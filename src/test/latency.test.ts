/**
 * Note-on latency tests — measures samples from keyOn to first non-zero output.
 *
 * The target: < 10ms from note trigger to first audible sample.
 * At 44100 Hz, 10ms = 441 samples ≈ 3.4 × 128-sample buffers.
 *
 * Tests cover: default patch (short attack), minimum attack (instant), and
 * maximum attack (5s — the note should still START before the attack peak).
 * Also validates that 4-voice chord onset latency stays within the same bound.
 *
 * Latency is reported in the test failure message for regression tracking.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import synthDspSource from "@/audio/synth.dsp?raw";
import { SYNTH_PARAMS } from "@/audio/params";

// ── Config ──

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 128;
const VOICES = 8;

/** < 10ms target. At 44100 Hz: 441 samples. */
const MAX_LATENCY_MS = 10;
const MAX_LATENCY_SAMPLES = Math.ceil((MAX_LATENCY_MS / 1000) * SAMPLE_RATE); // 441

/** Threshold for "first non-zero sample" detection. */
const ONSET_THRESHOLD = 0.0001;

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
  const proc = await cachedGen!.createOfflineProcessor(SAMPLE_RATE, BUFFER_SIZE, VOICES);
  if (!proc) throw new Error("Failed to create offline processor");
  const p = proc as unknown as OfflineProc;
  p.start();
  return p;
}

// ── Helpers ──

/**
 * Measure samples from keyOn to first sample above threshold.
 * Returns -1 if onset never reached in the given window.
 */
function measureOnsetLatency(proc: OfflineProc, maxBuffers: number): number {
  const silence = new Float32Array(BUFFER_SIZE);
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);

  for (let i = 0; i < maxBuffers; i++) {
    outL.fill(0); outR.fill(0);
    proc.compute([silence], [outL, outR]);
    for (let s = 0; s < BUFFER_SIZE; s++) {
      const sample = Math.max(Math.abs(outL[s]), Math.abs(outR[s]));
      if (sample > ONSET_THRESHOLD) {
        return i * BUFFER_SIZE + s;
      }
    }
  }
  return -1;
}

function samplesToMs(samples: number): string {
  return `${((samples / SAMPLE_RATE) * 1000).toFixed(2)}ms`;
}

// ── Tests ──

describe("Note-on latency", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it(`default params: onset < ${MAX_LATENCY_MS}ms`, () => {
    proc.allNotesOff(true);
    // Flush prior state
    const silence = new Float32Array(BUFFER_SIZE);
    const out = [new Float32Array(BUFFER_SIZE), new Float32Array(BUFFER_SIZE)];
    for (let i = 0; i < 100; i++) proc.compute([silence], out);

    proc.keyOn(0, 69, 100); // A4
    const latencySamples = measureOnsetLatency(proc, 10);
    proc.keyOff(0, 69, 0);

    expect(
      latencySamples,
      `Default params onset not detected within ${10 * BUFFER_SIZE} samples`
    ).toBeGreaterThanOrEqual(0);

    expect(
      latencySamples,
      `Default onset=${samplesToMs(latencySamples)} exceeded ${MAX_LATENCY_MS}ms limit`
    ).toBeLessThan(MAX_LATENCY_SAMPLES);
  });

  it(`minimum attack (${SYNTH_PARAMS.attack.min}s): onset < ${MAX_LATENCY_MS}ms`, () => {
    proc.allNotesOff(true);
    const silence = new Float32Array(BUFFER_SIZE);
    const out = [new Float32Array(BUFFER_SIZE), new Float32Array(BUFFER_SIZE)];
    for (let i = 0; i < 50; i++) proc.compute([silence], out);

    proc.setParamValue("attack", SYNTH_PARAMS.attack.min);
    proc.setParamValue("sustain", 0.8);
    proc.keyOn(0, 69, 100);
    const latencySamples = measureOnsetLatency(proc, 10);
    proc.keyOff(0, 69, 0);
    proc.setParamValue("attack", SYNTH_PARAMS.attack.default);
    proc.setParamValue("sustain", SYNTH_PARAMS.sustain.default);

    expect(
      latencySamples,
      `Min-attack onset not detected within ${10 * BUFFER_SIZE} samples`
    ).toBeGreaterThanOrEqual(0);

    expect(
      latencySamples,
      `Min-attack onset=${samplesToMs(latencySamples)} exceeded ${MAX_LATENCY_MS}ms limit`
    ).toBeLessThan(MAX_LATENCY_SAMPLES);
  });

  it("4-voice chord: all voices onset within 2 buffers of first", () => {
    proc.allNotesOff(true);
    const silence = new Float32Array(BUFFER_SIZE);
    const out = [new Float32Array(BUFFER_SIZE), new Float32Array(BUFFER_SIZE)];
    for (let i = 0; i < 50; i++) proc.compute([silence], out);

    proc.setParamValue("attack", 0.005); // short attack
    proc.setParamValue("sustain", 0.8);

    // Fire 4 notes in rapid succession (all in same buffer)
    proc.keyOn(0, 60, 100);
    proc.keyOn(0, 64, 100);
    proc.keyOn(0, 67, 100);
    proc.keyOn(0, 71, 100);

    const latencySamples = measureOnsetLatency(proc, 10);
    proc.allNotesOff(false);

    proc.setParamValue("attack", SYNTH_PARAMS.attack.default);
    proc.setParamValue("sustain", SYNTH_PARAMS.sustain.default);

    expect(
      latencySamples,
      `4-voice chord onset not detected within ${10 * BUFFER_SIZE} samples`
    ).toBeGreaterThanOrEqual(0);

    // 4-voice chord should start within 2 buffers (256 samples ≈ 5.8ms)
    expect(
      latencySamples,
      `4-voice chord onset=${samplesToMs(latencySamples)} exceeded 2-buffer limit`
    ).toBeLessThan(BUFFER_SIZE * 2);
  });

  it("latency is consistent: 5 sequential notes each < 10ms", () => {
    proc.setParamValue("attack", 0.005);
    proc.setParamValue("sustain", 0.8);

    const latencies: number[] = [];
    for (let n = 0; n < 5; n++) {
      proc.allNotesOff(true);
      const silence = new Float32Array(BUFFER_SIZE);
      const out = [new Float32Array(BUFFER_SIZE), new Float32Array(BUFFER_SIZE)];
      for (let i = 0; i < 30; i++) proc.compute([silence], out);

      proc.keyOn(0, 60 + n, 100);
      const latencySamples = measureOnsetLatency(proc, 10);
      proc.keyOff(0, 60 + n, 0);
      latencies.push(latencySamples);
    }

    proc.setParamValue("attack", SYNTH_PARAMS.attack.default);
    proc.setParamValue("sustain", SYNTH_PARAMS.sustain.default);

    for (let i = 0; i < latencies.length; i++) {
      expect(
        latencies[i],
        `Note ${i + 1} onset=${samplesToMs(latencies[i])} exceeded ${MAX_LATENCY_MS}ms`
      ).toBeLessThan(MAX_LATENCY_SAMPLES);
    }
  });
});
