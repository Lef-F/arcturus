/**
 * Effects chain tests — verify encoder 9-15 routing and delay tempo sync.
 */

import { describe, it, expect } from "vitest";
import { SYNTH_PARAMS, ENCODER_PARAM_NAMES, ParameterStore } from "./params";
import { getDelayTimeForBeat, MidiClock } from "@/midi/clock";

// ── Encoder → Effect param routing ──

describe("encoder to effect param routing", () => {
  it("encoder 9 (index 8) maps to delay_time", () => {
    expect(ENCODER_PARAM_NAMES[8]).toBe("delay_time");
    expect(SYNTH_PARAMS.delay_time.path).toBe("delay_time");
  });

  it("encoder 10 (index 9) maps to delay_feedback", () => {
    expect(ENCODER_PARAM_NAMES[9]).toBe("delay_feedback");
  });

  it("encoder 11 (index 10) maps to reverb_damp", () => {
    expect(ENCODER_PARAM_NAMES[10]).toBe("reverb_damp");
  });

  it("encoder 12 (index 11) maps to reverb_mix", () => {
    expect(ENCODER_PARAM_NAMES[11]).toBe("reverb_mix");
  });

  it("encoder 13 (index 12) maps to chorus_rate", () => {
    expect(ENCODER_PARAM_NAMES[12]).toBe("chorus_rate");
  });

  it("encoder 14 (index 13) maps to chorus_depth", () => {
    expect(ENCODER_PARAM_NAMES[13]).toBe("chorus_depth");
  });

  it("encoder 15 (index 14) maps to drive", () => {
    expect(ENCODER_PARAM_NAMES[14]).toBe("drive");
  });
});

// ── ParameterStore: effect encoder deltas ──

describe("ParameterStore — effect parameter updates via encoder", () => {
  function makeStore() {
    const store = new ParameterStore();
    const changes: Array<{ path: string; value: number }> = [];
    store.onParamChange = (path, value) => changes.push({ path, value });
    return { store, changes };
  }

  it("encoder 8 (delay_time) updates delay_time param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(8, 1); // CW turn
    expect(changes.some((c) => c.path === "delay_time")).toBe(true);
  });

  it("encoder 9 (delay_feedback) updates delay_feedback param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(9, 1);
    expect(changes.some((c) => c.path === "delay_feedback")).toBe(true);
  });

  it("encoder 10 (reverb_damp) updates reverb_damp param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(10, 1);
    expect(changes.some((c) => c.path === "reverb_damp")).toBe(true);
  });

  it("encoder 11 (reverb_mix) updates reverb_mix param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(11, 1);
    expect(changes.some((c) => c.path === "reverb_mix")).toBe(true);
  });

  it("encoder 12 (chorus_rate) updates chorus_rate param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(12, 1);
    expect(changes.some((c) => c.path === "chorus_rate")).toBe(true);
  });

  it("encoder 13 (chorus_depth) updates chorus_depth param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(13, 1);
    expect(changes.some((c) => c.path === "chorus_depth")).toBe(true);
  });

  it("encoder 14 (drive) updates drive param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(14, 1);
    expect(changes.some((c) => c.path === "drive")).toBe(true);
  });

  it("drive value is bounded between 0 and 1", () => {
    const { store, changes } = makeStore();
    // Turn encoder 14 (drive) many times CW to hit max
    for (let i = 0; i < 200; i++) {
      store.processEncoderDelta(14, 1);
    }
    const lastDrive = changes.filter((c) => c.path === "drive").pop();
    expect(lastDrive?.value).toBeLessThanOrEqual(1);

    // Now CCW to min
    for (let i = 0; i < 200; i++) {
      store.processEncoderDelta(14, -1);
    }
    const minDrive = changes.filter((c) => c.path === "drive").pop();
    expect(minDrive?.value).toBeGreaterThanOrEqual(0);
  });
});

// ── Delay tempo sync ──

describe("getDelayTimeForBeat", () => {
  it("120 BPM quarter note = 0.5 seconds", () => {
    expect(getDelayTimeForBeat(120, "quarter")).toBeCloseTo(0.5);
  });

  it("120 BPM half note = 1 second", () => {
    expect(getDelayTimeForBeat(120, "half")).toBeCloseTo(1.0);
  });

  it("120 BPM eighth note = 0.25 seconds", () => {
    expect(getDelayTimeForBeat(120, "eighth")).toBeCloseTo(0.25);
  });

  it("120 BPM dotted quarter = 0.75 seconds", () => {
    expect(getDelayTimeForBeat(120, "dotted_quarter")).toBeCloseTo(0.75);
  });

  it("60 BPM quarter note = 1 second", () => {
    expect(getDelayTimeForBeat(60, "quarter")).toBeCloseTo(1.0);
  });

  it("240 BPM quarter note = 0.25 seconds", () => {
    expect(getDelayTimeForBeat(240, "quarter")).toBeCloseTo(0.25);
  });

  it("very slow BPM: delay clamped to 2 seconds max", () => {
    expect(getDelayTimeForBeat(10, "whole")).toBe(2.0);
  });

  it("very fast BPM: delay at minimum reasonable value", () => {
    // 300 BPM sixteenth = 60/300 * 0.25 = 0.05s — within range
    const dt = getDelayTimeForBeat(300, "sixteenth");
    expect(dt).toBeGreaterThanOrEqual(0.01);
    expect(dt).toBeCloseTo(0.05);
  });

  it("default subdivision is quarter", () => {
    expect(getDelayTimeForBeat(120)).toBe(getDelayTimeForBeat(120, "quarter"));
  });
});

describe("MidiClock.getDelayTime", () => {
  it("returns delay time for current BPM", () => {
    const clock = new MidiClock(120);
    expect(clock.getDelayTime("quarter")).toBeCloseTo(0.5);
  });

  it("updates after setBpm", () => {
    const clock = new MidiClock(120);
    clock.setBpm(60);
    expect(clock.getDelayTime("quarter")).toBeCloseTo(1.0);
  });

  it("fires onBpmChange callback when BPM changes", () => {
    const clock = new MidiClock(120);
    const bpmHistory: number[] = [];
    clock.onBpmChange = (bpm) => bpmHistory.push(bpm);
    clock.setBpm(140);
    clock.setBpm(100);
    expect(bpmHistory).toEqual([140, 100]);
  });
});

// ── Effects DSP parameter definitions ──

describe("effects DSP parameter definitions", () => {
  const effectParams = ["drive", "chorus_rate", "chorus_depth", "delay_time", "delay_feedback", "reverb_damp", "reverb_mix"] as const;

  for (const paramName of effectParams) {
    it(`${paramName} has valid min/max/default`, () => {
      const p = SYNTH_PARAMS[paramName];
      expect(p).toBeDefined();
      expect(p.min).toBeLessThan(p.max);
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    });
  }
});
