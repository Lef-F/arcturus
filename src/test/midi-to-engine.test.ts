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
