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
  controller.settleMs = 0; // skip delays in tests
  controller.onStateChange = (state) => {
    if (state.step === "waiting_to_begin") {
      queueMicrotask(() => {
        beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])); // any CC to begin
      });
    } else if (state.step === "characterizing_master" && !state.masterFound) {
      queueMicrotask(() => {
        beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])); // CC 112 = master
      });
    } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
      queueMicrotask(() => {
        for (let i = 1; i <= 16; i++) {
          beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
        }
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
}

// ── Discovery ──

describe("_discoverDevices", () => {
  it("discovers KeyStep and BeatStep via SysEx identity", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;
    autoRespond(controller, getBeatstepInput(access));

    const result = await controller.run(access);

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
    controller.settleMs = 0;

    await expect(controller.run(singleAccess)).rejects.toThrow(
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
    controller.settleMs = 0;
    autoRespond(controller, getBeatstepInput(access));

    const result = await controller.run(access);

    expect(result.beatstep.portName).toBe("BeatStep");
    expect(result.keystep.portName).toBe("KeyStep");
  });
});

// ── Encoder characterization ──

describe("_characterizeEncoders", () => {
  it("records 16 unique CC numbers when all encoders turned", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;
    const foundCounts: number[] = [];

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])));
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])));
      } else if (state.step === "characterizing_encoders") {
        foundCounts.push(state.encodersFound);
        if (state.encodersFound === 0) {
          // First entry into characterizing_encoders: fire all 16 CCs
          queueMicrotask(() => {
            for (let i = 1; i <= 16; i++) {
              beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
            }
          });
        }
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    const result = await controller.run(access);

    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(result.beatstep.encoderCalibration[i].encoderIndex).toBe(i);
      expect(result.beatstep.encoderCalibration[i].cc).toBe(i + 1); // CC numbers 1-16
    }
    // State was updated incrementally
    expect(foundCounts.some((n) => n > 0 && n < 16)).toBe(true);
    expect(foundCounts[foundCounts.length - 1]).toBe(16);
  });

  it("ignores duplicate CC numbers from the same encoder", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])));
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])));
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
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
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    const result = await controller.run(access);
    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    const indices = result.beatstep.encoderCalibration.map((c) => c.encoderIndex);
    expect(new Set(indices).size).toBe(16);
  });
});

// ── Partial encoder discovery (finalizeEncoders) ──

describe("partial encoder discovery via finalizeEncoders()", () => {
  it("proceeds with < 16 encoders when finalizeEncoders() is called mid-step", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])));
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])));
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        // Only fire 8 of 16 encoders, then finalize
        queueMicrotask(() => {
          for (let i = 1; i <= 8; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
          controller.finalizeEncoders(); // partial — only 8 found
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    const result = await controller.run(access);

    // Should complete successfully with the 8 encoders that were found
    expect(result.beatstep.encoderCalibration).toHaveLength(8);
    expect(result.beatstep.encoderCalibration[0].cc).toBe(1);
    expect(result.beatstep.encoderCalibration[7].cc).toBe(8);
    // State should progress to complete
    expect(controller.state.step).toBe("complete");
  });

  it("finalizeEncoders() is a no-op when not in encoder characterization step", () => {
    const controller = new CalibrationController();
    // No active run — should not throw
    expect(() => controller.finalizeEncoders()).not.toThrow();
  });
});

// ── State transitions ──

describe("state transitions", () => {
  it("emits all expected steps in order", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;
    const steps: string[] = [];

    const beatstepInput = getBeatstepInput(access);
    controller.onStateChange = (state) => {
      steps.push(state.step);
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45]));
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          for (let i = 1; i <= 16; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    await controller.run(access);

    expect(steps).toContain("discovering");
    expect(steps).toContain("waiting_to_begin");
    expect(steps).toContain("characterizing_master");
    expect(steps).toContain("characterizing_encoders");
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
    controller.settleMs = 0;
    autoRespond(controller, getBeatstepInput(access));

    await controller.run(access);

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
    controller.settleMs = 0;
      autoRespond(controller, getBeatstepInput(access));
      return controller.run(access);
    };

    await runCalibration();
    await runCalibration();

    // Should still have exactly one performer and one control_plane
    const profiles = await loadProfilesByRole();
    expect(profiles.performer).not.toBeNull();
    expect(profiles.control_plane).not.toBeNull();
  });
});

// ── Pad row input filtering ──

describe("pad row characterization: input filtering", () => {
  /** Drive calibration but intercept pad row 1 to inject noise before valid notes. */
  function runWithPadRow1Noise(
    access: MIDIAccess,
    noise: Uint8Array[],
  ): ReturnType<CalibrationController["run"]> {
    const controller = new CalibrationController();
    controller.settleMs = 0;
    const beatstepInput = getBeatstepInput(access);
    let row1Done = false;

    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])));
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])));
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          for (let i = 1; i <= 16; i++) beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && !row1Done) {
        row1Done = true;
        queueMicrotask(() => {
          // Fire noise first — should be filtered
          for (const msg of noise) beatstepInput.fireMessage(msg);
          // Then fire 8 valid Note On messages
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    return controller.run(access);
  }

  it("ignores poly aftertouch (0xa0) during pad row capture — pads not polluted", async () => {
    const { access } = createTestMIDIEnvironment();
    // Poly aftertouch: status 0xa0, note 0x24, pressure 0x40
    const noise = [new Uint8Array([0xa0, 0x24, 0x40])];

    const result = await runWithPadRow1Noise(access, noise);

    expect(result.beatstep.mapping.padRow1Notes).toHaveLength(8);
    // Pads should be 0x24–0x2b, not polluted with pressure byte 0x40
    expect(result.beatstep.mapping.padRow1Notes[0]).toBe(0x24);
    expect(result.beatstep.mapping.padRow1Notes).not.toContain(0x40);
  });

  it("ignores Note On velocity=0 (velocity-zero Note Off encoding) during pad row capture", async () => {
    const { access } = createTestMIDIEnvironment();
    // Note On with velocity=0 (standard Note Off encoding) — must be filtered
    const noise = [new Uint8Array([0x90, 0x24, 0x00])];

    const result = await runWithPadRow1Noise(access, noise);

    // Row 1 should still have exactly 8 valid pads
    expect(result.beatstep.mapping.padRow1Notes).toHaveLength(8);
    expect(result.beatstep.mapping.padRow1Notes[0]).toBe(0x24);
  });
});

// ── finalizeEncoders: skip early ──

describe("CalibrationController.finalizeEncoders", () => {
  it("calling finalizeEncoders mid-characterization resolves with partial encoder set", async () => {
    const { access } = createTestMIDIEnvironment();
    const beatstepInput = getBeatstepInput(access);
    const controller = new CalibrationController();
    controller.settleMs = 0;

    // Wire standard auto-responses except encoder characterization — we only fire 8, then finalize
    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45])); // any CC to begin
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45])); // CC 112 = master
        });
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          // Only fire 8 of the 16 encoders, then finalize early
          for (let i = 1; i <= 8; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
          controller.finalizeEncoders();
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    const result = await controller.run(access);

    // Only 8 encoders found before finalizeEncoders() was called
    expect(result.beatstep.encoderCalibration).toHaveLength(8);
    // Calibration still completes successfully (pads still captured)
    expect(controller.state.step).toBe("complete");
    expect(result.beatstep.mapping.padRow1Notes).toHaveLength(8);
  });

  it("finalizeEncoders outside encoder characterization step is a no-op", async () => {
    const { access } = createTestMIDIEnvironment();
    const beatstepInput = getBeatstepInput(access);
    const controller = new CalibrationController();
    controller.settleMs = 0;
    autoRespond(controller, beatstepInput);

    // Run full calibration to completion
    const result = await controller.run(access);
    expect(controller.state.step).toBe("complete");

    // Calling finalizeEncoders after calibration is complete is a no-op (no crash)
    expect(() => controller.finalizeEncoders()).not.toThrow();
    expect(controller.state.step).toBe("complete");
    expect(result.beatstep.encoderCalibration).toHaveLength(16);
  });
});

// ── characterizeEncoders: master CC is skipped ──

describe("CalibrationController._characterizeEncoders: master CC is ignored during encoder scan", () => {
  it("turning master encoder during encoder scan does not count as an encoder CC", async () => {
    const { access } = createTestMIDIEnvironment();
    const beatstepInput = getBeatstepInput(access);
    const controller = new CalibrationController();
    controller.settleMs = 0;
    const MASTER_CC = 0x70; // CC 112

    controller.onStateChange = (state) => {
      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45]));
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, MASTER_CC, 0x45]));
        });
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          // Fire master CC first — should be ignored
          beatstepInput.fireMessage(new Uint8Array([0xb0, MASTER_CC, 0x45]));
          // Then fire 16 unique encoder CCs (1-16)
          for (let i = 1; i <= 16; i++) {
            beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
          }
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    const result = await controller.run(access);

    // 16 encoders found; masterCC must not appear in encoder CCs
    expect(result.beatstep.encoderCalibration).toHaveLength(16);
    const encoderCCs = result.beatstep.encoderCalibration.map((e) => e.cc);
    expect(encoderCCs).not.toContain(MASTER_CC);
  });
});

// ── waiting_to_begin: 1-byte real-time message is ignored ──

describe("CalibrationController: 1-byte MIDI real-time message during waiting_to_begin is ignored", () => {
  it("firing 0xF8 (timing clock) does not advance past waiting_to_begin; a valid CC does", async () => {
    const { access } = createTestMIDIEnvironment();
    const beatstepInput = getBeatstepInput(access);
    const controller = new CalibrationController();
    controller.settleMs = 0;

    const statesSeen: string[] = [];
    let resolveAfterBegin!: () => void;
    const afterBegin = new Promise<void>((r) => (resolveAfterBegin = r));

    controller.onStateChange = (state) => {
      statesSeen.push(state.step);

      if (state.step === "waiting_to_begin") {
        queueMicrotask(() => {
          // Fire a 1-byte MIDI real-time message — must be ignored
          beatstepInput.fireMessage(new Uint8Array([0xf8]));
          // State must remain waiting_to_begin after this
          expect(controller.state.step).toBe("waiting_to_begin");

          // Now fire a valid CC to actually begin
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x7f, 0x45]));
          resolveAfterBegin();
        });
      } else if (state.step === "characterizing_master" && !state.masterFound) {
        queueMicrotask(() => {
          beatstepInput.fireMessage(new Uint8Array([0xb0, 0x70, 0x45]));
        });
      } else if (state.step === "characterizing_encoders" && state.encodersFound === 0) {
        queueMicrotask(() => {
          for (let i = 1; i <= 16; i++) beatstepInput.fireMessage(new Uint8Array([0xb0, i, 0x45]));
        });
      } else if (state.step === "characterizing_pad_row1" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x24 + i, 0x7f]));
        });
      } else if (state.step === "characterizing_pad_row2" && state.padsFound === 0) {
        queueMicrotask(() => {
          for (let i = 0; i < 8; i++) beatstepInput.fireMessage(new Uint8Array([0x90, 0x2c + i, 0x7f]));
        });
      }
    };

    await Promise.all([controller.run(access), afterBegin]);

    // Calibration completed and waiting_to_begin was entered exactly once
    expect(statesSeen.filter((s) => s === "waiting_to_begin")).toHaveLength(1);
    expect(controller.state.step).toBe("complete");
  });
});
