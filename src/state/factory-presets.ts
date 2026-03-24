/**
 * Factory presets — 8 programs seeded on first boot.
 *
 * Each preset is a Record<string, number> mapping Faust param paths to real values.
 * Only non-default values need to be specified; missing params keep their defaults
 * from SYNTH_PARAMS when loaded via ParameterStore.loadValues().
 *
 * Designed to showcase Arcturus's capabilities and encourage exploration:
 *   P1: Init — clean starting point (Prophet-5 "basic" patch)
 *   P2: Warm Pad — lush slow chords
 *   P3: Fat Bass — mono, aggressive
 *   P4: Sync Lead — hard sync screaming lead
 *   P5: FM Bell — poly mod metallic
 *   P6: Supersaw — JP-8000 trance
 *   P7: Ambient — delay + reverb wash
 *   P8: Discovery — poly mod exploration patch
 */

import type { Patch } from "@/types";
import { SYNTH_PARAMS } from "@/audio/params";

// Helper: start with all defaults, then override
function preset(overrides: Record<string, number>): Record<string, number> {
  const params: Record<string, number> = {};
  for (const p of Object.values(SYNTH_PARAMS)) {
    params[p.path] = p.default;
  }
  return { ...params, ...overrides };
}

export const FACTORY_PRESETS: Array<{ name: string; parameters: Record<string, number> }> = [
  // ── P1: Init ──
  // Clean sawtooth, open filter, no effects. The blank canvas.
  // Slight envelope curve for that "expensive synth" feel.
  {
    name: "Init",
    parameters: preset({
      waveform: 0,          // SAW
      octave: 0,
      cutoff: 8000,
      resonance: 0.3,
      fenv_amount: 0.3,
      f_attack: 0.005,
      f_decay: 0.4,
      f_sustain: 0.4,
      f_release: 0.3,
      fenv_curve: 0.5,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.8,
      release: 0.3,
      aenv_curve: 0.5,
      vel_to_amp: 1,
      master: 0.8,
    }),
  },

  // ── P2: Warm Pad ──
  // Lush, slow-attack pad with chorus. Vintage drift for width.
  // Juno-106 inspired: single oscillator, chorus does the heavy lifting.
  {
    name: "Warm Pad",
    parameters: preset({
      waveform: 1,          // SQR
      pulse_width: 0.45,
      cutoff: 3000,
      resonance: 0.2,
      fenv_amount: 0.15,
      filter_mode: 0,       // LP
      f_attack: 0.8,
      f_decay: 1.5,
      f_sustain: 0.6,
      f_release: 1.2,
      fenv_curve: 0.3,      // gentle curve
      attack: 0.6,
      decay: 1.0,
      sustain: 0.85,
      release: 1.5,
      aenv_curve: 0.3,
      lfo_rate: 0.3,
      lfo_depth: 0.4,
      lfo_to_pw: 0.6,       // PWM for movement
      lfo_delay: 1.0,
      chorus_mode: 3,        // Juno I+II
      reverb_mix: 0.35,
      reverb_damp: 0.4,
      vintage: 0.4,
      vel_to_amp: 0.3,      // pads respond to velocity but stay lush even soft
      master: 0.75,
    }),
  },

  // ── P3: Fat Bass ──
  // Mono, two oscillators, pre-filter saturation, low cutoff.
  // Prophet-5 gain staging: mixer drive pushes the filter input.
  {
    name: "Fat Bass",
    parameters: preset({
      waveform: 0,          // SAW
      octave: -1,
      oscb_level: 0.8,
      oscb_wave: 0,         // SAW
      oscb_pitch: -12,      // sub octave
      mixer_drive: 0.6,     // push the filter
      cutoff: 1200,
      resonance: 0.35,
      fenv_amount: 0.7,
      f_attack: 0.001,
      f_decay: 0.25,
      f_sustain: 0.2,
      f_release: 0.15,
      fenv_curve: 0.8,      // snappy
      attack: 0.001,
      decay: 0.2,
      sustain: 0.6,
      release: 0.15,
      aenv_curve: 0.7,
      vel_to_amp: 0.5,
      vel_to_cutoff: 0.4,
      hpf_cutoff: 1,        // 18Hz — tighten the low end
      glide: 0.08,
      voices: 1,
      drive: 0.2,
      master: 0.85,
    }),
  },

  // ── P4: Sync Lead ──
  // Hard sync with OscB detuned up. Filter envelope sweeps the sync harmonics.
  // Classic Prophet-5 screaming lead.
  {
    name: "Sync Lead",
    parameters: preset({
      waveform: 0,          // SAW
      osc_sync: 1,          // hard sync ON
      oscb_level: 0.3,
      oscb_wave: 0,         // SAW
      oscb_pitch: 7,        // perfect fifth up
      cutoff: 4000,
      resonance: 0.4,
      fenv_amount: 0.6,
      f_attack: 0.001,
      f_decay: 0.35,
      f_sustain: 0.3,
      f_release: 0.25,
      fenv_curve: 0.7,      // snappy
      attack: 0.005,
      decay: 0.3,
      sustain: 0.7,
      release: 0.35,
      aenv_curve: 0.6,
      vel_to_amp: 0.4,
      lfo_rate: 5.5,
      lfo_depth: 0.3,
      lfo_to_pitch: 0.15,   // subtle vibrato
      lfo_delay: 0.5,       // delayed vibrato
      glide: 0.06,
      voices: 4,
      chorus_mode: 1,        // Juno I
      master: 0.8,
    }),
  },

  // ── P5: FM Bell ──
  // Poly mod: filter envelope → pitch creates metallic FM bell tones.
  // OscB at audio rate creates complex sidebands.
  {
    name: "FM Bell",
    parameters: preset({
      waveform: 3,          // SIN
      oscb_level: 0.15,
      oscb_wave: 3,         // SIN
      oscb_pitch: 19,       // ~2.5x ratio for metallic character
      oscb_fine: 7,
      cutoff: 6000,
      resonance: 0.15,
      fenv_amount: 0.4,
      f_attack: 0.001,
      f_decay: 1.5,
      f_sustain: 0.1,
      f_release: 2.0,
      fenv_curve: 0.6,
      attack: 0.001,
      decay: 2.0,
      sustain: 0.05,
      release: 2.5,
      aenv_curve: 0.4,
      poly_fenv_freq: 0.35, // FEnv → pitch FM (bell attack)
      poly_oscb_freq: 0.2,  // OscB audio-rate FM
      vel_to_amp: 0.6,
      vel_to_cutoff: 0.3,
      reverb_mix: 0.45,
      reverb_damp: 0.3,
      vintage: 0.3,
      master: 0.75,
    }),
  },

  // ── P6: Supersaw ──
  // JP-8000 trance supersaw. Big, wide, moving.
  {
    name: "Supersaw",
    parameters: preset({
      waveform: 4,           // SUPER
      supersaw_detune: 0.6,
      supersaw_mix: 0.7,
      cutoff: 5000,
      resonance: 0.25,
      fenv_amount: 0.35,
      f_attack: 0.01,
      f_decay: 0.5,
      f_sustain: 0.5,
      f_release: 0.4,
      fenv_curve: 0.5,
      attack: 0.02,
      decay: 0.4,
      sustain: 0.75,
      release: 0.5,
      aenv_curve: 0.5,
      vel_to_amp: 0.3,
      hpf_cutoff: 1,         // 18Hz
      chorus_mode: 2,         // Juno II
      reverb_mix: 0.2,
      reverb_damp: 0.5,
      master: 0.75,
    }),
  },

  // ── P7: Ambient ──
  // Gentle triangle wave through reverb and delay. Ethereal, spacious.
  {
    name: "Ambient",
    parameters: preset({
      waveform: 2,          // TRI
      timbre: 0.15,         // slight wavefold for shimmer
      cutoff: 2500,
      resonance: 0.3,
      fenv_amount: 0.2,
      filter_mode: 0.3,     // slightly toward notch
      f_attack: 1.0,
      f_decay: 2.0,
      f_sustain: 0.5,
      f_release: 2.5,
      fenv_curve: 0.2,      // nearly linear, slow bloom
      attack: 1.2,
      decay: 2.0,
      sustain: 0.6,
      release: 3.0,
      aenv_curve: 0.2,
      lfo_rate: 0.15,
      lfo_depth: 0.3,
      lfo_shape: 0,         // SIN
      lfo_to_filter: 0.3,   // gentle filter wah
      lfo_to_pitch: 0.05,   // barely perceptible pitch drift
      delay_time: 0.375,
      delay_feedback: 0.55,
      reverb_mix: 0.6,
      reverb_damp: 0.25,
      vintage: 0.5,
      vel_to_amp: 0,        // ambient: even dynamics, velocity doesn't affect volume
      master: 0.7,
    }),
  },

  // ── P8: Discovery ──
  // Poly mod pre-dialed for "happy accidents". Twist any knob and find gold.
  // The patch that makes you not want to stop playing.
  {
    name: "Discovery",
    parameters: preset({
      waveform: 0,          // SAW
      pulse_width: 0.4,
      oscb_level: 0.5,
      oscb_wave: 1,         // SQR
      oscb_pitch: 0,
      oscb_fine: -8,        // slight detune for thickness
      mixer_drive: 0.3,     // warm the filter input
      cutoff: 3500,
      resonance: 0.45,
      fenv_amount: 0.5,
      f_attack: 0.005,
      f_decay: 0.6,
      f_sustain: 0.35,
      f_release: 0.5,
      fenv_curve: 0.6,
      attack: 0.01,
      decay: 0.4,
      sustain: 0.65,
      release: 0.4,
      aenv_curve: 0.55,
      // The poly mod "short-circuit" routes — preset for exploration
      poly_fenv_freq: 0.15,  // subtle pitch blip on attack
      poly_fenv_pw: 0.2,     // envelope-driven PW variation
      poly_oscb_filt: 0.1,   // OscB gently wobbles the filter
      lfo_rate: 1.2,
      lfo_depth: 0.25,
      lfo_to_pw: 0.4,        // PWM movement
      lfo_delay: 0.3,
      vel_to_amp: 0.4,
      vel_to_cutoff: 0.25,
      chorus_mode: 1,         // Juno I
      reverb_mix: 0.25,
      vintage: 0.35,
      master: 0.8,
    }),
  },
];

/** Convert factory presets to Patch objects for IndexedDB storage. */
export function createFactoryPatches(): Omit<Patch, "patchId">[] {
  const now = Date.now();
  return FACTORY_PRESETS.map((fp, i) => ({
    name: fp.name,
    slot: i + 1,
    parameters: fp.parameters,
    createdAt: now,
    updatedAt: now,
  }));
}
