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
 *   Engine 0 fxNode ─┐
 *   Engine 1 fxNode ─┤→ masterGain → analyser → destination
 *   Engine N fxNode ─┘
 */

import { SynthEngine, type CompiledGenerators } from "./engine";

export class EnginePool {
  private _ctx: AudioContext | null = null;
  private _generators: CompiledGenerators | null = null;
  private _engines = new Map<number, SynthEngine>(); // programIndex → engine
  private _activeProgram = 0;
  private _masterGain: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;
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
    this._masterGain = ctx.createGain();
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._masterGain.connect(this._analyser);
    this._analyser.connect(ctx.destination);
  }

  // ── Engine lifecycle ──

  /**
   * Get or create an engine for a program. If an engine already exists for
   * this program (frozen), returns it. Otherwise creates a new one.
   */
  async getOrCreateEngine(programIndex: number): Promise<SynthEngine> {
    const existing = this._engines.get(programIndex);
    if (existing) return existing;

    if (!this._ctx || !this._generators || !this._masterGain) {
      throw new Error("EnginePool not booted — call boot() first");
    }

    const engine = new SynthEngine();
    const id = this._nextProcessorId++;
    await engine.startFromGenerators(this._ctx, this._generators, id);

    // Connect this engine's output to the shared mixer
    const output = engine.outputNode;
    if (output) {
      (output as unknown as { connect(d: AudioNode): void }).connect(this._masterGain);
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

  // ── Master volume ──

  /** Set master volume (global, applies to all engines). */
  setMasterVolume(value: number): void {
    if (this._masterGain) {
      this._masterGain.gain.value = value;
    }
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
   * Master param is routed to masterGain instead.
   */
  setParamValue(path: string, value: number, programIndex?: number): void {
    if (path === "master") {
      this.setMasterVolume(value);
      return;
    }
    const engine = programIndex !== undefined
      ? this._engines.get(programIndex)
      : this.getActiveEngine();
    engine?.setParamValue(path, value);
  }
}
