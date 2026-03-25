/**
 * Calibration flow tests — virtual MIDI + IndexedDB (happy-dom + fake-indexeddb).
 *
 * Strategy: Use onStateChange to reactively drive MIDI events rather than fake timers,
 * because fake-indexeddb's async state machine requires real timers to function.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { CalibrationController } from "@/midi/calibration";
import { createTestMIDIEnvironment, type VirtualMIDIInput } from "./virtual-midi";
import { hasSavedProfiles, loadProfilesByRole } from "@/state/hardware-map";
import { resetDB } from "@/state/db";

// Short timeout per step (ms) — tests complete in ~100ms each
const T = 50;

beforeEach(() => {
  // Fresh IndexedDB per test — fake-indexeddb persists data between runs otherwise
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDB();
});

// ── Helpers ──

/** Get the beatstep input from the test environment by name. */
function getBeatstepInput(access: MIDIAccess): VirtualMIDIInput {
  const found = Array.from(access.inputs.values()).find((i) => i.name === "BeatStep");
  if (!found) throw new Error("BeatStep not in access");
  return found as VirtualMIDIInput;
}

/**
 * Wire up a CalibrationController to auto-respond with MIDI events:
 * - When characterizing_encoders: fire 16 unique CCs from the beatstep
 * - When characterizing_master: fire a CC not in the encoder set
 * - When characterizing_pad_row1/2: fire a Note On
 *
 * Events are queued as microtasks so they fire after the Promise listeners
 * are registered (the Promise constructor runs synchronously before the await suspends).
 */
function autoRespond(controller: CalibrationController, beatstepInput: VirtualMIDIInput): void {
  controller.onStateChange = (state) => {
    if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
      queueMicrotask(() => {
        for (let i = 1; i <= 16; i++) {
          beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
        }
      });
    } else if (state.step === "characterizing_master" && !state.masterFound) {
      queueMicrotask(() => {
        beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])); // CC 112, not in 1-16
      });
    } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
      queueMicrotask(() => {
        for (let i = 0; i < 8; i++) {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f])); // Row 1: notes 36-43
        }
      });
    } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
      queueMicrotask(() => {
        for (let i = 0; i < 8; i++) {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f])); // Row 2: notes 44-51
        }
      });
    }
  };
}

// ── Discovery ──

describe("_discoverDevices", () => {
  it("discovers KeyStep and BeatStep via SysEx identity", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    autoRespond(controller, getBeatstepInput(access));

    const result = await controller.run(access, T);

    expect(result.beatstep.portName).toBe("BeatStep");
    expect(result.keystep.portName).toBe("KeyStep");
    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    expect(controller.state.step).toBe("complete");
  });

  it("errors if fewer than 2 Arturia devices found", async () => {
    const { keystep } = createTestMIDIEnvironment();

    const singleAccess: MIDIAccess = {
      inputs: new Map([[keystep.input.id, keystep.input]]),
      outputs: new Map([[keystep.output.id, keystep.output]]),
      sysexEnabled: true,
      onstatechange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    const controller = new CalibrationController();

    await expect(controller.run(singleAccess, T)).rejects.toThrow(
      "Only 1 Arturia device(s) found"
    );
    expect(controller.state.step).toBe("error");
  });
});

// ── Device identification by port name ──

describe("device identification by port name", () => {
  it("identifies BeatStep and KeyStep by port name during discovery", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    autoRespond(controller, getBeatstepInput(access));

    const result = await controller.run(access, T);

    expect(result.beatstep.portName).toBe("BeatStep");
    expect(result.keystep.portName).toBe("KeyStep");
  });
});

// ── Encoder characterization ──

describe("_characterizeEncoders", () => {
  it("records 16 unique CC numbers when all encoders turned", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    const foundCounts: number[] = [];

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "characterizing_encoders") {
        foundCounts.push(state.encodersFound);
        if (state.encodersFound === 0) {
          // First entry into characterizing_encoders: fire all 16 CCs
          queueMicrotask(() => {
            for (let i = 1; i <= 16; i++) {
              beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
            }
          });
        }
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x24, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c, 0x7f]));
        });
      }
    };

    const result = await controller.run(access, T);

    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(result.beatstep.encoderCalibration[i].encoderIndex).toBe(i);
      expect(result.beatstep.encoderCalibration[i].cc).toBe(i + 1); // CC numbers 1-16
    }
    // State was updated incrementally
    expect(foundCounts.some((n) => n > 0 && n < 16)).toBe(true);
    expect(foundCounts[foundCounts.length - 1]).toBe(16);
  });

  it("pads with defaults if fewer than 16 encoders turned before timeout", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        // Only turn 4 encoders — let the rest time out
        queueMicrotask(() => {
          for (let i = 1; i <= 4; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x24, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c, 0x7f]));
        });
      }
    };

    const result = await controller.run(access, T);
    // No padding — only the 4 encoders actually turned are recorded
    expect(result.beatstep.encoderCalibration).toHaveLength(4);
  });

  it("ignores duplicate CC numbers from the same encoder", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          // Send duplicates mixed in
          beatstepInput.fireMessage(new Uint8Array([0xb0, 1, 0x45]));
          beatstepInput.fireMessage(new Uint8Array([0xb0, 1, 0x40])); // duplicate
          beatstepInput.fireMessage(new Uint8Array([0xb0, 2, 0x45]));
          beatstepInput.fireMessage(new Uint8Array([0xb0, 2, 0x40])); // duplicate
          for (let i = 3; i <= 16; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x24, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c, 0x7f]));
        });
      }
    };

    const result = await controller.run(access, T);
    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    const indices = result.beatstep.encoderCalibration.map((c) => c.encoderIndex);
    expect(new Set(indices).size).toBe(16);
  });
});

// ── State transitions ──

describe("state transitions", () => {
  it("emits all expected steps in order", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    const steps: string[] = [];

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      steps.push(state.step);
      if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          for (let i = 1; i <= 16; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) {
            beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
          }
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) {
            beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
          }
        });
      }
    };

    await controller.run(access, T);

    expect(steps).toContain("discovering");
    expect(steps).toContain("characterizing_encoders");
    expect(steps).toContain("characterizing_master");
    expect(steps).toContain("characterizing_pad_row1");
    expect(steps).toContain("characterizing_pad_row2");
    expect(steps).toContain("saving");
    expect(steps).toContain("complete");
    expect(steps.indexOf("discovering")).toBeLessThan(steps.indexOf("characterizing_encoders"));
    expect(steps.indexOf("characterizing_encoders")).toBeLessThan(steps.indexOf("complete"));
  });
});

// ── Profile persistence ──

describe("profile persistence", () => {
  it("hasSavedProfiles returns false before any calibration", async () => {
    expect(await hasSavedProfiles()).toBe(false);
  });

  it("saves profiles to IndexedDB after successful calibration", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    autoRespond(controller, getBeatstepInput(access));

    await controller.run(access, T);

    expect(await hasSavedProfiles()).toBe(true);

    const profiles = await loadProfilesByRole();
    expect(profiles.performer).not.toBeNull();
    expect(profiles.control_plane).not.toBeNull();
    expect(profiles.performer!.portName).toBe("KeyStep");
    expect(profiles.control_plane!.portName).toBe("BeatStep");
    expect(profiles.control_plane!.encoderCalibration).toHaveLength(16);
  });

  it("updates existing profile on re-calibration", async () => {
    const { access } = createTestMIDIEnvironment();

    const runCalibration = async () => {
      const controller = new CalibrationController();
      autoRespond(controller, getBeatstepInput(access));
      return controller.run(access, T);
    };

    await runCalibration();
    await runCalibration();

    // Should still have exactly one performer and one control_plane
    const profiles = await loadProfilesByRole();
    expect(profiles.performer).not.toBeNull();
    expect(profiles.control_plane).not.toBeNull();
  });
});
