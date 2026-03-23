/**
 * Parameter registry — Faust parameter paths, value scaling, soft takeover.
 * Parameter paths match the hslider/button names in synth.dsp and effects.dsp.
 */

import type { SynthParam, EncoderMapping } from "@/types";

// ── Parameter Definitions ──
// Paths match exactly the hslider labels in the Faust DSP files.

export const SYNTH_PARAMS: Record<string, SynthParam> = {
  waveform: {
    path: "waveform",
    label: "Wave",
    min: 0,
    max: 3,
    default: 0,
    scale: "linear",
  },
  detune: {
    path: "detune",
    label: "Tune",
    min: -100,
    max: 100,
    default: 0,
    scale: "linear",
    unit: "¢",
  },
  cutoff: {
    path: "cutoff",
    label: "Cut",
    min: 20,
    max: 20000,
    default: 8000,
    scale: "logarithmic",
    unit: "Hz",
  },
  resonance: {
    path: "resonance",
    label: "Res",
    min: 0,
    max: 1,
    default: 0.5,
    scale: "linear",
  },
  fenv_amount: {
    path: "fenv_amount",
    label: "FEnv",
    min: -1,
    max: 1,
    default: 0.5,
    scale: "linear",
  },
  attack: {
    path: "attack",
    label: "Atk",
    min: 0.001,
    max: 5,
    default: 0.01,
    scale: "logarithmic",
    unit: "s",
  },
  decay_sustain: {
    path: "decay",
    label: "D/S",
    min: 0.001,
    max: 5,
    default: 0.3,
    scale: "logarithmic",
    unit: "s",
  },
  release: {
    path: "release",
    label: "Rel",
    min: 0.001,
    max: 5,
    default: 0.5,
    scale: "logarithmic",
    unit: "s",
  },
  delay_time: {
    path: "delay_time",
    label: "DTim",
    min: 0.01,
    max: 2,
    default: 0.25,
    scale: "logarithmic",
    unit: "s",
  },
  delay_feedback: {
    path: "delay_feedback",
    label: "DFbk",
    min: 0,
    max: 0.95,
    default: 0.3,
    scale: "linear",
  },
  reverb_damp: {
    path: "reverb_damp",
    label: "RvDk",
    min: 0,
    max: 1,
    default: 0.5,
    scale: "linear",
  },
  reverb_mix: {
    path: "reverb_mix",
    label: "RvMx",
    min: 0,
    max: 1,
    default: 0.3,
    scale: "linear",
  },
  chorus_rate: {
    path: "chorus_rate",
    label: "ChRt",
    min: 0.1,
    max: 10,
    default: 1.5,
    scale: "logarithmic",
    unit: "Hz",
  },
  chorus_depth: {
    path: "chorus_depth",
    label: "ChDp",
    min: 0,
    max: 1,
    default: 0.5,
    scale: "linear",
  },
  drive: {
    path: "drive",
    label: "Driv",
    min: 0,
    max: 1,
    default: 0,
    scale: "linear",
  },
  // Encoder 16: voice limit — not a DSP param, handled at app layer
  voices: {
    path: "__voices",
    label: "Voic",
    min: 1,
    max: 8,
    default: 8,
    scale: "linear",
  },
};

/** Encoder index (0-15) → parameter key in SYNTH_PARAMS */
export const ENCODER_PARAM_NAMES: string[] = [
  "waveform",      // E1
  "detune",        // E2
  "cutoff",        // E3
  "resonance",     // E4
  "fenv_amount",   // E5
  "attack",        // E6
  "decay_sustain", // E7
  "release",       // E8
  "delay_time",    // E9
  "delay_feedback",// E10
  "reverb_damp",   // E11
  "reverb_mix",    // E12
  "chorus_rate",   // E13
  "chorus_depth",  // E14
  "drive",         // E15
  "voices",        // E16
];

/** Build encoder → param mapping array for the mapper. */
export function buildEncoderMappings(): EncoderMapping[] {
  return ENCODER_PARAM_NAMES.map((name, idx) => ({
    encoderIndex: idx,
    param: SYNTH_PARAMS[name],
  }));
}

// ── Value scaling ──

/**
 * Convert a normalized 0-1 encoder position to a DSP parameter value.
 * Linear: direct interpolation between min and max.
 * Logarithmic: exponential interpolation (equal ratios per unit).
 */
export function normalizedToParam(normalized: number, param: SynthParam): number {
  const n = Math.max(0, Math.min(1, normalized));
  if (param.scale === "logarithmic") {
    const logMin = Math.log(param.min);
    const logMax = Math.log(param.max);
    return Math.exp(logMin + n * (logMax - logMin));
  }
  return param.min + n * (param.max - param.min);
}

/**
 * Convert a DSP parameter value to a normalized 0-1 encoder position.
 */
export function paramToNormalized(value: number, param: SynthParam): number {
  const v = Math.max(param.min, Math.min(param.max, value));
  if (param.scale === "logarithmic") {
    const logMin = Math.log(param.min);
    const logMax = Math.log(param.max);
    return (Math.log(v) - logMin) / (logMax - logMin);
  }
  return (v - param.min) / (param.max - param.min);
}

// ── Soft takeover ──

/**
 * Soft takeover state per encoder.
 * When a patch loads, the encoder latches until the hardware position
 * passes through the software value, then becomes live.
 *
 * approachFromAbove is set at latch time:
 * - true  → hardware is above soft value; unlatch only when hardware goes DOWN to soft
 * - false → hardware is below soft value; unlatch only when hardware goes UP to soft
 */
export interface SoftTakeoverState {
  softValue: number;        // Current software value, normalized 0-1
  live: boolean;            // True when hardware position matches software
  hardwarePosition: number; // Last known hardware encoder position, normalized 0-1
  approachFromAbove: boolean; // Which side hardware started on at latch time
}

export function createSoftTakeoverState(
  initialValue: number,
  param: SynthParam
): SoftTakeoverState {
  const normalized = paramToNormalized(initialValue, param);
  return { softValue: normalized, live: true, hardwarePosition: normalized, approachFromAbove: false };
}

/**
 * Process an encoder delta with soft takeover.
 * Returns new normalized value if live, or null if still latched.
 *
 * @param state - mutated in-place
 * @param delta - raw encoder delta (e.g. 1 for slow CW, -1 for slow CCW)
 * @param sensitivity - scaling factor (default 1/128)
 */
export function processSoftTakeover(
  state: SoftTakeoverState,
  delta: number,
  sensitivity = 1 / 128
): number | null {
  const newPos = Math.max(0, Math.min(1, state.hardwarePosition + delta * sensitivity));
  state.hardwarePosition = newPos;

  if (state.live) {
    state.softValue = newPos;
    return newPos;
  }

  // Unlatch only when hardware has moved through the soft value from the correct side:
  // - Hardware started above soft value → only unlatch when going CCW (down) and crossing it
  // - Hardware started below soft value → only unlatch when going CW (up) and crossing it
  const crossedThrough = state.approachFromAbove
    ? delta < 0 && state.hardwarePosition <= state.softValue
    : delta > 0 && state.hardwarePosition >= state.softValue;

  if (crossedThrough) {
    state.live = true;
    state.softValue = newPos;
    return newPos;
  }

  return null;
}

/** Force an encoder to re-latch (call when loading a patch). */
export function latchEncoder(state: SoftTakeoverState, newSoftValue: number): void {
  state.softValue = newSoftValue;
  state.live = false;
  state.approachFromAbove = state.hardwarePosition > newSoftValue;
}

// ── Parameter Store ──

/**
 * Holds current normalized values for all parameters.
 * Manages soft takeover state per encoder.
 * Fires onParamChange when a value changes.
 */
export class ParameterStore {
  private readonly _values: Map<string, number> = new Map();
  private readonly _softTakeover: SoftTakeoverState[] = [];
  onParamChange?: (path: string, value: number) => void;

  constructor() {
    for (const param of Object.values(SYNTH_PARAMS)) {
      this._values.set(param.path, paramToNormalized(param.default, param));
    }
    for (let i = 0; i < 16; i++) {
      const name = ENCODER_PARAM_NAMES[i];
      const param = SYNTH_PARAMS[name];
      this._softTakeover.push(createSoftTakeoverState(param.default, param));
    }
  }

  /** Get the current normalized (0-1) value for a path. */
  getNormalized(path: string): number {
    return this._values.get(path) ?? 0;
  }

  /** Get the current scaled value for a SynthParam. */
  getValue(param: SynthParam): number {
    return normalizedToParam(this.getNormalized(param.path), param);
  }

  /** Set normalized value directly (bypasses soft takeover). */
  setNormalized(path: string, normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this._values.set(path, clamped);
    const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
    if (param) this.onParamChange?.(path, normalizedToParam(clamped, param));
  }

  /**
   * Process an encoder delta with soft takeover.
   * Returns true if the DSP parameter was actually updated.
   */
  processEncoderDelta(encoderIndex: number, delta: number, sensitivity?: number): boolean {
    const state = this._softTakeover[encoderIndex];
    const name = ENCODER_PARAM_NAMES[encoderIndex];
    const param = name ? SYNTH_PARAMS[name] : undefined;
    if (!state || !param) return false;

    const newNorm = processSoftTakeover(state, delta, sensitivity);
    if (newNorm === null) return false;

    this._values.set(param.path, newNorm);
    this.onParamChange?.(param.path, normalizedToParam(newNorm, param));
    return true;
  }

  /**
   * Load parameter values from a patch.
   * Triggers soft takeover latching for all encoders not at loaded positions.
   */
  loadValues(values: Record<string, number>): void {
    for (const [path, value] of Object.entries(values)) {
      const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
      if (!param) continue;
      const normalized = paramToNormalized(value, param);
      this._values.set(path, normalized);
      for (let i = 0; i < ENCODER_PARAM_NAMES.length; i++) {
        const name = ENCODER_PARAM_NAMES[i];
        if (SYNTH_PARAMS[name]?.path === path) {
          latchEncoder(this._softTakeover[i], normalized);
        }
      }
      this.onParamChange?.(path, value);
    }
  }

  /** Snapshot all current values as a patch parameter record. */
  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const param of Object.values(SYNTH_PARAMS)) {
      if (param.path.startsWith("__")) continue; // skip internal params
      const n = this._values.get(param.path) ?? paramToNormalized(param.default, param);
      result[param.path] = normalizedToParam(n, param);
    }
    return result;
  }
}
