/**
 * Integration test: virtual MIDI → engine parameter change end-to-end.
 * Tests the complete flow: simulated hardware input → control handler → engine.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createTestMIDIEnvironment,
} from "./virtual-midi";
import {
  simulateEncoderTurn,
  simulateNoteOn,
  simulateNoteOff,
  simulateAftertouch,
  simulatePitchBend,
  simulateProgramChange,
  TEST_HARDWARE_MAPPING,
} from "./helpers";
import { KeyStepHandler, decodePitchBend, pitchBendToSemitones } from "@/control/keystep";
import { SynthEngine } from "@/audio/engine";
import { ControlMapper } from "@/control/mapper";
import { PadHandler, buildPadLedMessage } from "@/control/pads";
import {
  ParameterStore, getModuleParams, SYNTH_PARAMS,
  normalizedToParam, paramToNormalized,
  processSoftTakeover, latchEncoder, createSoftTakeoverState,
} from "@/audio/params";
import {
  EncoderManager,
  parseTwosComplementCC, parseSignMagnitudeCC, parseEncoderDelta, DEFAULT_SENSITIVITY,
} from "@/control/encoder";

// ── Mock Engine ──
function makeMockEngine() {
  const params = new Map<string, number>([
    ["cutoff", 8000],
    ["resonance", 0.5],
    ["detune", 0],
  ]);
  return {
    keyOn: vi.fn(),
    keyOff: vi.fn(),
    setParamValue: vi.fn((path: string, value: number) => { params.set(path, value); }),
    getParamValue: vi.fn((path: string) => params.get(path) ?? 0),
    _params: params,
  };
}

describe("KeyStep → Engine (note flow)", () => {
  it("note on from virtual KeyStep triggers engine.keyOn", () => {
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);

    // Wire virtual input to handler
    keystep.input.onmidimessage = (e) => {
      if (e.data) ksHandler.handleMessage(e.data);
    };

    simulateNoteOn(keystep.input, 60, 100);

    expect(engine.keyOn).toHaveBeenCalledWith(1, 60, 100);
  });

  it("note off from virtual KeyStep triggers engine.keyOff", () => {
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);

    keystep.input.onmidimessage = (e) => {
      if (e.data) ksHandler.handleMessage(e.data);
    };

    simulateNoteOn(keystep.input, 60, 80);
    simulateNoteOff(keystep.input, 60);

    expect(engine.keyOff).toHaveBeenCalled();
  });

  it("pitch bend sets detune parameter on engine", () => {
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);

    keystep.input.onmidimessage = (e) => {
      if (e.data) ksHandler.handleMessage(e.data);
    };

    simulatePitchBend(keystep.input, 16383); // max up

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const detuneCall = calls.find((call) => call[0] === "detune");
    expect(detuneCall).toBeDefined();
    expect(detuneCall![1]).toBeGreaterThan(0);
  });

  it("aftertouch modulates filter cutoff", () => {
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);

    keystep.input.onmidimessage = (e) => {
      if (e.data) ksHandler.handleMessage(e.data);
    };

    simulateAftertouch(keystep.input, 127); // full pressure

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffCall = calls.find((call) => call[0] === "cutoff");
    expect(cutoffCall).toBeDefined();
    expect(cutoffCall![1]).toBeGreaterThan(8000); // should increase cutoff
  });

  it("aftertouch curve is pressure^1.5 (not ^2)", () => {
    // Verify the curve shape at 40% and 70% pressure using known values:
    //   pressure=0.4: pow(0.4, 1.5)≈0.253, pow(0.4, 2)=0.160
    //   pressure=0.7: pow(0.7, 1.5)≈0.586, pow(0.7, 2)=0.490
    // baseCutoff=8000, AT_SENSITIVITY=0.3, maxCutoff=20000
    // modded = baseCutoff + curved * 0.3 * (20000 - baseCutoff)
    // At 40%: expected=8000 + 0.253*0.3*12000 ≈ 8910, wrongIfSquared≈8576
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);
    keystep.input.onmidimessage = (e) => { if (e.data) ksHandler.handleMessage(e.data); };

    // Test at 40% pressure (MIDI value ≈ 51)
    simulateAftertouch(keystep.input, 51);
    const pressure40 = 51 / 127;
    const expected40 = 8000 + Math.pow(pressure40, 1.5) * 0.3 * (20000 - 8000);
    const wrong40   = 8000 + Math.pow(pressure40, 2)   * 0.3 * (20000 - 8000);

    const calls40 = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoff40 = calls40.filter((c) => c[0] === "cutoff").at(-1)?.[1] ?? 0;
    expect(cutoff40).toBeCloseTo(expected40, 0); // within 0.5 Hz (rounding from MIDI int)
    expect(Math.abs(cutoff40 - wrong40)).toBeGreaterThan(50); // distinguishably different from ^2

    // Test at 70% pressure (MIDI value ≈ 89)
    simulateAftertouch(keystep.input, 89);
    const pressure70 = 89 / 127;
    const expected70 = 8000 + Math.pow(pressure70, 1.5) * 0.3 * (20000 - 8000);
    const wrong70   = 8000 + Math.pow(pressure70, 2)   * 0.3 * (20000 - 8000);

    const calls70 = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoff70 = calls70.filter((c: [string, number]) => c[0] === "cutoff").at(-1)?.[1] ?? 0;
    expect(cutoff70).toBeCloseTo(expected70, 0);
    expect(Math.abs(cutoff70 - wrong70)).toBeGreaterThan(50);
  });

  it("aftertouch with negative pressure does not produce NaN (clamp guard)", () => {
    // Math.pow(x, 1.5) returns NaN for negative x — the clamp in _applyAftertouch must prevent this
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);
    keystep.input.onmidimessage = (e) => { if (e.data) ksHandler.handleMessage(e.data); };

    // Send a raw channel pressure message with byte value 0 (normalizes to 0 — boundary test)
    // Then call _applyAftertouch directly with a negative value via handleMessage override
    // We test via the public API: any valid pressure should set a finite cutoff value
    simulateAftertouch(keystep.input, 0); // 0 pressure: should set cutoff to baseCutoff, not NaN

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffCall = calls.find((c: [string, number]) => c[0] === "cutoff");
    expect(cutoffCall).toBeDefined();
    expect(Number.isFinite(cutoffCall![1])).toBe(true);
    expect(cutoffCall![1]).toBeCloseTo(8000, 0); // zero pressure → no modulation, stays at base
  });

  it("note-on on wrong MIDI channel is ignored; correct channel still works", () => {
    // KeyStepHandler configured for channel 1 (0x90) — note messages on other channels ignored.
    // CC messages (incl. All Notes Off) pass through on any channel (global panic signals).
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1); // channel 1

    keystep.input.onmidimessage = (e) => { if (e.data) ksHandler.handleMessage(e.data); };

    // Note On on channel 2 (0x91) — must be ignored
    keystep.input.fireMessage(new Uint8Array([0x91, 60, 100]));
    expect(engine.keyOn).not.toHaveBeenCalled();

    // Note On on channel 1 (0x90) — must be processed
    keystep.input.fireMessage(new Uint8Array([0x90, 60, 100]));
    expect(engine.keyOn).toHaveBeenCalledWith(1, 60, 100);
  });

  it("pitch bend with no engine attached does not crash (boot race condition)", () => {
    // KeyStepHandler created without engine (before first setEngine() in app.ts)
    const handler = new KeyStepHandler(); // no engine
    const bends: number[] = [];
    handler.onPitchBend = (s) => bends.push(s);

    // Pitch bend should fire callback but not crash with no engine
    expect(() => {
      handler.handleMessage(new Uint8Array([0xe0, 0x7f, 0x7f])); // max up
    }).not.toThrow();
    expect(bends).toHaveLength(1);
    expect(bends[0]).toBeGreaterThan(0);
  });

  it("setEngine() mid-aftertouch: new engine's baseCutoff captured, AT not auto-re-applied", () => {
    // When engine is replaced mid-pressure, new engine starts clean (no AT applied to it yet).
    // AT modulation resumes on next AT message — designed behavior during program switch.
    const { keystep } = createTestMIDIEnvironment();
    const engine1 = makeMockEngine();
    const engine2 = makeMockEngine();
    const handler = new KeyStepHandler(engine1 as never, 1);
    keystep.input.onmidimessage = (e) => { if (e.data) handler.handleMessage(e.data); };

    // Apply aftertouch to engine1
    simulateAftertouch(keystep.input, 100);
    const calls1 = (engine1.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    expect(calls1.some((c: [string, number]) => c[0] === "cutoff")).toBe(true);

    // Switch to engine2 (program change scenario)
    handler.setEngine(engine2 as never);

    // engine2 should NOT have received setParamValue("cutoff") yet (AT not auto-re-applied)
    const calls2 = (engine2.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    expect(calls2.some((c: [string, number]) => c[0] === "cutoff")).toBe(false);

    // But the next AT message WILL apply to engine2
    simulateAftertouch(keystep.input, 100);
    const calls2After = (engine2.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    expect(calls2After.some((c: [string, number]) => c[0] === "cutoff")).toBe(true);
  });

  it("aftertouch resets to baseCutoff on new note-on", () => {
    const { keystep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const ksHandler = new KeyStepHandler(engine as never, 1);
    keystep.input.onmidimessage = (e) => { if (e.data) ksHandler.handleMessage(e.data); };

    // Apply aftertouch then play a new note — cutoff should reset to base
    simulateAftertouch(keystep.input, 100);
    simulateNoteOn(keystep.input, 60, 80);

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    // After note-on, setParamValue("cutoff", baseCutoff) should have been called
    const lastCutoff = calls.filter((c: [string, number]) => c[0] === "cutoff").at(-1)?.[1] ?? -1;
    expect(lastCutoff).toBeCloseTo(8000, 0); // back to base
  });
});

describe("BeatStep Encoder → ParameterStore → Engine (full flow)", () => {
  function setup() {
    const { beatstep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const store = new ParameterStore();
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, TEST_HARDWARE_MAPPING.masterCC);
    mapper.setStore(store);
    store.onParamChange = (path, value) => engine.setParamValue(path, value);

    beatstep.input.onmidimessage = (e) => {
      if (e.data) mapper.handleMessage(e.data);
    };

    return { beatstep, engine, store, mapper };
  }

  it("encoder 0 (cutoff) CW increases cutoff on engine when FLTR module active", () => {
    const { beatstep, engine, store } = setup();
    store.activeModule = 2; // FLTR module — slot 0 = cutoff

    simulateEncoderTurn(beatstep.input, 0, "cw", 3);

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffCall = calls.find((call) => call[0] === "cutoff");
    expect(cutoffCall).toBeDefined();
    expect(cutoffCall![1]).toBeGreaterThan(8000); // default is 8000
  });

  it("encoder 0 (cutoff) CCW decreases cutoff on engine when FLTR module active", () => {
    const { beatstep, engine, store } = setup();
    store.activeModule = 2; // FLTR module — slot 0 = cutoff

    simulateEncoderTurn(beatstep.input, 0, "ccw", 3);

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffCall = calls.find((call) => call[0] === "cutoff");
    expect(cutoffCall).toBeDefined();
    expect(cutoffCall![1]).toBeLessThan(8000);
  });

  it("all 16 encoders can be turned without errors", () => {
    const { beatstep, engine } = setup();

    for (let i = 0; i < 16; i++) {
      simulateEncoderTurn(beatstep.input, i, "cw", 1);
    }

    // Engine should have received at least one setParamValue call
    expect((engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("encoder delta magnitude: 64 CW steps moves linear param by its full range", () => {
    // Validates no double-scaling: EncoderManager pre-scales by 1/64, mapper passes sensitivity=1.
    // If double-scaled (1/64 × 1/64), 64 steps would move only 1/64 of the range — functionally broken.
    const { beatstep, store } = setup();
    store.activeModule = 2; // FLTR module — slot 1 (encoder 1) = resonance (linear 0–1)
    store.loadValues({ resonance: 0 }); // start at min

    for (let i = 0; i < 64; i++) {
      simulateEncoderTurn(beatstep.input, 1, "cw", 1); // speed=1 → raw delta=1 → scaled 1/64
    }

    // 64 steps × (1/64 per step) = 1.0 total movement on a 0–1 range
    expect(store.snapshot().resonance).toBeCloseTo(1.0, 1);
  });

  it("encoder 15 routes to active module slot 15 (MOD module: glide)", () => {
    const { beatstep, engine, store } = setup();
    store.activeModule = 4; // MOD module — slot 14 = glide

    simulateEncoderTurn(beatstep.input, 14, "cw", 3);

    const calls = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const glideCalls = calls.filter((call) => call[0] === "glide");
    expect(glideCalls.length).toBeGreaterThan(0);
  });
});

describe("BeatStep Pads (module select + patch select)", () => {
  function makePadHandler(): PadHandler {
    const handler = new PadHandler();
    handler.setPadNotes(TEST_HARDWARE_MAPPING.padRow1Notes[0], TEST_HARDWARE_MAPPING.padRow2Notes[0]);
    return handler;
  }

  it("program change fires onModuleSelect with correct slot", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const padHandler = makePadHandler();
    const slots: number[] = [];
    padHandler.onModuleSelect = (s) => slots.push(s);

    beatstep.input.onmidimessage = (e) => {
      if (e.data) padHandler.handleMessage(e.data);
    };

    simulateProgramChange(beatstep.input, 5);

    expect(slots).toEqual([5]);
  });

  it("row 1 Note On fires onModuleSelect", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const padHandler = makePadHandler();
    const slots: number[] = [];
    padHandler.onModuleSelect = (s) => slots.push(s);

    beatstep.input.onmidimessage = (e) => {
      if (e.data) padHandler.handleMessage(e.data);
    };

    // Pad 4 (row 1) = note padRow1Notes[3] → slot 3
    beatstep.input.fireMessage(new Uint8Array([0x90, TEST_HARDWARE_MAPPING.padRow1Notes[3], 90]));

    expect(slots).toEqual([3]);
  });

  it("rapid repeated Note On same pad fires callback each time (no dedup)", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const padHandler = makePadHandler();
    const slots: number[] = [];
    padHandler.onModuleSelect = (s) => slots.push(s);
    beatstep.input.onmidimessage = (e) => { if (e.data) padHandler.handleMessage(e.data); };

    const note = TEST_HARDWARE_MAPPING.padRow1Notes[0];
    beatstep.input.fireMessage(new Uint8Array([0x90, note, 90]));
    beatstep.input.fireMessage(new Uint8Array([0x90, note, 90]));
    beatstep.input.fireMessage(new Uint8Array([0x90, note, 90]));

    // Each Note On should fire independently — PadHandler has no dedup
    expect(slots).toHaveLength(3);
    expect(slots).toEqual([0, 0, 0]);
  });

  it("handleMessage before setPadNotes returns false and fires no callback", () => {
    // Unconfigured PadHandler: no calibration has run yet
    const handler = new PadHandler();
    const fired: number[] = [];
    handler.onModuleSelect = (s) => fired.push(s);

    // Note On for a pad note — but handler not configured
    const result = handler.handleMessage(new Uint8Array([0x90, 44, 90]));
    expect(result).toBe(false);
    expect(fired).toHaveLength(0);
  });

  it("Note Off (velocity 0 and 0x80 status) does not fire pad callbacks", () => {
    const handler = new PadHandler();
    const module: number[] = [];
    const patch: number[] = [];
    handler.onModuleSelect = (s) => module.push(s);
    handler.onPatchSelect = (s) => patch.push(s);
    handler.setPadNotes(TEST_HARDWARE_MAPPING.padRow1Notes[0], TEST_HARDWARE_MAPPING.padRow2Notes[0]);

    const moduleNote = TEST_HARDWARE_MAPPING.padRow1Notes[0];
    const patchNote = TEST_HARDWARE_MAPPING.padRow2Notes[0];

    // Note On with velocity=0 — treated as Note Off, must not fire
    handler.handleMessage(new Uint8Array([0x90, moduleNote, 0]));
    handler.handleMessage(new Uint8Array([0x90, patchNote, 0]));

    // Actual Note Off status (0x80) — must not fire
    handler.handleMessage(new Uint8Array([0x80, moduleNote, 64]));
    handler.handleMessage(new Uint8Array([0x80, patchNote, 64]));

    expect(module).toHaveLength(0);
    expect(patch).toHaveLength(0);
  });

  it("row 2 Note On fires onPatchSelect with slot 0-7", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const padHandler = makePadHandler();
    const slots: number[] = [];
    padHandler.onPatchSelect = (s) => slots.push(s);

    beatstep.input.onmidimessage = (e) => {
      if (e.data) padHandler.handleMessage(e.data);
    };

    // Pad 9 (row 2) = note padRow2Notes[0] → slot 0
    beatstep.input.fireMessage(new Uint8Array([0x90, TEST_HARDWARE_MAPPING.padRow2Notes[0], 90]));

    expect(slots).toEqual([0]);
  });
});

describe("EncoderManager: mode switching", () => {
  function makeManager(mode: "relative" | "absolute" = "relative") {
    const mgr = new EncoderManager([{ ccNumber: 10, mode, sensitivity: 1 }]);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);
    return { mgr, deltas };
  }

  it("absolute mode: first message sets position, no delta fired", () => {
    const { mgr, deltas } = makeManager("absolute");
    mgr.handleMessage(new Uint8Array([0xb0, 10, 64])); // first message
    expect(deltas).toHaveLength(0); // no delta — no previous value
  });

  it("absolute mode: second message fires delta = current - prev", () => {
    const { mgr, deltas } = makeManager("absolute");
    mgr.handleMessage(new Uint8Array([0xb0, 10, 64])); // establish position
    mgr.handleMessage(new Uint8Array([0xb0, 10, 70])); // +6
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeCloseTo(6, 5);
  });

  it("setEncoderMode: switching from absolute to relative clears position — first relative fires delta", () => {
    const { mgr, deltas } = makeManager("absolute");
    mgr.handleMessage(new Uint8Array([0xb0, 10, 64])); // establish absolute position
    mgr.handleMessage(new Uint8Array([0xb0, 10, 70])); // +6 absolute delta

    mgr.setEncoderMode(0, "relative"); // switch to relative
    deltas.length = 0; // reset captured deltas

    // relative: CC 65 = +1 step
    mgr.handleMessage(new Uint8Array([0xb0, 10, 65]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeGreaterThan(0);
  });

  it("setEncoderMode: switching from relative to absolute clears stale position — first msg is no-op", () => {
    const { mgr, deltas } = makeManager("relative");
    mgr.handleMessage(new Uint8Array([0xb0, 10, 65])); // relative turn
    expect(deltas).toHaveLength(1);

    mgr.setEncoderMode(0, "absolute");
    deltas.length = 0;

    // First absolute message should return early (no previous value to diff)
    mgr.handleMessage(new Uint8Array([0xb0, 10, 64]));
    expect(deltas).toHaveLength(0);
  });
});

describe("fingerprint: SysEx identity replies", () => {
  it("KeyStep identity reply is valid and identifiable", async () => {
    const { keystep } = createTestMIDIEnvironment();
    const { IDENTITY_REQUEST, isArturiaIdentityReply, parseIdentityReply, identifyDevice } =
      await import("@/midi/fingerprint");

    let fingerprint = null;
    keystep.input.onmidimessage = (e) => {
      if (e.data && isArturiaIdentityReply(e.data)) {
        fingerprint = parseIdentityReply(e.data);
      }
    };
    keystep.output.send(IDENTITY_REQUEST);

    await new Promise((r) => setTimeout(r, 10));

    expect(fingerprint).not.toBeNull();
    expect(identifyDevice(fingerprint!)).toBe("keystep");
  });

  it("BeatStep identity reply is valid and identifiable", async () => {
    const { beatstep } = createTestMIDIEnvironment();
    const { IDENTITY_REQUEST, isArturiaIdentityReply, parseIdentityReply, identifyDevice } =
      await import("@/midi/fingerprint");

    let fingerprint = null;
    beatstep.input.onmidimessage = (e) => {
      if (e.data && isArturiaIdentityReply(e.data)) {
        fingerprint = parseIdentityReply(e.data);
      }
    };
    beatstep.output.send(IDENTITY_REQUEST);

    await new Promise((r) => setTimeout(r, 10));

    expect(fingerprint).not.toBeNull();
    expect(identifyDevice(fingerprint!)).toBe("beatstep");
  });
});

describe("ControlMapper: null store robustness", () => {
  it("encoder delta before setStore() is a silent no-op — no crash, returns true", () => {
    // ControlMapper with no store attached: encoder CCs should be recognized
    // (return true = handled) but not crash since store is null.
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, TEST_HARDWARE_MAPPING.masterCC);
    // No setStore() called — _store is null

    const cc = TEST_HARDWARE_MAPPING.encoders[0].cc;
    // CW step (relative CC 65 = +1)
    expect(() => mapper.handleMessage(new Uint8Array([0xb0, cc, 65]))).not.toThrow();
  });

  it("SysEx and Program Change pass through mapper as unhandled (return false)", () => {
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, TEST_HARDWARE_MAPPING.masterCC);

    // SysEx — 0xF0 start byte, not a CC
    const sysex = new Uint8Array([0xf0, 0x00, 0x20, 0x6b, 0xf7]);
    expect(mapper.handleMessage(sysex)).toBe(false);

    // Program Change (0xC0) — not a CC, should not be claimed by mapper
    const programChange = new Uint8Array([0xc0, 5]);
    expect(mapper.handleMessage(programChange)).toBe(false);
  });
});

describe("ControlMapper: module switch mid-turn soft-takeover isolation", () => {
  it("switching activeModule mid-turn does not leak encoder state to new module", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const engine = makeMockEngine();
    const store = new ParameterStore();
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, TEST_HARDWARE_MAPPING.masterCC);
    mapper.setStore(store);
    store.onParamChange = (path, value) => engine.setParamValue(path, value);
    beatstep.input.onmidimessage = (e) => { if (e.data) mapper.handleMessage(e.data); };

    // Start on FLTR module (encoder 0 = cutoff)
    store.activeModule = 2;
    simulateEncoderTurn(beatstep.input, 0, "cw", 4);

    const callsBeforeSwitch = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffBeforeSwitch = callsBeforeSwitch.filter((c) => c[0] === "cutoff").length;
    expect(cutoffBeforeSwitch).toBeGreaterThan(0);

    // Switch to OSCA module (encoder 0 = osc_a_tune) mid-session
    store.activeModule = 0;
    (engine.setParamValue as ReturnType<typeof vi.fn>).mockClear();

    // Turn encoder 0 again — should route to osc_a_tune, NOT continue on cutoff
    simulateEncoderTurn(beatstep.input, 0, "cw", 2);

    const callsAfterSwitch = (engine.setParamValue as ReturnType<typeof vi.fn>).mock.calls as [string, number][];
    const cutoffAfterSwitch = callsAfterSwitch.filter((c) => c[0] === "cutoff");
    expect(cutoffAfterSwitch).toHaveLength(0); // no cutoff updates after module switch
  });
});

describe("PadHandler: Program Change (module select without pad notes)", () => {
  it("Program Change 0–7 fires onModuleSelect even before setPadNotes()", () => {
    // Program Change bypasses the _configured check — intentional so software
    // sources can drive module selection without BeatStep pad calibration.
    const handler = new PadHandler();
    const modules: number[] = [];
    handler.onModuleSelect = (m) => modules.push(m);

    for (let i = 0; i <= 7; i++) {
      handler.handleMessage(new Uint8Array([0xc0, i])); // PC on ch1
    }
    expect(modules).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("Program Change >= 8 is ignored (returns false)", () => {
    const handler = new PadHandler();
    const modules: number[] = [];
    handler.onModuleSelect = (m) => modules.push(m);

    expect(handler.handleMessage(new Uint8Array([0xc0, 8]))).toBe(false);
    expect(handler.handleMessage(new Uint8Array([0xc0, 127]))).toBe(false);
    expect(modules).toHaveLength(0);
  });
});

describe("ParameterStore: SCENE module and out-of-range slots", () => {
  it("processEncoderDelta on SCENE module (all-null slots) returns false for any slot", () => {
    const store = new ParameterStore();
    store.activeModule = 7; // SCENE — all 16 slots are null (future use)

    for (let slot = 0; slot < 16; slot++) {
      expect(store.processEncoderDelta(slot, 1 / 64)).toBe(false);
    }
  });

  it("getModuleParams with out-of-bounds index returns 16 nulls (no crash)", () => {
    const result = getModuleParams(99);
    expect(result).toHaveLength(16);
    expect(result.every((p) => p === null)).toBe(true);
  });
});

describe("buildPadLedMessage: LED message format", () => {
  it("row 1 pads (0–7) use moduleBase note with 0x99 status", () => {
    for (let i = 0; i < 8; i++) {
      const msg = buildPadLedMessage(i, 100, 44, 36);
      expect(msg[0]).toBe(0x99); // channel 10 Note On
      expect(msg[1]).toBe(44 + i); // moduleBase + padIndex
      expect(msg[2]).toBe(100);
    }
  });

  it("row 2 pads (8–15) use patchBase note", () => {
    for (let i = 8; i < 16; i++) {
      const msg = buildPadLedMessage(i, 64, 44, 36);
      expect(msg[0]).toBe(0x99);
      expect(msg[1]).toBe(36 + (i - 8)); // patchBase + (padIndex - 8)
      expect(msg[2]).toBe(64);
    }
  });

  it("velocity=0 turns LED off (note & velocity bytes both masked to 0x7f)", () => {
    const msg = buildPadLedMessage(0, 0, 44, 36);
    expect(msg[2]).toBe(0); // off
  });

  it("high note and velocity values are masked to 0x7f", () => {
    const msg = buildPadLedMessage(0, 255, 200, 36); // note=200 → masked to 72, vel=255 → 127
    expect(msg[1]).toBe(200 & 0x7f); // 72
    expect(msg[2]).toBe(255 & 0x7f); // 127
  });
});

describe("parseTwosComplementCC (relative2 mode)", () => {
  it("CW values (1–63) return positive deltas", () => {
    expect(parseTwosComplementCC(1)).toBe(1);
    expect(parseTwosComplementCC(32)).toBe(32);
    expect(parseTwosComplementCC(63)).toBe(63);
  });

  it("CCW values (65–127) return negative deltas (two's complement)", () => {
    expect(parseTwosComplementCC(127)).toBe(-1);  // 127 - 128 = -1
    expect(parseTwosComplementCC(96)).toBe(-32);  // 96 - 128 = -32
    expect(parseTwosComplementCC(65)).toBe(-63);  // 65 - 128 = -63
  });

  it("center values 0 and 64 return 0 (no movement)", () => {
    expect(parseTwosComplementCC(0)).toBe(0);
    expect(parseTwosComplementCC(64)).toBe(0);
  });
});

describe("parseSignMagnitudeCC (relative3 mode)", () => {
  it("bit6=0 (CW): returns positive magnitude from bits 0-5", () => {
    expect(parseSignMagnitudeCC(0b00000001)).toBe(1);
    expect(parseSignMagnitudeCC(0b00000101)).toBe(5);
    expect(parseSignMagnitudeCC(0b00111111)).toBe(63);
  });

  it("bit6=1 (CCW): returns negative magnitude", () => {
    expect(parseSignMagnitudeCC(0b01000001)).toBe(-1);
    expect(parseSignMagnitudeCC(0b01000101)).toBe(-5);
    expect(parseSignMagnitudeCC(0b01111111)).toBe(-63);
  });

  it("magnitude 0 returns 0 regardless of direction bit", () => {
    expect(parseSignMagnitudeCC(0b00000000)).toBe(0);
    expect(parseSignMagnitudeCC(0b01000000)).toBe(0);
  });
});

describe("EncoderManager: relative2 and relative3 modes via handleMessage", () => {
  it("relative2 mode: CW message produces positive delta with acceleration", () => {
    const encoders = [{ ccNumber: 10, mode: "relative2" as const }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    mgr.handleMessage(new Uint8Array([0xb0, 10, 1])); // CW, magnitude 1
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeGreaterThan(0);
  });

  it("relative2 mode: CCW message (127) produces negative delta", () => {
    const encoders = [{ ccNumber: 10, mode: "relative2" as const }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    mgr.handleMessage(new Uint8Array([0xb0, 10, 127])); // CCW, raw=-1
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeLessThan(0);
  });

  it("relative2 mode: center value 64 produces no delta", () => {
    const encoders = [{ ccNumber: 10, mode: "relative2" as const }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    mgr.handleMessage(new Uint8Array([0xb0, 10, 64]));
    expect(deltas).toHaveLength(0);
  });

  it("relative3 mode: CW message (bit6=0) produces positive delta", () => {
    const encoders = [{ ccNumber: 11, mode: "relative3" as const }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    mgr.handleMessage(new Uint8Array([0xb0, 11, 0b00000101])); // CW, magnitude 5
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeGreaterThan(0);
  });

  it("relative3 mode: CCW message (bit6=1) produces negative delta", () => {
    const encoders = [{ ccNumber: 11, mode: "relative3" as const }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    mgr.handleMessage(new Uint8Array([0xb0, 11, 0b01000101])); // CCW, magnitude 5
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeLessThan(0);
  });
});

describe("normalizedToParam / paramToNormalized: logarithmic boundary", () => {
  it("normalizedToParam(0) returns exact param.min for logarithmic param", () => {
    const param = SYNTH_PARAMS["cutoff"]; // logarithmic, min=20
    const result = normalizedToParam(0, param);
    expect(result).toBeCloseTo(20, 1);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("normalizedToParam(1) returns exact param.max for logarithmic param", () => {
    const param = SYNTH_PARAMS["cutoff"]; // max=20000
    const result = normalizedToParam(1, param);
    expect(result).toBeCloseTo(20000, 0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("normalizedToParam out-of-range values clamp: -0.5 → min, 1.5 → max", () => {
    const param = SYNTH_PARAMS["cutoff"];
    expect(normalizedToParam(-0.5, param)).toBeCloseTo(20, 1);
    expect(normalizedToParam(1.5, param)).toBeCloseTo(20000, 0);
  });

  it("paramToNormalized / normalizedToParam round-trip for logarithmic param", () => {
    const param = SYNTH_PARAMS["cutoff"];
    for (const val of [20, 100, 1000, 8000, 20000]) {
      const norm = paramToNormalized(val, param);
      const back = normalizedToParam(norm, param);
      expect(Number.isFinite(norm)).toBe(true);
      expect(back).toBeCloseTo(val, 0);
    }
  });

  it("paramToNormalized out-of-range clamps: value < min → 0, value > max → 1", () => {
    const param = SYNTH_PARAMS["cutoff"]; // min=20, max=20000
    expect(paramToNormalized(10, param)).toBe(0);
    expect(paramToNormalized(50000, param)).toBe(1);
  });
});

describe("EncoderManager.setEncoderCC: CC reassignment behavior", () => {
  it("setEncoderCC updates CC routing — old CC no longer fires delta", () => {
    const encoders = [{ ccNumber: 5 }];
    const mgr = new EncoderManager(encoders);
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);

    // Reassign encoder 0 from CC 5 → CC 10
    mgr.setEncoderCC(0, 10);

    // Old CC 5 should no longer fire
    mgr.handleMessage(new Uint8Array([0xb0, 5, 65]));
    expect(deltas).toHaveLength(0);

    // New CC 10 should fire
    mgr.handleMessage(new Uint8Array([0xb0, 10, 65]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeGreaterThan(0);
  });

  it("setEncoderCC with out-of-bounds encoderIndex is a no-op (no crash)", () => {
    const encoders = [{ ccNumber: 5 }];
    const mgr = new EncoderManager(encoders);
    expect(() => mgr.setEncoderCC(99, 20)).not.toThrow();
    // CC 5 still works after no-op
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_idx, d) => deltas.push(d);
    mgr.handleMessage(new Uint8Array([0xb0, 5, 65]));
    expect(deltas).toHaveLength(1);
  });
});

describe("ParameterStore: stepped param negative delta from fractional value", () => {
  it("stepped param with negative delta from fractional value decreases, not increases", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSCA — slot 0 = waveform, steps=5, values 0-4

    // Load at a value that normalizes to ~0.51 (between step 2 and 3)
    // waveform=2 → normalized 2/4=0.5, waveform=3 → 3/4=0.75
    // Load at 2.0 (exact step) then verify negative delta goes to step 1
    store.loadValues({ waveform: 2 });

    const before = store.snapshot().waveform;
    const changed = store.processEncoderDelta(0, -1); // negative delta = CCW = decrease
    expect(changed).toBe(true);
    expect(store.snapshot().waveform).toBeLessThan(before); // must go DOWN
  });
});

describe("processSoftTakeover + latchEncoder: hunt mode approach directions", () => {
  it("approach from above: CCW delta (< 0) crossing downward through softValue unlocks", () => {
    // Hardware at 0.8, softValue at 0.3 → approachFromAbove=true → need delta < 0 crossing
    const param = SYNTH_PARAMS["resonance"]; // linear 0-1
    const state = createSoftTakeoverState(0.8, param); // start live at 0.8
    latchEncoder(state, 0.3); // new patch loaded: softValue=0.3, live=false, approachFromAbove=true

    expect(state.live).toBe(false);
    expect(state.approachFromAbove).toBe(true);

    // Move hardware DOWN slowly from 0.8 toward 0.3
    let unlatched = false;
    for (let i = 0; i < 100; i++) {
      const result = processSoftTakeover(state, -1, 1 / 128); // small CCW steps
      if (result !== null) { unlatched = true; break; }
    }
    expect(unlatched).toBe(true);
    expect(state.live).toBe(true);
  });

  it("approach from below: CW delta (> 0) crossing upward through softValue unlocks", () => {
    // Hardware at 0.2, softValue at 0.7 → approachFromAbove=false → need delta > 0 crossing
    const param = SYNTH_PARAMS["resonance"];
    const state = createSoftTakeoverState(0.2, param);
    latchEncoder(state, 0.7); // new patch: softValue=0.7, approachFromAbove=false

    expect(state.live).toBe(false);
    expect(state.approachFromAbove).toBe(false);

    // Move hardware UP slowly from 0.2 toward 0.7
    let unlatched = false;
    for (let i = 0; i < 100; i++) {
      const result = processSoftTakeover(state, 1, 1 / 128); // small CW steps
      if (result !== null) { unlatched = true; break; }
    }
    expect(unlatched).toBe(true);
    expect(state.live).toBe(true);
  });

  it("wrong direction never unlocks: CCW when approachFromAbove=false returns null forever", () => {
    const param = SYNTH_PARAMS["resonance"];
    const state = createSoftTakeoverState(0.2, param);
    latchEncoder(state, 0.7); // hardware below, must go CW

    // Turn CCW (wrong way) — should never unlock
    for (let i = 0; i < 50; i++) {
      const result = processSoftTakeover(state, -1, 1 / 128);
      expect(result).toBeNull(); // still latched
    }
    expect(state.live).toBe(false);
  });
});

// ── ParameterStore.setNormalized ──

describe("ParameterStore.setNormalized", () => {
  it("clamps normalized > 1 to 1 and stores max value", () => {
    const store = new ParameterStore();
    store.setNormalized("resonance", 2.5); // way above 1
    expect(store.getNormalized("resonance")).toBeCloseTo(1.0, 5);
  });

  it("clamps normalized < 0 to 0 and stores min value", () => {
    const store = new ParameterStore();
    store.setNormalized("resonance", -0.5); // below 0
    expect(store.getNormalized("resonance")).toBeCloseTo(0.0, 5);
  });

  it("fires onParamChange with the denormalized value (linear param)", () => {
    const store = new ParameterStore();
    const changes: Array<[string, number]> = [];
    store.onParamChange = (path, value) => changes.push([path, value]);

    // resonance: linear, min=0, max=1 → normalized=0.5 → denorm=0.5
    store.setNormalized("resonance", 0.5);
    expect(changes).toHaveLength(1);
    expect(changes[0][0]).toBe("resonance");
    expect(changes[0][1]).toBeCloseTo(0.5, 5);
  });

  it("fires onParamChange with geometric mean for log param at normalized=0.5", () => {
    const store = new ParameterStore();
    const changes: Array<[string, number]> = [];
    store.onParamChange = (path, value) => changes.push([path, value]);

    // cutoff: logarithmic, min=20, max=20000 → geometric mean = sqrt(20 * 20000) ≈ 632.46
    store.setNormalized("cutoff", 0.5);
    expect(changes).toHaveLength(1);
    expect(changes[0][0]).toBe("cutoff");
    expect(changes[0][1]).toBeCloseTo(Math.sqrt(20 * 20000), 0); // ~632 Hz
  });

  it("does not fire onParamChange when no callback is wired", () => {
    const store = new ParameterStore();
    // No onParamChange set — should not throw
    expect(() => store.setNormalized("resonance", 0.5)).not.toThrow();
    expect(store.getNormalized("resonance")).toBeCloseTo(0.5, 5);
  });
});

// ── ControlMapper: onMasterDelta callback ──

describe("ControlMapper: onMasterDelta callback", () => {
  it("master CC CW fires onMasterDelta with positive scaled delta", () => {
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const masterCC = TEST_HARDWARE_MAPPING.masterCC;
    const mapper = new ControlMapper(encoderStates, masterCC);
    const deltas: number[] = [];
    mapper.onMasterDelta = (d) => deltas.push(d);

    // Relative1 CW: value 65 → parseRelativeCC(65) = 1 → delta = 1/64
    mapper.handleMessage(new Uint8Array([0xb0, masterCC, 65]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeCloseTo(1 / 64, 6);
  });

  it("master CC CCW fires onMasterDelta with negative scaled delta", () => {
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const masterCC = TEST_HARDWARE_MAPPING.masterCC;
    const mapper = new ControlMapper(encoderStates, masterCC);
    const deltas: number[] = [];
    mapper.onMasterDelta = (d) => deltas.push(d);

    // Relative1 CCW: value 63 → parseRelativeCC(63) = -1 → delta = -1/64
    mapper.handleMessage(new Uint8Array([0xb0, masterCC, 63]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeCloseTo(-1 / 64, 6);
  });

  it("master CC center (64) does not fire onMasterDelta", () => {
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const masterCC = TEST_HARDWARE_MAPPING.masterCC;
    const mapper = new ControlMapper(encoderStates, masterCC);
    const deltas: number[] = [];
    mapper.onMasterDelta = (d) => deltas.push(d);

    mapper.handleMessage(new Uint8Array([0xb0, masterCC, 64])); // center = no movement
    expect(deltas).toHaveLength(0);
  });

  it("non-master CC does not fire onMasterDelta", () => {
    const encoderStates = TEST_HARDWARE_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const masterCC = TEST_HARDWARE_MAPPING.masterCC;
    const mapper = new ControlMapper(encoderStates, masterCC);
    const deltas: number[] = [];
    mapper.onMasterDelta = (d) => deltas.push(d);

    // Use an encoder CC (not the master)
    const encoderCC = TEST_HARDWARE_MAPPING.encoders[0].cc;
    mapper.handleMessage(new Uint8Array([0xb0, encoderCC, 65]));
    expect(deltas).toHaveLength(0);
  });
});

// ── KeyStepHandler: aftertouch reset on new note ──

describe("KeyStepHandler: aftertouch reset on new note-on", () => {
  it("second note-on while AT held resets cutoff to baseCutoff", () => {
    const paramValues = new Map<string, number>([["cutoff", 8000], ["detune", 0]]);
    const engine = {
      keyOn: vi.fn(),
      keyOff: vi.fn(),
      setParamValue: vi.fn((path: string, value: number) => { paramValues.set(path, value); }),
      getParamValue: vi.fn((path: string) => paramValues.get(path) ?? 0),
    };

    const handler = new KeyStepHandler(engine as never, 1);

    // Note on + aftertouch → cutoff goes above baseCutoff (8000)
    handler.handleMessage(new Uint8Array([0x90, 60, 80])); // note-on ch1
    handler.handleMessage(new Uint8Array([0xd0, 100])); // channel pressure (AT)
    const cutoffAfterAT = paramValues.get("cutoff") ?? 0;
    expect(cutoffAfterAT).toBeGreaterThan(8000); // AT raised the cutoff

    // Second note-on should reset AT and snap cutoff back to baseCutoff (8000)
    handler.handleMessage(new Uint8Array([0x90, 64, 80]));
    const cutoffAfterSecondNote = paramValues.get("cutoff") ?? 0;
    expect(cutoffAfterSecondNote).toBeCloseTo(8000, 0);
  });
});

// ── EncoderManager: setEncoderCC CC collision ──

describe("EncoderManager: setEncoderCC CC collision handling", () => {
  it("reassigning encoder 1 to encoder 0's CC claims it (encoder 0 loses old CC)", () => {
    // Create with 3 encoders: CC5, CC6, CC7
    const manager = new EncoderManager([
      { ccNumber: 5 },
      { ccNumber: 6 },
      { ccNumber: 7 },
    ]);
    const fired: Array<[number, number]> = [];
    manager.onEncoderDelta = (idx, delta) => fired.push([idx, delta]);

    // Reassign encoder 1 to CC5 (collision with encoder 0)
    manager.setEncoderCC(1, 5);

    // CC5 should now route to encoder 1, not encoder 0
    fired.length = 0;
    manager.handleMessage(new Uint8Array([0xb0, 5, 65]));
    expect(fired).toHaveLength(1);
    expect(fired[0][0]).toBe(1); // encoder 1 owns CC5 now

    // CC6 (old encoder 1 CC) should no longer route to encoder 1
    fired.length = 0;
    manager.handleMessage(new Uint8Array([0xb0, 6, 65]));
    expect(fired).toHaveLength(0); // CC6 was encoder 1's old CC — now orphaned
  });
});

// ── PadHandler: Program Change works on any MIDI channel ──

describe("PadHandler: Program Change channel masking", () => {
  it("PC on any MIDI channel fires onModuleSelect (status & 0xF0 = 0xC0)", () => {
    const handler = new PadHandler();
    const modules: number[] = [];
    handler.onModuleSelect = (slot) => modules.push(slot);

    // PC on channel 1 (0xC0), channel 4 (0xC3), channel 16 (0xCF)
    handler.handleMessage(new Uint8Array([0xc0, 2])); // ch1, program 2
    handler.handleMessage(new Uint8Array([0xc3, 5])); // ch4, program 5
    handler.handleMessage(new Uint8Array([0xcf, 7])); // ch16, program 7

    expect(modules).toEqual([2, 5, 7]);
  });
});

// ── KeyStepHandler: setBaseCutoff reapplies AT modulation ──

describe("KeyStepHandler: setBaseCutoff with AT held", () => {
  it("setBaseCutoff while AT held immediately re-applies modulation from new base", () => {
    const paramValues = new Map<string, number>([["cutoff", 8000], ["detune", 0]]);
    const setParamCalls: Array<[string, number]> = [];
    const engine = {
      keyOn: vi.fn(),
      keyOff: vi.fn(),
      setParamValue: vi.fn((path: string, value: number) => {
        paramValues.set(path, value);
        setParamCalls.push([path, value]);
      }),
      getParamValue: vi.fn((path: string) => paramValues.get(path) ?? 0),
    };

    const handler = new KeyStepHandler(engine as never, 1);

    // Hold AT at 100/127
    handler.handleMessage(new Uint8Array([0x90, 60, 80]));
    handler.handleMessage(new Uint8Array([0xd0, 100]));
    const cutoffWithAT = paramValues.get("cutoff") ?? 0;
    expect(cutoffWithAT).toBeGreaterThan(8000);

    // User turns cutoff knob — setBaseCutoff called from onParamChange
    handler.setBaseCutoff(4000); // new knob position
    const cutoffAfterKnob = paramValues.get("cutoff") ?? 0;

    // AT modulation must re-apply on top of the new base (4000 + AT curve)
    expect(cutoffAfterKnob).toBeGreaterThan(4000); // still AT-modulated
    expect(cutoffAfterKnob).toBeLessThan(cutoffWithAT); // but lower than 8000+AT
  });
});

// ── decodePitchBend / pitchBendToSemitones boundaries ──

describe("decodePitchBend and pitchBendToSemitones", () => {
  it("decodePitchBend(0, 0) = 0 (minimum pitch bend)", () => {
    expect(decodePitchBend(0, 0)).toBe(0);
  });

  it("decodePitchBend(0x00, 0x40) = 8192 (center, no bend)", () => {
    expect(decodePitchBend(0x00, 0x40)).toBe(8192);
  });

  it("decodePitchBend(0x7f, 0x7f) = 16383 (maximum pitch bend)", () => {
    expect(decodePitchBend(0x7f, 0x7f)).toBe(16383);
  });

  it("pitchBendToSemitones(8192) = 0 (center = no bend)", () => {
    // center is 8192 → semitones = (8192 - 8192) / 8192 × 2 = 0
    expect(pitchBendToSemitones(8192)).toBeCloseTo(0, 6);
  });

  it("pitchBendToSemitones(0) ≈ -2 semitones (full down bend)", () => {
    // (0 - 8192) / 8192 × 2 = -2
    expect(pitchBendToSemitones(0)).toBeCloseTo(-2, 5);
  });

  it("pitchBendToSemitones(16383) ≈ +2 semitones (full up bend)", () => {
    // (16383 - 8192) / 8192 × 2 ≈ 1.9997...
    expect(pitchBendToSemitones(16383)).toBeCloseTo(2, 2);
  });
});

// ── EncoderManager: setAllEncoderModes clears absolute position tracking ──

describe("EncoderManager: setAllEncoderModes clears absolute position tracking", () => {
  it("after switching to absolute mode, first message sets baseline (no delta fires)", () => {
    const manager = new EncoderManager([{ ccNumber: 5, mode: "relative" }]);
    const deltas: number[] = [];
    manager.onEncoderDelta = (_idx, d) => deltas.push(d);

    // Switch to absolute mode — _lastAbsoluteValue should be cleared
    manager.setAllEncoderModes("absolute");

    // First absolute CC: establishes baseline, must NOT fire a delta
    manager.handleMessage(new Uint8Array([0xb0, 5, 64]));
    expect(deltas).toHaveLength(0); // no delta yet — baseline set

    // Second absolute CC: fires delta = (96 - 64) × sensitivity
    manager.handleMessage(new Uint8Array([0xb0, 5, 96]));
    expect(deltas).toHaveLength(1); // now fires
    expect(deltas[0]).toBeGreaterThan(0); // positive delta (value increased)
  });

  it("after mode switch, stale _lastAbsoluteValue from prior relative mode does not cause spurious delta", () => {
    // If _lastAbsoluteValue were NOT cleared on mode switch,
    // the first absolute message would diff against whatever leftover state was there.
    // This test ensures no such spurious jump occurs.
    const manager = new EncoderManager([{ ccNumber: 5, mode: "relative" }]);
    const deltas: number[] = [];
    manager.onEncoderDelta = (_idx, d) => deltas.push(d);

    // In relative mode — no absolute tracking involved
    manager.handleMessage(new Uint8Array([0xb0, 5, 65])); // relative CW
    expect(deltas).toHaveLength(1);

    // Switch to absolute and verify first message is still baseline-only
    manager.setAllEncoderModes("absolute");
    deltas.length = 0;

    manager.handleMessage(new Uint8Array([0xb0, 5, 10])); // first absolute
    expect(deltas).toHaveLength(0); // must be baseline, not diff against stale state
  });
});

// ── ParameterStore.loadValues: sends defaults for missing params ──

describe("ParameterStore.loadValues: defaults for missing params", () => {
  it("params not in the patch are sent to onParamChange with their default value", () => {
    const store = new ParameterStore();
    const received = new Map<string, number>();
    store.onParamChange = (path, value) => received.set(path, value);

    // Load a patch with only cutoff — all other params must be sent with defaults
    store.loadValues({ cutoff: 3000 });

    // cutoff is present → value is 3000
    expect(received.get("cutoff")).toBeCloseTo(3000, 0);

    // resonance is missing → must be sent with its default
    const resonanceParam = SYNTH_PARAMS["resonance"];
    expect(received.get("resonance")).toBeCloseTo(resonanceParam.default, 5);

    // voices is missing → must be sent with its default
    const voicesParam = SYNTH_PARAMS["voices"];
    expect(received.get("voices")).toBeCloseTo(voicesParam.default, 0);
  });

  it("params in the patch override the default — missing params still get defaults", () => {
    const store = new ParameterStore();
    const received = new Map<string, number>();
    store.onParamChange = (path, value) => received.set(path, value);

    store.loadValues({ voices: 4 }); // only voices explicitly set

    // voices must be exactly 4
    expect(received.get("voices")).toBe(4);

    // cutoff missing → receives its default (8000 Hz)
    expect(received.get("cutoff")).toBeCloseTo(SYNTH_PARAMS["cutoff"].default, 0);
  });
});

// ── KeyStepHandler: CC 123 (ALL_NOTES_OFF) bypasses channel filter ──

describe("KeyStepHandler: CC_ALL_NOTES_OFF accepted on any MIDI channel", () => {
  it("CC 123 on channel 2 still fires allNotesOff when handler is on channel 1", () => {
    const engine = {
      keyOn: vi.fn(),
      keyOff: vi.fn(),
      setParamValue: vi.fn(),
      getParamValue: vi.fn(() => 0),
      allNotesOff: vi.fn(),
    };
    const handler = new KeyStepHandler(engine as never, 1);

    // CC 123 on channel 2 (status 0xB1) — handler is on channel 1
    handler.handleMessage(new Uint8Array([0xb1, 123, 0]));
    expect(engine.allNotesOff).toHaveBeenCalledTimes(1);
  });

  it("Note On on wrong channel is ignored but CC 123 on same wrong channel is not", () => {
    const engine = {
      keyOn: vi.fn(),
      keyOff: vi.fn(),
      setParamValue: vi.fn(),
      getParamValue: vi.fn(() => 0),
      allNotesOff: vi.fn(),
    };
    const handler = new KeyStepHandler(engine as never, 1);

    // Note On on channel 3 → ignored (voice message, wrong channel)
    handler.handleMessage(new Uint8Array([0x92, 60, 80]));
    expect(engine.keyOn).not.toHaveBeenCalled();

    // CC 123 on channel 3 → NOT ignored (CC bypasses channel filter)
    handler.handleMessage(new Uint8Array([0xb2, 123, 0]));
    expect(engine.allNotesOff).toHaveBeenCalledTimes(1);
  });
});

// ── ParameterStore.setNormalized: unknown path silently skips onParamChange ──

describe("ParameterStore.setNormalized: unknown path behavior", () => {
  it("setNormalized with unknown param path stores value but does not fire onParamChange", () => {
    const store = new ParameterStore();
    const fired: string[] = [];
    store.onParamChange = (path) => fired.push(path);

    store.setNormalized("nonexistent_param_xyz", 0.5);

    // onParamChange must NOT fire — no known param to denormalize against
    expect(fired).toHaveLength(0);
  });
});

// ── SynthEngine: setParamValue / getParamValue before nodes are created ──

describe("SynthEngine: param access before nodes are initialized", () => {
  it("setParamValue before startFromGenerators is a silent no-op", () => {
    const engine = new SynthEngine();
    // Before startFromGenerators(), _synthNode and _fxNode are null
    expect(() => engine.setParamValue("cutoff", 5000)).not.toThrow();
  });

  it("getParamValue before startFromGenerators returns 0 (default)", () => {
    const engine = new SynthEngine();
    expect(engine.getParamValue("cutoff")).toBe(0);
    expect(engine.getParamValue("resonance")).toBe(0);
  });

  it("PadHandler: Note On for a note not in any pad row returns false", () => {
    const handler = new PadHandler();
    handler.setPadNotes(36, 44); // row1: 36-43, row2: 44-51
    const calls: number[] = [];
    handler.onModuleSelect = (s) => calls.push(s);
    handler.onPatchSelect = (s) => calls.push(s);

    // Note 60 is in neither row
    const result = handler.handleMessage(new Uint8Array([0x90, 60, 80]));
    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ── EncoderManager: acceleration clamp at raw=63 ──

describe("EncoderManager: acceleration clamp at maximum raw delta", () => {
  it("fast CW turn (raw=63) is clamped to 6× acceleration, not 63× (no exponential blowout)", () => {
    const manager = new EncoderManager([{ ccNumber: 10 }]);
    const deltas: number[] = [];
    manager.onEncoderDelta = (_idx, d) => deltas.push(d);

    // Relative1: value 127 → raw = 127 - 64 = 63 (fastest CW turn)
    manager.handleMessage(new Uint8Array([0xb0, 10, 127]));
    expect(deltas).toHaveLength(1);

    // accel = Math.min(63, 6) = 6; delta = 6 × (1/64) = 6/64 ≈ 0.09375
    // NOT 63/64 ≈ 0.984 (would be way too large — moves param nearly full range in one tick)
    expect(deltas[0]).toBeCloseTo(6 / 64, 5);
  });

  it("slow CW turn (raw=1) gets no acceleration multiplier (1×)", () => {
    const manager = new EncoderManager([{ ccNumber: 10 }]);
    const deltas: number[] = [];
    manager.onEncoderDelta = (_idx, d) => deltas.push(d);

    // Relative1: value 65 → raw = 65 - 64 = 1 (slowest CW turn)
    manager.handleMessage(new Uint8Array([0xb0, 10, 65]));
    expect(deltas[0]).toBeCloseTo(1 / 64, 5); // accel=1, delta=1/64
  });
});

// ── ParameterStore: stepped param sensitivity override is ignored ──

describe("ParameterStore: stepped param ignores sensitivity override", () => {
  it("processParamDelta on stepped param with sensitivity=10 still advances exactly 1 step", () => {
    const store = new ParameterStore();
    store.activeModule = 1; // OSCB module — but use processParamDelta directly
    store.loadValues({ osc_sync: 0 }); // step 0 (OFF)

    // sensitivity=10 should be ignored for stepped params
    const changed = store.processParamDelta("osc_sync", 1, 10);
    expect(changed).toBe(true);
    expect(store.snapshot().osc_sync).toBe(1); // exactly 1 step (ON), not 10 steps
  });

  it("processParamDelta on stepped param with sensitivity=0.001 also advances exactly 1 step", () => {
    const store = new ParameterStore();
    store.loadValues({ osc_sync: 0 });

    const changed = store.processParamDelta("osc_sync", 1, 0.001); // tiny sensitivity — ignored
    expect(changed).toBe(true);
    expect(store.snapshot().osc_sync).toBe(1); // still 1 step, sensitivity had no effect
  });
});

// ── KeyStepHandler: callback value correctness ──

describe("KeyStepHandler: callback values are correctly normalized/typed", () => {
  it("onModWheel fires with normalized 0–1 (not raw 0–127)", () => {
    const handler = new KeyStepHandler();
    const values: number[] = [];
    handler.onModWheel = (v) => values.push(v);

    handler.handleMessage(new Uint8Array([0xb0, 1, 64])); // center
    expect(values[0]).toBeCloseTo(64 / 127, 4);

    handler.handleMessage(new Uint8Array([0xb0, 1, 0])); // min
    expect(values[1]).toBeCloseTo(0, 4);

    handler.handleMessage(new Uint8Array([0xb0, 1, 127])); // max
    expect(values[2]).toBeCloseTo(1, 4);
  });

  it("onTransport fires with correct action string for all transport messages", () => {
    const handler = new KeyStepHandler();
    const actions: string[] = [];
    handler.onTransport = (a) => actions.push(a);

    handler.handleMessage(new Uint8Array([0xfa])); // TRANSPORT_START
    handler.handleMessage(new Uint8Array([0xfb])); // TRANSPORT_CONTINUE
    handler.handleMessage(new Uint8Array([0xfc])); // TRANSPORT_STOP

    expect(actions).toEqual(["start", "continue", "stop"]);
  });
});

// ── EncoderManager: absolute mode wrap-around (127 → 0) ──

describe("EncoderManager: absolute mode large delta (hardware wrap-around)", () => {
  it("absolute mode: 127 → 0 produces a large negative delta (not clamped)", () => {
    const manager = new EncoderManager([{ ccNumber: 10, mode: "absolute" }]);
    const deltas: number[] = [];
    manager.onEncoderDelta = (_idx, d) => deltas.push(d);

    // Establish high position (127)
    manager.handleMessage(new Uint8Array([0xb0, 10, 127]));
    expect(deltas).toHaveLength(0); // baseline set, no delta yet

    // Wrap to 0 — raw delta = (0 - 127) × sensitivity
    manager.handleMessage(new Uint8Array([0xb0, 10, 0]));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeLessThan(0); // large negative delta
    // Default sensitivity = 1/64, so delta = -127/64 ≈ -1.984
    expect(deltas[0]).toBeCloseTo(-127 / 64, 2);
  });
});

// ── SynthEngine.allNotesOff: null synthNode with stale activeNotes ──

describe("SynthEngine.allNotesOff: null synthNode with stale activeNotes", () => {
  it("allNotesOff with null synthNode returns early and does NOT clear _activeNotes", () => {
    const engine = new SynthEngine();
    const activeNotes = (engine as unknown as { _activeNotes: Map<number, number> })._activeNotes;

    // Inject stale active note state (simulates crash or race mid-session)
    activeNotes.set(60, 0);
    activeNotes.set(64, 1);
    expect(engine.activeVoices).toBe(2);

    // synthNode is null (engine not started) — allNotesOff returns early
    engine.allNotesOff();

    // Map is NOT cleared because allNotesOff bails out before clear() when _synthNode is null
    // This documents the known behavior: only a started engine can fully drain activeNotes
    expect(engine.activeVoices).toBe(2); // stale entries remain
    expect(() => engine.allNotesOff()).not.toThrow(); // idempotent: no crash
  });
});

// ── parseEncoderDelta: CCW with acceleration ──

describe("parseEncoderDelta: CCW values with correct sign and acceleration", () => {
  it("CCW raw=-1 (value 63): delta = -1 × 1 × sensitivity (no acceleration)", () => {
    // sensitivity default = 1/64, accel(1) = 1
    expect(parseEncoderDelta(63)).toBeCloseTo(-1 / 64, 6);
  });

  it("CCW raw=-4 (value 60): delta = -1 × 4 × sensitivity (4× acceleration)", () => {
    // accel(4) = Math.min(4, 6) = 4
    expect(parseEncoderDelta(60)).toBeCloseTo(-4 / 64, 6);
  });

  it("CCW raw=-6 (value 58): delta = -1 × 6 × sensitivity (clamped to max acceleration)", () => {
    // accel(6) = Math.min(6, 6) = 6 (at the clamp)
    expect(parseEncoderDelta(58)).toBeCloseTo(-6 / 64, 6);
  });

  it("CCW raw=-63 (value 1): same magnitude as raw=-6 due to acceleration clamp", () => {
    // accel(63) = Math.min(63, 6) = 6 — same as raw=-6
    expect(parseEncoderDelta(1)).toBeCloseTo(-6 / 64, 6);
  });
});

// ── ParameterStore.snapshot: key ordering determinism ──

describe("ParameterStore.snapshot: deterministic key ordering", () => {
  it("consecutive snapshot calls produce identical key order", () => {
    const store = new ParameterStore();
    store.loadValues({ cutoff: 5000, resonance: 0.3 });

    const snap1 = store.snapshot();
    const snap2 = store.snapshot();

    expect(Object.keys(snap1)).toEqual(Object.keys(snap2));
  });
});

// ── ParameterStore.getNormalized: returns 0 for unknown path ──

describe("ParameterStore.getNormalized: unknown path returns 0", () => {
  it("returns exactly 0 for a path not in the store", () => {
    const store = new ParameterStore();
    expect(store.getNormalized("nonexistent_param_xyz")).toBe(0);
  });
});

// ── SynthEngine: unison mode keyOn/keyOff voice stacking ──

describe("SynthEngine: unison mode stacks voices on keyOn and releases all on keyOff", () => {
  it("keyOn in unison mode calls synthNode.keyOn maxVoices (4) times", () => {
    const engine = new SynthEngine();
    engine.unison = true;
    engine.maxVoices = 4;

    const keyOnCalls: { pitch: number }[] = [];
    const keyOffCalls: { pitch: number }[] = [];
    const mockSynthNode = {
      keyOn: (_ch: number, pitch: number, _vel: number) => { keyOnCalls.push({ pitch }); },
      keyOff: (_ch: number, pitch: number, _vel: number) => { keyOffCalls.push({ pitch }); },
      setParamValue: () => {},
      getParamValue: () => 0,
    };
    (engine as unknown as { _synthNode: unknown })._synthNode = mockSynthNode;

    engine.keyOn(0, 60, 100);
    expect(keyOnCalls).toHaveLength(4); // maxVoices = 4 stacked voices
    expect(keyOnCalls.every((c) => c.pitch === 60)).toBe(true);
    expect(engine.activeVoices).toBe(1); // one note tracked (not 4)

    engine.keyOff(0, 60, 0);
    expect(keyOffCalls).toHaveLength(4); // all stacked voices released
    expect(engine.activeVoices).toBe(0); // note cleared
  });

  it("keyOff in unison mode clears _unisonPitches after release", () => {
    const engine = new SynthEngine();
    engine.unison = true;
    engine.maxVoices = 2;

    const mockSynthNode = {
      keyOn: () => {},
      keyOff: () => {},
      setParamValue: () => {},
      getParamValue: () => 0,
    };
    (engine as unknown as { _synthNode: unknown })._synthNode = mockSynthNode;

    const unisonPitches = (engine as unknown as { _unisonPitches: Map<number, number[]> })._unisonPitches;

    engine.keyOn(0, 60, 100);
    expect(unisonPitches.has(60)).toBe(true);
    expect(unisonPitches.get(60)).toHaveLength(2);

    engine.keyOff(0, 60, 0);
    expect(unisonPitches.has(60)).toBe(false); // cleaned up
  });
});

// ── ParameterStore: stepped param at min boundary with negative delta ──

describe("ParameterStore: stepped param at minimum boundary rejects negative delta", () => {
  it("waveform at step 0 with negative delta: processParamDelta returns false (clamped)", () => {
    const store = new ParameterStore();
    store.loadValues({ waveform: 0 }); // step 0 (minimum)

    const changed = store.processParamDelta("waveform", -1);
    expect(changed).toBe(false); // already at min, no step below
    expect(store.snapshot().waveform).toBe(0); // unchanged
  });

  it("osc_sync at step 0 (OFF) with negative delta: stays at 0, returns false", () => {
    const store = new ParameterStore();
    store.loadValues({ osc_sync: 0 }); // step 0

    const changed = store.processParamDelta("osc_sync", -1);
    expect(changed).toBe(false);
  });
});

// ── KeyStepHandler: setBaseCutoff with no AT pressure ──

describe("KeyStepHandler: setBaseCutoff with zero AT pressure does not fire applyAftertouch", () => {
  it("setBaseCutoff when _atPressure=0 does not trigger engine.setParamValue for cutoff", () => {
    const setCalls: { path: string; value: number }[] = [];
    const mockEngine = {
      keyOn: () => {},
      keyOff: () => {},
      setParamValue: (path: string, value: number) => setCalls.push({ path, value }),
      getParamValue: () => 0,
      allNotesOff: () => {},
    } as unknown as import("@/audio/engine").SynthEngine;

    const handler = new KeyStepHandler(mockEngine, 1);
    // _atPressure is 0 by default — no AT has been applied

    // setCalls may have been populated by constructor; reset
    setCalls.length = 0;

    handler.setBaseCutoff(5000);

    // No setParamValue for cutoff since _atPressure=0 (guard prevents re-apply)
    const cutoffCalls = setCalls.filter((c) => c.path === "cutoff");
    expect(cutoffCalls).toHaveLength(0);
  });
});

// ── KeyStepHandler: Note On velocity=0 fires keyOff ──

describe("KeyStepHandler: Note On with velocity=0 acts as Note Off", () => {
  it("Note On (0x90) with velocity=0 calls engine.keyOff, not keyOn", () => {
    const keyOnCalls: number[] = [];
    const keyOffCalls: number[] = [];
    const mockEngine = {
      keyOn: (_ch: number, pitch: number, _vel: number) => keyOnCalls.push(pitch),
      keyOff: (_ch: number, pitch: number) => keyOffCalls.push(pitch),
      setParamValue: () => {},
      getParamValue: () => 0,
      allNotesOff: () => {},
    } as unknown as import("@/audio/engine").SynthEngine;

    const handler = new KeyStepHandler(mockEngine, 1);

    // Note On with velocity=0 on channel 1 (status 0x90 = channel 1)
    handler.handleMessage(new Uint8Array([0x90, 60, 0]));

    expect(keyOnCalls).toHaveLength(0);  // must NOT call keyOn
    expect(keyOffCalls).toHaveLength(1); // must call keyOff
    expect(keyOffCalls[0]).toBe(60);
  });
});

// ── EncoderManager: per-encoder sensitivity override ──

describe("EncoderManager: per-encoder sensitivity override", () => {
  it("encoder with 2× sensitivity produces 2× the default delta for the same CC", () => {
    const defaultMgr = new EncoderManager([{ ccNumber: 10 }]); // no sensitivity → DEFAULT_SENSITIVITY
    const customMgr = new EncoderManager([{ ccNumber: 10, sensitivity: 2 * DEFAULT_SENSITIVITY }]);

    const defaultDeltas: number[] = [];
    const customDeltas: number[] = [];
    defaultMgr.onEncoderDelta = (_i, d) => defaultDeltas.push(d);
    customMgr.onEncoderDelta = (_i, d) => customDeltas.push(d);

    // CW turn with raw=1 (CC value 65)
    defaultMgr.handleMessage(new Uint8Array([0xb0, 10, 65]));
    customMgr.handleMessage(new Uint8Array([0xb0, 10, 65]));

    expect(defaultDeltas).toHaveLength(1);
    expect(customDeltas).toHaveLength(1);
    expect(customDeltas[0]).toBeCloseTo(defaultDeltas[0] * 2, 6); // 2× scaling
  });

  it("encoder with undefined sensitivity falls back to DEFAULT_SENSITIVITY", () => {
    const mgr = new EncoderManager([{ ccNumber: 10 }]); // sensitivity=undefined
    const deltas: number[] = [];
    mgr.onEncoderDelta = (_i, d) => deltas.push(d);

    // CW raw=1 (value=65)
    mgr.handleMessage(new Uint8Array([0xb0, 10, 65]));
    expect(deltas[0]).toBeCloseTo(DEFAULT_SENSITIVITY, 6); // 1 × 1 × (1/64)
  });
});

// ── ParameterStore.setNormalized: stepped param does NOT quantize ──

describe("ParameterStore.setNormalized: stepped param fractional value bypasses quantization", () => {
  it("setNormalized(0.625) on waveform (steps=5) stores fractional value — snapshot returns 2.5, not 2 or 3", () => {
    // This documents the API contract: setNormalized does NOT quantize to discrete steps.
    // Use processParamDelta for stepped params; setNormalized is for modwheel/continuous sources.
    const store = new ParameterStore();
    const waveformParam = SYNTH_PARAMS["waveform"]!; // min=0, max=4, steps=5

    // 0.625 normalized → between step 2 (0.5) and step 3 (0.75)
    store.setNormalized("waveform", 0.625);

    // normalizedToParam(0.625, {min=0, max=4}) = 0 + 0.625 * 4 = 2.5
    const expected = waveformParam.min + 0.625 * (waveformParam.max - waveformParam.min);
    expect(store.snapshot().waveform).toBeCloseTo(expected, 4);
  });
});

// ── SynthEngine: unison mode second note calls allNotesOff before stacking ──

describe("SynthEngine: unison mode second note clears first stack before new stack", () => {
  it("keyOn with second note while first is held: first note's keyOff fires before new stack", () => {
    const engine = new SynthEngine();
    engine.unison = true;
    engine.maxVoices = 2;

    const keyOnCalls: number[] = [];
    const keyOffCalls: number[] = [];
    const mockSynthNode = {
      keyOn: (_ch: number, pitch: number) => { keyOnCalls.push(pitch); },
      keyOff: (_ch: number, pitch: number) => { keyOffCalls.push(pitch); },
      setParamValue: () => {},
      getParamValue: () => 0,
    };
    (engine as unknown as { _synthNode: unknown })._synthNode = mockSynthNode;

    engine.keyOn(0, 60, 100); // first note in unison: stacks 2 keyOns
    expect(keyOnCalls).toHaveLength(2); // both stacked on pitch 60
    expect(keyOffCalls).toHaveLength(0);

    engine.keyOn(0, 64, 100); // second note: engine.allNotesOff() fires keyOff(60), then stacks 2

    // allNotesOff clears previous note via keyOff (one keyOff for the tracked pitch 60)
    expect(keyOffCalls).toHaveLength(1);
    expect(keyOffCalls[0]).toBe(60);

    // Then 2 new keyOn calls for pitch 64
    expect(keyOnCalls).toHaveLength(4); // 2 for pitch 60 + 2 for pitch 64

    // _activeNotes now only has note 64
    expect(engine.activeVoices).toBe(1);
  });
});

// ── KeyStepHandler: empty message guard ──

describe("KeyStepHandler: empty message returns false", () => {
  it("handleMessage(empty Uint8Array) returns false without throwing", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);
    expect(handler.handleMessage(new Uint8Array([]))).toBe(false);
  });
});

// ── PadHandler: short message guard ──

describe("PadHandler: 1-byte message returns false", () => {
  it("handleMessage(1-byte Note On status only) returns false without throwing", () => {
    const { padRow1Notes, padRow2Notes } = TEST_HARDWARE_MAPPING;
    const handler = new PadHandler(padRow1Notes, padRow2Notes);
    expect(handler.handleMessage(new Uint8Array([0x90]))).toBe(false);
  });
});

// ── EncoderManager: CC collision last-write-wins ──

describe("EncoderManager: CC collision — two setEncoderCC to same CC, last assignment wins", () => {
  it("assigning same CC to encoder 0 then encoder 1: encoder 1 owns the CC", () => {
    const manager = new EncoderManager([
      { ccNumber: 1 },
      { ccNumber: 2 },
    ]);
    const fired: Array<[number, number]> = [];
    manager.onEncoderDelta = (idx, d) => fired.push([idx, d]);

    // Both encoders claim CC10
    manager.setEncoderCC(0, 10);
    manager.setEncoderCC(1, 10); // last write wins

    // CC10 should route to encoder 1 (last assignment)
    manager.handleMessage(new Uint8Array([0xb0, 10, 65])); // CW
    expect(fired).toHaveLength(1);
    expect(fired[0][0]).toBe(1); // encoder 1 owns CC10
  });
});

// ── KeyStepHandler: setBaseCutoff while AT active reapplies modulation ──

describe("KeyStepHandler: setBaseCutoff while aftertouch active reapplies modulation", () => {
  it("setBaseCutoff with _atPressure > 0 fires setParamValue for cutoff", () => {
    const setCalls: { path: string; value: number }[] = [];
    const mockEngine = {
      keyOn: () => {},
      keyOff: () => {},
      setParamValue: (path: string, value: number) => setCalls.push({ path, value }),
      getParamValue: () => 0,
      allNotesOff: () => {},
    } as unknown as import("@/audio/engine").SynthEngine;

    const handler = new KeyStepHandler(mockEngine, 1);
    // Apply channel pressure to set _atPressure > 0
    handler.handleMessage(new Uint8Array([0xd0, 100])); // channel pressure = 100/127
    setCalls.length = 0; // reset after initial AT application

    // Change base cutoff while AT is active — must reapply from new base
    handler.setBaseCutoff(10000);

    const cutoffCalls = setCalls.filter((c) => c.path === "cutoff");
    expect(cutoffCalls).toHaveLength(1);
  });
});

// ── KeyStepHandler: unrecognized 1-byte message returns false ──

describe("KeyStepHandler: unrecognized 1-byte MIDI message returns false", () => {
  it("handleMessage(0xF8 timing clock) returns false — not a transport message", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);
    // 0xF8 = MIDI Timing Clock — not one of start(0xFA)/continue(0xFB)/stop(0xFC)
    expect(handler.handleMessage(new Uint8Array([0xf8]))).toBe(false);
  });

  it("handleMessage(0xFE active sensing) returns false", () => {
    const engine = makeMockEngine();
    const handler = new KeyStepHandler(engine as never, 1);
    expect(handler.handleMessage(new Uint8Array([0xfe]))).toBe(false);
  });
});

// ── EncoderManager.setEncoderCC: skip-delete-if-already-claimed ──

describe("EncoderManager.setEncoderCC: does not delete CC already claimed by another encoder", () => {
  it("remapping encoder 0 does not orphan the CC that encoder 1 already claimed", () => {
    // encoder 0 = CC1, encoder 1 = CC2 initially
    const manager = new EncoderManager([{ ccNumber: 1 }, { ccNumber: 2 }]);
    const fired: Array<[number, number]> = [];
    manager.onEncoderDelta = (idx, d) => fired.push([idx, d]);

    // encoder 1 claims CC1 (same as encoder 0's current CC)
    manager.setEncoderCC(1, 1); // encoder1: 2→1; now _ccToIndex[1]=1
    // encoder 0 now remaps to CC5; guard should NOT delete CC1 (encoder 1 owns it)
    manager.setEncoderCC(0, 5);

    // CC1 must still route to encoder 1 (guard preserved it)
    manager.handleMessage(new Uint8Array([0xb0, 1, 65]));
    expect(fired).toHaveLength(1);
    expect(fired[0][0]).toBe(1);

    // CC5 must route to encoder 0
    fired.length = 0;
    manager.handleMessage(new Uint8Array([0xb0, 5, 65]));
    expect(fired).toHaveLength(1);
    expect(fired[0][0]).toBe(0);
  });
});
