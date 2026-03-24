/**
 * Effects chain tests — verify FX module encoder routing and delay tempo sync.
 */

import { describe, it, expect } from "vitest";
import { SYNTH_PARAMS, getModuleParams, ParameterStore } from "./params";
import { getDelayTimeForBeat, MidiClock } from "@/midi/clock";

// ── FX module (module 5) encoder routing ──

describe("FX module encoder routing (module 5)", () => {
  const fxParams = getModuleParams(5);

  it("FX module slot 0 = drive", () => {
    expect(fxParams[0]?.path).toBe("drive");
  });

  it("FX module slot 4 = delay_time", () => {
    expect(fxParams[4]?.path).toBe("delay_time");
  });

  it("FX module slot 5 = delay_feedback", () => {
    expect(fxParams[5]?.path).toBe("delay_feedback");
  });

  it("FX module slot 8 = null (master controlled by dedicated encoder)", () => {
    expect(fxParams[8]).toBeNull();
  });
});

// ── ParameterStore: FX param updates via activeModule=5 encoder ──

describe("ParameterStore — FX parameter updates via encoder (module 5)", () => {
  function makeStore() {
    const store = new ParameterStore();
    store.activeModule = 5; // switch to FX module
    const changes: Array<{ path: string; value: number }> = [];
    store.onParamChange = (path, value) => changes.push({ path, value });
    return { store, changes };
  }

  it("encoder slot 0 (drive) updates drive param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(0, 1);
    expect(changes.some((c) => c.path === "drive")).toBe(true);
  });

  it("encoder slot 4 (delay_time) updates delay_time param", () => {
    const { store, changes } = makeStore();
    store.processEncoderDelta(4, 1);
    expect(changes.some((c) => c.path === "delay_time")).toBe(true);
  });

  it("drive value is bounded between 0 and 1", () => {
    const { store, changes } = makeStore();
    for (let i = 0; i < 200; i++) store.processEncoderDelta(0, 1);
    const lastDrive = changes.filter((c) => c.path === "drive").pop();
    expect(lastDrive?.value).toBeLessThanOrEqual(1);

    for (let i = 0; i < 200; i++) store.processEncoderDelta(0, -1);
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
