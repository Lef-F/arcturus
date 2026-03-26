/**
 * Effects signal integration tests — effects.dsp offline verification.
 *
 * Uses Faust offline mono processor to compile effects.dsp, feed a sine
 * burst as input, sweep all 17 FX params at min/max/default, and verify
 * signal integrity: no NaN, no silence (except master=0), no clipping.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import { SYNTH_PARAMS } from "@/audio/params";
import effectsDspSource from "@/audio/effects.dsp?raw";

// ── Config ──

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 128;
const SINE_FREQ = 440; // A4 input signal
const SINE_AMP = 0.5;  // Moderate level — avoids clipping even with drive

// ── FX param keys (the 17 params that live in effects.dsp) ──

const FX_PARAM_KEYS = [
  "drive", "phaser_rate", "phaser_depth", "phaser_feedback",
  "chorus_rate", "chorus_depth", "chorus_mode",
  "delay_time", "delay_feedback", "delay_mod",
  "reverb_damp", "reverb_mix", "reverb_size",
  "eq_lo", "eq_hi", "stereo_width", "master",
] as const;

const FX_PARAMS = FX_PARAM_KEYS.map(key => ({ key, param: SYNTH_PARAMS[key] }));

// ── Mono offline processor interface ──

interface MonoProc {
  start(): void;
  stop(): void;
  compute(input: Float32Array[], output: Float32Array[]): boolean;
  setParamValue(path: string, value: number): void;
  getParamValue(path: string): number;
}

// ── Audio helpers ──

/** Single-period sine wave at SINE_FREQ repeated to fill numSamples. */
function sineBuffer(numSamples: number): Float32Array {
  const buf = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buf[i] = SINE_AMP * Math.sin(2 * Math.PI * SINE_FREQ * (i / SAMPLE_RATE));
  }
  return buf;
}

function peakAmp(buf: Float32Array): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const abs = Math.abs(buf[i]);
    if (abs > max) max = abs;
  }
  return max;
}

function hasInvalidSamples(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (!isFinite(buf[i])) return true;
  }
  return false;
}

/**
 * Feed numBuffers of sine input through the processor.
 * Returns peak amplitude of the louder stereo channel over the run.
 */
function runWithSine(proc: MonoProc, numBuffers: number): { peak: number; hasNaN: boolean } {
  let peak = 0;
  let hasNaN = false;
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);

  for (let i = 0; i < numBuffers; i++) {
    const input = sineBuffer(BUFFER_SIZE);
    outL.fill(0); outR.fill(0);
    proc.compute([input], [outL, outR]);
    if (hasInvalidSamples(outL) || hasInvalidSamples(outR)) hasNaN = true;
    peak = Math.max(peak, peakAmp(outL), peakAmp(outR));
  }
  return { peak, hasNaN };
}

/** Run numBuffers of silence to flush delay/reverb tails. */
function flush(proc: MonoProc, numBuffers = 200): void {
  const silence = new Float32Array(BUFFER_SIZE);
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);
  for (let i = 0; i < numBuffers; i++) {
    proc.compute([silence], [outL, outR]);
  }
}

// ── Faust offline compiler (cached at module level) ──

let cachedCompiler: unknown = null;
let cachedGen: {
  createOfflineProcessor(sr: number, bs: number): Promise<unknown>;
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

  const gen = new faustwasm.FaustMonoDspGenerator();
  await gen.compile(
    cachedCompiler as Parameters<typeof gen.compile>[0],
    "effects",
    effectsDspSource,
    "-I libraries/",
  );
  cachedGen = gen as unknown as typeof cachedGen;
}

async function createProcessor(): Promise<MonoProc> {
  await ensureCompiled();
  const proc = await (cachedGen as { createOfflineProcessor(sr: number, bs: number): Promise<unknown> }).createOfflineProcessor(SAMPLE_RATE, BUFFER_SIZE);
  if (!proc) throw new Error("Failed to create effects offline processor");
  const p = proc as MonoProc;
  p.start();
  return p;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Core signal invariants
// ════════════════════════════════════════════════════════════════════════════

describe("Effects core signal invariants", () => {
  let proc: MonoProc;
  beforeAll(async () => { proc = await createProcessor(); }, 30_000);

  it("passes signal through with default params (non-zero output)", () => {
    flush(proc, 10);
    const { peak } = runWithSine(proc, 20);
    expect(peak).toBeGreaterThan(0.01);
  });

  it("no NaN or Infinity with default params", () => {
    flush(proc, 10);
    const { hasNaN } = runWithSine(proc, 20);
    expect(hasNaN).toBe(false);
  });

  it("no clipping with SINE_AMP=0.5 and default params", () => {
    flush(proc, 10);
    const { peak } = runWithSine(proc, 20);
    expect(peak).toBeLessThan(2.0); // generous headroom — overdrive at 0 default
  });

  it("master=0 produces silence", () => {
    flush(proc);
    proc.setParamValue("master", 0);
    const { peak } = runWithSine(proc, 20);
    proc.setParamValue("master", SYNTH_PARAMS["master"].default);
    expect(peak).toBeLessThan(0.0001);
  });

  it("left and right output channels are both non-zero", () => {
    flush(proc, 10);
    const outL = new Float32Array(BUFFER_SIZE);
    const outR = new Float32Array(BUFFER_SIZE);
    proc.compute([sineBuffer(BUFFER_SIZE)], [outL, outR]);
    expect(peakAmp(outL)).toBeGreaterThan(0.001);
    expect(peakAmp(outR)).toBeGreaterThan(0.001);
  });

  it("stereo_width=0 collapses to mono (L==R) but remains non-silent", () => {
    flush(proc, 10);
    proc.setParamValue("stereo_width", 0);
    const outL = new Float32Array(BUFFER_SIZE);
    const outR = new Float32Array(BUFFER_SIZE);
    proc.compute([sineBuffer(BUFFER_SIZE)], [outL, outR]);
    proc.setParamValue("stereo_width", SYNTH_PARAMS["stereo_width"].default);
    expect(peakAmp(outL)).toBeGreaterThan(0.001);
    expect(peakAmp(outR)).toBeGreaterThan(0.001);
    // At width=0 L and R should be identical (mono collapse)
    let maxDiff = 0;
    for (let i = 0; i < BUFFER_SIZE; i++) maxDiff = Math.max(maxDiff, Math.abs(outL[i] - outR[i]));
    expect(maxDiff).toBeLessThan(0.0001);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Per-param sweep: no NaN at min/max/default
// ════════════════════════════════════════════════════════════════════════════

describe("Effects per-param NaN sweep", () => {
  let proc: MonoProc;
  beforeAll(async () => { proc = await createProcessor(); }, 30_000);

  for (const { key, param } of FX_PARAMS) {
    for (const [label, value] of [
      ["min", param.min],
      ["max", param.max],
      ["default", param.default],
    ] as const) {
      it(`${key}: no NaN at ${label}=${value}`, () => {
        flush(proc, 50);
        proc.setParamValue(key, value);
        const { hasNaN } = runWithSine(proc, 10);
        proc.setParamValue(key, param.default);
        expect(hasNaN).toBe(false);
      });
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Per-param sweep: signal presence at min/max (not silence)
// ════════════════════════════════════════════════════════════════════════════

describe("Effects per-param signal presence", () => {
  let proc: MonoProc;
  beforeAll(async () => { proc = await createProcessor(); }, 30_000);

  for (const { key, param } of FX_PARAMS) {
    for (const [label, value] of [["min", param.min], ["max", param.max]] as const) {
      // master=0 is expected to produce silence — skip signal presence check
      if (key === "master" && value === 0) continue;

      it(`${key}: produces sound at ${label}=${value}`, () => {
        flush(proc, 50);
        proc.setParamValue(key, value);
        const { peak } = runWithSine(proc, 15);
        proc.setParamValue(key, param.default);
        expect(peak).toBeGreaterThan(0.001);
      });
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Pairwise feedback stability: nested feedback chains must not produce NaN
// ════════════════════════════════════════════════════════════════════════════

describe("Effects pairwise feedback stability", () => {
  let proc: MonoProc;
  beforeAll(async () => { proc = await createProcessor(); }, 30_000);

  it("max drive + max delay_feedback + max reverb: no NaN (nested feedback stability)", () => {
    // All three feedback paths active simultaneously: drive → delay → reverb.
    // This is the worst-case combo — each stage re-feeds into the next.
    flush(proc, 100);
    proc.setParamValue("drive", 1.0);
    proc.setParamValue("delay_feedback", 0.95);
    proc.setParamValue("reverb_mix", 1.0);
    proc.setParamValue("reverb_size", 1.0);
    proc.setParamValue("phaser_feedback", 0.9);

    // Long run to let reverb tail accumulate — enough to trigger instability if present
    const { hasNaN } = runWithSine(proc, 200);
    flush(proc, 200);

    // Restore defaults
    proc.setParamValue("drive", SYNTH_PARAMS["drive"].default);
    proc.setParamValue("delay_feedback", SYNTH_PARAMS["delay_feedback"].default);
    proc.setParamValue("reverb_mix", SYNTH_PARAMS["reverb_mix"].default);
    proc.setParamValue("reverb_size", SYNTH_PARAMS["reverb_size"].default);
    proc.setParamValue("phaser_feedback", SYNTH_PARAMS["phaser_feedback"].default);

    expect(hasNaN).toBe(false);
  });

  it("extreme EQ gains + max reverb: no NaN (eq_lo=+12, eq_hi=-12, reverb_mix=1.0)", () => {
    flush(proc, 100);
    proc.setParamValue("eq_lo", 12);
    proc.setParamValue("eq_hi", -12);
    proc.setParamValue("reverb_mix", 1.0);
    proc.setParamValue("reverb_damp", 0);

    const { hasNaN } = runWithSine(proc, 100);
    flush(proc, 100);

    proc.setParamValue("eq_lo", SYNTH_PARAMS["eq_lo"].default);
    proc.setParamValue("eq_hi", SYNTH_PARAMS["eq_hi"].default);
    proc.setParamValue("reverb_mix", SYNTH_PARAMS["reverb_mix"].default);
    proc.setParamValue("reverb_damp", SYNTH_PARAMS["reverb_damp"].default);

    expect(hasNaN).toBe(false);
  });

  it("stereo_width=0 + long delay_feedback does not collapse to silence", () => {
    // Width=0 means mono, but delay feedback should still keep signal alive
    flush(proc, 100);
    proc.setParamValue("stereo_width", 0);
    proc.setParamValue("delay_feedback", 0.9);
    proc.setParamValue("delay_time", 0.25);

    const { peak, hasNaN } = runWithSine(proc, 100);
    flush(proc, 100);

    proc.setParamValue("stereo_width", SYNTH_PARAMS["stereo_width"].default);
    proc.setParamValue("delay_feedback", SYNTH_PARAMS["delay_feedback"].default);
    proc.setParamValue("delay_time", SYNTH_PARAMS["delay_time"].default);

    expect(hasNaN).toBe(false);
    expect(peak).toBeGreaterThan(0.001); // must not go silent
  });
});
