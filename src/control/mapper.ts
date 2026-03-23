/**
 * Control Mapper — routes BeatStep CC messages to Faust parameters.
 * Bridges the EncoderManager and ParameterStore.
 */

import { EncoderManager, type EncoderState } from "./encoder";
import type { ParameterStore } from "@/audio/params";
import type { SynthEngine } from "@/audio/engine";

// ── Mapper ──

export class ControlMapper {
  private readonly _encoderManager: EncoderManager;
  private _store: ParameterStore | null = null;
  private _engine: SynthEngine | null = null;
  private _voiceLimit = 8; // current max voices (controlled by encoder 16)

  /** Called when encoder 16 changes the voice limit. */
  onVoiceLimitChange?: (voices: number) => void;

  constructor(encoders?: EncoderState[]) {
    this._encoderManager = new EncoderManager(encoders);
    this._encoderManager.onEncoderDelta = (idx, delta) => {
      this._routeEncoderDelta(idx, delta);
    };
  }

  /** Attach the parameter store (routes encoder deltas to DSP params). */
  setStore(store: ParameterStore): void {
    this._store = store;
    // Wire store param changes to the engine
    store.onParamChange = (path, value) => {
      this._engine?.setParamValue(path, value);
    };
  }

  /** Attach the synth engine (receives setParamValue calls). */
  setEngine(engine: SynthEngine): void {
    this._engine = engine;
  }

  /**
   * Process a raw MIDI message from the BeatStep.
   * Only handles CC messages (encoder turns).
   * Returns true if handled.
   */
  handleMessage(data: Uint8Array): boolean {
    return this._encoderManager.handleMessage(data);
  }

  /** Update the CC assignment for an encoder (used after calibration). */
  setEncoderCC(encoderIndex: number, ccNumber: number): void {
    this._encoderManager.setEncoderCC(encoderIndex, ccNumber);
  }

  private _routeEncoderDelta(encoderIndex: number, delta: number): void {
    // Encoder 16 (index 15) controls voice limit — handled at app layer
    if (encoderIndex === 15) {
      this._voiceLimit = Math.max(1, Math.min(8, Math.round(this._voiceLimit + delta * 8)));
      this._store?.processEncoderDelta(15, delta);
      this.onVoiceLimitChange?.(this._voiceLimit);
      return;
    }

    this._store?.processEncoderDelta(encoderIndex, delta);
  }
}
