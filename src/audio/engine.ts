/**
 * Audio Engine — Faust WASM compilation and AudioWorklet node lifecycle.
 *
 * Architecture:
 *   synthNode (FaustMonoAudioWorkletNode) → fxNode (FaustMonoAudioWorkletNode) → destination
 *
 * The engine exposes keyOn/keyOff/setParamValue which delegate to the
 * underlying Faust nodes. An IFaustDspNode injection point enables unit
 * testing without real WASM compilation.
 */

import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from "@grame/faustwasm";
import type { IFaustMonoWebAudioNode } from "@grame/faustwasm";

// ── DSP source text (imported as strings at build time via ?raw) ──
// These are loaded lazily in start() to avoid top-level side effects.

/** Injectable DSP node interface for testing. */
export interface IFaustDspNode {
  setParamValue(path: string, value: number): void;
  getParamValue(path: string): number;
  connect(destination: AudioNode): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

// ── Engine state ──

export class SynthEngine {
  private _ctx: AudioContext | null = null;
  private _synthNode: IFaustDspNode | null = null;
  private _fxNode: IFaustDspNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _running = false;

  /** Active voice count (for polyphony in M4) */
  activeVoices = 0;

  /** Injected nodes for testing — if set, skips WASM compilation. */
  _testSynthNode?: IFaustDspNode;
  _testFxNode?: IFaustDspNode;

  /**
   * Initialize the audio engine.
   * Compiles Faust DSP, creates AudioWorklet nodes, connects the graph.
   *
   * @param context - AudioContext to use (pass a test stub in tests)
   * @param synthDspCode - Faust source for the synth voice
   * @param effectsDspCode - Faust source for the effects chain
   */
  async start(
    context: AudioContext,
    synthDspCode: string,
    effectsDspCode: string
  ): Promise<void> {
    if (this._running) return;
    this._ctx = context;

    // Use injected test nodes if provided
    if (this._testSynthNode && this._testFxNode) {
      this._synthNode = this._testSynthNode;
      this._fxNode = this._testFxNode;
    } else {
      const { synthNode, fxNode } = await this._compileDsp(
        context,
        synthDspCode,
        effectsDspCode
      );
      this._synthNode = synthNode;
      this._fxNode = fxNode;
    }

    // Analyser for waveform display
    this._analyser = context.createAnalyser();
    this._analyser.fftSize = 2048;

    // Connect signal graph
    (this._synthNode as unknown as { connect(d: AudioNode): void }).connect(
      this._fxNode as unknown as AudioNode
    );
    (this._fxNode as unknown as { connect(d: AudioNode): void }).connect(this._analyser);
    this._analyser.connect(context.destination);

    this._synthNode.start();
    this._fxNode.start();
    this._running = true;
  }

  /** Stop and disconnect all nodes. */
  stop(): void {
    if (!this._running) return;
    this._synthNode?.stop();
    this._fxNode?.stop();
    this._synthNode?.disconnect();
    this._fxNode?.disconnect();
    this._analyser?.disconnect();
    this._running = false;
  }

  /** Trigger a note on. Channel is 1-based (MIDI convention). */
  keyOn(_channel: number, pitch: number, velocity: number): void {
    if (!this._synthNode) return;
    const freq = midiNoteToHz(pitch);
    const gain = velocity / 127;
    this._synthNode.setParamValue("freq", freq);
    this._synthNode.setParamValue("gain", gain);
    this._synthNode.setParamValue("gate", 1);
  }

  /** Trigger a note off. */
  keyOff(_channel: number, _pitch: number, _velocity: number): void {
    this._synthNode?.setParamValue("gate", 0);
  }

  /**
   * Update a Faust parameter by path.
   * Routes to the appropriate node: synth params go to synthNode,
   * effects params go to fxNode.
   */
  setParamValue(path: string, value: number): void {
    const isEffectParam = EFFECT_PARAM_PATHS.has(path);
    if (isEffectParam) {
      this._fxNode?.setParamValue(path, value);
    } else {
      this._synthNode?.setParamValue(path, value);
    }
  }

  /** Get current value of a Faust parameter. */
  getParamValue(path: string): number {
    const isEffectParam = EFFECT_PARAM_PATHS.has(path);
    if (isEffectParam) {
      return this._fxNode?.getParamValue(path) ?? 0;
    }
    return this._synthNode?.getParamValue(path) ?? 0;
  }

  /** True when audio nodes are initialized and running. */
  get isRunning(): boolean {
    return this._running;
  }

  /** AnalyserNode for waveform display (null until start() resolves). */
  get analyser(): AnalyserNode | null {
    return this._analyser;
  }

  /** Sample rate of the AudioContext. */
  get sampleRate(): number {
    return this._ctx?.sampleRate ?? 48000;
  }

  // ── Private ──

  private async _compileDsp(
    context: AudioContext,
    synthCode: string,
    effectsCode: string
  ): Promise<{ synthNode: IFaustMonoWebAudioNode; fxNode: IFaustMonoWebAudioNode }> {
    // Load the Faust WASM module from public directory
    const faustModule = await instantiateFaustModuleFromFile(
      "/libfaust-wasm/libfaust-wasm.js"
    );
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);

    const synthGen = new FaustMonoDspGenerator();
    const fxGen = new FaustMonoDspGenerator();

    await Promise.all([
      synthGen.compile(compiler, "synth", synthCode, "-I libraries/"),
      fxGen.compile(compiler, "effects", effectsCode, "-I libraries/"),
    ]);

    const synthNode = await synthGen.createNode(context, "synth");
    const fxNode = await fxGen.createNode(context, "effects");

    if (!synthNode || !fxNode) {
      throw new Error("Faust DSP compilation failed: createNode returned null");
    }

    return { synthNode, fxNode };
  }
}

// ── Helpers ──

/** MIDI note number to frequency in Hz */
export function midiNoteToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Effect DSP parameter paths (route to fxNode instead of synthNode). */
const EFFECT_PARAM_PATHS = new Set([
  "drive",
  "chorus_rate",
  "chorus_depth",
  "delay_time",
  "delay_feedback",
  "reverb_damp",
  "reverb_mix",
  "master",
]);
