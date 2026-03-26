/**
 * Transition audio tests — amplitude continuity during critical transitions.
 *
 * Uses the Faust offline polyphonic processor to verify that note lifecycle,
 * program-switch simulation, and voice stealing produce clean audio.
 *
 * Click detection method: RMS envelope (not per-sample delta).
 * We compute RMS over BUFFER_SIZE windows, then measure max change between
 * adjacent windows. A click shows as a large sudden RMS jump; normal
 * oscillation stays within the envelope.
 *
 * Thresholds calibrated from empirical observations:
 *   CLICK_RMS_JUMP = 0.5  — sudden amplitude burst at transition point
 *   VOICE_CLIP     = 4.0  — peak amplitude limit (4 voices can sum ~2×)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import { SYNTH_PARAMS } from "@/audio/params";
import synthDspSource from "@/audio/synth.dsp?raw";

// ── Config ──

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 128;
const VOICES = 4;

/** Max per-buffer RMS jump that indicates a click. */
const CLICK_RMS_JUMP = 0.5;

/** Max peak amplitude across VOICES voices (headroom). */
const VOICE_CLIP = 4.0;

// ── Processor interface ──

interface OfflineProc {
  start(): void;
  stop(): void;
  keyOn(channel: number, pitch: number, velocity: number): void;
  keyOff(channel: number, pitch: number, velocity: number): void;
  allNotesOff(hard: boolean): void;
  compute(input: Float32Array[], output: Float32Array[]): boolean;
  setParamValue(path: string, value: number): void;
  getParamValue(path: string): number;
}

// ── Audio helpers ──

function computeBuffers(proc: OfflineProc, numBuffers: number): Float32Array {
  const total = numBuffers * BUFFER_SIZE;
  const result = new Float32Array(total);
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);
  for (let i = 0; i < numBuffers; i++) {
    outL.fill(0); outR.fill(0);
    proc.compute([], [outL, outR]);
    let sumL = 0; let sumR = 0;
    for (let j = 0; j < BUFFER_SIZE; j++) { sumL += outL[j] * outL[j]; sumR += outR[j] * outR[j]; }
    result.set(sumL >= sumR ? outL : outR, i * BUFFER_SIZE);
  }
  return result;
}

function peakAmp(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > max) max = abs;
  }
  return max;
}

function bufRms(samples: Float32Array, offset: number, len: number): number {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += samples[offset + i] ** 2;
  return Math.sqrt(sum / len);
}

/**
 * Compute per-buffer RMS envelope and return the max jump between adjacent
 * buffers. This is the click metric — immune to intra-buffer oscillation.
 */
function maxRmsJump(samples: Float32Array): number {
  const numBufs = Math.floor(samples.length / BUFFER_SIZE);
  let maxJump = 0;
  let prevRms = bufRms(samples, 0, BUFFER_SIZE);
  for (let i = 1; i < numBufs; i++) {
    const rms = bufRms(samples, i * BUFFER_SIZE, BUFFER_SIZE);
    maxJump = Math.max(maxJump, Math.abs(rms - prevRms));
    prevRms = rms;
  }
  return maxJump;
}

function hasInvalidSamples(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (!isFinite(samples[i])) return true;
  }
  return false;
}

function resetParam(proc: OfflineProc, key: string): void {
  const p = SYNTH_PARAMS[key];
  if (p) proc.setParamValue(key, p.default);
}

// ── Faust compiler (module-level cache) ──

let cachedCompiler: unknown = null;
let cachedGen: {
  createOfflineProcessor(sr: number, bs: number, v: number): Promise<unknown>;
} | null = null;

async function ensureCompiled(): Promise<void> {
  if (cachedGen) return;
  const faustwasm = await import("@grame/faustwasm/dist/esm/index.js");
  if (!cachedCompiler) {
    const { loadFaustModule } = await import("./faust-loader.js");
    const testDir = new URL(".", import.meta.url).pathname;
    const libfaustPath = testDir + "../../public/libfaust-wasm/libfaust-wasm.js";
    const faustModule = await loadFaustModule(libfaustPath) as ReturnType<typeof faustwasm.instantiateFaustModuleFromFile> extends Promise<infer T> ? T : never;
    const libFaust = new faustwasm.LibFaust(faustModule);
    cachedCompiler = new faustwasm.FaustCompiler(libFaust);
  }
  const gen = new faustwasm.FaustPolyDspGenerator();
  await gen.compile(
    cachedCompiler as Parameters<typeof gen.compile>[0],
    "synth",
    synthDspSource,
    "-I libraries/",
  );
  cachedGen = gen as unknown as typeof cachedGen;
}

async function createProc(): Promise<OfflineProc> {
  await ensureCompiled();
  const proc = await (cachedGen as { createOfflineProcessor(sr: number, bs: number, v: number): Promise<unknown> })
    .createOfflineProcessor(SAMPLE_RATE, BUFFER_SIZE, VOICES);
  if (!proc) throw new Error("Failed to create offline processor");
  const p = proc as unknown as OfflineProc;
  p.start();
  return p;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Note onset and release
// ════════════════════════════════════════════════════════════════════════════

describe("Note onset and release transitions", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("attack ramp: amplitude rises smoothly (RMS increases monotonically)", () => {
    proc.setParamValue("attack", 0.1); // 100ms attack
    proc.allNotesOff(true);
    computeBuffers(proc, 10);
    proc.keyOn(0, 60, 100);
    const ramp = computeBuffers(proc, 35); // ~100ms, covers full attack
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "attack");

    // RMS envelope should rise, then plateau — not jump suddenly
    expect(maxRmsJump(ramp)).toBeLessThan(CLICK_RMS_JUMP);
    // Some sound must exist by the end of the ramp
    expect(bufRms(ramp, ramp.length - BUFFER_SIZE, BUFFER_SIZE)).toBeGreaterThan(0.001);
  });

  it("note release: produces non-zero tail (not instant silence)", () => {
    proc.setParamValue("release", 0.08); // 80ms release — fast, but audible tail
    proc.allNotesOff(true);
    computeBuffers(proc, 80); // flush prior state (~232ms — well past any prior release)
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 25); // let note fully open (~73ms)
    proc.keyOff(0, 60, 0);
    const releaseTail = computeBuffers(proc, 5); // first ~14ms — still in release
    // Wait well past release: 80ms release → skip 40 buffers (115ms) for safety
    computeBuffers(proc, 40);
    const silence = computeBuffers(proc, 5);
    resetParam(proc, "release");

    // Release tail should still have amplitude (not instant silence)
    expect(peakAmp(releaseTail)).toBeGreaterThan(0.001);
    // After full release period, near silence
    expect(peakAmp(silence)).toBeLessThan(0.01);
    // No NaN during release
    expect(hasInvalidSamples(releaseTail)).toBe(false);
  });

  it("release RMS envelope decays smoothly (no sudden amplitude jump)", () => {
    proc.setParamValue("release", 0.2);
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 25);
    proc.keyOff(0, 60, 0);
    const tail = computeBuffers(proc, 25); // capture decay
    computeBuffers(proc, 100);
    resetParam(proc, "release");

    // The RMS envelope during release should change gradually, not spike
    expect(maxRmsJump(tail)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("allNotesOff hard: produces silence within 2 buffers", () => {
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 2); // drain
    const silence = computeBuffers(proc, 5);
    expect(peakAmp(silence)).toBeLessThan(0.001);
  });

  it("two-note chord release: RMS envelope is smooth", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 10);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    computeBuffers(proc, 20);
    proc.keyOff(0, 60, 0);
    proc.keyOff(0, 64, 0);
    const tail = computeBuffers(proc, 20);
    computeBuffers(proc, 100);

    expect(maxRmsJump(tail)).toBeLessThan(CLICK_RMS_JUMP);
    expect(hasInvalidSamples(tail)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Parameter transitions (program switch simulation)
// ════════════════════════════════════════════════════════════════════════════

describe("Parameter transition continuity", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("cutoff change: DSP internal state preserved (no filter-state reset click)", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.setParamValue("cutoff", 8000);
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 15);
    proc.setParamValue("cutoff", 500);
    const transition = computeBuffers(proc, 10);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "cutoff");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(maxRmsJump(transition)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("program-switch pattern: pre-apply params → correct timbre from first note", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    // Simulate new engine with preset pre-applied before note starts
    proc.setParamValue("cutoff", 1500);
    proc.setParamValue("resonance", 0.9);
    proc.keyOn(0, 60, 100);
    const onset = computeBuffers(proc, 8);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "cutoff"); resetParam(proc, "resonance");

    expect(peakAmp(onset)).toBeGreaterThan(0.0001); // audible immediately
    expect(hasInvalidSamples(onset)).toBe(false);
    expect(maxRmsJump(onset)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("waveform change mid-note: no NaN, bounded RMS jump", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.setParamValue("waveform", 0); // SAW
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);
    proc.setParamValue("waveform", 2); // TRI
    const transition = computeBuffers(proc, 8);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "waveform");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(maxRmsJump(transition)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("resonance change mid-note: no NaN", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.setParamValue("resonance", 0.2);
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);
    proc.setParamValue("resonance", 0.95);
    const transition = computeBuffers(proc, 8);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "resonance");

    expect(hasInvalidSamples(transition)).toBe(false);
  });

  it("simultaneous cutoff + resonance + waveform change during 4-voice chord: no NaN, no clip", () => {
    // Worst-case simultaneous param blast: multiple params at once, 4 voices active
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.setParamValue("cutoff", 8000);
    proc.setParamValue("resonance", 0.3);
    proc.setParamValue("waveform", 0); // SAW
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 90);
    proc.keyOn(0, 67, 85);
    proc.keyOn(0, 71, 80);
    computeBuffers(proc, 15); // let chord settle

    // Simultaneous changes (simulates rapid encoder sweep on a new program patch)
    proc.setParamValue("cutoff", 500);
    proc.setParamValue("resonance", 0.9);
    proc.setParamValue("waveform", 2); // TRI

    const transition = computeBuffers(proc, 15);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "cutoff");
    resetParam(proc, "resonance");
    resetParam(proc, "waveform");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(peakAmp(transition)).toBeLessThan(VOICE_CLIP);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Voice stealing
// ════════════════════════════════════════════════════════════════════════════

describe("Voice stealing transitions", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("4-voice chord: all voices produce audio (no silent steal)", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    proc.keyOn(0, 67, 100);
    proc.keyOn(0, 71, 100);
    const chord = computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    expect(peakAmp(chord)).toBeGreaterThan(0.01);
    expect(hasInvalidSamples(chord)).toBe(false);
  });

  it("5th note voice steal: no NaN in output", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    proc.keyOn(0, 67, 100);
    proc.keyOn(0, 71, 100);
    computeBuffers(proc, 10);
    proc.keyOn(0, 74, 100); // 5th note — triggers steal
    const afterSteal = computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    expect(hasInvalidSamples(afterSteal)).toBe(false);
  });

  it("5th note voice steal: amplitude bounded (no runaway)", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    proc.keyOn(0, 67, 100);
    proc.keyOn(0, 71, 100);
    computeBuffers(proc, 10);
    proc.keyOn(0, 74, 100);
    const afterSteal = computeBuffers(proc, 15);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    // Voice stealing causes an RMS jump (new voice attacks) — only check bounds and NaN
    expect(hasInvalidSamples(afterSteal)).toBe(false);
    expect(peakAmp(afterSteal)).toBeLessThan(VOICE_CLIP);
  });

  it("rapid note triggering: no accumulated NaN or clip", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 10);
    for (let i = 0; i < 8; i++) {
      proc.keyOn(0, 60, 100);
      computeBuffers(proc, 2);
      proc.keyOff(0, 60, 0);
      computeBuffers(proc, 2);
    }
    const final = computeBuffers(proc, 5);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    expect(hasInvalidSamples(final)).toBe(false);
    expect(peakAmp(final)).toBeLessThan(VOICE_CLIP);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Latch simulation (frozen vs active engine)
// ════════════════════════════════════════════════════════════════════════════

describe("Latch pattern (frozen engine simulation)", () => {
  let frozen: OfflineProc;
  let active: OfflineProc;

  beforeAll(async () => {
    frozen = await createProc();
    active = await createProc();
  }, 30_000);

  it("frozen engine keeps producing audio independently of new engine", () => {
    frozen.allNotesOff(true); computeBuffers(frozen, 10);
    frozen.keyOn(0, 60, 100);
    computeBuffers(frozen, 10);

    active.allNotesOff(true); computeBuffers(active, 10);
    active.keyOn(0, 72, 100);

    const frozenOut = computeBuffers(frozen, 10);
    const activeOut = computeBuffers(active, 10);

    frozen.allNotesOff(true); active.allNotesOff(true);
    computeBuffers(frozen, 50); computeBuffers(active, 50);

    expect(peakAmp(frozenOut)).toBeGreaterThan(0.001);
    expect(peakAmp(activeOut)).toBeGreaterThan(0.001);
  });

  it("param changes on active don't affect frozen (processors are independent)", () => {
    frozen.allNotesOff(true); computeBuffers(frozen, 20);
    active.allNotesOff(true); computeBuffers(active, 20);

    frozen.setParamValue("cutoff", 8000);
    frozen.keyOn(0, 60, 100);
    computeBuffers(frozen, 10);
    const frozenBefore = computeBuffers(frozen, 5);

    active.setParamValue("cutoff", 100); // drastic change on active
    active.keyOn(0, 60, 100);
    computeBuffers(active, 10);

    const frozenAfter = computeBuffers(frozen, 5);

    frozen.allNotesOff(true); active.allNotesOff(true);
    computeBuffers(frozen, 50); computeBuffers(active, 50);
    resetParam(frozen, "cutoff"); resetParam(active, "cutoff");

    // Frozen engine was unaffected — both windows should be non-zero
    expect(peakAmp(frozenBefore)).toBeGreaterThan(0.001);
    expect(peakAmp(frozenAfter)).toBeGreaterThan(0.001);
    // Frozen engine's RMS should be in similar range before and after
    const rmsBefore = bufRms(frozenBefore, 0, frozenBefore.length);
    const rmsAfter = bufRms(frozenAfter, 0, frozenAfter.length);
    expect(Math.abs(rmsBefore - rmsAfter)).toBeLessThan(0.3); // similar level
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. LFO modulation transitions
// ════════════════════════════════════════════════════════════════════════════

describe("LFO modulation mid-note transitions", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("enabling lfo_to_pitch mid-note: no click (RMS jump below threshold)", () => {
    proc.allNotesOff(true);
    proc.setParamValue("lfo_to_pitch", 0);
    proc.setParamValue("lfo_depth", 0.5);
    proc.setParamValue("lfo_rate", 4.0);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 20); // let note settle

    // Enable pitch LFO mid-note
    proc.setParamValue("lfo_to_pitch", 1);
    const transition = computeBuffers(proc, 20);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "lfo_to_pitch");
    resetParam(proc, "lfo_depth");
    resetParam(proc, "lfo_rate");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(maxRmsJump(transition)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("enabling lfo_to_filter mid-note: no click", () => {
    proc.allNotesOff(true);
    proc.setParamValue("lfo_to_filter", 0);
    proc.setParamValue("lfo_depth", 0.6);
    proc.setParamValue("lfo_rate", 2.0);
    proc.setParamValue("cutoff", 4000);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 20);

    proc.setParamValue("lfo_to_filter", 1);
    const transition = computeBuffers(proc, 20);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "lfo_to_filter");
    resetParam(proc, "lfo_depth");
    resetParam(proc, "lfo_rate");
    resetParam(proc, "cutoff");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(maxRmsJump(transition)).toBeLessThan(CLICK_RMS_JUMP);
  });

  it("lfo_depth sweep from 0 to 1.0 mid-note: no NaN", () => {
    proc.allNotesOff(true);
    proc.setParamValue("lfo_to_pitch", 1);
    proc.setParamValue("lfo_rate", 5.0);
    proc.setParamValue("lfo_depth", 0);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);

    // Sweep lfo_depth from 0 to 1.0 in steps
    for (let i = 0; i <= 10; i++) {
      proc.setParamValue("lfo_depth", i / 10);
      computeBuffers(proc, 2);
    }
    const atMax = computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "lfo_to_pitch");
    resetParam(proc, "lfo_depth");
    resetParam(proc, "lfo_rate");

    expect(hasInvalidSamples(atMax)).toBe(false);
    expect(peakAmp(atMax)).toBeLessThan(VOICE_CLIP);
  });

  it("lfo_rate change mid-note: no NaN, audio continues", () => {
    proc.allNotesOff(true);
    proc.setParamValue("lfo_to_filter", 1);
    proc.setParamValue("lfo_depth", 0.8);
    proc.setParamValue("lfo_rate", 1.0);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 20);

    // Rapid rate change
    proc.setParamValue("lfo_rate", 8.0);
    const afterChange = computeBuffers(proc, 15);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "lfo_to_filter");
    resetParam(proc, "lfo_depth");
    resetParam(proc, "lfo_rate");

    expect(hasInvalidSamples(afterChange)).toBe(false);
    expect(peakAmp(afterChange)).toBeGreaterThan(0.001); // audio continues
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Unison mode transitions
// ════════════════════════════════════════════════════════════════════════════

describe("Unison mode transitions", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("enabling unison mid-note: no NaN in output", () => {
    proc.allNotesOff(true);
    proc.setParamValue("unison", 0); // poly mode
    proc.setParamValue("unison_detune", 0.3);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 20);

    // Toggle to unison mid-note (in DSP: triggers per-voice detuning)
    proc.setParamValue("unison", 1);
    const transition = computeBuffers(proc, 20);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "unison");
    resetParam(proc, "unison_detune");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(peakAmp(transition)).toBeLessThan(VOICE_CLIP);
  });

  it("disabling unison mid-note: no NaN, no clip", () => {
    proc.allNotesOff(true);
    proc.setParamValue("unison", 1); // unison mode
    proc.setParamValue("unison_detune", 0.5);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    computeBuffers(proc, 20);

    proc.setParamValue("unison", 0); // back to poly
    const transition = computeBuffers(proc, 20);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "unison");
    resetParam(proc, "unison_detune");

    expect(hasInvalidSamples(transition)).toBe(false);
    expect(peakAmp(transition)).toBeLessThan(VOICE_CLIP);
  });

  it("unison_detune sweep with active notes: no NaN", () => {
    proc.allNotesOff(true);
    proc.setParamValue("unison", 1);
    proc.setParamValue("unison_detune", 0);
    computeBuffers(proc, 20);

    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);

    // Sweep detune from 0 to 1.0
    for (let i = 0; i <= 10; i++) {
      proc.setParamValue("unison_detune", i / 10);
      computeBuffers(proc, 2);
    }
    const atMax = computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);
    resetParam(proc, "unison");
    resetParam(proc, "unison_detune");

    expect(hasInvalidSamples(atMax)).toBe(false);
    expect(peakAmp(atMax)).toBeGreaterThan(0.001);
    expect(peakAmp(atMax)).toBeLessThan(VOICE_CLIP);
  });
});
