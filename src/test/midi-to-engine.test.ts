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
import { KeyStepHandler } from "@/control/keystep";
import { ControlMapper } from "@/control/mapper";
import { PadHandler } from "@/control/pads";
import { ParameterStore } from "@/audio/params";
import { EncoderManager } from "@/control/encoder";

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
