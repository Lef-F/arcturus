/**
 * M7 Patches & State tests — PatchManager CRUD, autosave, config persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { PatchManager } from "@/state/patches";
import { loadConfig, saveConfig } from "@/state/config";
import { ParameterStore } from "@/audio/params";
import { resetDB } from "@/state/db";

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDB();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── PatchManager: save & load ──

describe("PatchManager — save and load", () => {
  it("saves a patch to slot 1", async () => {
    const mgr = new PatchManager();
    const params = { cutoff: 5000, resonance: 0.7 };
    const saved = await mgr.save(params, "My Patch", 1);

    expect(saved.slot).toBe(1);
    expect(saved.name).toBe("My Patch");
    expect(saved.parameters).toEqual(params);
  });

  it("loads a saved patch by slot", async () => {
    const mgr = new PatchManager();
    const params = { cutoff: 3000 };
    await mgr.save(params, "Pad 1", 1);

    let loaded: ReturnType<typeof Object.create> = null;
    mgr.onPatchLoad = (p) => { loaded = p; };
    await mgr.load(1);

    expect(loaded).not.toBeNull();
    expect(loaded.parameters.cutoff).toBe(3000);
  });

  it("returns null when loading empty slot", async () => {
    const mgr = new PatchManager();
    const result = await mgr.load(5);
    expect(result).toBeNull();
  });

  it("updates existing patch on re-save", async () => {
    const mgr = new PatchManager();
    await mgr.save({ cutoff: 5000 }, "V1", 1);
    const updated = await mgr.save({ cutoff: 8000 }, "V2", 1);

    expect(updated.name).toBe("V2");
    expect(updated.parameters.cutoff).toBe(8000);
  });

  it("current slot changes after load", async () => {
    const mgr = new PatchManager();
    await mgr.save({ cutoff: 5000 }, "P3", 3);
    await mgr.load(3);
    expect(mgr.currentSlot).toBe(3);
  });

  it("fires onSlotChange on load", async () => {
    const mgr = new PatchManager();
    await mgr.save({ cutoff: 5000 }, "P2", 2);
    const slots: number[] = [];
    mgr.onSlotChange = (s) => slots.push(s);
    await mgr.load(2);
    expect(slots).toContain(2);
  });

  it("clamps slot to 1-8 range", async () => {
    const mgr = new PatchManager();
    const p = await mgr.save({}, "P", 0); // slot 0 → clamps to 1
    expect(p.slot).toBe(1);
    const p8 = await mgr.save({}, "P8", 9); // slot 9 → clamps to 8
    expect(p8.slot).toBe(8);
  });
});

// ── PatchManager: autosave ──
// Note: save() is mocked to avoid fake-timer + IndexedDB conflict.

describe("PatchManager — autosave", () => {
  it("markDirty triggers autosave after delay", async () => {
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const saveCalls: object[] = [];
    // Mock save to avoid IndexedDB with fake timers
    vi.spyOn(mgr, "save").mockImplementation(async (params) => {
      const patch = { patchId: 1, name: "Patch 1", slot: 1, parameters: params, createdAt: 0, updatedAt: 0 };
      saveCalls.push(patch);
      mgr.onPatchSave?.(patch);
      return patch;
    });

    mgr.markDirty({ cutoff: 5000 });
    expect(saveCalls.length).toBe(0); // not saved yet

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveCalls.length).toBe(1);
  });

  it("isDirty is false after explicit save()", async () => {
    const mgr = new PatchManager();
    mgr.markDirty({ cutoff: 5000 });
    expect(mgr.isDirty).toBe(true);
    mgr.cancelAutosave();
    await mgr.save({ cutoff: 5000 });
    expect(mgr.isDirty).toBe(false);
  });

  it("cancelAutosave prevents the save", async () => {
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const saveCalls: object[] = [];
    vi.spyOn(mgr, "save").mockImplementation(async (params) => {
      saveCalls.push(params);
      return { patchId: 1, name: "P", slot: 1, parameters: params, createdAt: 0, updatedAt: 0 };
    });

    mgr.markDirty({ cutoff: 5000 });
    mgr.cancelAutosave();

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveCalls.length).toBe(0);
  });

  it("rapid markDirty calls are debounced to single save", async () => {
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const saveCalls: object[] = [];
    vi.spyOn(mgr, "save").mockImplementation(async (params) => {
      saveCalls.push(params);
      return { patchId: 1, name: "P", slot: 1, parameters: params, createdAt: 0, updatedAt: 0 };
    });

    mgr.markDirty({ cutoff: 1000 });
    mgr.markDirty({ cutoff: 2000 });
    mgr.markDirty({ cutoff: 3000 });

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveCalls.length).toBe(1);
  });
});

// ── PatchManager: batch operations ──

describe("PatchManager — loadAll and deleteSlot", () => {
  it("loadAll returns 8-element array with null for empty slots", async () => {
    const mgr = new PatchManager();
    await mgr.save({ cutoff: 5000 }, "P1", 1);
    await mgr.save({ cutoff: 6000 }, "P3", 3);

    const all = await mgr.loadAll();
    expect(all.length).toBe(8);
    expect(all[0]).not.toBeNull(); // slot 1
    expect(all[1]).toBeNull();      // slot 2
    expect(all[2]).not.toBeNull(); // slot 3
    expect(all[7]).toBeNull();      // slot 8
  });

  it("deleteSlot removes the patch from the store", async () => {
    const mgr = new PatchManager();
    await mgr.save({ cutoff: 5000 }, "P4", 4);
    await mgr.deleteSlot(4);

    const result = await mgr.load(4);
    expect(result).toBeNull();
  });
});

// ── Soft takeover on patch switch ──

describe("soft takeover on patch load", () => {
  it("encoders latch after loadValues and unlatch when crossed", () => {
    const store = new ParameterStore();
    store.activeModule = 1; // FLTR module — slot 0 = cutoff
    const changes: string[] = [];
    store.onParamChange = (path) => changes.push(path);

    // Load a patch with cutoff at 5000 Hz (below hardware default of 8000)
    store.loadValues({ cutoff: 5000 });

    // Encoder slot 0 in FLTR = cutoff. Hardware default ~8000 → above soft 5000.
    // approachFromAbove=true → must turn CCW to cross down through 5000 to unlatch.
    const beforeChanges = changes.filter((p) => p === "cutoff").length;

    let latchBroken = false;
    for (let i = 0; i < 200; i++) {
      const changed = store.processEncoderDelta(0, -1); // CCW
      if (changed) {
        latchBroken = true;
        break;
      }
    }
    expect(latchBroken).toBe(true);
    // After unlatch, further turns should have changed cutoff
    const afterChanges = changes.filter((p) => p === "cutoff").length;
    expect(afterChanges).toBeGreaterThan(beforeChanges);
  });

  it("snapshot captures all params including voices", () => {
    const store = new ParameterStore();
    const snap = store.snapshot();
    expect("cutoff" in snap).toBe(true);
    expect("drive" in snap).toBe(true);
    expect("voices" in snap).toBe(true); // voices is now saved with patches
  });

  it("loadValues + snapshot round-trips values", () => {
    const store = new ParameterStore();
    const original = store.snapshot();
    store.loadValues(original);
    const roundTripped = store.snapshot();

    for (const [key, val] of Object.entries(original)) {
      expect(roundTripped[key]).toBeCloseTo(val, 5);
    }
  });
});

// ── Config persistence ──

describe("config persistence", () => {
  it("loadConfig returns default config on empty DB", async () => {
    const config = await loadConfig();
    expect(config.sampleRate).toBe(48000);
    expect(config.bufferSize).toBe(128);
    expect(config.maxVoices).toBe(8);
  });

  it("saveConfig persists values to IndexedDB", async () => {
    await saveConfig({ maxVoices: 4, sampleRate: 44100 });
    const config = await loadConfig();
    expect(config.maxVoices).toBe(4);
    expect(config.sampleRate).toBe(44100);
    // Non-saved values keep defaults
    expect(config.bufferSize).toBe(128);
  });

  it("saveConfig partial update doesn't clobber other keys", async () => {
    await saveConfig({ maxVoices: 4 });
    await saveConfig({ bufferSize: 256 });
    const config = await loadConfig();
    expect(config.maxVoices).toBe(4);
    expect(config.bufferSize).toBe(256);
  });
});

// ── Pad LED feedback ──

describe("pad LED feedback logic (via PatchManager)", () => {
  it("selectSlot updates currentSlot and fires onSlotChange", () => {
    const mgr = new PatchManager();
    const slots: number[] = [];
    mgr.onSlotChange = (s) => slots.push(s);

    mgr.selectSlot(3);
    expect(mgr.currentSlot).toBe(3);
    expect(slots).toContain(3);
  });

  it("selectSlot clamps slot to 1-8", () => {
    const mgr = new PatchManager();
    mgr.selectSlot(0);
    expect(mgr.currentSlot).toBe(1);
    mgr.selectSlot(99);
    expect(mgr.currentSlot).toBe(8);
  });
});
