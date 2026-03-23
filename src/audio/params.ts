/**
 * Parameter registry — Faust parameter paths, value scaling, soft takeover.
 */

import type { EncoderMapping, SynthParam } from "@/types";

const filterCutoff: SynthParam = {
  path: "/synth/filter/cutoff",
  label: "Cutoff",
  min: 20,
  max: 20000,
  default: 8000,
  scale: "logarithmic",
  unit: "Hz",
};

const filterResonance: SynthParam = {
  path: "/synth/filter/resonance",
  label: "Res",
  min: 0,
  max: 1,
  default: 0.3,
  scale: "linear",
};

const oscDetune: SynthParam = {
  path: "/synth/osc/detune",
  label: "Tune",
  min: -1,
  max: 1,
  default: 0,
  scale: "linear",
  unit: "st",
};

const ampAttack: SynthParam = {
  path: "/synth/env/attack",
  label: "Atk",
  min: 0.001,
  max: 5,
  default: 0.01,
  scale: "logarithmic",
  unit: "s",
};

const ampDecay: SynthParam = {
  path: "/synth/env/decay",
  label: "D/S",
  min: 0.001,
  max: 5,
  default: 0.1,
  scale: "logarithmic",
  unit: "s",
};

const ampRelease: SynthParam = {
  path: "/synth/env/release",
  label: "Rel",
  min: 0.001,
  max: 5,
  default: 0.3,
  scale: "logarithmic",
  unit: "s",
};

const delayFeedback: SynthParam = {
  path: "/synth/fx/delay/feedback",
  label: "DFbk",
  min: 0,
  max: 0.95,
  default: 0.3,
  scale: "linear",
};

const reverbDecay: SynthParam = {
  path: "/synth/fx/reverb/decay",
  label: "RvDk",
  min: 0.5,
  max: 8,
  default: 2,
  scale: "linear",
  unit: "s",
};

const reverbMix: SynthParam = {
  path: "/synth/fx/reverb/mix",
  label: "RvMx",
  min: 0,
  max: 1,
  default: 0.2,
  scale: "linear",
};

const chorusRate: SynthParam = {
  path: "/synth/fx/chorus/rate",
  label: "ChRt",
  min: 0.1,
  max: 10,
  default: 1,
  scale: "logarithmic",
  unit: "Hz",
};

const chorusDepth: SynthParam = {
  path: "/synth/fx/chorus/depth",
  label: "ChDp",
  min: 0,
  max: 1,
  default: 0.3,
  scale: "linear",
};

const overdrive: SynthParam = {
  path: "/synth/fx/drive",
  label: "Drive",
  min: 0,
  max: 1,
  default: 0,
  scale: "linear",
};

/** Default BeatStep encoder → parameter mapping (single page) */
export const DEFAULT_ENCODER_MAP: EncoderMapping[] = [
  // Encoder indices 0-15 match BeatStep encoders 1-16
  { encoderIndex: 0, param: { path: "/synth/osc/waveform", label: "Wave", min: 0, max: 3, default: 0, scale: "linear" } },
  { encoderIndex: 1, param: oscDetune },
  { encoderIndex: 2, param: filterCutoff },
  { encoderIndex: 3, param: filterResonance },
  { encoderIndex: 4, param: { path: "/synth/filter/env_amount", label: "FEnv", min: -1, max: 1, default: 0, scale: "linear" } },
  { encoderIndex: 5, param: ampAttack },
  { encoderIndex: 6, param: ampDecay },
  { encoderIndex: 7, param: ampRelease },
  { encoderIndex: 8, param: { path: "/synth/fx/delay/time", label: "DTim", min: 0, max: 7, default: 3, scale: "linear" } },
  { encoderIndex: 9, param: delayFeedback },
  { encoderIndex: 10, param: reverbDecay },
  { encoderIndex: 11, param: reverbMix },
  { encoderIndex: 12, param: chorusRate },
  { encoderIndex: 13, param: chorusDepth },
  { encoderIndex: 14, param: overdrive },
  { encoderIndex: 15, param: { path: "/system/active_voices", label: "Voic", min: 1, max: 8, default: 8, scale: "linear" } },
];
