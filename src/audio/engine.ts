/**
 * Audio Engine — Faust WASM compilation and AudioWorklet node lifecycle.
 *
 * Architecture:
 *   synthNode (FaustPolyAudioWorkletNode) → fxNode (FaustMonoAudioWorkletNode) → outputNode
 *
 * The engine exposes keyOn/keyOff/setParamValue which delegate to the
 * underlying Faust nodes. Compilation can be done once and reused across
 * multiple engine instances via compileGenerators() + startFromGenerators().
 */

import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
  FaustPolyDspGenerator,
} from "@grame/faustwasm";
// IFaustMonoWebAudioNode and IFaustPolyWebAudioNode are the return types from createNode()
// but we cast them to IFaustDspNode internally, so no explicit import needed.

// ── Injectable DSP node interfaces for testing ──

/** Injectable synth node interface (polyphonic). */
export interface IFaustDspNode {
  setParamValue(path: string, value: number): void;
  getParamValue(path: string): number;
  connect(destination: AudioNode): void;
  disconnect(): void;
  start(): void;
  stop(): void;
  keyOn?(channel: number, pitch: number, velocity: number): void;
  keyOff?(channel: number, pitch: number, velocity: number): void;
}

/** Compiled Faust generators — reusable across engine instances. */
export interface CompiledGenerators {
  synthGen: FaustPolyDspGenerator;
  fxGen: FaustMonoDspGenerator;
}

// ── Engine state ──

export class SynthEngine {
  private _ctx: AudioContext | null = null;
  private _synthNode: IFaustDspNode | null = null;
  private _fxNode: IFaustDspNode | null = null;
  private _running = false;

  /** Maximum polyphonic voices (1–8). Set via the "voices" parameter. */
  maxVoices = 8;

  /** Unison mode: stack all voices on one note with detuning. */
  unison = false;

  /** Current count of sounding voices (accurate, based on tracked notes). */
  get activeVoices(): number { return this._activeNotes.size; }

  /** pitch → channel for all currently held notes. */
  private _activeNotes = new Map<number, number>();

  /** In unison mode: base pitch → array of stacked pitches triggered. */
  private _unisonPitches = new Map<number, number[]>();

  /** Injected nodes for testing — if set, skips WASM compilation. */
  _testSynthNode?: IFaustDspNode;
  _testFxNode?: IFaustDspNode;

  // ── Static compilation (compile once, reuse across instances) ──

  /**
   * Compile Faust DSP code into reusable generators.
   * Call once at boot, then pass generators to startFromGenerators() for each engine.
   */
  static async compileGenerators(
    synthDspCode: string,
    effectsDspCode: string
  ): Promise<CompiledGenerators> {
    console.log("[Arcturus] Compiling Faust DSP (one-time)…");
    const faustModule = await instantiateFaustModuleFromFile(
      "/libfaust-wasm/libfaust-wasm.js"
    );
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);

    const synthGen = new FaustPolyDspGenerator();
    const fxGen = new FaustMonoDspGenerator();

    await synthGen.compile(compiler, "synth", synthDspCode, "-I libraries/");
    console.log("[Arcturus] Synth DSP compiled OK");

    await fxGen.compile(compiler, "effects", effectsDspCode, "-I libraries/");
    console.log("[Arcturus] Effects DSP compiled OK");

    return { synthGen, fxGen };
  }

  // ── Instance lifecycle ──

  /**
   * Start from pre-compiled generators (fast — no WASM compilation).
   * Each engine gets a unique processorId to avoid AudioWorklet name collisions.
   */
  async startFromGenerators(
    context: AudioContext,
    generators: CompiledGenerators,
    processorId: number
  ): Promise<void> {
    if (this._running) return;
    this._ctx = context;

    if (this._testSynthNode && this._testFxNode) {
      this._synthNode = this._testSynthNode;
      this._fxNode = this._testFxNode;
    } else {
      const synthNode = await generators.synthGen.createNode(
        context, this.maxVoices, "synth",
        undefined, undefined, undefined, // voiceFactory, mixerModule, effectFactory
        false, undefined, // sp, bufferSize
        `synth-${processorId}` // unique processor name
      );
      const fxNode = await generators.fxGen.createNode(
        context, "effects",
        undefined, false, undefined, // factory, sp, bufferSize
        `effects-${processorId}` // unique processor name
      );

      if (!synthNode || !fxNode) {
        throw new Error(`Engine ${processorId}: Faust createNode returned null`);
      }

      this._synthNode = synthNode;
      this._fxNode = fxNode;
    }

    // Connect synth → fx (output connection done externally by EnginePool)
    (this._synthNode as unknown as { connect(d: AudioNode): void }).connect(
      this._fxNode as unknown as AudioNode
    );

    this._synthNode.start();
    this._fxNode.start();
    this._running = true;
  }

  /**
   * Convenience: compile + start in one call (single-engine mode / tests).
   */
  async start(
    context: AudioContext,
    synthDspCode: string,
    effectsDspCode: string
  ): Promise<void> {
    if (this._running) return;
    this._ctx = context;

    if (this._testSynthNode && this._testFxNode) {
      this._synthNode = this._testSynthNode;
      this._fxNode = this._testFxNode;
    } else {
      const generators = await SynthEngine.compileGenerators(synthDspCode, effectsDspCode);
      const synthNode = await generators.synthGen.createNode(context, this.maxVoices, "synth");
      const fxNode = await generators.fxGen.createNode(context, "effects");

      if (!synthNode || !fxNode) {
        throw new Error("Faust DSP compilation failed: createNode returned null");
      }

      this._synthNode = synthNode;
      this._fxNode = fxNode;
    }

    // Connect signal graph with analyser (standalone mode)
    (this._synthNode as unknown as { connect(d: AudioNode): void }).connect(
      this._fxNode as unknown as AudioNode
    );
    (this._fxNode as unknown as { connect(d: AudioNode): void }).connect(context.destination);

    this._synthNode.start();
    this._fxNode.start();
    this._running = true;
  }

  /** Destroy the engine: release all notes, disconnect all nodes. */
  destroy(): void {
    if (!this._running) return;
    this.allNotesOff();
    this._synthNode?.stop();
    this._fxNode?.stop();
    this._synthNode?.disconnect();
    this._fxNode?.disconnect();
    this._running = false;
    this._synthNode = null;
    this._fxNode = null;
  }

  /** The effects output node — connect this to a mixer/analyser. */
  get outputNode(): AudioNode | null {
    return this._fxNode as unknown as AudioNode ?? null;
  }

  // ── Note control ──

  keyOn(channel: number, pitch: number, velocity: number): void {
    if (!this._synthNode) return;

    if (this.unison && this._synthNode.keyOn) {
      this.allNotesOff();
      const stacked: number[] = [];
      for (let i = 0; i < this.maxVoices; i++) {
        this._synthNode.keyOn(channel, pitch, velocity);
        stacked.push(pitch);
      }
      this._unisonPitches.set(pitch, stacked);
      this._activeNotes.set(pitch, channel);
      return;
    }

    if (this._synthNode.keyOn) {
      if (this._activeNotes.size >= this.maxVoices) {
        const stealPitch = this._activeNotes.keys().next().value as number;
        const stealChannel = this._activeNotes.get(stealPitch)!;
        this._synthNode.keyOff?.(stealChannel, stealPitch, 0);
        this._activeNotes.delete(stealPitch);
      }
      this._synthNode.keyOn(channel, pitch, velocity);
      this._activeNotes.set(pitch, channel);
    } else {
      this._synthNode.setParamValue("freq", midiNoteToHz(pitch));
      this._synthNode.setParamValue("gain", velocity / 127);
      this._synthNode.setParamValue("gate", 1);
      this._activeNotes.set(pitch, channel);
    }
  }

  keyOff(channel: number, pitch: number, velocity: number): void {
    if (!this._synthNode) return;

    if (this.unison && this._unisonPitches.has(pitch)) {
      const stacked = this._unisonPitches.get(pitch)!;
      for (const p of stacked) {
        this._synthNode.keyOff?.(channel, p, velocity);
      }
      this._unisonPitches.delete(pitch);
      this._activeNotes.delete(pitch);
      return;
    }

    if (this._synthNode.keyOff) {
      this._synthNode.keyOff(channel, pitch, velocity);
    } else {
      this._synthNode.setParamValue("gate", 0);
    }
    this._activeNotes.delete(pitch);
  }

  allNotesOff(): void {
    if (!this._synthNode) return;
    for (const [pitch, channel] of this._activeNotes) {
      this._synthNode.keyOff?.(channel, pitch, 0);
    }
    this._activeNotes.clear();
    this._unisonPitches.clear();
  }

  // ── Parameters ──

  setParamValue(path: string, value: number): void {
    if (EFFECT_PARAM_PATHS.has(path)) {
      this._fxNode?.setParamValue(path, value);
    } else {
      this._synthNode?.setParamValue(path, value);
    }
  }

  getParamValue(path: string): number {
    if (EFFECT_PARAM_PATHS.has(path)) {
      return this._fxNode?.getParamValue(path) ?? 0;
    }
    return this._synthNode?.getParamValue(path) ?? 0;
  }

  get isRunning(): boolean { return this._running; }
  get sampleRate(): number { return this._ctx?.sampleRate ?? 48000; }
  get ctx(): AudioContext | null { return this._ctx; }
}

// ── Helpers ──

/** MIDI note number to frequency in Hz */
export function midiNoteToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Effect DSP parameter paths (route to fxNode instead of synthNode). */
export const EFFECT_PARAM_PATHS = new Set([
  "drive",
  "phaser_rate",
  "phaser_depth",
  "phaser_feedback",
  "chorus_rate",
  "chorus_depth",
  "chorus_mode",
  "delay_time",
  "delay_feedback",
  "delay_mod",
  "reverb_damp",
  "reverb_mix",
  "reverb_size",
  "eq_lo",
  "eq_hi",
  "stereo_width",
  "master",
]);
