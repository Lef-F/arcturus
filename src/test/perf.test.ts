/**
 * Performance benchmarks — DSP CPU usage at 8 voices, 48kHz.
 *
 * Measures wall-clock time for the offline polyphonic processor to compute
 * N buffers with 8 simultaneous voices. Reports CPU percentage relative to
 * real-time (100% = exactly keeping up with audio clock).
 *
 * Threshold: < 1000% CPU per engine (10× real-time). This is very generous —
 * any failure indicates a severe algorithmic regression (O(N²), infinite loop,
 * etc.), not normal performance variation between machines.
 *
 * Actual expected performance on modern hardware: ~5–50% per engine.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import synthDspSource from "@/audio/synth.dsp?raw";

// ── Config ──

const SAMPLE_RATE = 48000;         // 48kHz as per DOCTRINE requirement
const BUFFER_SIZE = 128;
const VOICES = 8;
const BENCH_BUFFERS = 2000;        // ~5.3s of audio to average over

/** Real-time budget per buffer in ms. */
const BUFFER_DURATION_MS = (BUFFER_SIZE / SAMPLE_RATE) * 1000; // ~2.67ms at 48kHz

/** Fail threshold: 10× real-time = 10× 2.67ms = 26.7ms per buffer */
const MAX_CPU_PERCENT = 1000;

// ── Processor interface ──

interface OfflineProc {
  start(): void;
  stop(): void;
  keyOn(channel: number, pitch: number, velocity: number): void;
  keyOff(channel: number, pitch: number, velocity: number): void;
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

// ── Benchmark helper ──

interface BenchResult {
  totalWallMs: number;
  msPerBuffer: number;
  cpuPercent: number;
  voiceCount: number;
}

function runBenchmark(proc: OfflineProc, numBuffers: number, voices: number): BenchResult {
  const silence = new Float32Array(BUFFER_SIZE);
  const outL = new Float32Array(BUFFER_SIZE);
  const outR = new Float32Array(BUFFER_SIZE);

  // Play N voices
  const notes = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let v = 0; v < voices; v++) {
    proc.keyOn(0, notes[v % notes.length] + Math.floor(v / notes.length) * 12, 80);
  }

  // Warm up (JIT compile, WASM warm-up)
  for (let i = 0; i < 50; i++) {
    proc.compute([silence], [outL, outR]);
  }

  // Timed run
  const start = performance.now();
  for (let i = 0; i < numBuffers; i++) {
    proc.compute([silence], [outL, outR]);
  }
  const totalWallMs = performance.now() - start;

  const msPerBuffer = totalWallMs / numBuffers;
  const cpuPercent = (msPerBuffer / BUFFER_DURATION_MS) * 100;

  return { totalWallMs, msPerBuffer, cpuPercent, voiceCount: voices };
}

// ── Tests ──

describe("DSP performance benchmark", () => {
  let proc: OfflineProc;
  beforeAll(async () => { proc = await createProc(); }, 30_000);

  it(`8 voices at ${SAMPLE_RATE}Hz: CPU < ${MAX_CPU_PERCENT}%`, () => {
    const result = runBenchmark(proc, BENCH_BUFFERS, VOICES);

    const summary = [
      `voices=${result.voiceCount}`,
      `sampleRate=${SAMPLE_RATE}`,
      `buffers=${BENCH_BUFFERS}`,
      `totalWall=${result.totalWallMs.toFixed(1)}ms`,
      `msPerBuffer=${result.msPerBuffer.toFixed(3)}ms`,
      `audioPerBuffer=${BUFFER_DURATION_MS.toFixed(3)}ms`,
      `CPU=${result.cpuPercent.toFixed(1)}%`,
    ].join(", ");

    console.info(`[perf] ${summary}`);

    expect(
      result.cpuPercent,
      `CPU usage ${result.cpuPercent.toFixed(1)}% exceeded ${MAX_CPU_PERCENT}% threshold\n${summary}`
    ).toBeLessThan(MAX_CPU_PERCENT);
  });

  it("CPU scales sub-quadratically: 8 voices < 8× 1 voice", () => {
    const single = runBenchmark(proc, 500, 1);
    proc.keyOn(0, 60, 80); // reset for 8-voice run
    const eight = runBenchmark(proc, 500, VOICES);

    const ratio = eight.cpuPercent / single.cpuPercent;
    console.info(
      `[perf] 1 voice: ${single.cpuPercent.toFixed(1)}%, ` +
      `8 voices: ${eight.cpuPercent.toFixed(1)}%, ` +
      `ratio: ${ratio.toFixed(2)}× (must be < 8)`
    );

    // Each additional voice should be roughly linear in cost — O(N)
    // Ratio > 8× would indicate O(N²) bug or global lock
    expect(ratio).toBeLessThan(8);
  });
});
