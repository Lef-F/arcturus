/**
 * Encoder — CC parsing for BeatStep encoders in all four transmission modes.
 *
 * Absolute mode: encoder tracks position 0-127; delta = current - previous.
 *
 * Relative 1 (Binary Offset):
 *   CC value 64 = no movement; >64 = CW; <64 = CCW. Delta = value - 64.
 *
 * Relative 2 (Two's Complement):
 *   CW = 1..63; CCW = 65..127 (127 = -1, 126 = -2, …). Delta = value ≤ 63 ? value : value - 128.
 *
 * Relative 3 (Sign + Magnitude):
 *   Bit 6 = direction (0 = CW, 1 = CCW); bits 0-5 = step magnitude.
 *   Delta = (value & 0x40) ? -(value & 0x3F) : (value & 0x3F).
 *
 * Acceleration: larger absolute deltas indicate faster spinning. We apply a
 * linear multiplier so fast turns move parameters faster.
 */

// ── Configuration ──

/**
 * Sensitivity multiplier applied to each encoder step before passing to
 * the parameter store. Tune this to feel right at default parameter ranges.
 * A value of 1/64 means 64 full CW steps moves a linear param from 0→1.
 */
export const DEFAULT_SENSITIVITY = 1 / 64;

/**
 * Acceleration multiplier table.
 * Maps absolute delta magnitude to a multiplier.
 * delta 1 = slow (×1), delta 6+ = fast (×6).
 */
function accelerationMultiplier(absDelta: number): number {
  return Math.min(absDelta, 6);
}

// ── Relative CC parsing ──

/**
 * Parse a Binary Offset (Relative 1) CC value into a signed delta.
 * Returns 0 if value is 64 (center = no movement).
 *
 * @param ccValue - raw CC data byte (0-127)
 */
export function parseRelativeCC(ccValue: number): number {
  const raw = ccValue - 64;
  if (raw === 0) return 0;
  return raw;
}

/**
 * Parse a Two's Complement (Relative 2) CC value into a signed delta.
 * CW = 1..63; CCW = 65..127 (127 = -1, 126 = -2, …); 0 and 64 = no movement.
 *
 * @param ccValue - raw CC data byte (0-127)
 */
export function parseTwosComplementCC(ccValue: number): number {
  if (ccValue === 0 || ccValue === 64) return 0;
  return ccValue <= 63 ? ccValue : ccValue - 128;
}

/**
 * Parse a Sign + Magnitude (Relative 3) CC value into a signed delta.
 * Bit 6 = direction (0 = CW, 1 = CCW); bits 0-5 = magnitude.
 *
 * @param ccValue - raw CC data byte (0-127)
 */
export function parseSignMagnitudeCC(ccValue: number): number {
  const magnitude = ccValue & 0x3f;
  if (magnitude === 0) return 0;
  return (ccValue & 0x40) ? -magnitude : magnitude;
}

/**
 * Parse a Binary Offset CC value into an accelerated signed delta,
 * scaled by the sensitivity factor.
 *
 * @param ccValue - raw CC data byte (0-127)
 * @param sensitivity - per-step scaling (default DEFAULT_SENSITIVITY)
 */
export function parseEncoderDelta(
  ccValue: number,
  sensitivity = DEFAULT_SENSITIVITY
): number {
  const raw = parseRelativeCC(ccValue);
  if (raw === 0) return 0;
  const sign = raw > 0 ? 1 : -1;
  const accel = accelerationMultiplier(Math.abs(raw));
  return sign * accel * sensitivity;
}

// ── Encoder state ──

/**
 * State for a single encoder channel.
 * Tracks the last CC number assigned to this encoder position.
 */
export interface EncoderState {
  /** BeatStep CC number for this encoder (1-16 by default) */
  ccNumber: number;
  /** Sensitivity override (uses DEFAULT_SENSITIVITY if undefined) */
  sensitivity?: number;
  /**
   * Encoder transmission mode.
   * - "relative"  — Relative 1, Binary Offset: value 64=center, >64=CW, <64=CCW.
   * - "relative2" — Relative 2, Two's Complement: CW=1..63, CCW=65..127.
   * - "relative3" — Relative 3, Sign+Magnitude: bit6=direction, bits0-5=magnitude.
   * - "absolute"  — tracks position 0-127; delta = current - previous.
   */
  mode?: "relative" | "relative2" | "relative3" | "absolute";
}

// ── Encoder Manager ──

/**
 * EncoderManager processes incoming CC messages from the BeatStep
 * and routes them to a callback as (encoderIndex, delta) pairs.
 */
export class EncoderManager {
  private readonly _encoders: EncoderState[];
  private readonly _ccToIndex: Map<number, number>;
  /** Last seen absolute value per encoder index (for absolute mode delta tracking). */
  private readonly _lastAbsoluteValue: Map<number, number> = new Map();
  onEncoderDelta?: (encoderIndex: number, delta: number) => void;

  constructor(encoders: EncoderState[]) {
    this._encoders = encoders;
    this._ccToIndex = new Map(encoders.map((e, i) => [e.ccNumber, i]));
  }

  /**
   * Process a CC message (status byte + cc + value).
   * Only handles Control Change messages (status 0xBn).
   * Returns true if the message was handled.
   */
  handleMessage(data: Uint8Array): boolean {
    if (data.length < 3) return false;
    const status = data[0] & 0xf0;
    if (status !== 0xb0) return false; // not CC

    const cc = data[1];
    const value = data[2];

    const idx = this._ccToIndex.get(cc);
    if (idx === undefined) return false;

    const encoder = this._encoders[idx];
    const sensitivity = encoder.sensitivity ?? DEFAULT_SENSITIVITY;
    let delta: number;

    if (encoder.mode === "absolute") {
      const prev = this._lastAbsoluteValue.get(idx);
      this._lastAbsoluteValue.set(idx, value);
      if (prev === undefined) return true; // first message — no previous value to diff against
      delta = (value - prev) * sensitivity;
    } else if (encoder.mode === "relative2") {
      const raw = parseTwosComplementCC(value);
      if (raw === 0) return true;
      const sign = raw > 0 ? 1 : -1;
      delta = sign * accelerationMultiplier(Math.abs(raw)) * sensitivity;
    } else if (encoder.mode === "relative3") {
      const raw = parseSignMagnitudeCC(value);
      if (raw === 0) return true;
      const sign = raw > 0 ? 1 : -1;
      delta = sign * accelerationMultiplier(Math.abs(raw)) * sensitivity;
    } else {
      delta = parseEncoderDelta(value, sensitivity);
    }

    if (delta !== 0) {
      this.onEncoderDelta?.(idx, delta);
    }
    return true;
  }

  /** Update the CC number for an encoder (used after calibration). */
  setEncoderCC(encoderIndex: number, ccNumber: number): void {
    const old = this._encoders[encoderIndex];
    if (!old) return;
    // Only remove the old CC mapping if it still points to this encoder.
    // If another setEncoderCC call already claimed old.ccNumber, leave it alone.
    if (this._ccToIndex.get(old.ccNumber) === encoderIndex) {
      this._ccToIndex.delete(old.ccNumber);
    }
    old.ccNumber = ccNumber;
    this._ccToIndex.set(ccNumber, encoderIndex);
  }

  /** Update the transmission mode for an encoder. */
  setEncoderMode(encoderIndex: number, mode: EncoderState["mode"]): void {
    const enc = this._encoders[encoderIndex];
    if (!enc) return;
    enc.mode = mode;
    this._lastAbsoluteValue.delete(encoderIndex); // reset position tracking on mode change
  }

  /** Update the transmission mode for all encoders at once. */
  setAllEncoderModes(mode: EncoderState["mode"]): void {
    for (let i = 0; i < this._encoders.length; i++) {
      this.setEncoderMode(i, mode);
    }
  }
}
