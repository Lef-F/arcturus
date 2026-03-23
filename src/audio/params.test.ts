/**
 * Unit tests for the parameter registry, value scaling, and soft takeover.
 */

import { describe, it, expect, vi } from "vitest";
import {
  SYNTH_PARAMS,
  ENCODER_PARAM_NAMES,
  buildEncoderMappings,
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

describe("buildEncoderMappings", () => {
  it("returns 16 mappings", () => {
    expect(buildEncoderMappings()).toHaveLength(16);
  });

  it("encoder 0 maps to waveform", () => {
    const mappings = buildEncoderMappings();
    expect(mappings[0].param.path).toBe("waveform");
    expect(mappings[0].encoderIndex).toBe(0);
  });

  it("encoder 2 maps to cutoff (logarithmic)", () => {
    const mappings = buildEncoderMappings();
    expect(mappings[2].param.path).toBe("cutoff");
    expect(mappings[2].param.scale).toBe("logarithmic");
  });

  it("all 16 ENCODER_PARAM_NAMES are in SYNTH_PARAMS", () => {
    for (const name of ENCODER_PARAM_NAMES) {
      expect(SYNTH_PARAMS[name], `Missing param: ${name}`).toBeDefined();
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

    const updated = store.processEncoderDelta(2, 1); // encoder 2 = cutoff
    expect(updated).toBe(true);
    expect(changed).toHaveLength(1);
    expect(changed[0][0]).toBe("cutoff");
    expect(changed[0][1]).toBeGreaterThan(SYNTH_PARAMS["cutoff"].default);
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

  it("snapshot captures all non-internal param values", () => {
    const store = new ParameterStore();
    const snap = store.snapshot();

    expect(snap["cutoff"]).toBeDefined();
    expect(snap["resonance"]).toBeDefined();
    expect(snap["__voices"]).toBeUndefined(); // internal param excluded
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

  it("loadValues triggers soft takeover latching", () => {
    const store = new ParameterStore();

    // Load a value that differs from the current encoder position
    store.loadValues({ resonance: 0.1 }); // low value

    // Encoder 3 is resonance; it should now be latched
    // A CW turn should NOT update until it crosses the latched value
    // (This tests the integration path: processEncoderDelta with latched state)
    const spy = vi.fn();
    store.onParamChange = spy;

    // With hardware starting around the default (0.5), going CW won't cross 0.1
    // So processEncoderDelta should return false (latched)
    store.processEncoderDelta(3, 1); // encoder 3 = resonance, CW
    // Hardware was at ~default normalized for 0.5, soft value is now low (0.1)
    // CW movement goes further away from soft value → still latched
    expect(spy).not.toHaveBeenCalled();
  });
});
