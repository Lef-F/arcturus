/**
 * Integration tests — MIDIManager, CalibrationView rendering, fingerprint functions,
 * BeatStep profile persistence, and end-to-end routing wiring.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { MIDIManager } from "@/midi/manager";
import {
  isArturiaIdentityReply,
  identifyDevice,
  parseIdentityReply,
  identifyByPortName,
  BEATSTEP_MODEL_CODE,
} from "@/midi/fingerprint";
import { persistBeatStepProfile, loadBeatStepProfile, hasSavedBeatStepProfile, profileToMapping } from "@/state/hardware-map";
import { resetDB } from "@/state/db";
import { CalibrationView } from "@/ui/calibration-view";
import { ConfigView } from "@/ui/config-view";
import { NoteHandler } from "@/control/note-handler";
import { ControlMapper } from "@/control/mapper";
import { ParameterStore } from "@/audio/params";
import { SynthEngine } from "@/audio/engine";
import {
  createTestMIDIEnvironment,
  type VirtualMIDIInput,
  type VirtualMIDIAccess,
} from "./virtual-midi";
import { TEST_BEATSTEP_MAPPING } from "./helpers";

// ── MIDIManager ──

describe("MIDIManager", () => {
  let env: ReturnType<typeof createTestMIDIEnvironment>;

  beforeEach(() => {
    env = createTestMIDIEnvironment();
  });

  it("discoverDevices returns an empty state before access is set", async () => {
    const mgr = new MIDIManager();
    const result = await mgr.discoverDevices(10);
    expect(result.hasBeatstep).toBe(false);
    expect(result.noteSourceNames).toEqual([]);
  });

  it("discoverDevices identifies BeatStep and lists everything else as note sources", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    const result = await mgr.discoverDevices(50);
    expect(result.hasBeatstep).toBe(true);
    expect(result.noteSourceNames).toContain("KeyStep");
  });

  it("fires onDevicesChanged callback after discovery", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    const states: Array<{ hasBeatstep: boolean; noteSourceNames: string[] }> = [];
    mgr.onDevicesChanged = (state) => states.push(state);

    await mgr.discoverDevices(50);
    expect(states.length).toBeGreaterThan(0);
    expect(states[states.length - 1].hasBeatstep).toBe(true);
  });

  it("routes messages to onNoteSourceMessage from non-BeatStep inputs", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    await mgr.discoverDevices(50);

    const messages: Uint8Array[] = [];
    mgr.onNoteSourceMessage = (data: Uint8Array) => messages.push(data);

    const keystepInput = env.keystep.input as VirtualMIDIInput;
    keystepInput.fireMessage(new Uint8Array([0x90, 60, 100]));

    expect(messages.length).toBe(1);
    expect(messages[0][0]).toBe(0x90);
  });

  it("routes messages to onBeatstepMessage from the BeatStep input", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    await mgr.discoverDevices(50);

    const messages: Uint8Array[] = [];
    mgr.onBeatstepMessage = (data: Uint8Array) => messages.push(data);

    const beatstepInput = env.beatstep.input as VirtualMIDIInput;
    beatstepInput.fireMessage(new Uint8Array([0xb0, 1, 70]));

    expect(messages.length).toBe(1);
  });

  it("sendToBeatstep does not throw when no output is assigned", () => {
    const mgr = new MIDIManager();
    expect(() => mgr.sendToBeatstep(new Uint8Array([0xb0, 1, 64]))).not.toThrow();
  });

  it("getters return null before discovery", () => {
    const mgr = new MIDIManager();
    expect(mgr.beatstepInput).toBeNull();
    expect(mgr.beatstepOutput).toBeNull();
    expect(mgr.access).toBeNull();
    expect(mgr.noteSourceCount).toBe(0);
  });
});

// ── fingerprint.ts — isArturiaIdentityReply ──

describe("isArturiaIdentityReply", () => {
  const validReply = new Uint8Array([
    0xf0, 0x7e, 0x01, 0x06, 0x02, 0x00, 0x20, 0x6b, 0x02, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0xf7,
  ]);

  it("returns true for a valid Arturia reply", () => {
    expect(isArturiaIdentityReply(validReply)).toBe(true);
  });

  it("returns false when too short", () => {
    expect(isArturiaIdentityReply(new Uint8Array([0xf0, 0x7e]))).toBe(false);
  });

  it("returns false when status byte is wrong", () => {
    const bad = Uint8Array.from(validReply);
    bad[0] = 0xf1;
    expect(isArturiaIdentityReply(bad)).toBe(false);
  });

  it("returns false when universal byte is wrong", () => {
    const bad = Uint8Array.from(validReply);
    bad[1] = 0x00;
    expect(isArturiaIdentityReply(bad)).toBe(false);
  });

  it("returns false when manufacturer byte is wrong", () => {
    const bad = Uint8Array.from(validReply);
    bad[5] = 0x01;
    expect(isArturiaIdentityReply(bad)).toBe(false);
  });

  it("returns false when not terminated with 0xf7", () => {
    const bad = Uint8Array.from(validReply);
    bad[bad.length - 1] = 0x00;
    expect(isArturiaIdentityReply(bad)).toBe(false);
  });
});

// ── fingerprint.ts — identifyDevice ──

describe("identifyDevice", () => {
  it("returns null for unknown model code", () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0xff, 0x00] as [number, number],
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    expect(identifyDevice(fp)).toBeNull();
  });

  it("returns null for a KeyStep model code (KeyStep is treated as a generic note source)", () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0x04, 0x00] as [number, number], // legacy KeyStep model code
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    expect(identifyDevice(fp)).toBeNull();
  });

  it("identifies BeatStep via BEATSTEP_MODEL_CODE", () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: BEATSTEP_MODEL_CODE,
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    expect(identifyDevice(fp)).toBe("beatstep");
  });
});

describe("parseIdentityReply", () => {
  it("extracts all fingerprint fields from correct byte positions", () => {
    const reply = new Uint8Array([
      0xf0, 0x7e, 0x01, 0x06, 0x02,
      0x00, 0x20, 0x6b,        // manufacturerId [5,6,7]
      0x02, 0x00,              // familyCode [8,9]
      0x05, 0x00,              // modelCode [10,11] = BeatStep
      0x01, 0x02, 0x03, 0x04, // firmwareVersion [12,13,14,15]
      0xf7,
    ]);

    const fp = parseIdentityReply(reply);
    expect(fp.manufacturerId).toEqual([0x00, 0x20, 0x6b]);
    expect(fp.familyCode).toEqual([0x02, 0x00]);
    expect(fp.modelCode).toEqual([0x05, 0x00]);
    expect(fp.firmwareVersion).toEqual([0x01, 0x02, 0x03, 0x04]);
  });
});

// ── CalibrationView rendering ──

describe("CalibrationView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renderState discovering shows hint", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "discovering", error: null, encoderCCs: [], encodersFound: 0, masterFound: false, padsFound: 0, padRow: 1 });
    expect(container.querySelector(".calibration-hint")).not.toBeNull();
  });

  it("renderState characterizing_encoders shows progress with encoder count", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "characterizing_encoders", error: null, encoderCCs: [], encodersFound: 4, masterFound: false, padsFound: 0, padRow: 1 });
    expect(container.querySelector(".calibration-title")?.textContent).toBeTruthy();
    expect(container.innerHTML).toContain("5"); // shows encoder count+1 (next to turn)
  });

  it("renderState complete fires onComplete via auto-proceed", async () => {
    const view = new CalibrationView(container);
    let completed = false;
    view.onComplete = () => { completed = true; };
    view.renderState({ step: "complete", error: null, encoderCCs: [], encodersFound: 16, masterFound: true, padsFound: 0, padRow: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(completed).toBe(true);
  });

  it("renderState error shows error message and skip option", () => {
    const view = new CalibrationView(container);
    view.renderState({
      step: "error",
      error: "Connection failed",
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });
    expect(container.innerHTML).toContain("Connection failed");
    expect(container.querySelector(".calibration-view--error")).not.toBeNull();
    expect(container.querySelector("#calibration-skip-btn")).not.toBeNull();
  });

  it("renderState characterizing_encoders with 16 found shows all learned", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "characterizing_encoders", error: null, encoderCCs: [], encodersFound: 16, masterFound: true, padsFound: 0, padRow: 1 });
    expect(container.innerHTML).toContain("17 of 17 learned");
  });
});

// ── ConfigView keyboard shortcuts ──

describe("ConfigView keyboard shortcuts", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("Escape key hides visible config view", () => {
    const cv = new ConfigView(container);
    cv.show();
    const panel = container.querySelector<HTMLElement>(".config-panel");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });

  it("Ctrl+, shows hidden config view then hides it again", () => {
    const cv = new ConfigView(container);
    void cv;
    const panel = container.querySelector<HTMLElement>(".config-panel");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(panel?.hasAttribute("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });
});

// ── BeatStep profile persistence ──

describe("BeatStep profile persistence", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
    resetDB();
  });

  it("hasSavedBeatStepProfile returns false when DB is empty", async () => {
    expect(await hasSavedBeatStepProfile()).toBe(false);
  });

  it("persists and reloads a BeatStep profile", async () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: BEATSTEP_MODEL_CODE,
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    await persistBeatStepProfile(fp, "BeatStep", TEST_BEATSTEP_MAPPING, []);

    expect(await hasSavedBeatStepProfile()).toBe(true);
    const profile = await loadBeatStepProfile();
    expect(profile).not.toBeNull();
    expect(profile!.portName).toBe("BeatStep");
    expect(profileToMapping(profile!)).toEqual(TEST_BEATSTEP_MAPPING);
  });

  it("re-persisting under the same port name updates in place (no duplicate)", async () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: BEATSTEP_MODEL_CODE,
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    await persistBeatStepProfile(fp, "BeatStep", TEST_BEATSTEP_MAPPING, []);
    const updated = { ...TEST_BEATSTEP_MAPPING, masterCC: 99 };
    await persistBeatStepProfile(fp, "BeatStep", updated, []);

    const profile = await loadBeatStepProfile();
    expect(profile).not.toBeNull();
    expect(profile!.mapping.masterCC).toBe(99);
  });
});

// ── identifyByPortName ──

describe("identifyByPortName", () => {
  it("identifies BeatStep by exact name", () => {
    expect(identifyByPortName("BeatStep")).toBe("beatstep");
  });

  it("identifies BeatStep with space variant", () => {
    expect(identifyByPortName("Arturia Beat Step")).toBe("beatstep");
  });

  it("returns null for KeyStep (KeyStep is no longer special-cased)", () => {
    expect(identifyByPortName("KeyStep")).toBeNull();
  });

  it("returns null for unknown port name", () => {
    expect(identifyByPortName("Unknown Device")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(identifyByPortName("")).toBeNull();
  });
});

// ── MIDIManager port-name fallback ──

describe("MIDIManager port-name fallback for BeatStep", () => {
  it("identifies BeatStep via port name when SysEx times out", async () => {
    const { VirtualMIDIInput, VirtualMIDIOutput, VirtualMIDIAccess } =
      await import("./virtual-midi");

    const opts = { id: "bs-no-sysex", name: "BeatStep", manufacturer: "Arturia", version: "1.0" };
    const bsInput  = new VirtualMIDIInput(opts);
    const bsOutput = new VirtualMIDIOutput(opts); // no _onSend → no SysEx auto-reply
    const access   = new VirtualMIDIAccess([{ input: bsInput, output: bsOutput }]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    const state = await mgr.discoverDevices(10);

    expect(state.hasBeatstep).toBe(true);
  });
});

// ── SynthEngine.allNotesOff ──

describe("SynthEngine.allNotesOff", () => {
  it("calls keyOff for each active note and clears the map", () => {
    const engine = new SynthEngine();
    const keyOffCalls: Array<[number, number, number]> = [];
    engine._testSynthNode = {
      setParamValue: () => {},
      getParamValue: () => 0,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      keyOn: (_ch, _p, _v) => {},
      keyOff: (ch, p, v) => { keyOffCalls.push([ch, p, v]); },
    };
    engine._testFxNode = {
      setParamValue: () => {},
      getParamValue: () => 0,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    };

    (engine as unknown as { _activeNotes: Map<number, number> })._activeNotes.set(60, 1);
    (engine as unknown as { _activeNotes: Map<number, number> })._activeNotes.set(64, 1);
    (engine as unknown as { _activeNotes: Map<number, number> })._activeNotes.set(67, 1);

    (engine as unknown as { _synthNode: typeof engine._testSynthNode })._synthNode = engine._testSynthNode;

    engine.allNotesOff();

    expect(keyOffCalls).toHaveLength(3);
    expect(engine.activeVoices).toBe(0);
  });

  it("does nothing when no notes are active", () => {
    const engine = new SynthEngine();
    expect(() => engine.allNotesOff()).not.toThrow();
  });
});

// ── End-to-end MIDI routing smoke test ──

describe("full MIDI routing: NoteHandler → engine, BeatStep → mapper → store", () => {
  it("routing chain connects without errors", () => {
    const manager = new MIDIManager();
    const noteHandler = new NoteHandler();
    const encoderStates = TEST_BEATSTEP_MAPPING.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, TEST_BEATSTEP_MAPPING.masterCC);
    const store = new ParameterStore();
    const engine = new SynthEngine();

    mapper.setStore(store);
    store.onParamChange = (path, value) => engine.setParamValue(path, value);
    noteHandler.setEngine(engine);
    manager.onNoteSourceMessage = (data: Uint8Array) => noteHandler.handleMessage(data);
    manager.onBeatstepMessage = (data: Uint8Array) => mapper.handleMessage(data);

    expect(manager).toBeDefined();
    expect(noteHandler).toBeDefined();
    expect(mapper).toBeDefined();
    expect(store).toBeDefined();
    expect(engine).toBeDefined();
  });
});
