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
import { hasSavedBeatStepProfile, loadBeatStepProfile } from "@/state/hardware-map";
import { resetDB } from "@/state/db";

beforeEach(() => {
  // Fresh IndexedDB per test — fake-indexeddb persists data between runs otherwise
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDB();
});

// ── Helpers ──

function getBeatstepInput(access: MIDIAccess): VirtualMIDIInput {
  const found = Array.from(access.inputs.values()).find((i) => i.name === "BeatStep");
  if (!found) throw new Error("BeatStep not in access");
  return found as VirtualMIDIInput;
}

/**
 * Wire up a CalibrationController to auto-respond with MIDI events:
 * - When characterizing_encoders: fire 16 unique CCs from the beatstep
 * - When characterizing_master: fire a CC not in the encoder set
 * - When characterizing_pad_row1/2: fire 8 unique Note Ons
 *
 * Events are queued as microtasks so they fire after the Promise listeners
 * are registered (the Promise constructor runs synchronously before the await suspends).
 */
function autoRespond(controller: CalibrationController, beatstepInput: VirtualMIDIInput): void {
  controller.settleMs = 0;
  controller.onStateChange = (state) => {
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

describe("BeatStep discovery", () => {
  it("identifies the BeatStep and runs to completion", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;
    autoRespond(controller, getBeatstepInput(access));

    const result = await controller.run(access);

    expect(result).not.toBeNull();
    expect(result!.portName).toBe("BeatStep");
    expect(result!.encoderCalibration).toHaveLength(16);
    expect(controller.state.step).toBe("complete");
  });

  it("returns null and enters no_beatstep state when no BeatStep is connected", async () => {
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

    const result = await controller.run(singleAccess);
    expect(result).toBeNull();
    expect(controller.state.step).toBe("no_beatstep");
  });

  it("returns null when MIDIAccess has no inputs at all", async () => {
    const emptyAccess: MIDIAccess = {
      inputs: new Map(),
      outputs: new Map(),
      sysexEnabled: true,
      onstatechange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    const controller = new CalibrationController();
    controller.settleMs = 0;

    const result = await controller.run(emptyAccess);
    expect(result).toBeNull();
    expect(controller.state.step).toBe("no_beatstep");
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

    expect(result).not.toBeNull();
    expect(result!.encoderCalibration).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(result!.encoderCalibration[i].encoderIndex).toBe(i);
      expect(result!.encoderCalibration[i].cc).toBe(i + 1);
    }
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
    expect(result).not.toBeNull();
    expect(result!.encoderCalibration).toHaveLength(16);
    const indices = result!.encoderCalibration.map((c) => c.encoderIndex);
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
        queueMicrotask(() => {
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

    expect(result).not.toBeNull();
    expect(result!.encoderCalibration).toHaveLength(8);
    expect(result!.encoderCalibration[0].cc).toBe(1);
    expect(result!.encoderCalibration[7].cc).toBe(8);
    expect(controller.state.step).toBe("complete");
  });

  it("finalizeEncoders() is a no-op when not in encoder characterization step", () => {
    const controller = new CalibrationController();
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
  it("hasSavedBeatStepProfile returns false before any calibration", async () => {
    expect(await hasSavedBeatStepProfile()).toBe(false);
  });

  it("saves the BeatStep profile to IndexedDB after successful calibration", async () => {
    const { access } = createTestMIDIEnvironment();
    const controller = new CalibrationController();
    controller.settleMs = 0;
    autoRespond(controller, getBeatstepInput(access));

    await controller.run(access);

    expect(await hasSavedBeatStepProfile()).toBe(true);

    const profile = await loadBeatStepProfile();
    expect(profile).not.toBeNull();
    expect(profile!.portName).toBe("BeatStep");
    expect(profile!.encoderCalibration).toHaveLength(16);
    expect(profile!.mapping.padRow1Notes).toHaveLength(8);
    expect(profile!.mapping.padRow2Notes).toHaveLength(8);
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

    // Should still have exactly one BeatStep profile
    const profile = await loadBeatStepProfile();
    expect(profile).not.toBeNull();
  });
});

// ── Pad row input filtering ──

describe("pad row characterization: input filtering", () => {
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
          for (const msg of noise) beatstepInput.fireMessage(msg);
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
    const noise = [new Uint8Array([0xa0, 0x24, 0x40])];

    const result = await runWithPadRow1Noise(access, noise);

    expect(result).not.toBeNull();
    expect(result!.mapping.padRow1Notes).toHaveLength(8);
    expect(result!.mapping.padRow1Notes[0]).toBe(0x24);
    expect(result!.mapping.padRow1Notes).not.toContain(0x40);
  });

  it("ignores Note On velocity=0 (velocity-zero Note Off encoding) during pad row capture", async () => {
    const { access } = createTestMIDIEnvironment();
    const noise = [new Uint8Array([0x90, 0x24, 0x00])];

    const result = await runWithPadRow1Noise(access, noise);

    expect(result).not.toBeNull();
    expect(result!.mapping.padRow1Notes).toHaveLength(8);
    expect(result!.mapping.padRow1Notes[0]).toBe(0x24);
  });
});

// ── characterizeEncoders: master CC is skipped ──

describe("CalibrationController._characterizeEncoders: master CC is ignored during encoder scan", () => {
  it("turning master encoder during encoder scan does not count as an encoder CC", async () => {
    const { access } = createTestMIDIEnvironment();
    const beatstepInput = getBeatstepInput(access);
    const controller = new CalibrationController();
    controller.settleMs = 0;
    const MASTER_CC = 0x70;

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
          beatstepInput.fireMessage(new Uint8Array([0xb0, MASTER_CC, 0x45]));
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

    expect(result).not.toBeNull();
    expect(result!.encoderCalibration).toHaveLength(16);
    const encoderCCs = result!.encoderCalibration.map((e) => e.cc);
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
          beatstepInput.fireMessage(new Uint8Array([0xf8]));
          expect(controller.state.step).toBe("waiting_to_begin");

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

    expect(statesSeen.filter((s) => s === "waiting_to_begin")).toHaveLength(1);
    expect(controller.state.step).toBe("complete");
  });
});
