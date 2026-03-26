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
    steps: 5, valueLabels: ["SAW", "SQR", "TRI", "SIN", "SUPR"],
    hints: { affectsSpectrum: true },
  },
  octave: {
    path: "octave", label: "Oct",
    min: -2, max: 2, default: 0, scale: "linear",
    steps: 5, // −2 / −1 / 0 / +1 / +2
    hints: { affectsSpectrum: true },
  },
  detune: {
    path: "detune", label: "Tune",
    min: -100, max: 100, default: 0, scale: "linear", unit: "¢",
    hints: { affectsSpectrum: true },
  },
  pulse_width: {
    path: "pulse_width", label: "PW",
    min: 0.05, max: 0.95, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  noise_level: {
    path: "noise_level", label: "Noise",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },

  // ── OSC B ──
  oscb_level: {
    path: "oscb_level", label: "BLvl",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true, affectsAmplitude: true },
  },
  oscb_pitch: {
    path: "oscb_pitch", label: "BPch",
    min: -24, max: 24, default: 0, scale: "linear",
    steps: 49, // every semitone −24…+24
    hints: { affectsSpectrum: true },
  },
  oscb_fine: {
    path: "oscb_fine", label: "BFne",
    min: -50, max: 50, default: 0, scale: "linear", unit: "¢",
    hints: { affectsSpectrum: true },
  },
  oscb_wave: {
    path: "oscb_wave", label: "BWav",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, valueLabels: ["SAW", "SQR", "TRI", "SIN"],
    hints: { affectsSpectrum: true },
  },

  // ── Supersaw ──
  supersaw_detune: {
    path: "supersaw_detune", label: "SDtn",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  supersaw_mix: {
    path: "supersaw_mix", label: "SMix",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },

  // ── Filter ──
  cutoff: {
    path: "cutoff", label: "Cut",
    min: 20, max: 20000, default: 8000, scale: "logarithmic", unit: "Hz",
    hints: { affectsSpectrum: true, canMuteOutput: true }, // very low cutoff → near-silence
  },
  resonance: {
    path: "resonance", label: "Res",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  fenv_amount: {
    path: "fenv_amount", label: "FEnv",
    min: -1, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  filter_mode: {
    path: "filter_mode", label: "FMod",
    min: 0, max: 1, default: 0, scale: "linear",
    // 0 = Moog LP, 0.5 = Notch, 1 = HP (continuous Oberheim SEM-style sweep)
    hints: { affectsSpectrum: true },
  },

  // ── Filter Envelope ──
  f_attack: {
    path: "f_attack", label: "Atk",
    min: 0.001, max: 5, default: 0.01, scale: "logarithmic", unit: "s",
    hints: { maxLatency: 5 },
  },
  f_decay: {
    path: "f_decay", label: "Dec",
    min: 0.001, max: 5, default: 0.3, scale: "logarithmic", unit: "s",
    hints: { affectsSpectrum: true },
  },
  f_sustain: {
    path: "f_sustain", label: "Sus",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  f_release: {
    path: "f_release", label: "Rel",
    min: 0.001, max: 5, default: 0.5, scale: "logarithmic", unit: "s",
    hints: { maxLatency: 5 },
  },

  // ── Amp Envelope ──
  attack: {
    path: "attack", label: "Atk",
    min: 0.001, max: 5, default: 0.01, scale: "logarithmic", unit: "s",
    hints: { maxLatency: 5, affectsAmplitude: true },
  },
  decay: {
    path: "decay", label: "Dec",
    min: 0.001, max: 5, default: 0.3, scale: "logarithmic", unit: "s",
    hints: { affectsAmplitude: true },
  },
  sustain: {
    path: "sustain", label: "Sus",
    min: 0, max: 1, default: 0.7, scale: "linear",
    hints: { affectsAmplitude: true, canMuteOutput: true }, // sustain=0 → silence after decay
  },
  release: {
    path: "release", label: "Rel",
    min: 0.001, max: 5, default: 0.5, scale: "logarithmic", unit: "s",
    hints: { maxLatency: 5 },
  },

  // ── LFO ──
  lfo_rate: {
    path: "lfo_rate", label: "Rate",
    min: 0.01, max: 20, default: 1, scale: "logarithmic", unit: "Hz",
    hints: { affectsSpectrum: true },
  },
  lfo_depth: {
    path: "lfo_depth", label: "Dpth",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  lfo_to_pitch: {
    path: "lfo_to_pitch", label: "→Pch",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  lfo_to_filter: {
    path: "lfo_to_filter", label: "→Flt",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  lfo_to_pw: {
    path: "lfo_to_pw", label: "→PW",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  lfo_to_amp: {
    path: "lfo_to_amp", label: "→Amp",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsAmplitude: true },
  },
  lfo_shape: {
    path: "lfo_shape", label: "Shpe",
    min: 0, max: 4, default: 0, scale: "linear",
    steps: 5, valueLabels: ["SIN", "TRI", "SAW", "SQR", "S&H"],
    hints: { affectsSpectrum: true },
  },
  lfo_delay: {
    path: "lfo_delay", label: "Dlay",
    min: 0, max: 3, default: 0, scale: "linear", unit: "s",
    hints: { maxLatency: 3 },
  },

  // ── Mod ──
  transpose: {
    path: "transpose", label: "Xpos",
    min: -24, max: 24, default: 0, scale: "linear",
    steps: 49, // every semitone −24…+24
    hints: { affectsSpectrum: true },
  },
  glide: {
    path: "glide", label: "Glid",
    min: 0.001, max: 3, default: 0.001, scale: "logarithmic", unit: "s",
    // Values < 5ms bypass the slew (hard gate), so default feels like "off"
    hints: { maxLatency: 3 },
  },
  poly_fenv_freq: {
    path: "poly_fenv_freq", label: "FE→P",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  poly_fenv_pw: {
    path: "poly_fenv_pw", label: "FE→W",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  poly_oscb_freq: {
    path: "poly_oscb_freq", label: "B→Pt",
    min: -1, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  poly_oscb_pw: {
    path: "poly_oscb_pw", label: "B→PW",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  poly_oscb_filt: {
    path: "poly_oscb_filt", label: "B→Ft",
    min: -1, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },

  // ── FX ──
  drive: {
    path: "drive", label: "Driv",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  chorus_rate: {
    path: "chorus_rate", label: "ChRt",
    min: 0.1, max: 10, default: 1.5, scale: "logarithmic", unit: "Hz",
    hints: { affectsSpectrum: true },
  },
  chorus_depth: {
    path: "chorus_depth", label: "ChDp",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  delay_time: {
    path: "delay_time", label: "DTim",
    min: 0.01, max: 2, default: 0.25, scale: "logarithmic", unit: "s",
    hints: { affectsSpectrum: true },
  },
  delay_feedback: {
    path: "delay_feedback", label: "DFbk",
    min: 0, max: 0.95, default: 0.3, scale: "linear",
    hints: { affectsAmplitude: true },
  },
  reverb_mix: {
    path: "reverb_mix", label: "RvMx",
    min: 0, max: 1, default: 0.3, scale: "linear",
    hints: { affectsAmplitude: true },
  },
  reverb_damp: {
    path: "reverb_damp", label: "RvDk",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  master: {
    path: "master", label: "Vol",
    min: 0, max: 1, default: 0.8, scale: "linear",
    hints: { affectsAmplitude: true, canMuteOutput: true },
  },

  // ── OSC (additional) ──
  osc_sync: {
    path: "osc_sync", label: "Sync",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, valueLabels: ["OFF", "ON"],
    hints: { affectsSpectrum: true },
  },
  timbre: {
    path: "timbre", label: "Timb",
    min: 0, max: 1, default: 0, scale: "linear",
    // Buchla-style sine wavefolder: 0=dry, 1=fully folded
    hints: { affectsSpectrum: true },
  },
  noise_color: {
    path: "noise_color", label: "NCol",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, valueLabels: ["WHT", "PNK"],
    hints: { affectsSpectrum: true },
  },

  // ── Filter (additional) ──
  key_track: {
    path: "key_track", label: "KTrk",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 3, valueLabels: ["OFF", "HALF", "FULL"],
    hints: { affectsSpectrum: true },
  },
  vel_to_cutoff: {
    path: "vel_to_cutoff", label: "V→F",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  hpf_cutoff: {
    path: "hpf_cutoff", label: "HPF",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, valueLabels: ["OFF", "18Hz", "59Hz", "185Hz"],
    hints: { affectsSpectrum: true },
  },

  // ── Filter Envelope (additional) ──
  fenv_mode: {
    path: "fenv_mode", label: "Mode",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, valueLabels: ["ADSR", "ADS"],
    hints: { affectsSpectrum: true },
  },
  fenv_curve: {
    path: "fenv_curve", label: "Curv",
    min: 0, max: 1, default: 0.5, scale: "linear",
    // 0=linear, 0.5=moderate expo, 1=steep expo (Prophet-5 snap)
    hints: { affectsSpectrum: true },
  },

  // ── Amp Envelope (additional) ──
  vel_to_amp: {
    path: "vel_to_amp", label: "V→A",
    min: 0, max: 1, default: 1, scale: "linear",
    hints: { affectsAmplitude: true },
  },
  aenv_mode: {
    path: "aenv_mode", label: "Mode",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, valueLabels: ["ADSR", "ADS"],
    hints: { affectsAmplitude: true },
  },
  aenv_curve: {
    path: "aenv_curve", label: "Curv",
    min: 0, max: 1, default: 0.5, scale: "linear",
    // 0=linear, 0.5=moderate expo, 1=steep expo (Prophet-5 snap)
    hints: { affectsAmplitude: true },
  },

  // ── Mixer ──
  mixer_drive: {
    path: "mixer_drive", label: "MDrv",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true, affectsAmplitude: true },
  },

  // ── Unison ──
  unison: {
    path: "unison", label: "Uni",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 2, valueLabels: ["POLY", "UNI"],
    hints: { engineOnly: true },
  },
  unison_detune: {
    path: "unison_detune", label: "UDtn",
    min: 0, max: 50, default: 0, scale: "linear", unit: "¢",
    // Unison voice spread in cents. All voices stack on one note with symmetric detuning.
    hints: { affectsSpectrum: true },
  },

  // ── FX (additional) ──
  chorus_mode: {
    path: "chorus_mode", label: "ChMd",
    min: 0, max: 3, default: 0, scale: "linear",
    steps: 4, valueLabels: ["CUST", "JNO-I", "JNO-II", "JNO12"],
    hints: { affectsSpectrum: true },
  },
  phaser_rate: {
    path: "phaser_rate", label: "PhRt",
    min: 0.1, max: 5, default: 0.5, scale: "logarithmic", unit: "Hz",
    hints: { affectsSpectrum: true },
  },
  phaser_depth: {
    path: "phaser_depth", label: "PhDp",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  phaser_feedback: {
    path: "phaser_feedback", label: "PhFb",
    min: 0, max: 0.9, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  stereo_width: {
    path: "stereo_width", label: "Wdth",
    min: 0, max: 2, default: 1, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  delay_mod: {
    path: "delay_mod", label: "DMod",
    min: 0, max: 1, default: 0, scale: "linear",
    hints: { affectsSpectrum: true },
  },
  eq_lo: {
    path: "eq_lo", label: "EQLo",
    min: -12, max: 12, default: 0, scale: "linear", unit: "dB",
    hints: { affectsSpectrum: true },
  },
  eq_hi: {
    path: "eq_hi", label: "EQHi",
    min: -12, max: 12, default: 0, scale: "linear", unit: "dB",
    hints: { affectsSpectrum: true },
  },
  reverb_size: {
    path: "reverb_size", label: "RvSz",
    min: 0, max: 1, default: 0.5, scale: "linear",
    hints: { affectsSpectrum: true },
  },

  // ── ENV (additional) ──
  lpg_amount: {
    path: "lpg_amount", label: "LPG",
    min: 0, max: 1, default: 0, scale: "linear",
    // Buchla Vactrol-like coupling: 0=independent amp env, 1=amp follows filter env
    hints: { affectsSpectrum: true, affectsAmplitude: true },
  },

  // ── Global ──
  vintage: {
    path: "vintage", label: "Vntg",
    min: 0, max: 1, default: 0, scale: "linear",
    steps: 5, // 0 = stable … 4 = max drift
    hints: { affectsSpectrum: true },
  },
  voices: {
    path: "voices", label: "Voic",
    min: 1, max: 8, default: 8, scale: "linear",
    steps: 8, // 1 – 8 voices
    hints: { engineOnly: true },
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
      "lpg_amount",                                           // E16: Buchla LPG coupling
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
  // Module 6 — FX: Effects chain. Full 16-slot grid, ordered by signal flow.
  // Q1=overdrive+phaser, Q2=chorus+width, Q3=delay, Q4=reverb+EQ
  {
    id: "fx", label: "FX",
    params: slots(
      "drive", "phaser_rate", "phaser_depth", "phaser_feedback",      // E1–E4: overdrive + phaser
      "chorus_mode", "chorus_rate", "chorus_depth", "stereo_width",   // E5–E8: chorus + stereo width
      "delay_time", "delay_feedback", "delay_mod", "eq_lo",           // E9–E12: delay + low EQ
      "reverb_mix", "reverb_damp", "reverb_size", "eq_hi",            // E13–E16: reverb + high EQ
    ),
  },
  // Module 7 — GLOB: Global voice settings.
  {
    id: "global", label: "GLOB",
    params: slots(
      "voices", "vintage", "unison", "unison_detune",                 // E1–E4: voice engine
    ),
  },
  // Module 8 — SCENE: Scene latch status and controls
  {
    id: "scene", label: "SCNE",
    params: slots(), // future: per-layer volume, transpose, fade controls
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

/**
 * Latch an encoder for soft takeover — used when a parameter changes from
 * outside the encoder (e.g. restoring a preset on a physical knob with end stops).
 * The encoder must physically "meet" the new value before it takes over.
 * NOT appropriate for infinite encoders — use syncEncoder instead.
 */
export function latchEncoder(state: SoftTakeoverState, newSoftValue: number): void {
  state.softValue = newSoftValue;
  state.live = false;
  state.approachFromAbove = state.hardwarePosition > newSoftValue;
}

/**
 * Sync an encoder after a parameter change from outside (patch load, UI control).
 * Sets both softValue and hardwarePosition to the new value and keeps live=true.
 *
 * Use this for infinite encoders (BeatStep, mouse wheel, etc.) — there is no
 * physical "wrong position" to protect against, so hunt mode is never needed.
 * The next encoder turn will always apply a delta from the current parameter value.
 */
export function syncEncoder(state: SoftTakeoverState, newValue: number): void {
  state.softValue = newValue;
  state.hardwarePosition = newValue;
  state.live = true;
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

    // Stepped params: any non-zero delta advances exactly one step.
    // Bypass sensitivity accumulation — one encoder tick = one discrete step.
    if (param.steps && param.steps > 1) {
      if (delta === 0) return false;
      const n = param.steps - 1;
      const currentStep = Math.round((this._values.get(path) ?? state.softValue) * n);
      const nextStep = Math.max(0, Math.min(n, currentStep + (delta > 0 ? 1 : -1)));
      if (nextStep === currentStep) return false;
      const newNorm = nextStep / n;
      state.softValue = newNorm;
      state.hardwarePosition = newNorm;
      this._values.set(path, newNorm);
      this.onParamChange?.(path, normalizedToParam(newNorm, param));
      return true;
    }

    const newNorm = processSoftTakeover(state, delta, sensitivity);
    if (newNorm === null) return false;

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
      // syncEncoder keeps live=true so infinite encoders (BeatStep) start from
      // the loaded value immediately — no hunt-mode sync required.
      if (state) syncEncoder(state, normalized);
      this.onParamChange?.(path, value);
    }
    // Send defaults for any params missing from the patch so the DSP engine
    // is always fully in sync with the store — prevents stale DSP values for
    // params that were added after older patches were saved.
    for (const param of Object.values(SYNTH_PARAMS)) {
      if (!(param.path in values)) {
        const n = this._values.get(param.path) ?? paramToNormalized(param.default, param);
        this.onParamChange?.(param.path, normalizedToParam(n, param));
      }
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
