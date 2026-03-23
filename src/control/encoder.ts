/**
 * Encoder — Binary Offset (Relative 1) mode CC parsing for BeatStep encoders.
 *
 * In Relative 1 / Binary Offset mode:
 *   CC value 64 = no movement
 *   CC value > 64 = clockwise (increment)
 *   CC value < 64 = counter-clockwise (decrement)
 *   Delta = value - 64
 *
 * Acceleration: larger absolute deltas from the hardware indicate faster
 * spinning. We apply a linear multiplier so fast turns move parameters faster.
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
 * Parse a Binary Offset CC value into a signed delta.
 * Returns 0 if the value is in the deadzone (64 ± 1).
 *
 * @param ccValue - raw CC data byte (0-127)
 */
export function parseRelativeCC(ccValue: number): number {
  const raw = ccValue - 64;
  if (Math.abs(raw) <= 0) return 0; // strict deadzone: only 64 means no movement
  return raw;
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
}

/** Default 16-encoder configuration: CC 1-16 on MIDI channel 1. */
export function defaultEncoderConfig(): EncoderState[] {
  return Array.from({ length: 16 }, (_, i) => ({ ccNumber: i + 1 }));
}

// ── Encoder Manager ──

/**
 * EncoderManager processes incoming CC messages from the BeatStep
 * and routes them to a callback as (encoderIndex, delta) pairs.
 */
export class EncoderManager {
  private readonly _encoders: EncoderState[];
  private readonly _ccToIndex: Map<number, number>;
  onEncoderDelta?: (encoderIndex: number, delta: number) => void;

  constructor(encoders: EncoderState[] = defaultEncoderConfig()) {
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
    const delta = parseEncoderDelta(value, encoder.sensitivity);
    if (delta !== 0) {
      this.onEncoderDelta?.(idx, delta);
    }
    return true;
  }

  /** Update the CC number for an encoder (used after calibration). */
  setEncoderCC(encoderIndex: number, ccNumber: number): void {
    const old = this._encoders[encoderIndex];
    if (!old) return;
    this._ccToIndex.delete(old.ccNumber);
    old.ccNumber = ccNumber;
    this._ccToIndex.set(ccNumber, encoderIndex);
  }
}
