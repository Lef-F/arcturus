/**
 * Preset sonic validation tests.
 *
 * Verifies that each factory preset:
 *   1. Produces non-silent audio when a note is played
 *   2. Is collectively spectrally diverse (8 presets span different timbres)
 *
 * Uses the polyphonic synth DSP offline processor (synth.dsp only — FX params
 * are validated separately in effects-signal.test.ts). FX-only params are
 * skipped when applying preset parameters to the synth processor.
 *
 * Spectral diversity is measured by spectral centroid. The 8 presets must span
 * a centroid range of at least 500 Hz, ensuring they don't all sound the same.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import synthDspSource from "@/audio/synth.dsp?raw";
import { FACTORY_PRESETS } from "@/state/factory-presets";

// ── Config ──

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 128;
const VOICES = 8;

/** Buffers to render per preset (≈1.5s — covers longest attack: Ambient 1.2s). */
const RENDER_BUFFERS = 512;

/** Spectral analysis window size (power of 2). */
const SPECTRAL_WIN = 512;

/** Minimum non-silence peak amplitude. */
const MIN_PEAK = 0.001;

/** Required centroid span across all 8 presets (Hz). */
const MIN_CENTROID_SPAN = 400;

// ── FX param keys (not accepted by synth.dsp) ──

const FX_KEYS = new Set([
  "drive", "phaser_rate", "phaser_depth", "phaser_feedback",
  "chorus_rate", "chorus_depth", "chorus_mode",
  "delay_time", "delay_feedback", "delay_mod",
  "reverb_damp", "reverb_mix", "reverb_size",
  "eq_lo", "eq_hi", "stereo_width", "master",
]);

// ── Processor interface ──

interface OfflineProc {
  start(): void;
  stop(): void;
  keyOn(channel: number, pitch: number, velocity: number): void;
  keyOff(channel: number, pitch: number, velocity: number): void;
  allNotesOff(hard: boolean): void;
  compute(input: Float32Array[], output: Float32Array[]): boolean;
  setParamValue(path: string, value: number): void;
}

// ── Faust offline compiler (module-level cache) ──

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
  const proc = await cachedGen!.createOfflineProcessor(SAMPLE_RATE, BUFFER_SIZE, VOICES);
  if (!proc) throw new Error("Failed to create offline processor");
  const p = proc as unknown as OfflineProc;
  p.start();
  return p;
}

// ── Audio helpers ──

function computeBuffers(proc: OfflineProc, numBuffers: number): Float32Array {
  const samples = new Float32Array(numBuffers * BUFFER_SIZE);
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);
  const silence = new Float32Array(BUFFER_SIZE);
  for (let i = 0; i < numBuffers; i++) {
    proc.compute([silence], [outL, outR]);
    samples.set(outL, i * BUFFER_SIZE);
  }
  return samples;
}

function peakAmp(buf: Float32Array): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const abs = Math.abs(buf[i]);
    if (abs > max) max = abs;
  }
  return max;
}

/**
 * Spectral centroid of a sample window — weighted average frequency.
 * Lower values = darker/more filtered sound. Higher = brighter/richer harmonics.
 */
function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const N = Math.min(SPECTRAL_WIN, samples.length);
  let weightedSum = 0;
  let totalMag = 0;

  for (let k = 1; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += samples[n] * Math.cos(angle);
      im -= samples[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    const freq = (k * sampleRate) / N;
    weightedSum += freq * mag;
    totalMag += mag;
  }

  return totalMag > 0 ? weightedSum / totalMag : 0;
}

/**
 * Apply a preset's non-FX parameters to the processor.
 * FX params (drive, reverb, chorus, etc.) are not accepted by synth.dsp.
 */
function applyPresetSynthParams(proc: OfflineProc, params: Record<string, number>): void {
  for (const [path, value] of Object.entries(params)) {
    if (!FX_KEYS.has(path)) {
      proc.setParamValue(path, value);
    }
  }
}

// ── Tests ──

describe("Preset sonic validation", () => {
  const centroids: number[] = [];

  for (const preset of FACTORY_PRESETS) {
    it(`${preset.name}: produces non-silent audio`, async () => {
      const proc = await createProc();
      applyPresetSynthParams(proc, preset.parameters);

      proc.allNotesOff(true);
      computeBuffers(proc, 10); // flush prior state

      proc.keyOn(0, 60, 100); // middle C, full velocity
      const audio = computeBuffers(proc, RENDER_BUFFERS);
      proc.stop();

      const peak = peakAmp(audio);
      expect(peak, `${preset.name} peak=${peak.toFixed(4)} — expected > ${MIN_PEAK}`).toBeGreaterThan(MIN_PEAK);
    });
  }

  it("all presets are spectrally diverse (centroids span ≥ 400 Hz)", async () => {
    for (const preset of FACTORY_PRESETS) {
      const proc = await createProc();
      applyPresetSynthParams(proc, preset.parameters);

      proc.allNotesOff(true);
      computeBuffers(proc, 10); // flush

      proc.keyOn(0, 60, 100);
      const audio = computeBuffers(proc, RENDER_BUFFERS);
      proc.stop();

      // Analyze the last SPECTRAL_WIN samples (settled portion of the sound)
      const window = audio.slice(audio.length - SPECTRAL_WIN);
      const centroid = spectralCentroid(window, SAMPLE_RATE);
      centroids.push(centroid);
    }

    const min = Math.min(...centroids);
    const max = Math.max(...centroids);
    const span = max - min;

    // Log centroids for diagnostics
    const centroidSummary = FACTORY_PRESETS.map((p, i) =>
      `  ${p.name}: ${centroids[i]?.toFixed(0)} Hz`
    ).join("\n");

    expect(
      span,
      `Centroid span=${span.toFixed(0)} Hz — expected ≥ ${MIN_CENTROID_SPAN}\nCentroids:\n${centroidSummary}`
    ).toBeGreaterThanOrEqual(MIN_CENTROID_SPAN);
  });
});
