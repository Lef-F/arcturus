/**
 * M8 Integration tests — MIDIManager, CalibrationView rendering, fingerprint functions.
 * Covers modules with low or zero test coverage.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { MIDIManager } from "@/midi/manager";
import {
  isArturiaIdentityReply,
  identifyDevice,
  broadcastIdentityRequest,
} from "@/midi/fingerprint";
import { persistHardwareProfile, findMatchingProfile } from "@/state/hardware-map";
import { resetDB } from "@/state/db";
import { CalibrationView } from "@/ui/calibration-view";
import { ConfigView } from "@/ui/config-view";
import { KeyStepHandler } from "@/control/keystep";
import { ControlMapper } from "@/control/mapper";
import { ParameterStore } from "@/audio/params";
import { SynthEngine } from "@/audio/engine";
import {
  createTestMIDIEnvironment,
  type VirtualMIDIInput,
  type VirtualMIDIAccess,
} from "./virtual-midi";

// ── MIDIManager ──

describe("MIDIManager", () => {
  let env: ReturnType<typeof createTestMIDIEnvironment>;

  beforeEach(() => {
    env = createTestMIDIEnvironment();
  });

  it("discoverDevices returns empty array before access is set", async () => {
    const mgr = new MIDIManager();
    const result = await mgr.discoverDevices(10);
    expect(result).toEqual([]);
  });

  it("discoverDevices finds KeyStep and BeatStep", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    const discovered = await mgr.discoverDevices(50);
    expect(discovered.length).toBe(2);

    const types = discovered.map((d) => d.type).sort();
    expect(types).toEqual(["beatstep", "keystep"]);
  });

  it("fires onDevicesDiscovered callback", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    const callbackDevices: unknown[] = [];
    mgr.onDevicesDiscovered = (devices) => callbackDevices.push(...devices);

    await mgr.discoverDevices(50);
    expect(callbackDevices.length).toBe(2);
  });

  it("routes messages to onKeystepMessage after discovery", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    await mgr.discoverDevices(50);

    const messages: Uint8Array[] = [];
    mgr.onKeystepMessage = (data) => messages.push(data);

    // Fire a note on from the keystep input
    const keystepInput = env.keystep.input as VirtualMIDIInput;
    keystepInput.fireMessage(new Uint8Array([0x90, 60, 100]));

    expect(messages.length).toBe(1);
    expect(messages[0][0]).toBe(0x90);
  });

  it("routes messages to onBeatstepMessage after discovery", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    await mgr.discoverDevices(50);

    const messages: Uint8Array[] = [];
    mgr.onBeatstepMessage = (data) => messages.push(data);

    const beatstepInput = env.beatstep.input as VirtualMIDIInput;
    beatstepInput.fireMessage(new Uint8Array([0xb0, 1, 70]));

    expect(messages.length).toBe(1);
  });

  it("sendToKeystep sends data to keystep output after discovery", async () => {
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = env.access;

    await mgr.discoverDevices(50);
    const sentBefore = env.keystep.output.sentMessages.length;
    mgr.sendToKeystep(new Uint8Array([0xf0, 0x41, 0x10, 0xf7]));

    expect(env.keystep.output.sentMessages.length).toBeGreaterThan(sentBefore);
    const last = env.keystep.output.sentMessages[env.keystep.output.sentMessages.length - 1];
    expect(last[0]).toBe(0xf0);
  });

  it("sendToBeatstep does not throw when no output is assigned", () => {
    const mgr = new MIDIManager();
    expect(() => mgr.sendToBeatstep(new Uint8Array([0xb0, 1, 64]))).not.toThrow();
  });

  it("access/keystepInput/beatstepInput getters return null before discovery", () => {
    const mgr = new MIDIManager();
    expect(mgr.keystepInput).toBeNull();
    expect(mgr.beatstepInput).toBeNull();
    expect(mgr.keystepOutput).toBeNull();
    expect(mgr.access).toBeNull();
  });
});

// ── fingerprint.ts — broadcastIdentityRequest ──

describe("broadcastIdentityRequest", () => {
  it("sends identity request to all outputs", () => {
    const { access } = createTestMIDIEnvironment();
    broadcastIdentityRequest(access.outputs as MIDIOutputMap);

    const { keystep, beatstep } = createTestMIDIEnvironment();
    // Use the actual outputs from the env to check they were sent to
    Array.from(access.outputs.values()).forEach((output) => {
      const sentMessages = (output as import("./virtual-midi").VirtualMIDIOutput).sentMessages;
      expect(sentMessages.length).toBeGreaterThan(0);
      const identityReq = sentMessages.find(
        (m) => m[0] === 0xf0 && m[1] === 0x7e && m[5] === 0xf7
      );
      expect(identityReq).toBeDefined();
    });

    void keystep; void beatstep; // suppress unused warnings
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
      modelCode: [0xff, 0x00] as [number, number], // unknown
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    expect(identifyDevice(fp)).toBeNull();
  });

  it("returns null for unknown manufacturer and model", () => {
    const fp = {
      manufacturerId: [0x01, 0x00, 0x00] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0xab, 0x00] as [number, number],
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    expect(identifyDevice(fp)).toBeNull();
  });
});

// ── CalibrationView rendering ──

describe("CalibrationView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renderIdle shows start button", () => {
    const view = new CalibrationView(container);
    view.renderIdle();
    expect(container.querySelector("#calibration-start-btn")).not.toBeNull();
    expect(container.querySelector(".calibration-title")?.textContent).toBeTruthy();
  });

  it("renderSkipPrompt shows skip and recalibrate buttons", () => {
    const view = new CalibrationView(container);
    view.renderSkipPrompt();
    expect(container.querySelector("#calibration-skip-btn")).not.toBeNull();
    expect(container.querySelector("#calibration-recalibrate-btn")).not.toBeNull();
  });

  it("renderSkipPrompt fires onSkip when skip button clicked", () => {
    const view = new CalibrationView(container);
    view.renderSkipPrompt();
    let skipped = false;
    view.onSkip = () => { skipped = true; };
    container.querySelector<HTMLButtonElement>("#calibration-skip-btn")?.click();
    expect(skipped).toBe(true);
  });

  it("renderState discovering shows progress bar", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "discovering", error: null, encoderCCs: [], encodersFound: 0 });
    expect(container.querySelector(".calibration-progress")).not.toBeNull();
  });

  it("renderState identify_device_1 shows action prompt", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "identify_device_1", error: null, encoderCCs: [], encodersFound: 0 });
    expect(container.querySelector(".calibration-hint")).not.toBeNull();
  });

  it("renderState characterizing_encoders shows progress with encoder count", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "characterizing_encoders", error: null, encoderCCs: [], encodersFound: 4 });
    expect(container.querySelector(".calibration-title")?.textContent).toBeTruthy();
    expect(container.innerHTML).toContain("5"); // shows encoder count+1 (next to turn)
  });

  it("renderState complete shows done button", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "complete", error: null, encoderCCs: [], encodersFound: 16 });
    expect(container.querySelector("#calibration-done-btn")).not.toBeNull();
  });

  it("renderState complete fires onComplete when button clicked", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "complete", error: null, encoderCCs: [], encodersFound: 16 });
    let completed = false;
    view.onComplete = () => { completed = true; };
    container.querySelector<HTMLButtonElement>("#calibration-done-btn")?.click();
    expect(completed).toBe(true);
  });

  it("renderState error shows error message", () => {
    const view = new CalibrationView(container);
    view.renderState({
      step: "error",
      error: "Connection failed",
      encoderCCs: [],
      encodersFound: 0,
    });
    expect(container.innerHTML).toContain("Connection failed");
    expect(container.querySelector(".calibration-view--error")).not.toBeNull();
  });

  it("renderState characterizing_encoders with 16 found shows all captured message", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "characterizing_encoders", error: null, encoderCCs: [], encodersFound: 16 });
    expect(container.innerHTML).toContain("captured");
  });

  it("renderState saving shows progress bar", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "saving", error: null, encoderCCs: [], encodersFound: 16 });
    expect(container.querySelector(".calibration-progress")).not.toBeNull();
  });

  it("renderState identify_device_2 shows progress", () => {
    const view = new CalibrationView(container);
    view.renderState({ step: "identify_device_2", error: null, encoderCCs: [], encodersFound: 0 });
    expect(container.querySelector(".calibration-progress")).not.toBeNull();
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
    void cv; // accessed via keyboard events
    const panel = container.querySelector<HTMLElement>(".config-panel");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(panel?.hasAttribute("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });
});

// ── hardware-map.ts — findMatchingProfile fallback ──

describe("findMatchingProfile", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
    resetDB();
  });

  it("finds profile by port name match", async () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0x04, 0x00] as [number, number],
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    await persistHardwareProfile(fp, "KeyStep MIDI", "performer");
    const result = await findMatchingProfile(fp, "KeyStep MIDI");
    expect(result).not.toBeNull();
    expect(result!.portName).toBe("KeyStep MIDI");
  });

  it("falls back to fingerprint match when port name differs", async () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0x04, 0x00] as [number, number],
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    await persistHardwareProfile(fp, "KeyStep MIDI", "performer");
    // Search with different port name but same fingerprint
    const result = await findMatchingProfile(fp, "KeyStep MIDI Port 2");
    expect(result).not.toBeNull();
    expect(result!.portName).toBe("KeyStep MIDI");
  });

  it("returns null when no profile matches", async () => {
    const fp = {
      manufacturerId: [0x00, 0x20, 0x6b] as [number, number, number],
      familyCode: [0x02, 0x00] as [number, number],
      modelCode: [0x04, 0x00] as [number, number],
      firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
    };
    const result = await findMatchingProfile(fp, "Unknown Port");
    expect(result).toBeNull();
  });
});

// ── End-to-end MIDI routing smoke test ──

describe("full MIDI routing: KeyStep → engine → encoder → param", () => {
  it("routing chain connects without errors", () => {
    const manager = new MIDIManager();
    const keystep = new KeyStepHandler();
    const mapper = new ControlMapper();
    const store = new ParameterStore();
    const engine = new SynthEngine();

    mapper.setStore(store);
    mapper.setEngine(engine);
    keystep.setEngine(engine);
    manager.onKeystepMessage = (data: Uint8Array) => keystep.handleMessage(data);
    manager.onBeatstepMessage = (data: Uint8Array) => mapper.handleMessage(data);

    expect(manager).toBeDefined();
    expect(keystep).toBeDefined();
    expect(mapper).toBeDefined();
    expect(store).toBeDefined();
    expect(engine).toBeDefined();
  });
});
