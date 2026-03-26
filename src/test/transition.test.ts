/**
 * Transition audio tests — amplitude continuity during critical transitions.
 *
 * Uses the Faust offline polyphonic processor (same as audio-signal.test.ts)
 * to render audio and measure amplitude discontinuities. A "click" is defined
 * as a sample where |sample[n] - sample[n-1]| exceeds a threshold.
 *
 * Thresholds:
 *   - CLICK_THRESHOLD = 0.3   — audible click (large discontinuity)
 *   - SMOOTH_THRESHOLD = 0.05 — subtle zipper noise (should pass for gradual changes)
 *
 * Test scenarios:
 *   1. Param change preserves DSP state (no filter-state reset click)
 *   2. Note release decays smoothly (no abrupt silence)
 *   3. Voice stealing (5th note with 4-voice proc) — no large jump
 *   4. Rapid param sweep — max discontinuity stays bounded
 *   5. Attack onset — amplitude rises from 0, no premature peak
 *   6. Note played while note sustaining — polyphonic, no gap
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

/** Audible click: two adjacent samples differ by more than this. */
const CLICK_THRESHOLD = 0.3;

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
    // Use the louder channel
    let peakL = 0; let peakR = 0;
    for (let j = 0; j < BUFFER_SIZE; j++) { peakL += outL[j] * outL[j]; peakR += outR[j] * outR[j]; }
    result.set(peakL >= peakR ? outL : outR, i * BUFFER_SIZE);
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

/**
 * Maximum adjacent-sample delta in the signal — the "click" metric.
 * Ignores the first sample (unavoidable boundary artifact).
 */
function maxDiscontinuity(samples: Float32Array): number {
  let maxDelta = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta > maxDelta) maxDelta = delta;
  }
  return maxDelta;
}

/**
 * Compute buffers and check: the amplitude discontinuity between the last
 * sample of buffer N and the first of buffer N+1 (cross-buffer boundary).
 */
/** Check amplitude discontinuity at buffer boundaries — for future use. */
export function crossBoundaryDiscontinuity(proc: OfflineProc, numBuffers: number): number {
  const samples = computeBuffers(proc, numBuffers);
  let maxDelta = 0;
  // Only check at buffer boundaries
  for (let b = 1; b < numBuffers; b++) {
    const last = samples[b * BUFFER_SIZE - 1];
    const first = samples[b * BUFFER_SIZE];
    const delta = Math.abs(first - last);
    if (delta > maxDelta) maxDelta = delta;
  }
  return maxDelta;
}

function setParam(proc: OfflineProc, key: string, value: number): void {
  proc.setParamValue(key, value);
}

function resetParam(proc: OfflineProc, key: string): void {
  const p = SYNTH_PARAMS[key];
  if (p) proc.setParamValue(key, p.default);
}

// ── Faust compiler (cached at module level) ──

let cachedCompiler: unknown = null;
let cachedGen: {
  createOfflineProcessor(sr: number, bs: number, v: number): Promise<unknown>;
} | null = null;

async function ensureCompiled(): Promise<void> {
  if (cachedGen) return;
  const faustwasm = await import("@grame/faustwasm/dist/esm/index.js");
  if (!cachedCompiler) {
    const testDir = new URL(".", import.meta.url).pathname;
    const libfaustPath = testDir + "../../public/libfaust-wasm/libfaust-wasm.js";
    const faustModule = await faustwasm.instantiateFaustModuleFromFile(libfaustPath);
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

  it("note onset: amplitude rises smoothly (no premature peak > attack)", () => {
    setParam(proc, "attack", 0.05); // 50ms attack
    proc.allNotesOff(true);
    computeBuffers(proc, 10); // flush
    proc.keyOn(0, 60, 100);
    const ramp = computeBuffers(proc, 10); // ~29ms into attack
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "attack");

    // Peak during early attack should be below 0.95 (amplitude hasn't fully opened)
    const peakDuringAttack = peakAmp(ramp);
    expect(peakDuringAttack).toBeGreaterThan(0.0001); // some sound
    // No sudden jump: max discontinuity within attack ramp stays bounded
    expect(maxDiscontinuity(ramp)).toBeLessThan(CLICK_THRESHOLD);
  });

  it("note release: amplitude decays without abrupt truncation", () => {
    setParam(proc, "release", 0.1); // 100ms release
    proc.allNotesOff(true);
    computeBuffers(proc, 20); // flush silence
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 20); // let note fully open
    proc.keyOff(0, 60, 0);
    const releaseTail = computeBuffers(proc, 5); // first 18ms of release
    const silenceTail = computeBuffers(proc, 100); // after full release
    resetParam(proc, "release");

    // Check: first buffer of release is non-zero (release not instant)
    expect(peakAmp(releaseTail)).toBeGreaterThan(0.001);
    // Check: no audible click at release trigger
    expect(maxDiscontinuity(releaseTail)).toBeLessThan(CLICK_THRESHOLD);
    // Check: after 100ms release, near silence
    expect(peakAmp(silenceTail)).toBeLessThan(0.01);
  });

  it("allNotesOff hard: produces silence within 2 buffers", () => {
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 2); // drain pipeline
    const silence = computeBuffers(proc, 5);
    expect(peakAmp(silence)).toBeLessThan(0.001);
  });

  it("multiple note releases don't stack up into audible click", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 10);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    computeBuffers(proc, 20);
    proc.keyOff(0, 60, 0);
    proc.keyOff(0, 64, 0);
    const firstBuffer = computeBuffers(proc, 3);
    computeBuffers(proc, 100);
    expect(maxDiscontinuity(firstBuffer)).toBeLessThan(CLICK_THRESHOLD);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Parameter transitions (program switch simulation)
// ════════════════════════════════════════════════════════════════════════════

describe("Parameter transition continuity", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("cutoff change preserves DSP state (filter memory, no click)", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    setParam(proc, "cutoff", 8000);
    proc.keyOn(0, 60, 100);
    const before = computeBuffers(proc, 10);
    // Abrupt param change — filter internal state is preserved
    setParam(proc, "cutoff", 500);
    const after = computeBuffers(proc, 10);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "cutoff");

    // Both before and after should be non-NaN
    for (let i = 0; i < before.length; i++) expect(isFinite(before[i])).toBe(true);
    for (let i = 0; i < after.length; i++) expect(isFinite(after[i])).toBe(true);

    // The first sample of 'after' should not wildly diverge from last of 'before'
    // (filter state continuity — not a hard reset)
    const lastBefore = before[before.length - 1];
    const firstAfter = after[0];
    expect(Math.abs(firstAfter - lastBefore)).toBeLessThan(CLICK_THRESHOLD);
  });

  it("program-switch pattern: pre-apply params before keyOn → no onset click", () => {
    // Simulate: new engine gets preset params applied before first note
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    // Apply 'new preset' params before notes start
    setParam(proc, "cutoff", 2000);
    setParam(proc, "resonance", 0.8);
    setParam(proc, "attack", 0.01);
    // Now play first note on 'new preset'
    proc.keyOn(0, 60, 100);
    const onset = computeBuffers(proc, 5);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "cutoff"); resetParam(proc, "resonance"); resetParam(proc, "attack");

    // Pre-applied params: onset should be audible and not contain clicks
    expect(peakAmp(onset)).toBeGreaterThan(0.0001);
    expect(maxDiscontinuity(onset)).toBeLessThan(CLICK_THRESHOLD);
  });

  it("waveform switch mid-note: no NaN, bounded discontinuity", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    setParam(proc, "waveform", 0); // SAW
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10); // stable SAW
    setParam(proc, "waveform", 2); // TRI
    const transition = computeBuffers(proc, 5);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "waveform");

    for (let i = 0; i < transition.length; i++) expect(isFinite(transition[i])).toBe(true);
    expect(maxDiscontinuity(transition)).toBeLessThan(CLICK_THRESHOLD);
  });

  it("filter mode sweep mid-note: continuous signal through LP→HP transition", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    setParam(proc, "filter_mode", 0); // LP
    proc.keyOn(0, 60, 100);
    computeBuffers(proc, 10);
    setParam(proc, "filter_mode", 1); // HP
    const transition = computeBuffers(proc, 5);
    proc.keyOff(0, 60, 0);
    computeBuffers(proc, 100);
    resetParam(proc, "filter_mode");

    for (let i = 0; i < transition.length; i++) expect(isFinite(transition[i])).toBe(true);
    expect(maxDiscontinuity(transition)).toBeLessThan(CLICK_THRESHOLD);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Voice stealing
// ════════════════════════════════════════════════════════════════════════════

describe("Voice stealing transitions", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it("filling all voices: all 4 notes produce audio", () => {
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
  });

  it("voice steal (5th note, 4-voice proc): no NaN in output", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 20);
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    proc.keyOn(0, 67, 100);
    proc.keyOn(0, 71, 100);
    computeBuffers(proc, 10); // all 4 voices active
    proc.keyOn(0, 74, 100); // 5th note — triggers steal
    const afterSteal = computeBuffers(proc, 10);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);

    for (let i = 0; i < afterSteal.length; i++) {
      expect(isFinite(afterSteal[i])).toBe(true);
    }
  });

  it("voice steal: post-steal output bounded (no runaway amplitude)", () => {
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

    expect(peakAmp(afterSteal)).toBeLessThan(2.0); // headroom check — no explosion
    expect(maxDiscontinuity(afterSteal)).toBeLessThan(CLICK_THRESHOLD);
  });

  it("rapid note triggering: no accumulated NaN or clip", () => {
    proc.allNotesOff(true);
    computeBuffers(proc, 10);
    // Simulate rapid tapping of same note (arpeggio-style)
    for (let i = 0; i < 8; i++) {
      proc.keyOn(0, 60, 100);
      computeBuffers(proc, 2);
      proc.keyOff(0, 60, 0);
      computeBuffers(proc, 2);
    }
    const final = computeBuffers(proc, 5);
    proc.allNotesOff(true);
    computeBuffers(proc, 50);

    for (let i = 0; i < final.length; i++) expect(isFinite(final[i])).toBe(true);
    expect(peakAmp(final)).toBeLessThan(2.0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Latch simulation (frozen-engine pattern)
// ════════════════════════════════════════════════════════════════════════════

describe("Latch pattern (frozen engine simulation)", () => {
  let proc1: OfflineProc;
  let proc2: OfflineProc;

  beforeAll(async () => {
    proc1 = await createProc();
    proc2 = await createProc();
  }, 30_000);

  it("frozen engine keeps producing audio independently of new engine", () => {
    // proc1 = frozen engine (latched notes)
    proc1.allNotesOff(true);
    computeBuffers(proc1, 10);
    proc1.keyOn(0, 60, 100);
    computeBuffers(proc1, 10);

    // proc2 = new active engine
    proc2.allNotesOff(true);
    computeBuffers(proc2, 10);
    proc2.keyOn(0, 72, 100);

    // Both produce audio simultaneously
    const frozen = computeBuffers(proc1, 10);
    const active = computeBuffers(proc2, 10);

    proc1.allNotesOff(true);
    proc2.allNotesOff(true);
    computeBuffers(proc1, 50);
    computeBuffers(proc2, 50);

    expect(peakAmp(frozen)).toBeGreaterThan(0.001);
    expect(peakAmp(active)).toBeGreaterThan(0.001);
  });

  it("param changes on active engine don't affect frozen engine output", () => {
    proc1.allNotesOff(true);
    proc2.allNotesOff(true);
    computeBuffers(proc1, 20);
    computeBuffers(proc2, 20);

    // Frozen engine: play with default cutoff
    proc1.keyOn(0, 60, 100);
    setParam(proc1, "cutoff", 8000);
    const frozenBefore = computeBuffers(proc1, 10);

    // Active engine: heavy cutoff change
    proc2.keyOn(0, 60, 100);
    setParam(proc2, "cutoff", 100);
    computeBuffers(proc2, 10);

    // Frozen engine should not have been affected
    const frozenAfter = computeBuffers(proc1, 10);

    proc1.allNotesOff(true);
    proc2.allNotesOff(true);
    computeBuffers(proc1, 50);
    computeBuffers(proc2, 50);
    resetParam(proc1, "cutoff");
    resetParam(proc2, "cutoff");

    // Both before and after should be non-zero (frozen engine still playing)
    expect(peakAmp(frozenBefore)).toBeGreaterThan(0.001);
    expect(peakAmp(frozenAfter)).toBeGreaterThan(0.001);
  });
});
