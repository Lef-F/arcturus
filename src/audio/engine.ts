/**
 * Audio Engine — Faust WASM compilation and AudioWorklet node lifecycle.
 *
 * Architecture:
 *   synthNode (FaustPolyAudioWorkletNode) → fxNode (FaustMonoAudioWorkletNode) → destination
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
  FaustPolyDspGenerator,
} from "@grame/faustwasm";
import type { IFaustMonoWebAudioNode, IFaustPolyWebAudioNode } from "@grame/faustwasm";

// ── Injectable DSP node interfaces for testing ──

/** Injectable synth node interface (polyphonic). */
export interface IFaustDspNode {
  setParamValue(path: string, value: number): void;
  getParamValue(path: string): number;
  connect(destination: AudioNode): void;
  disconnect(): void;
  start(): void;
  stop(): void;
  /** Polyphonic keyOn (only implemented on poly nodes). */
  keyOn?(channel: number, pitch: number, velocity: number): void;
  /** Polyphonic keyOff (only implemented on poly nodes). */
  keyOff?(channel: number, pitch: number, velocity: number): void;
}

// ── Engine state ──

export class SynthEngine {
  private _ctx: AudioContext | null = null;
  private _synthNode: IFaustDspNode | null = null;
  private _fxNode: IFaustDspNode | null = null;
  private _analyser: AnalyserNode | null = null;
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

  /**
   * Trigger a note on.
   * In unison mode: stacks maxVoices voices on the same pitch.
   * In poly mode: enforces maxVoices by stealing the oldest active note.
   */
  keyOn(channel: number, pitch: number, velocity: number): void {
    if (!this._synthNode) return;

    if (this.unison && this._synthNode.keyOn) {
      // Unison: release any previous notes, then stack all voices on this pitch.
      // Each Faust voice gets the same MIDI pitch; the DSP's per-voice
      // unisonRand (ba.sAndH on noise) gives each voice a unique detune offset.
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
      // Steal oldest voice if at the polyphony limit
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

  /**
   * Trigger a note off.
   * In unison mode: releases all stacked voices for this pitch.
   */
  keyOff(channel: number, pitch: number, velocity: number): void {
    if (!this._synthNode) return;

    if (this.unison && this._unisonPitches.has(pitch)) {
      // Release all stacked unison voices
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

  /**
   * Release all currently held notes (MIDI CC#123 / All Notes Off).
   * Called when KeyStep triple-stop is pressed.
   */
  allNotesOff(): void {
    if (!this._synthNode) return;
    for (const [pitch, channel] of this._activeNotes) {
      this._synthNode.keyOff?.(channel, pitch, 0);
    }
    this._activeNotes.clear();
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

  /** The AudioContext (null until start() resolves). */
  get ctx(): AudioContext | null {
    return this._ctx;
  }

  // ── Private ──

  private async _compileDsp(
    context: AudioContext,
    synthCode: string,
    effectsCode: string
  ): Promise<{
    synthNode: IFaustPolyWebAudioNode;
    fxNode: IFaustMonoWebAudioNode;
  }> {
    console.log("[Arcturus] _compileDsp: loading Faust WASM module…");
    const faustModule = await instantiateFaustModuleFromFile(
      "/libfaust-wasm/libfaust-wasm.js"
    );
    console.log("[Arcturus] _compileDsp: Faust module loaded, creating compiler…");
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);

    const synthGen = new FaustPolyDspGenerator();
    const fxGen = new FaustMonoDspGenerator();

    console.log("[Arcturus] _compileDsp: compiling synth DSP… (src length:", synthCode.length, ")");
    console.log("[Arcturus] _compileDsp: synth DSP first 200 chars:", synthCode.slice(0, 200));
    try {
      await synthGen.compile(compiler, "synth", synthCode, "-I libraries/");
      console.log("[Arcturus] _compileDsp: synth DSP compiled OK");
    } catch (e) {
      console.error("[Arcturus] _compileDsp: synth DSP compilation FAILED:", e);
      throw e;
    }

    console.log("[Arcturus] _compileDsp: compiling effects DSP…");
    try {
      await fxGen.compile(compiler, "effects", effectsCode, "-I libraries/");
      console.log("[Arcturus] _compileDsp: effects DSP compiled OK");
    } catch (e) {
      console.error("[Arcturus] _compileDsp: effects DSP compilation FAILED:", e);
      throw e;
    }

    const vf = (synthGen as unknown as Record<string, unknown>).voiceFactory as Record<string, unknown> | undefined;
    if (vf) {
      const code = vf.code as ArrayBuffer | undefined;
      const json = vf.json as string | undefined;
      console.log("[Arcturus] _compileDsp: voice WASM size:", code?.byteLength ?? "unknown", "bytes");
      if (json) {
        try {
          const desc = JSON.parse(json);
          const numInputs = desc.inputs ?? "?";
          const numOutputs = desc.outputs ?? "?";
          const uiItems = JSON.stringify(desc.ui).length;
          console.log("[Arcturus] _compileDsp: DSP descriptor — inputs:", numInputs, "outputs:", numOutputs, "UI JSON size:", uiItems);
        } catch { /* ignore */ }
      }
    }
    console.log("[Arcturus] _compileDsp: creating synth node (voices=%d)…", this.maxVoices);
    console.log("[Arcturus] _compileDsp: context state:", context.state, "sampleRate:", context.sampleRate);
    const synthNode = await synthGen.createNode(context, this.maxVoices, "synth").catch((e: unknown) => {
      console.error("[Arcturus] _compileDsp: createNode threw:", e);
      throw e;
    });
    console.log("[Arcturus] _compileDsp: synth node created:", !!synthNode);

    console.log("[Arcturus] _compileDsp: creating effects node…");
    const fxNode = await fxGen.createNode(context, "effects");
    console.log("[Arcturus] _compileDsp: effects node created:", !!fxNode);

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
  "chorus_mode",
  "delay_time",
  "delay_feedback",
  "reverb_damp",
  "reverb_mix",
  "master",
]);
