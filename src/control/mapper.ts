/**
 * Control Mapper — routes BeatStep CC messages to Faust parameters.
 * Bridges the EncoderManager and ParameterStore.
 */

import { EncoderManager, type EncoderState } from "./encoder";
import type { ParameterStore } from "@/audio/params";

// ── Mapper ──

export class ControlMapper {
  private readonly _encoderManager: EncoderManager;
  private _store: ParameterStore | null = null;

  constructor(encoders?: EncoderState[]) {
    this._encoderManager = new EncoderManager(encoders);
    this._encoderManager.onEncoderDelta = (idx, delta) => {
      this._routeEncoderDelta(idx, delta);
    };
  }

  /** Attach the parameter store (routes encoder deltas to DSP params). */
  setStore(store: ParameterStore): void {
    this._store = store;
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
    if (encoderIndex === 15) {
      // Encoder 16 always controls voice count regardless of active module.
      // Encoder delta is already scaled by encoder sensitivity; pass sensitivity=1
      // so the soft-takeover system doesn't apply a second scale factor.
      this._store?.processParamDelta("voices", delta, 1);
      return;
    }

    this._store?.processEncoderDelta(encoderIndex, delta);
  }
}
