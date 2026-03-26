/**
 * Engine Pool — manages multiple SynthEngine instances for independent sound layers.
 *
 * Normal operation: one active engine. When notes are latched and the user switches
 * programs, the current engine freezes (keeps its notes + params) and a new engine
 * is created for the target program. Frozen engines can be refocused (encoders
 * control them again) or released (notes stop, engine destroyed).
 *
 * WASM is compiled once at boot. New engines are created from cached generators
 * in ~200-500ms (vs ~5-10s for cold compilation).
 *
 * Audio graph:
 *   Engine 0 fxNode (has own master vol) ─┐
 *   Engine 1 fxNode (has own master vol) ─┤→ summing bus → analyser → destination
 *   Engine N fxNode (has own master vol) ─┘
 *
 * Master volume is per-engine (stored in each patch). The summing bus is unity gain.
 */

import { SynthEngine, type CompiledGenerators } from "./engine";

export class EnginePool {
  private _ctx: AudioContext | null = null;
  private _generators: CompiledGenerators | null = null;
  private _engines = new Map<number, SynthEngine>(); // programIndex → engine
  private _meters = new Map<number, { left: AnalyserNode; right: AnalyserNode }>(); // stereo per-engine
  private _activeProgram = 0;
  private _masterGain: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _analyserL: AnalyserNode | null = null; // left channel meter
  private _analyserR: AnalyserNode | null = null; // right channel meter
  private _nextProcessorId = 0;

  // ── Boot ──

  /**
   * Compile Faust WASM once and set up the shared audio graph.
   * Call this at app boot before any engines are created.
   */
  async boot(
    ctx: AudioContext,
    synthDsp: string,
    effectsDsp: string
  ): Promise<void> {
    this._ctx = ctx;

    // Compile WASM once
    this._generators = await SynthEngine.compileGenerators(synthDsp, effectsDsp);

    // Shared output graph: masterGain → analyser → destination
    //                      masterGain → splitter → analyserL + analyserR (stereo metering)
    this._masterGain = ctx.createGain();
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._masterGain.connect(this._analyser);
    this._analyser.connect(ctx.destination);

    // Stereo channel split for L/R VU metering
    const splitter = ctx.createChannelSplitter(2);
    this._analyserL = ctx.createAnalyser();
    this._analyserL.fftSize = 256;
    this._analyserR = ctx.createAnalyser();
    this._analyserR.fftSize = 256;
    this._masterGain.connect(splitter);
    splitter.connect(this._analyserL, 0); // left channel
    splitter.connect(this._analyserR, 1); // right channel
  }

  // ── Engine lifecycle ──

  /**
   * Get or create an engine for a program. If an engine already exists for
   * this program (frozen), returns it. Otherwise creates a new one.
   *
   * @param initialParams — patch params to pre-apply before audio starts (prevents clicks)
   */
  async getOrCreateEngine(programIndex: number, initialParams?: Record<string, number>): Promise<SynthEngine> {
    const existing = this._engines.get(programIndex);
    if (existing) return existing;

    if (!this._ctx || !this._generators || !this._masterGain) {
      throw new Error("EnginePool not booted — call boot() first");
    }

    const engine = new SynthEngine();
    const id = this._nextProcessorId++;
    await engine.startFromGenerators(this._ctx, this._generators, id, initialParams);

    // Connect: engine output → stereo splitter → L/R analysers + shared mixer
    const output = engine.outputNode;
    if (output && this._ctx) {
      const splitter = this._ctx.createChannelSplitter(2);
      const left = this._ctx.createAnalyser();
      left.fftSize = 256;
      const right = this._ctx.createAnalyser();
      right.fftSize = 256;
      (output as unknown as { connect(d: AudioNode): void }).connect(splitter);
      (output as unknown as { connect(d: AudioNode): void }).connect(this._masterGain);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      this._meters.set(programIndex, { left, right });
    }

    this._engines.set(programIndex, engine);
    console.log(`[EnginePool] Engine ${id} created for program ${programIndex} (total: ${this._engines.size})`);
    return engine;
  }

  /**
   * Release an engine for a program. Sends allNotesOff, disconnects, destroys.
   * Returns the destroyed engine's active note count (for UI feedback).
   */
  releaseEngine(programIndex: number): number {
    const engine = this._engines.get(programIndex);
    if (!engine) return 0;

    const noteCount = engine.activeVoices;
    engine.destroy();
    this._engines.delete(programIndex);
    const meter = this._meters.get(programIndex);
    if (meter) { meter.left.disconnect(); meter.right.disconnect(); this._meters.delete(programIndex); }
    console.log(`[EnginePool] Engine released for program ${programIndex} (remaining: ${this._engines.size})`);
    return noteCount;
  }

  /** Check if a program has its own engine (frozen or active). */
  hasEngine(programIndex: number): boolean {
    return this._engines.has(programIndex);
  }

  /** Get the currently active engine (the one receiving param changes + notes). */
  getActiveEngine(): SynthEngine | null {
    return this._engines.get(this._activeProgram) ?? null;
  }

  /** Get engine for a specific program (may be frozen). */
  getEngine(programIndex: number): SynthEngine | null {
    return this._engines.get(programIndex) ?? null;
  }

  /** Set which program is active (receives encoder changes + new notes). */
  setActiveProgram(programIndex: number): void {
    this._activeProgram = programIndex;
  }

  get activeProgram(): number {
    return this._activeProgram;
  }

  // ── Metering ──

  /**
   * Get stereo RMS levels for a program's engine.
   */
  getEngineLevel(programIndex: number): { left: number; right: number; clipL: boolean; clipR: boolean } {
    const meter = this._meters.get(programIndex);
    if (!meter) return { left: 0, right: 0, clipL: false, clipR: false };
    const l = _readRms(meter.left);
    const r = _readRms(meter.right);
    return { left: l.rms, right: r.rms, clipL: l.clip, clipR: r.clip };
  }

  /**
   * Get stereo RMS levels and clip state from the master output.
   */
  getStereoLevels(): { left: number; right: number; clipL: boolean; clipR: boolean } {
    const l = _readRms(this._analyserL);
    const r = _readRms(this._analyserR);
    return { left: l.rms, right: r.rms, clipL: l.clip, clipR: r.clip };
  }

  // ── Aggregate state ──

  /** Total active voices across all engines. */
  get totalActiveVoices(): number {
    let total = 0;
    for (const engine of this._engines.values()) {
      total += engine.activeVoices;
    }
    return total;
  }

  /** Number of running engines. */
  get engineCount(): number {
    return this._engines.size;
  }

  /** Shared analyser (shows combined output of all engines). */
  get analyser(): AnalyserNode | null {
    return this._analyser;
  }

  /** The AudioContext. */
  get ctx(): AudioContext | null {
    return this._ctx;
  }

  // ── Panic ──

  /** Destroy all engines and release all notes. */
  destroyAll(): void {
    for (const [idx, engine] of this._engines) {
      engine.destroy();
      console.log(`[EnginePool] Panic: engine ${idx} destroyed`);
    }
    this._engines.clear();
  }

  /**
   * Release all notes across all engines and destroy all non-active engines.
   * Used for CC 123 (All Notes Off) panic reset.
   */
  panicReset(): void {
    for (const [idx, engine] of this._engines) {
      engine.allNotesOff();
      if (idx !== this._activeProgram) {
        engine.destroy();
        this._engines.delete(idx);
        console.log(`[EnginePool] Panic: engine ${idx} destroyed`);
      }
    }
  }

  /** Get all program indices that have engines. */
  get programsWithEngines(): number[] {
    return [...this._engines.keys()];
  }

  /**
   * Set a parameter on a specific engine (or active engine if no index given).
   */
  setParamValue(path: string, value: number, programIndex?: number): void {
    const engine = programIndex !== undefined
      ? this._engines.get(programIndex)
      : this.getActiveEngine();
    engine?.setParamValue(path, value);
  }
}

// ── Helpers ──

function _readRms(analyser: AnalyserNode | null): { rms: number; clip: boolean } {
  if (!analyser) return { rms: 0, clip: false };
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    sumSq += buf[i] * buf[i];
    const abs = Math.abs(buf[i]);
    if (abs > peak) peak = abs;
  }
  return { rms: Math.sqrt(sumSq / buf.length), clip: peak > 1.0 };
}
