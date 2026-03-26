/**
 * Engine Pool — manages multiple SynthEngine instances for independent sound layers.
 *
 * Audio graph per engine:
 *   engine.fxNode → splitter → L/R analysers (per-engine metering)
 *                 → masterGain → analyser → destination
 *                              → splitter → L/R analysers (global stereo metering)
 *
 * Master volume is per-engine (stored in each patch). The summing bus is unity gain.
 */

import { SynthEngine, type CompiledGenerators } from "./engine";

// Reusable buffer for RMS calculations (avoids allocation per frame)
const _rmsBuf = new Float32Array(2048);

export class EnginePool {
  private _ctx: AudioContext | null = null;
  private _generators: CompiledGenerators | null = null;
  private _engines = new Map<number, SynthEngine>();
  private _meters = new Map<number, { left: AnalyserNode; right: AnalyserNode }>();
  private _pending = new Map<number, Promise<SynthEngine>>(); // guards concurrent creation
  private _activeProgram = 0;
  private _masterGain: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _analyserL: AnalyserNode | null = null;
  private _analyserR: AnalyserNode | null = null;
  private _nextProcessorId = 0;

  // ── Boot ──

  async boot(ctx: AudioContext, synthDsp: string, effectsDsp: string): Promise<void> {
    this._ctx = ctx;
    this._generators = await SynthEngine.compileGenerators(synthDsp, effectsDsp);

    // Shared output: masterGain → analyser (waveform) → destination
    this._masterGain = ctx.createGain();
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._masterGain.connect(this._analyser);
    this._analyser.connect(ctx.destination);

    // Global stereo metering: masterGain → splitter → L/R analysers
    const splitter = ctx.createChannelSplitter(2);
    this._analyserL = ctx.createAnalyser();
    this._analyserL.fftSize = 256;
    this._analyserR = ctx.createAnalyser();
    this._analyserR.fftSize = 256;
    this._masterGain.connect(splitter);
    splitter.connect(this._analyserL, 0);
    splitter.connect(this._analyserR, 1);
  }

  // ── Engine lifecycle ──

  /**
   * Get or create an engine for a program.
   * Guarded against concurrent calls — if creation is in-flight, returns the pending promise.
   */
  async getOrCreateEngine(programIndex: number, initialParams?: Record<string, number>): Promise<SynthEngine> {
    const existing = this._engines.get(programIndex);
    if (existing) return existing;

    // Guard: if creation is already in-flight, return the same promise
    const pending = this._pending.get(programIndex);
    if (pending) return pending;

    const promise = this._createEngine(programIndex, initialParams);
    this._pending.set(programIndex, promise);
    try {
      return await promise;
    } finally {
      this._pending.delete(programIndex);
    }
  }

  private async _createEngine(programIndex: number, initialParams?: Record<string, number>): Promise<SynthEngine> {
    if (!this._ctx || !this._generators || !this._masterGain) {
      throw new Error("EnginePool not booted — call boot() first");
    }

    const engine = new SynthEngine();
    const id = this._nextProcessorId++;
    await engine.startFromGenerators(this._ctx, this._generators, id, initialParams);

    // Connect engine output → masterGain (audio) + per-engine stereo meters
    const output = engine.outputNode;
    if (output && this._ctx) {
      // Audio path: engine → masterGain
      (output as unknown as { connect(d: AudioNode): void }).connect(this._masterGain);

      // Meter path: engine → splitter → L/R analysers (doesn't affect audio routing)
      const splitter = this._ctx.createChannelSplitter(2);
      const left = this._ctx.createAnalyser();
      left.fftSize = 256;
      const right = this._ctx.createAnalyser();
      right.fftSize = 256;
      (output as unknown as { connect(d: AudioNode): void }).connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      this._meters.set(programIndex, { left, right });
    }

    this._engines.set(programIndex, engine);
    console.log(`[EnginePool] Engine ${id} created for program ${programIndex} (total: ${this._engines.size})`);
    return engine;
  }

  /** Release an engine: all notes off, disconnect, destroy, clean up meters. */
  releaseEngine(programIndex: number): number {
    const engine = this._engines.get(programIndex);
    if (!engine) return 0;

    const noteCount = engine.activeVoices;
    engine.destroy();
    this._engines.delete(programIndex);
    this._releaseMeter(programIndex);
    console.log(`[EnginePool] Engine released for program ${programIndex} (remaining: ${this._engines.size})`);
    return noteCount;
  }

  hasEngine(programIndex: number): boolean {
    return this._engines.has(programIndex);
  }

  getActiveEngine(): SynthEngine | null {
    return this._engines.get(this._activeProgram) ?? null;
  }

  getEngine(programIndex: number): SynthEngine | null {
    return this._engines.get(programIndex) ?? null;
  }

  setActiveProgram(programIndex: number): void {
    this._activeProgram = programIndex;
  }

  get activeProgram(): number {
    return this._activeProgram;
  }

  // ── Metering ──

  getEngineLevel(programIndex: number): { left: number; right: number; clipL: boolean; clipR: boolean } {
    const meter = this._meters.get(programIndex);
    if (!meter) return { left: 0, right: 0, clipL: false, clipR: false };
    const l = _readRms(meter.left);
    const r = _readRms(meter.right);
    return { left: l.rms, right: r.rms, clipL: l.clip, clipR: r.clip };
  }

  getStereoLevels(): { left: number; right: number; clipL: boolean; clipR: boolean } {
    const l = _readRms(this._analyserL);
    const r = _readRms(this._analyserR);
    return { left: l.rms, right: r.rms, clipL: l.clip, clipR: r.clip };
  }

  // ── Aggregate state ──

  get totalActiveVoices(): number {
    let total = 0;
    for (const engine of this._engines.values()) total += engine.activeVoices;
    return total;
  }

  get engineCount(): number { return this._engines.size; }
  get analyser(): AnalyserNode | null { return this._analyser; }
  get ctx(): AudioContext | null { return this._ctx; }

  // ── Panic ──

  destroyAll(): void {
    for (const [idx] of this._engines) {
      this.releaseEngine(idx); // reuse cleanup logic
    }
  }

  /** Release all notes and destroy all non-active engines. */
  panicReset(): void {
    for (const [idx, engine] of this._engines) {
      engine.allNotesOff();
      if (idx !== this._activeProgram) {
        engine.destroy();
        this._engines.delete(idx);
        this._releaseMeter(idx);
      }
    }
  }

  get programsWithEngines(): number[] {
    return [...this._engines.keys()];
  }

  setParamValue(path: string, value: number, programIndex?: number): void {
    const engine = programIndex !== undefined
      ? this._engines.get(programIndex)
      : this.getActiveEngine();
    engine?.setParamValue(path, value);
  }

  // ── Private ──

  private _releaseMeter(programIndex: number): void {
    const meter = this._meters.get(programIndex);
    if (meter) {
      meter.left.disconnect();
      meter.right.disconnect();
      this._meters.delete(programIndex);
    }
  }
}

// ── Helpers ──

function _readRms(analyser: AnalyserNode | null): { rms: number; clip: boolean } {
  if (!analyser) return { rms: 0, clip: false };
  const size = analyser.fftSize;
  const buf = _rmsBuf.subarray(0, size);
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < size; i++) {
    sumSq += buf[i] * buf[i];
    const abs = Math.abs(buf[i]);
    if (abs > peak) peak = abs;
  }
  return { rms: Math.sqrt(sumSq / size), clip: peak > 1.0 };
}
