// ── Device & Hardware Types ──

export interface DeviceFingerprint {
  manufacturerId: [number, number, number]; // e.g. [0x00, 0x20, 0x6B] for Arturia
  familyCode: [number, number];
  modelCode: [number, number];
  firmwareVersion: [number, number, number, number];
}

/**
 * BeatStep MIDI mapping — produced by calibration, consumed by encoder/pad routing.
 * Only the BeatStep needs a stored mapping; every other MIDI input is treated as a
 * generic note source and needs no calibration.
 */
export interface BeatStepMapping {
  encoders: { index: number; cc: number }[];  // 16 entries, index 0-15
  masterCC: number;
  padRow1Notes: number[];  // 8 module-select pad MIDI notes
  padRow2Notes: number[];  // 8 program-select pad MIDI notes
}

export interface BeatStepProfile {
  profileId?: number;
  fingerprint: DeviceFingerprint;
  portName: string;
  mapping: BeatStepMapping;
  encoderCalibration: EncoderCalibration[];
  createdAt: number;
  updatedAt: number;
}

export interface EncoderCalibration {
  encoderIndex: number;
  cc: number; // MIDI CC number this encoder sends
  deadzone: number; // typical: 2
  accelerationCurve: number[]; // sampled CC deltas during calibration
  sensitivity: number; // multiplier derived from calibration
}

// ── Synth Parameter Types ──

/** Signal behavior hints — used by tests, UI, and preset validation. */
export interface ParamSignalHints {
  /** At max value, this param can reduce output to silence (e.g., noise_level=0 with no osc). */
  canMuteOutput?: boolean;
  /** This param introduces onset delay — tests must compute extra buffers. Max latency in seconds. */
  maxLatency?: number;
  /** This param primarily affects frequency content, not amplitude. */
  affectsSpectrum?: boolean;
  /** This param primarily affects amplitude/loudness. */
  affectsAmplitude?: boolean;
  /** This param is engine-level (not a Faust DSP param) — e.g., voices, unison. */
  engineOnly?: boolean;
}

export interface SynthParam {
  path: string; // Faust parameter path, e.g. "/synth/filter/cutoff"
  label: string;
  min: number;
  max: number;
  default: number;
  scale: "linear" | "logarithmic";
  unit?: string;
  /** If set, encoder renders N discrete dots instead of a smooth arc. */
  steps?: number;
  /** Named labels for stepped params (index = step value). When present, display uses label instead of number. */
  valueLabels?: string[];
  /** Signal behavior hints for tests, UI, and preset validation. */
  hints?: ParamSignalHints;
}

export interface EncoderMapping {
  encoderIndex: number; // 0-15
  param: SynthParam;
}

export interface SynthModule {
  /** Short identifier used as key */
  id: string;
  /** 4-char label shown on the pad */
  label: string;
  /** 16 encoder slots. null = empty/unused slot. */
  params: (string | null)[]; // keys into SYNTH_PARAMS; length must be 16
}

// ── Patch Types ──

export interface Patch {
  patchId?: number;
  name: string;
  slot: number; // 1-8
  parameters: Record<string, number>; // param path → value
  createdAt: number;
  updatedAt: number;
}

// ── Config Types ──

export type VizMode = "scope" | "lissajous" | "time3d" | "spectral";

export interface ArctConfig {
  sampleRate: 44100 | 48000;
  bufferSize: 128 | 256 | 512;
  maxVoices: number; // 1-16
  vizMode: VizMode;
}

export const DEFAULT_CONFIG: ArctConfig = {
  sampleRate: 48000,
  bufferSize: 128,
  maxVoices: 8,
  vizMode: "time3d",
};
