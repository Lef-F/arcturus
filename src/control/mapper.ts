/**
 * Control Mapper — routes BeatStep CC messages to Faust parameters.
 * Bridges the EncoderManager and ParameterStore.
 */

import { EncoderManager, parseRelativeCC, type EncoderState } from "./encoder";
import type { ParameterStore } from "@/audio/params";

const CONTROL_CHANGE = 0xb0;

// ── Mapper ──

export class ControlMapper {
  private readonly _encoderManager: EncoderManager;
  private _store: ParameterStore | null = null;
  private readonly _ccMaster: number;

  constructor(encoders: EncoderState[], masterCC: number) {
    this._ccMaster = masterCC;
    this._encoderManager = new EncoderManager(encoders);
    this._encoderManager.onEncoderDelta = (idx, delta) => {
      this._routeEncoderDelta(idx, delta);
    };
  }

  /** Attach the parameter store (routes encoder deltas to DSP params). */
  setStore(store: ParameterStore): void {
    this._store = store;
  }

  /** Called when the large master encoder is turned. Delta is pre-scaled (÷64). */
  onMasterDelta?: (delta: number) => void;

  handleMessage(data: Uint8Array): boolean {
    if (data.length >= 3 && (data[0] & 0xf0) === CONTROL_CHANGE && data[1] === this._ccMaster) {
      const delta = parseRelativeCC(data[2]) / 64;
      if (delta !== 0) this.onMasterDelta?.(delta);
      return true;
    }
    return this._encoderManager.handleMessage(data);
  }

  /** Set transmission mode for all encoders ("relative" or "absolute"). */
  setAllEncoderModes(mode: "relative" | "relative2" | "relative3" | "absolute"): void {
    this._encoderManager.setAllEncoderModes(mode);
  }

  private _routeEncoderDelta(encoderIndex: number, delta: number): void {
    // delta is already scaled by EncoderManager (×1/64) — pass sensitivity=1 to avoid double-scaling.
    this._store?.processEncoderDelta(encoderIndex, delta, 1);
  }
}
