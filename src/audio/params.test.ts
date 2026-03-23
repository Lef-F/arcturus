/**
 * Unit tests for the parameter registry, value scaling, and soft takeover.
 */

import { describe, it, expect, vi } from "vitest";
import {
  SYNTH_PARAMS,
  getModuleParams,
  normalizedToParam,
  paramToNormalized,
  processSoftTakeover,
  latchEncoder,
  createSoftTakeoverState,
  ParameterStore,
} from "./params";

describe("normalizedToParam / paramToNormalized", () => {
  it("linear scaling: 0 → min, 1 → max, 0.5 → midpoint", () => {
    const p = SYNTH_PARAMS["resonance"];
    expect(normalizedToParam(0, p)).toBeCloseTo(p.min);
    expect(normalizedToParam(1, p)).toBeCloseTo(p.max);
    expect(normalizedToParam(0.5, p)).toBeCloseTo((p.min + p.max) / 2);
  });

  it("logarithmic scaling: 0 → min, 1 → max", () => {
    const p = SYNTH_PARAMS["cutoff"];
    expect(normalizedToParam(0, p)).toBeCloseTo(p.min, 5);
    expect(normalizedToParam(1, p)).toBeCloseTo(p.max, 1);
  });

  it("log scaling: 0.5 is the geometric mean of min and max", () => {
    const p = SYNTH_PARAMS["cutoff"];
    const geoMean = Math.sqrt(p.min * p.max);
    expect(normalizedToParam(0.5, p)).toBeCloseTo(geoMean, 1);
  });

  it("round-trips: normalizedToParam → paramToNormalized", () => {
    const params = ["cutoff", "attack", "resonance", "detune"];
    for (const name of params) {
      const p = SYNTH_PARAMS[name];
      const testValues = [p.min, p.max, p.default];
      for (const v of testValues) {
        const n = paramToNormalized(v, p);
        expect(normalizedToParam(n, p)).toBeCloseTo(v, 4);
      }
    }
  });

  it("clamps inputs outside [0,1] for normalizedToParam", () => {
    const p = SYNTH_PARAMS["resonance"];
    expect(normalizedToParam(-0.5, p)).toBeCloseTo(p.min);
    expect(normalizedToParam(2, p)).toBeCloseTo(p.max);
  });
});

describe("getModuleParams", () => {
  it("module 0 slot 0 maps to waveform", () => {
    expect(getModuleParams(0)[0]?.path).toBe("waveform");
  });

  it("module 0 slot 2 maps to detune", () => {
    expect(getModuleParams(0)[2]?.path).toBe("detune");
  });

  it("module 1 slot 0 is cutoff (logarithmic)", () => {
    const fltrParams = getModuleParams(1);
    expect(fltrParams[0]?.path).toBe("cutoff");
    expect(fltrParams[0]?.scale).toBe("logarithmic");
  });

  it("all non-null params in module 0 exist in SYNTH_PARAMS", () => {
    for (const param of getModuleParams(0)) {
      if (param) expect(SYNTH_PARAMS[param.path], `Missing param: ${param.path}`).toBeDefined();
    }
  });
});

describe("processSoftTakeover", () => {
  it("live encoder immediately updates value", () => {
    const state = createSoftTakeoverState(0.5, SYNTH_PARAMS["resonance"]);
    expect(state.live).toBe(true);

    const result = processSoftTakeover(state, 1, 1 / 128);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0.5);
  });

  it("latched encoder returns null until value is crossed (CW direction from below)", () => {
    const state = createSoftTakeoverState(0.5, SYNTH_PARAMS["resonance"]);
    // Latch with hardware below the software value
    state.live = false;
    state.hardwarePosition = 0.2;
    state.softValue = 0.5;
    state.approachFromAbove = false; // hardware started below soft

    // CW turns below the target: still latched
    expect(processSoftTakeover(state, 1, 1 / 128)).toBeNull();

    // Move hardware position up to cross through softValue
    state.hardwarePosition = 0.499;
    const result = processSoftTakeover(state, 1, 1 / 128);
    // Should now be live (crossed through from below, going CW)
    expect(result).not.toBeNull();
    expect(state.live).toBe(true);
  });

  it("latched encoder releases when hardware crosses from above (CCW direction)", () => {
    const state = createSoftTakeoverState(0.3, SYNTH_PARAMS["resonance"]);
    state.live = false;
    state.hardwarePosition = 0.7;
    state.softValue = 0.3;
    state.approachFromAbove = true; // hardware started above soft

    // CCW turns above target: still latched
    expect(processSoftTakeover(state, -1, 1 / 128)).toBeNull();

    // Move close enough to cross
    state.hardwarePosition = 0.301;
    const result = processSoftTakeover(state, -1, 1 / 128);
    expect(result).not.toBeNull();
    expect(state.live).toBe(true);
  });

  it("clamps hardware position to [0, 1]", () => {
    const state = createSoftTakeoverState(0.9, SYNTH_PARAMS["resonance"]);
    processSoftTakeover(state, 100, 1 / 128);
    expect(state.hardwarePosition).toBe(1);
    expect(state.softValue).toBeLessThanOrEqual(1);
  });
});

describe("latchEncoder", () => {
  it("sets new soft value and marks encoder as not live", () => {
    const state = createSoftTakeoverState(0.5, SYNTH_PARAMS["resonance"]);
    latchEncoder(state, 0.8);
    expect(state.softValue).toBe(0.8);
    expect(state.live).toBe(false);
    expect(state.hardwarePosition).toBe(paramToNormalized(0.5, SYNTH_PARAMS["resonance"]));
  });
});

describe("ParameterStore", () => {
  it("initializes with default values", () => {
    const store = new ParameterStore();
    const cutoffDefault = SYNTH_PARAMS["cutoff"].default;
    expect(store.getValue(SYNTH_PARAMS["cutoff"])).toBeCloseTo(cutoffDefault, 3);
  });

  it("processEncoderDelta updates the parameter and fires callback", () => {
    const store = new ParameterStore();
    const changed: Array<[string, number]> = [];
    store.onParamChange = (path, value) => changed.push([path, value]);

    // activeModule=0 (OSC), slot 2 = detune
    const updated = store.processEncoderDelta(2, 1);
    expect(updated).toBe(true);
    expect(changed).toHaveLength(1);
    expect(changed[0][0]).toBe("detune");
  });

  it("processEncoderDelta returns false for out-of-range encoder index", () => {
    const store = new ParameterStore();
    expect(store.processEncoderDelta(99, 1)).toBe(false);
  });

  it("loadValues latches all encoders and fires callbacks", () => {
    const store = new ParameterStore();
    const changed: string[] = [];
    store.onParamChange = (path) => changed.push(path);

    store.loadValues({ cutoff: 1000, resonance: 0.8 });

    expect(changed).toContain("cutoff");
    expect(changed).toContain("resonance");
    expect(store.getValue(SYNTH_PARAMS["cutoff"])).toBeCloseTo(1000, 1);
  });

  it("snapshot captures all param values including voices", () => {
    const store = new ParameterStore();
    const snap = store.snapshot();

    expect(snap["cutoff"]).toBeDefined();
    expect(snap["resonance"]).toBeDefined();
    expect(snap["voices"]).toBeDefined(); // voices is now saved with patches
  });

  it("setNormalized directly updates value and fires callback", () => {
    const store = new ParameterStore();
    const changed: Array<[string, number]> = [];
    store.onParamChange = (path, value) => changed.push([path, value]);

    store.setNormalized("resonance", 0.9);
    expect(store.getNormalized("resonance")).toBeCloseTo(0.9);
    expect(changed).toHaveLength(1);
    expect(changed[0][0]).toBe("resonance");
  });

  it("new params (lfo_to_pw, lfo_to_amp, key_track, glide, poly mod, osc_sync, vintage) are defined", () => {
    const newParams = [
      "lfo_to_pw", "lfo_to_amp", "key_track", "glide",
      "poly_fenv_freq", "poly_fenv_pw", "poly_oscb_freq", "poly_oscb_pw", "poly_oscb_filt",
      "osc_sync", "vintage",
    ];
    for (const key of newParams) {
      expect(SYNTH_PARAMS[key], `missing param: ${key}`).toBeDefined();
      const p = SYNTH_PARAMS[key];
      expect(typeof p.min).toBe("number");
      expect(typeof p.max).toBe("number");
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it("new params have sensible defaults (all off by default)", () => {
    const offByDefault = ["lfo_to_pw", "lfo_to_amp", "key_track", "lfo_to_pitch", "lfo_to_filter"];
    const store = new ParameterStore();
    for (const key of offByDefault) {
      expect(store.getValue(SYNTH_PARAMS[key]), `${key} default should be 0`).toBeCloseTo(0, 5);
    }
  });

  it("loadValues triggers soft takeover latching", () => {
    const store = new ParameterStore();

    // Switch to FLTR module (1) so encoder 1 = resonance
    store.activeModule = 1;
    store.loadValues({ resonance: 0.1 }); // load a low value (latch)

    const spy = vi.fn();
    store.onParamChange = spy;

    // Encoder slot 1 in FLTR module = resonance. Hardware default ~0.5, soft=0.1.
    // CW from 0.5 moves further away → still latched
    store.processEncoderDelta(1, 1);
    expect(spy).not.toHaveBeenCalled();
  });
});
