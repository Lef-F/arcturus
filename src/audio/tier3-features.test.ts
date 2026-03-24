/**
 * Tier 3 feature tests — velocity, ADS mode, wavefolder, pink noise, HPF, BBD chorus.
 * Verifies parameter definitions, module slot assignments, and encoder routing.
 *
 * Module layout (post-reorganization):
 *   0=OSCA, 1=OSCB, 2=FLTR, 3=ENV, 4=MOD, 5=FX, 6=GLOB, 7=AUX
 */

import { describe, it, expect } from "vitest";
import { SYNTH_PARAMS, getModuleParams, ParameterStore } from "./params";

// ── 1. Velocity sensitivity ──

describe("Velocity sensitivity params", () => {
  it("vel_to_amp is defined in SYNTH_PARAMS", () => {
    const p = SYNTH_PARAMS["vel_to_amp"];
    expect(p).toBeDefined();
    expect(p.path).toBe("vel_to_amp");
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.default).toBe(1); // on by default — velocity always affects amplitude
  });

  it("vel_to_cutoff is defined in SYNTH_PARAMS", () => {
    const p = SYNTH_PARAMS["vel_to_cutoff"];
    expect(p).toBeDefined();
    expect(p.path).toBe("vel_to_cutoff");
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.default).toBe(0); // off by default
  });

  it("vel_to_amp is in ENV module slot 14 (E15)", () => {
    const envParams = getModuleParams(3); // module 3 = ENV
    expect(envParams[14]?.path).toBe("vel_to_amp");
  });

  it("vel_to_cutoff is in FLTR module slot 5 (E6)", () => {
    const fltrParams = getModuleParams(2); // module 2 = FLTR
    expect(fltrParams[5]?.path).toBe("vel_to_cutoff");
  });

  it("ParameterStore initializes vel_to_amp=1 and vel_to_cutoff=0 by default", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["vel_to_amp"])).toBeCloseTo(1);
    expect(store.getValue(SYNTH_PARAMS["vel_to_cutoff"])).toBeCloseTo(0);
  });

  it("encoder in ENV module slot 14 updates vel_to_amp", () => {
    const store = new ParameterStore();
    store.activeModule = 3; // ENV
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(14, 1);
    expect(changed).toContain("vel_to_amp");
  });

  it("encoder in FLTR module slot 5 updates vel_to_cutoff", () => {
    const store = new ParameterStore();
    store.activeModule = 2; // FLTR
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(5, 1);
    expect(changed).toContain("vel_to_cutoff");
  });
});

// ── 2. ADS envelope mode ──

describe("ADS envelope mode (Oberheim SEM)", () => {
  it("fenv_mode is defined with steps=2", () => {
    const p = SYNTH_PARAMS["fenv_mode"];
    expect(p).toBeDefined();
    expect(p.steps).toBe(2);
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.default).toBe(0); // ADSR default
  });

  it("aenv_mode is defined with steps=2", () => {
    const p = SYNTH_PARAMS["aenv_mode"];
    expect(p).toBeDefined();
    expect(p.steps).toBe(2);
    expect(p.default).toBe(0); // ADSR default
  });

  it("fenv_mode is in ENV module slot 4 (E5)", () => {
    const envParams = getModuleParams(3); // module 3 = ENV
    expect(envParams[4]?.path).toBe("fenv_mode");
  });

  it("aenv_mode is in ENV module slot 12 (E13)", () => {
    const envParams = getModuleParams(3); // module 3 = ENV
    expect(envParams[12]?.path).toBe("aenv_mode");
  });

  it("ParameterStore initializes both modes to ADSR (0)", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["fenv_mode"])).toBeCloseTo(0);
    expect(store.getValue(SYNTH_PARAMS["aenv_mode"])).toBeCloseTo(0);
  });

  it("fenv_mode snaps to 0 or 1 (stepped)", () => {
    const store = new ParameterStore();
    store.activeModule = 3; // ENV
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "fenv_mode") values.push(value);
    };

    // Turn encoder many times — should only see values 0 or 1
    for (let i = 0; i < 30; i++) store.processEncoderDelta(4, 1);
    for (const v of values) {
      expect([0, 1]).toContain(Math.round(v));
    }
  });
});

// ── 3. Wavefolder / Timbre ──

describe("Wavefolder / Timbre (Buchla)", () => {
  it("timbre param is defined", () => {
    const p = SYNTH_PARAMS["timbre"];
    expect(p).toBeDefined();
    expect(p.path).toBe("timbre");
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.default).toBe(0); // dry by default
  });

  it("timbre is in OSCA module slot 7 (E8)", () => {
    const oscParams = getModuleParams(0); // module 0 = OSCA
    expect(oscParams[7]?.path).toBe("timbre");
  });

  it("ParameterStore initializes timbre to 0 (dry)", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["timbre"])).toBeCloseTo(0);
  });

  it("encoder in OSCA module slot 7 updates timbre", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSCA
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(7, 1);
    expect(changed).toContain("timbre");
  });
});

// ── 4. Pink noise ──

describe("Pink noise (noise_color)", () => {
  it("noise_color param is defined with steps=2", () => {
    const p = SYNTH_PARAMS["noise_color"];
    expect(p).toBeDefined();
    expect(p.steps).toBe(2);
    expect(p.default).toBe(0); // white by default
  });

  it("noise_color is in OSCB module slot 5 (E6)", () => {
    const oscbParams = getModuleParams(1); // module 1 = OSCB
    expect(oscbParams[5]?.path).toBe("noise_color");
  });

  it("noise_color snaps to 0 (White) or 1 (Pink)", () => {
    const store = new ParameterStore();
    store.activeModule = 1; // OSCB
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "noise_color") values.push(value);
    };

    for (let i = 0; i < 20; i++) store.processEncoderDelta(5, 1);
    for (const v of values) {
      expect([0, 1]).toContain(Math.round(v));
    }
  });
});

// ── 5. Passive HPF ──

describe("Passive HPF (Juno-106)", () => {
  it("hpf_cutoff is defined with steps=4", () => {
    const p = SYNTH_PARAMS["hpf_cutoff"];
    expect(p).toBeDefined();
    expect(p.steps).toBe(4);
    expect(p.min).toBe(0);
    expect(p.max).toBe(3);
    expect(p.default).toBe(0); // off by default
  });

  it("hpf_cutoff is in FLTR module slot 6 (E7)", () => {
    const fltrParams = getModuleParams(2); // module 2 = FLTR
    expect(fltrParams[6]?.path).toBe("hpf_cutoff");
  });

  it("hpf_cutoff snaps to 0, 1, 2, or 3", () => {
    const store = new ParameterStore();
    store.activeModule = 2; // FLTR
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "hpf_cutoff") values.push(value);
    };

    for (let i = 0; i < 50; i++) store.processEncoderDelta(6, 1);
    for (const v of values) {
      expect([0, 1, 2, 3]).toContain(Math.round(v));
    }
  });

  it("hpf_cutoff defaults to 0 (off) in store", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["hpf_cutoff"])).toBeCloseTo(0);
  });
});

// ── 6. BBD Chorus modes ──

describe("BBD Chorus modes (Juno-60)", () => {
  it("chorus_mode is defined with steps=4", () => {
    const p = SYNTH_PARAMS["chorus_mode"];
    expect(p).toBeDefined();
    expect(p.steps).toBe(4);
    expect(p.min).toBe(0);
    expect(p.max).toBe(3);
    expect(p.default).toBe(0); // Custom mode default
  });

  it("chorus_mode is in FX module slot 4 (E5)", () => {
    const fxParams = getModuleParams(5); // module 5 = FX
    expect(fxParams[4]?.path).toBe("chorus_mode");
  });

  it("chorus_mode snaps to integer steps 0–3", () => {
    const store = new ParameterStore();
    store.activeModule = 5; // FX
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "chorus_mode") values.push(value);
    };

    for (let i = 0; i < 60; i++) store.processEncoderDelta(4, 1);
    for (const v of values) {
      expect([0, 1, 2, 3]).toContain(Math.round(v));
    }
  });

  it("FX module slots match signal flow order", () => {
    const fxParams = getModuleParams(5);
    // Q1: overdrive + phaser
    expect(fxParams[0]?.path).toBe("drive");
    expect(fxParams[1]?.path).toBe("phaser_rate");
    expect(fxParams[2]?.path).toBe("phaser_depth");
    expect(fxParams[3]?.path).toBe("phaser_feedback");
    // Q2: chorus + stereo width
    expect(fxParams[4]?.path).toBe("chorus_mode");
    expect(fxParams[5]?.path).toBe("chorus_rate");
    expect(fxParams[6]?.path).toBe("chorus_depth");
    expect(fxParams[7]?.path).toBe("stereo_width");
    // Q3: delay
    expect(fxParams[8]?.path).toBe("delay_time");
    expect(fxParams[9]?.path).toBe("delay_feedback");
    expect(fxParams[10]?.path).toBe("delay_mod");
    expect(fxParams[11]?.path).toBe("eq_lo");
    // Q4: reverb + EQ
    expect(fxParams[12]?.path).toBe("reverb_mix");
    expect(fxParams[13]?.path).toBe("reverb_damp");
    expect(fxParams[14]?.path).toBe("reverb_size");
    expect(fxParams[15]?.path).toBe("eq_hi");
  });
});

// ── 7. New Tier 4 params — envelope curves, mixer drive, unison ──

describe("Tier 4 params — envelope curves, mixer drive, unison", () => {
  it("fenv_curve is defined with default 0.5", () => {
    const p = SYNTH_PARAMS["fenv_curve"];
    expect(p).toBeDefined();
    expect(p.default).toBe(0.5);
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
  });

  it("aenv_curve is defined with default 0.5", () => {
    const p = SYNTH_PARAMS["aenv_curve"];
    expect(p).toBeDefined();
    expect(p.default).toBe(0.5);
  });

  it("mixer_drive is defined with default 0", () => {
    const p = SYNTH_PARAMS["mixer_drive"];
    expect(p).toBeDefined();
    expect(p.default).toBe(0);
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
  });

  it("unison_detune is defined with default 0", () => {
    const p = SYNTH_PARAMS["unison_detune"];
    expect(p).toBeDefined();
    expect(p.default).toBe(0);
    expect(p.min).toBe(0);
    expect(p.max).toBe(50);
  });

  it("fenv_curve is in ENV module slot 5 (E6)", () => {
    const envParams = getModuleParams(3);
    expect(envParams[5]?.path).toBe("fenv_curve");
  });

  it("aenv_curve is in ENV module slot 13 (E14)", () => {
    const envParams = getModuleParams(3);
    expect(envParams[13]?.path).toBe("aenv_curve");
  });

  it("mixer_drive is in OSCB module slot 6 (E7)", () => {
    const oscbParams = getModuleParams(1);
    expect(oscbParams[6]?.path).toBe("mixer_drive");
  });

  it("unison is in GLOB module slot 2 (E3)", () => {
    const globParams = getModuleParams(6);
    expect(globParams[2]?.path).toBe("unison");
  });

  it("unison_detune is in GLOB module slot 3 (E4)", () => {
    const globParams = getModuleParams(6);
    expect(globParams[3]?.path).toBe("unison_detune");
  });

  it("snapshot includes all new params", () => {
    const store = new ParameterStore();
    const snap = store.snapshot();
    expect(snap["fenv_curve"]).toBeDefined();
    expect(snap["aenv_curve"]).toBeDefined();
    expect(snap["mixer_drive"]).toBeDefined();
    expect(snap["unison"]).toBeDefined();
    expect(snap["unison_detune"]).toBeDefined();
  });
});

// ── Cross-cutting: all Tier 3 params have valid definitions ──

describe("All Tier 3 params — structural validity", () => {
  const tier3Params = [
    "vel_to_amp", "vel_to_cutoff",
    "fenv_mode", "aenv_mode",
    "timbre", "noise_color",
    "hpf_cutoff", "chorus_mode",
  ];

  for (const key of tier3Params) {
    it(`${key}: min < max, default in range, path matches key`, () => {
      const p = SYNTH_PARAMS[key];
      expect(p, `missing param: ${key}`).toBeDefined();
      expect(p.min).toBeLessThan(p.max);
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
      expect(p.path).toBe(key);
    });
  }

  it("snapshot includes all Tier 3 params", () => {
    const store = new ParameterStore();
    const snap = store.snapshot();
    for (const key of tier3Params) {
      expect(snap[key], `snapshot missing: ${key}`).toBeDefined();
    }
  });
});
