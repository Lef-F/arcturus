/**
 * Parameter registry — all Faust parameter paths, scaling, and module layout.
 * See docs/SOUND_ENGINE.md for the full reference.
 */

import type { SynthParam, SynthModule } from "@/types";

// ── Parameter Definitions ──
// Paths match exactly the hslider labels in synth.dsp / effects.dsp.

export const SYNTH_PARAMS: Record<string, SynthParam> = {

  // ── OSC ──
  waveform: {
    path: "waveform", label: "Wave",
    min: 0, max: 4, default: 0, scale: "linear",
    steps: 5, // SAW / SQR / TRI / SIN / SUPER
  },
  octave: {
    path: "octave", label: "Oct",
    min: -2, max: 2, default: 0, scale: "linear",
    steps: 5, // −2 / −1 / 0 / +1 / +2
  },
  detune: {
    path: "detune", label: "Tune",
    min: -100, max: 100, default: 0, scale: "linear", unit: "¢",
  },
  pulse_width: {
    path: "pulse_width", label: "PW",
    min: 0.05, max: 0.95, default: 0.5, scale: "linear",
  },
  noise_level: {
    path: "noise_level", label: "Noise",
    min: 0, max: 1, default: 0, scale: "linear",
  },

  // ── OSC B ──
  oscb_level: {
    path: "oscb_level", label: "BLvl",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  oscb_pitch: {
    path: "oscb_pitch", label: "BPch",
    min: -24, max: 24, default: 0, scale: "linear",
    steps: 49, // every semitone −24…+24
  },
  oscb_fine: {
    path: "oscb_fine", label: "BFne",
    min: -50, max: 50, default: 0, scale: "linear", unit: "¢",
  },
  oscb_wave: {
    path: "oscb_wave", label: "BWav",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, // SAW / SQR / TRI / SIN
  },

  // ── Supersaw ──
  supersaw_detune: {
    path: "supersaw_detune", label: "SDtn",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  supersaw_mix: {
    path: "supersaw_mix", label: "SMix",
    min: 0, max: 1, default: 0.5, scale: "linear",
  },

  // ── Filter ──
  cutoff: {
    path: "cutoff", label: "Cut",
    min: 20, max: 20000, default: 8000, scale: "logarithmic", unit: "Hz",
  },
  resonance: {
    path: "resonance", label: "Res",
    min: 0, max: 1, default: 0.5, scale: "linear",
  },
  fenv_amount: {
    path: "fenv_amount", label: "FEnv",
    min: -1, max: 1, default: 0.5, scale: "linear",
  },
  filter_mode: {
    path: "filter_mode", label: "FMod",
    min: 0, max: 1, default: 0, scale: "linear",
    // 0 = Moog LP, 0.5 = Notch, 1 = HP (continuous Oberheim SEM-style sweep)
  },

  // ── Filter Envelope ──
  f_attack: {
    path: "f_attack", label: "Atk",
    min: 0.001, max: 5, default: 0.01, scale: "logarithmic", unit: "s",
  },
  f_decay: {
    path: "f_decay", label: "Dec",
    min: 0.001, max: 5, default: 0.3, scale: "logarithmic", unit: "s",
  },
  f_sustain: {
    path: "f_sustain", label: "Sus",
    min: 0, max: 1, default: 0.5, scale: "linear",
  },
  f_release: {
    path: "f_release", label: "Rel",
    min: 0.001, max: 5, default: 0.5, scale: "logarithmic", unit: "s",
  },

  // ── Amp Envelope ──
  attack: {
    path: "attack", label: "Atk",
    min: 0.001, max: 5, default: 0.01, scale: "logarithmic", unit: "s",
  },
  decay: {
    path: "decay", label: "Dec",
    min: 0.001, max: 5, default: 0.3, scale: "logarithmic", unit: "s",
  },
  sustain: {
    path: "sustain", label: "Sus",
    min: 0, max: 1, default: 0.7, scale: "linear",
  },
  release: {
    path: "release", label: "Rel",
    min: 0.001, max: 5, default: 0.5, scale: "logarithmic", unit: "s",
  },

  // ── LFO ──
  lfo_rate: {
    path: "lfo_rate", label: "Rate",
    min: 0.01, max: 20, default: 1, scale: "logarithmic", unit: "Hz",
  },
  lfo_depth: {
    path: "lfo_depth", label: "Dpth",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  lfo_to_pitch: {
    path: "lfo_to_pitch", label: "→Pch",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  lfo_to_filter: {
    path: "lfo_to_filter", label: "→Flt",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  lfo_to_pw: {
    path: "lfo_to_pw", label: "→PW",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  lfo_to_amp: {
    path: "lfo_to_amp", label: "→Amp",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  lfo_shape: {
    path: "lfo_shape", label: "Shpe",
    min: 0, max: 4, default: 0, scale: "linear",
    steps: 5, // SIN / TRI / SAW / SQR / S&H
  },
  lfo_delay: {
    path: "lfo_delay", label: "Dlay",
    min: 0, max: 3, default: 0, scale: "linear", unit: "s",
  },

  // ── Mod ──
  transpose: {
    path: "transpose", label: "Xpos",
    min: -24, max: 24, default: 0, scale: "linear",
    steps: 49, // every semitone −24…+24
  },
  glide: {
    path: "glide", label: "Glid",
    min: 0.001, max: 3, default: 0.001, scale: "logarithmic", unit: "s",
    // Values < 5ms bypass the slew (hard gate), so default feels like "off"
  },
  poly_fenv_freq: {
    path: "poly_fenv_freq", label: "FE→P",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  poly_fenv_pw: {
    path: "poly_fenv_pw", label: "FE→W",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  poly_oscb_freq: {
    path: "poly_oscb_freq", label: "B→Pt",
    min: -1, max: 1, default: 0, scale: "linear",
  },
  poly_oscb_pw: {
    path: "poly_oscb_pw", label: "B→PW",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  poly_oscb_filt: {
    path: "poly_oscb_filt", label: "B→Ft",
    min: -1, max: 1, default: 0, scale: "linear",
  },

  // ── FX ──
  drive: {
    path: "drive", label: "Driv",
    min: 0, max: 1, default: 0, scale: "linear",
  },
  chorus_rate: {
    path: "chorus_rate", label: "ChRt",
    min: 0.1, max: 10, default: 1.5, scale: "logarithmic", unit: "Hz",
  },
  chorus_depth: {
    path: "chorus_depth", label: "ChDp",
    min: 0, max: 1, default: 0.5, scale: "linear",
  },
  delay_time: {
    path: "delay_time", label: "DTim",
    min: 0.01, max: 2, default: 0.25, scale: "logarithmic", unit: "s",
  },
  delay_feedback: {
    path: "delay_feedback", label: "DFbk",
    min: 0, max: 0.95, default: 0.3, scale: "linear",
  },
  reverb_mix: {
    path: "reverb_mix", label: "RvMx",
    min: 0, max: 1, default: 0.3, scale: "linear",
  },
  reverb_damp: {
    path: "reverb_damp", label: "RvDk",
    min: 0, max: 1, default: 0.5, scale: "linear",
  },
  master: {
    path: "master", label: "Vol",
    min: 0, max: 1, default: 0.8, scale: "linear",
  },

  // ── OSC (additional) ──
  osc_sync: {
    path: "osc_sync", label: "Sync",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, // OFF / ON
  },
  timbre: {
    path: "timbre", label: "Timb",
    min: 0, max: 1, default: 0, scale: "linear",
    // Buchla-style sine wavefolder: 0=dry, 1=fully folded
  },
  noise_color: {
    path: "noise_color", label: "NCol",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, // 0=White / 1=Pink
  },

  // ── Filter (additional) ──
  key_track: {
    path: "key_track", label: "KTrk",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 3, // OFF / HALF / FULL
  },
  vel_to_cutoff: {
    path: "vel_to_cutoff", label: "V→F",
    min: 0, max: 1, default: 0, scale: "linear",
    // Velocity → filter cutoff: 1.0 = +2 octaves at max velocity
  },
  hpf_cutoff: {
    path: "hpf_cutoff", label: "HPF",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, // 0=off(~1Hz) / 1=18Hz / 2=59Hz / 3=185Hz
  },

  // ── Filter Envelope (additional) ──
  fenv_mode: {
    path: "fenv_mode", label: "Mode",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, // 0=ADSR / 1=ADS (Decay=Release, Oberheim SEM)
  },
  fenv_curve: {
    path: "fenv_curve", label: "Curv",
    min: 0, max: 1, default: 0.5, scale: "linear",
    // 0=linear, 0.5=moderate expo, 1=steep expo (Prophet-5 snap)
  },

  // ── Amp Envelope (additional) ──
  vel_to_amp: {
    path: "vel_to_amp", label: "V→A",
    min: 0, max: 1, default: 0, scale: "linear",
    // Velocity → amplitude: 0=ignore velocity, 1=full sensitivity
  },
  aenv_mode: {
    path: "aenv_mode", label: "Mode",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, // 0=ADSR / 1=ADS (Decay=Release, Oberheim SEM)
  },
  aenv_curve: {
    path: "aenv_curve", label: "Curv",
    min: 0, max: 1, default: 0.5, scale: "linear",
    // 0=linear, 0.5=moderate expo, 1=steep expo (Prophet-5 snap)
  },

  // ── Mixer ──
  mixer_drive: {
    path: "mixer_drive", label: "MDrv",
    min: 0, max: 1, default: 0, scale: "linear",
    // Pre-filter saturation: 0=clean, 1=tanh soft-clip (Prophet-5 gain staging)
  },

  // ── Unison ──
  unison_detune: {
    path: "unison_detune", label: "UDtn",
    min: 0, max: 50, default: 0, scale: "linear", unit: "¢",
    // Unison voice spread in cents (0=off). Active when voices=1.
  },

  // ── FX (additional) ──
  chorus_mode: {
    path: "chorus_mode", label: "ChMd",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, // 0=Custom / 1=Juno-I / 2=Juno-II / 3=Juno-I+II
  },

  // ── Global ──
  vintage: {
    path: "vintage", label: "Vntg",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 5, // 0 = stable … 4 = max drift
  },
  voices: {
    path: "voices", label: "Voic",
    min: 1, max: 8, default: 8, scale: "linear",
    steps: 8, // 1 – 8 voices
  },
};

// ── Module Definitions ──
// 8 modules × 16 encoder slots. null = empty/future slot.

const E = 16; // slots per module

function slots(...keys: (string | null)[]): (string | null)[] {
  const out = [...keys];
  while (out.length < E) out.push(null);
  return out;
}

export const MODULES: SynthModule[] = [
  // Module 1 — OSC A: Primary oscillator. Most-reached-for controls up front.
  {
    id: "osca", label: "OSCA",
    params: slots(
      "waveform", "octave", "detune", "pulse_width",         // E1–E4: core shape
      "supersaw_detune", "supersaw_mix",                      // E5–E6: supersaw (when wave=SUPER)
      "osc_sync", "timbre",                                   // E7–E8: sync + wavefolder
    ),
  },
  // Module 2 — OSC B: Second oscillator + noise. Layering sources.
  {
    id: "oscb", label: "OSCB",
    params: slots(
      "oscb_level", "oscb_wave", "oscb_pitch", "oscb_fine",  // E1–E4: core B controls
      "noise_level", "noise_color",                           // E5–E6: noise source
      "mixer_drive",                                          // E7: pre-filter saturation (gain staging)
      null,                                                   // E8: reserved
    ),
  },
  // Module 3 — FLTR: Filter. Signal shaping heart of the synth.
  {
    id: "filter", label: "FLTR",
    params: slots(
      "cutoff", "resonance", "fenv_amount", "filter_mode",   // E1–E4: core filter
      "key_track", "vel_to_cutoff", "hpf_cutoff",            // E5–E7: tracking + HPF
      null,                                                   // E8: reserved
    ),
  },
  // Module 4 — ENV: Both envelopes side-by-side. Filter env (E1–E8), Amp env (E9–E16).
  // Reduces module switching — tweak both envelopes without changing pages.
  {
    id: "env", label: "ENV",
    params: slots(
      "f_attack", "f_decay", "f_sustain", "f_release",       // E1–E4: filter ADSR
      "fenv_mode", "fenv_curve",                              // E5–E6: filter env options
      null, null,                                             // E7–E8: reserved (row break)
      "attack", "decay", "sustain", "release",                // E9–E12: amp ADSR
      "aenv_mode", "aenv_curve",                              // E13–E14: amp env options
      "vel_to_amp",                                           // E15: velocity sensitivity
      null,                                                   // E16: reserved
    ),
  },
  // Module 5 — MOD: All modulation in one place. LFO (E1–E8) + Poly Mod (E9–E16).
  {
    id: "mod", label: "MOD",
    params: slots(
      "lfo_rate", "lfo_depth", "lfo_shape", "lfo_delay",         // E1–E4: LFO core
      "lfo_to_pitch", "lfo_to_filter", "lfo_to_pw", "lfo_to_amp", // E5–E8: LFO destinations
      "poly_fenv_freq", "poly_fenv_pw",                           // E9–E10: FEnv poly mod
      "poly_oscb_freq", "poly_oscb_pw", "poly_oscb_filt",        // E11–E13: OscB poly mod
      "transpose", "glide",                                       // E14–E15: performance
      null,                                                       // E16: reserved
    ),
  },
  // Module 6 — FX: Effects chain. Ordered by signal flow.
  {
    id: "fx", label: "FX",
    params: slots(
      "drive",                                                        // E1: overdrive
      "chorus_mode", "chorus_rate", "chorus_depth",                   // E2–E4: chorus
      "delay_time", "delay_feedback",                                 // E5–E6: delay
      "reverb_mix", "reverb_damp",                                    // E7–E8: reverb
      "master",                                                       // E9: output volume
    ),
  },
  // Module 7 — GLOB: Global voice settings.
  {
    id: "global", label: "GLOB",
    params: slots(
      "voices", "vintage", "unison_detune",                          // E1–E3: voice engine
    ),
  },
  // Module 8 — (reserved for future expansion)
  {
    id: "aux", label: "AUX",
    params: slots(), // all empty — future: arpeggiator, aftertouch routing, etc.
  },
];

/** Resolve a module's 16 encoder slots to SynthParam | null. */
export function getModuleParams(moduleIndex: number): (SynthParam | null)[] {
  const mod = MODULES[moduleIndex];
  if (!mod) return new Array(16).fill(null);
  return mod.params.map((key) => (key ? (SYNTH_PARAMS[key] ?? null) : null));
}

// ── Value scaling ──

export function normalizedToParam(normalized: number, param: SynthParam): number {
  const n = Math.max(0, Math.min(1, normalized));
  if (param.scale === "logarithmic") {
    const logMin = Math.log(param.min);
    const logMax = Math.log(param.max);
    return Math.exp(logMin + n * (logMax - logMin));
  }
  return param.min + n * (param.max - param.min);
}

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

export interface SoftTakeoverState {
  softValue: number;
  live: boolean;
  hardwarePosition: number;
  approachFromAbove: boolean;
}

export function createSoftTakeoverState(
  initialValue: number,
  param: SynthParam
): SoftTakeoverState {
  const normalized = paramToNormalized(initialValue, param);
  return { softValue: normalized, live: true, hardwarePosition: normalized, approachFromAbove: false };
}

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

export function latchEncoder(state: SoftTakeoverState, newSoftValue: number): void {
  state.softValue = newSoftValue;
  state.live = false;
  state.approachFromAbove = state.hardwarePosition > newSoftValue;
}

// ── Parameter Store ──

export class ParameterStore {
  private readonly _values = new Map<string, number>();
  private readonly _softTakeover = new Map<string, SoftTakeoverState>();
  /** Currently active module index (0–7). Used by processEncoderDelta. */
  activeModule = 0;
  onParamChange?: (path: string, value: number) => void;

  constructor() {
    // Initialize all params to their defaults
    for (const param of Object.values(SYNTH_PARAMS)) {
      const norm = paramToNormalized(param.default, param);
      this._values.set(param.path, norm);
      this._softTakeover.set(param.path, createSoftTakeoverState(param.default, param));
    }
  }

  getNormalized(path: string): number {
    return this._values.get(path) ?? 0;
  }

  getValue(param: SynthParam): number {
    return normalizedToParam(this.getNormalized(param.path), param);
  }

  setNormalized(path: string, normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this._values.set(path, clamped);
    const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
    if (param) this.onParamChange?.(path, normalizedToParam(clamped, param));
  }

  /**
   * Process a delta for a physical encoder slot (0–15) in the active module.
   * Used by ControlMapper and legacy callers.
   */
  processEncoderDelta(encoderSlot: number, delta: number, sensitivity?: number): boolean {
    const param = getModuleParams(this.activeModule)[encoderSlot];
    if (!param) return false;
    return this.processParamDelta(param.path, delta, sensitivity);
  }

  /**
   * Process a delta for a specific parameter path (used for mouse wheel + hardware encoders).
   */
  processParamDelta(path: string, delta: number, sensitivity?: number): boolean {
    const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
    if (!param) return false;
    const state = this._softTakeover.get(path);
    if (!state) return false;

    let newNorm = processSoftTakeover(state, delta, sensitivity);
    if (newNorm === null) return false;

    // Snap to step grid for discrete params
    if (param.steps && param.steps > 1) {
      newNorm = Math.round(newNorm * (param.steps - 1)) / (param.steps - 1);
      if (newNorm === this._values.get(path)) return false;
      state.softValue = newNorm;
      state.hardwarePosition = newNorm;
    }

    this._values.set(path, newNorm);
    this.onParamChange?.(path, normalizedToParam(newNorm, param));
    return true;
  }

  loadValues(values: Record<string, number>): void {
    for (const [path, value] of Object.entries(values)) {
      const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
      if (!param) continue;
      const normalized = paramToNormalized(value, param);
      this._values.set(path, normalized);
      const state = this._softTakeover.get(path);
      if (state) latchEncoder(state, normalized);
      this.onParamChange?.(path, value);
    }
  }

  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const param of Object.values(SYNTH_PARAMS)) {
      const n = this._values.get(param.path) ?? paramToNormalized(param.default, param);
      result[param.path] = normalizedToParam(n, param);
    }
    return result;
  }
}
