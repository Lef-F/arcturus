/**
 * Unit tests for encoder relative CC parsing and EncoderManager.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseRelativeCC,
  parseTwosComplementCC,
  parseSignMagnitudeCC,
  parseEncoderDelta,
  DEFAULT_SENSITIVITY,
  EncoderManager,
} from "./encoder";
import { TEST_BEATSTEP_MAPPING } from "@/test/helpers";

/** Build EncoderState[] from test mapping. */
function testEncoderConfig() {
  return TEST_BEATSTEP_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
}

describe("parseRelativeCC", () => {
  it("64 → 0 (no movement)", () => {
    expect(parseRelativeCC(64)).toBe(0);
  });

  it("65 → +1 (slow CW)", () => {
    expect(parseRelativeCC(65)).toBe(1);
  });

  it("70 → +6 (fast CW)", () => {
    expect(parseRelativeCC(70)).toBe(6);
  });

  it("63 → -1 (slow CCW)", () => {
    expect(parseRelativeCC(63)).toBe(-1);
  });

  it("58 → -6 (fast CCW)", () => {
    expect(parseRelativeCC(58)).toBe(-6);
  });
});

describe("parseTwosComplementCC (Relative 2)", () => {
  it("0 and 64 → 0 (no movement)", () => {
    expect(parseTwosComplementCC(0)).toBe(0);
    expect(parseTwosComplementCC(64)).toBe(0);
  });

  it("1 → +1 (slow CW)", () => {
    expect(parseTwosComplementCC(1)).toBe(1);
  });

  it("9 → +9 (fast CW)", () => {
    expect(parseTwosComplementCC(9)).toBe(9);
  });

  it("127 → -1 (slow CCW)", () => {
    expect(parseTwosComplementCC(127)).toBe(-1);
  });

  it("119 → -9 (fast CCW)", () => {
    expect(parseTwosComplementCC(119)).toBe(-9);
  });

  it("63 → +63 (max CW step)", () => {
    expect(parseTwosComplementCC(63)).toBe(63);
  });

  it("65 → -63 (max CCW step)", () => {
    expect(parseTwosComplementCC(65)).toBe(-63);
  });
});

describe("parseSignMagnitudeCC (Relative 3)", () => {
  it("0 → 0 (no movement)", () => {
    expect(parseSignMagnitudeCC(0)).toBe(0);
  });

  it("1 → +1 (slow CW)", () => {
    expect(parseSignMagnitudeCC(1)).toBe(1);
  });

  it("12 → +12 (fast CW, from hardware log)", () => {
    expect(parseSignMagnitudeCC(12)).toBe(12);
  });

  it("0x40 (64) → 0 (CCW zero magnitude = no movement)", () => {
    expect(parseSignMagnitudeCC(0x40)).toBe(0);
  });

  it("0x41 (65) → -1 (slow CCW)", () => {
    expect(parseSignMagnitudeCC(0x41)).toBe(-1);
  });

  it("0x4C (76) → -12 (fast CCW)", () => {
    expect(parseSignMagnitudeCC(0x4c)).toBe(-12);
  });

  it("0x3F (63) → +63 (max CW magnitude)", () => {
    expect(parseSignMagnitudeCC(0x3f)).toBe(63);
  });

  it("0x7F (127) → -63 (max CCW magnitude)", () => {
    expect(parseSignMagnitudeCC(0x7f)).toBe(-63);
  });
});

describe("parseEncoderDelta", () => {
  it("64 → 0 delta", () => {
    expect(parseEncoderDelta(64)).toBe(0);
  });

  it("slow CW (65) → positive delta", () => {
    const d = parseEncoderDelta(65);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(1 * DEFAULT_SENSITIVITY, 6);
  });

  it("slow CCW (63) → negative delta", () => {
    const d = parseEncoderDelta(63);
    expect(d).toBeLessThan(0);
    expect(d).toBeCloseTo(-1 * DEFAULT_SENSITIVITY, 6);
  });

  it("fast CW (70) → larger positive delta than slow CW", () => {
    const slow = parseEncoderDelta(65);
    const fast = parseEncoderDelta(70);
    expect(fast).toBeGreaterThan(slow);
  });

  it("fast CCW (58) → larger negative delta than slow CCW", () => {
    const slow = parseEncoderDelta(63);
    const fast = parseEncoderDelta(58);
    expect(fast).toBeLessThan(slow);
  });

  it("acceleration caps at 6×", () => {
    // CC 70 = raw delta 6 (max acceleration)
    const maxFast = parseEncoderDelta(70);
    // CC 100 = raw delta 36, but should be capped at 6×
    const overMax = parseEncoderDelta(100);
    expect(Math.abs(overMax)).toBeCloseTo(Math.abs(maxFast));
  });

  it("custom sensitivity scales result", () => {
    const d1 = parseEncoderDelta(65, 1 / 64);
    const d2 = parseEncoderDelta(65, 1 / 128);
    expect(d1).toBeCloseTo(d2 * 2, 6);
  });
});

describe("EncoderManager", () => {
  it("handleMessage ignores non-CC messages", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const cb = vi.fn();
    manager.onEncoderDelta = cb;

    // Note On message — should be ignored
    manager.handleMessage(new Uint8Array([0x90, 60, 100]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("handleMessage ignores CC for unknown encoder", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const cb = vi.fn();
    manager.onEncoderDelta = cb;

    // CC 99 — not mapped by default
    manager.handleMessage(new Uint8Array([0xb0, 99, 65]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("handleMessage fires callback for encoder 0 (CC 1)", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const deltas: Array<[number, number]> = [];
    manager.onEncoderDelta = (idx, delta) => deltas.push([idx, delta]);

    manager.handleMessage(new Uint8Array([0xb0, 1, 65])); // CC 1, slow CW

    expect(deltas).toHaveLength(1);
    expect(deltas[0][0]).toBe(0); // encoder index 0
    expect(deltas[0][1]).toBeGreaterThan(0); // positive delta
  });

  it("handleMessage fires for all 16 encoders", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const seen = new Set<number>();
    manager.onEncoderDelta = (idx) => seen.add(idx);

    for (let cc = 1; cc <= 16; cc++) {
      manager.handleMessage(new Uint8Array([0xb0, cc, 65]));
    }

    expect(seen.size).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(seen.has(i)).toBe(true);
    }
  });

  it("handleMessage does not fire for CC value 64 (deadzone)", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const cb = vi.fn();
    manager.onEncoderDelta = cb;

    manager.handleMessage(new Uint8Array([0xb0, 1, 64])); // exactly 64

    expect(cb).not.toHaveBeenCalled();
  });

  it("setEncoderCC remaps encoder to new CC", () => {
    const manager = new EncoderManager(testEncoderConfig());
    const deltas: Array<[number, number]> = [];
    manager.onEncoderDelta = (idx, delta) => deltas.push([idx, delta]);

    // Remap encoder 0 from CC 1 to CC 50
    manager.setEncoderCC(0, 50);

    // Old CC 1 should no longer trigger encoder 0
    manager.handleMessage(new Uint8Array([0xb0, 1, 65]));
    expect(deltas).toHaveLength(0);

    // New CC 50 should trigger encoder 0
    manager.handleMessage(new Uint8Array([0xb0, 50, 65]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0][0]).toBe(0);
  });

});
