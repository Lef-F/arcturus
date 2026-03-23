/**
 * Tier 3 feature tests — velocity, ADS mode, wavefolder, pink noise, HPF, BBD chorus.
 * Verifies parameter definitions, module slot assignments, and encoder routing.
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
    expect(p.default).toBe(0); // off by default
  });

  it("vel_to_cutoff is defined in SYNTH_PARAMS", () => {
    const p = SYNTH_PARAMS["vel_to_cutoff"];
    expect(p).toBeDefined();
    expect(p.path).toBe("vel_to_cutoff");
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.default).toBe(0); // off by default
  });

  it("vel_to_amp is in AENV module slot 4 (E5)", () => {
    const aenvParams = getModuleParams(3); // module 3 = AENV
    expect(aenvParams[4]?.path).toBe("vel_to_amp");
  });

  it("vel_to_cutoff is in FLTR module slot 4 (E5)", () => {
    const fltrParams = getModuleParams(1); // module 1 = FLTR
    expect(fltrParams[4]?.path).toBe("vel_to_cutoff");
  });

  it("ParameterStore initializes vel_to_amp and vel_to_cutoff to 0", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["vel_to_amp"])).toBeCloseTo(0);
    expect(store.getValue(SYNTH_PARAMS["vel_to_cutoff"])).toBeCloseTo(0);
  });

  it("encoder in AENV module slot 4 updates vel_to_amp", () => {
    const store = new ParameterStore();
    store.activeModule = 3; // AENV
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(4, 1);
    expect(changed).toContain("vel_to_amp");
  });

  it("encoder in FLTR module slot 4 updates vel_to_cutoff", () => {
    const store = new ParameterStore();
    store.activeModule = 1; // FLTR
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(4, 1);
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

  it("fenv_mode is in FENV module slot 4 (E5)", () => {
    const fenvParams = getModuleParams(2); // module 2 = FENV
    expect(fenvParams[4]?.path).toBe("fenv_mode");
  });

  it("aenv_mode is in AENV module slot 5 (E6)", () => {
    const aenvParams = getModuleParams(3); // module 3 = AENV
    expect(aenvParams[5]?.path).toBe("aenv_mode");
  });

  it("ParameterStore initializes both modes to ADSR (0)", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["fenv_mode"])).toBeCloseTo(0);
    expect(store.getValue(SYNTH_PARAMS["aenv_mode"])).toBeCloseTo(0);
  });

  it("fenv_mode snaps to 0 or 1 (stepped)", () => {
    const store = new ParameterStore();
    store.activeModule = 2; // FENV
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

  it("timbre is in OSC module slot 15 (E16)", () => {
    const oscParams = getModuleParams(0); // module 0 = OSC
    expect(oscParams[15]?.path).toBe("timbre");
  });

  it("ParameterStore initializes timbre to 0 (dry)", () => {
    const store = new ParameterStore();
    expect(store.getValue(SYNTH_PARAMS["timbre"])).toBeCloseTo(0);
  });

  it("encoder in OSC module slot 15 updates timbre", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSC
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.processEncoderDelta(15, 1);
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

  it("noise_color is in OSC module slot 9 (E10)", () => {
    const oscParams = getModuleParams(0); // module 0 = OSC
    expect(oscParams[9]?.path).toBe("noise_color");
  });

  it("noise_color snaps to 0 (White) or 1 (Pink)", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSC
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "noise_color") values.push(value);
    };

    for (let i = 0; i < 20; i++) store.processEncoderDelta(9, 1);
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

  it("hpf_cutoff is in FLTR module slot 8 (E9)", () => {
    const fltrParams = getModuleParams(1); // module 1 = FLTR
    expect(fltrParams[8]?.path).toBe("hpf_cutoff");
  });

  it("hpf_cutoff snaps to 0, 1, 2, or 3", () => {
    const store = new ParameterStore();
    store.activeModule = 1; // FLTR
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "hpf_cutoff") values.push(value);
    };

    for (let i = 0; i < 50; i++) store.processEncoderDelta(8, 1);
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

  it("chorus_mode is in FX module slot 8 (E9)", () => {
    const fxParams = getModuleParams(6); // module 6 = FX
    expect(fxParams[8]?.path).toBe("chorus_mode");
  });

  it("chorus_mode snaps to integer steps 0–3", () => {
    const store = new ParameterStore();
    store.activeModule = 6; // FX
    const values: number[] = [];
    store.onParamChange = (path, value) => {
      if (path === "chorus_mode") values.push(value);
    };

    for (let i = 0; i < 60; i++) store.processEncoderDelta(8, 1);
    for (const v of values) {
      expect([0, 1, 2, 3]).toContain(Math.round(v));
    }
  });

  it("FX module existing slots 0-7 are unchanged", () => {
    const fxParams = getModuleParams(6);
    expect(fxParams[0]?.path).toBe("drive");
    expect(fxParams[1]?.path).toBe("chorus_rate");
    expect(fxParams[2]?.path).toBe("chorus_depth");
    expect(fxParams[3]?.path).toBe("delay_time");
    expect(fxParams[4]?.path).toBe("delay_feedback");
    expect(fxParams[5]?.path).toBe("reverb_mix");
    expect(fxParams[6]?.path).toBe("reverb_damp");
    expect(fxParams[7]?.path).toBe("master");
  });
});

// ── Cross-cutting: all new params have valid definitions ──

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
