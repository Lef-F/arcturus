/**
 * Unit tests for the KeyStep handler.
 */

import { describe, it, expect, vi } from "vitest";
import { KeyStepHandler, decodePitchBend, pitchBendToSemitones } from "./keystep";

// ── Minimal SynthEngine mock ──
function makeMockEngine() {
  return {
    keyOn: vi.fn(),
    keyOff: vi.fn(),
    setParamValue: vi.fn(),
    getParamValue: vi.fn(() => 8000), // default cutoff
  };
}

describe("decodePitchBend", () => {
  it("center (8192): lsb=0, msb=64", () => {
    expect(decodePitchBend(0x00, 0x40)).toBe(8192);
  });

  it("max up (16383): lsb=0x7f, msb=0x7f", () => {
    expect(decodePitchBend(0x7f, 0x7f)).toBe(16383);
  });

  it("max down (0): lsb=0, msb=0", () => {
    expect(decodePitchBend(0x00, 0x00)).toBe(0);
  });
});

describe("pitchBendToSemitones", () => {
  it("center (8192) → 0 semitones", () => {
    expect(pitchBendToSemitones(8192)).toBe(0);
  });

  it("max up → +2 semitones (default ±2 range)", () => {
    expect(pitchBendToSemitones(16383)).toBeCloseTo(2, 1);
  });

  it("max down → -2 semitones", () => {
    expect(pitchBendToSemitones(0)).toBeCloseTo(-2, 1);
  });
});

describe("KeyStepHandler", () => {
  it("Note On triggers engine.keyOn", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0x90, 60, 100]));

    expect(engine.keyOn).toHaveBeenCalledWith(1, 60, 100);
  });

  it("Note Off triggers engine.keyOff", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0x80, 60, 0]));

    expect(engine.keyOff).toHaveBeenCalledWith(1, 60, 0);
  });

  it("Note On with velocity 0 triggers keyOff (running status convention)", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0x90, 60, 0]));

    expect(engine.keyOff).toHaveBeenCalled();
    expect(engine.keyOn).not.toHaveBeenCalled();
  });

  it("Pitch Bend fires onPitchBend and sets detune", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);
    const bends: number[] = [];
    handler.onPitchBend = (s) => bends.push(s);

    // Center pitch bend
    handler.handleMessage(new Uint8Array([0xe0, 0x00, 0x40]));

    expect(bends).toHaveLength(1);
    expect(bends[0]).toBeCloseTo(0, 3);
    expect(engine.setParamValue).toHaveBeenCalledWith("detune", expect.any(Number));
  });

  it("Pitch Bend up sets positive detune in cents", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);

    // Max pitch bend up
    handler.handleMessage(new Uint8Array([0xe0, 0x7f, 0x7f]));

    const call = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("detune");
    expect(call[1]).toBeGreaterThan(0); // positive cents
  });

  it("Channel Aftertouch modulates filter cutoff", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0xd0, 64])); // 50% pressure

    expect(engine.setParamValue).toHaveBeenCalledWith("cutoff", expect.any(Number));
    const call = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBeGreaterThan(8000); // should be higher than base
  });

  it("Transport Start fires onTransport('start')", () => {
    const handler = new KeyStepHandler();
    const actions: string[] = [];
    handler.onTransport = (a) => actions.push(a);

    handler.handleMessage(new Uint8Array([0xfa])); // Transport Start

    expect(actions).toEqual(["start"]);
  });

  it("Transport Stop fires onTransport('stop')", () => {
    const handler = new KeyStepHandler();
    const actions: string[] = [];
    handler.onTransport = (a) => actions.push(a);

    handler.handleMessage(new Uint8Array([0xfc]));

    expect(actions).toEqual(["stop"]);
  });

  it("Transport Continue fires onTransport('continue')", () => {
    const handler = new KeyStepHandler();
    const actions: string[] = [];
    handler.onTransport = (a) => actions.push(a);

    handler.handleMessage(new Uint8Array([0xfb]));

    expect(actions).toEqual(["continue"]);
  });

  it("unknown message type returns false", () => {
    const handler = new KeyStepHandler();
    // SysEx message — not handled by KeyStep handler
    const result = handler.handleMessage(new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]));
    expect(result).toBe(false);
  });

  it("CC#123 (All Notes Off) calls engine.allNotesOff", () => {
    const engine = { ...makeMockEngine(), allNotesOff: vi.fn() };
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0xb0, 123, 0])); // CC#123 on channel 1

    expect(engine.allNotesOff).toHaveBeenCalledOnce();
  });

  it("CC#123 on any channel calls allNotesOff", () => {
    const engine = { ...makeMockEngine(), allNotesOff: vi.fn() };
    const handler = new KeyStepHandler(engine as never, 1);

    handler.handleMessage(new Uint8Array([0xb2, 123, 0])); // CC#123 on channel 3

    expect(engine.allNotesOff).toHaveBeenCalledOnce();
  });

  it("other CC messages return true but do not call allNotesOff", () => {
    const engine = { ...makeMockEngine(), allNotesOff: vi.fn() };
    const handler = new KeyStepHandler(engine as never, 1);

    const result = handler.handleMessage(new Uint8Array([0xb0, 7, 100])); // CC#7 volume

    expect(result).toBe(true);
    expect(engine.allNotesOff).not.toHaveBeenCalled();
  });
});
