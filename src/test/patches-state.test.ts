/**
 * M7 Patches & State tests — PatchManager CRUD, autosave, config persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { PatchManager } from "@/state/patches";
import { loadConfig, saveConfig } from "@/state/config";
import { ParameterStore, SYNTH_PARAMS } from "@/audio/params";
import { resetDB, openArctDB } from "@/state/db";
import { FACTORY_PRESETS } from "@/state/factory-presets";

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

  it("onSaveError fires when autosave fails", async () => {
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const errors: unknown[] = [];
    mgr.onSaveError = (err) => errors.push(err);
    vi.spyOn(mgr, "save").mockRejectedValue(new Error("IndexedDB quota exceeded"));

    mgr.markDirty({ cutoff: 5000 });
    await vi.advanceTimersByTimeAsync(2000);
    // Wait for the rejection to propagate
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("IndexedDB quota exceeded");
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

  it("rapid markDirty: last params win (most recent call is what gets saved)", async () => {
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const savedParams: object[] = [];
    vi.spyOn(mgr, "save").mockImplementation(async (params) => {
      savedParams.push({ ...params });
      return { patchId: 1, name: "P", slot: 1, parameters: params, createdAt: 0, updatedAt: 0 };
    });

    mgr.markDirty({ cutoff: 1000 });
    mgr.markDirty({ cutoff: 2000 });
    mgr.markDirty({ cutoff: 3000 }); // last call wins

    await vi.advanceTimersByTimeAsync(2000);
    expect(savedParams).toHaveLength(1);
    expect((savedParams[0] as Record<string, number>).cutoff).toBe(3000);
  });

  it("autosave saves to slot active at markDirty time, not at fire time", async () => {
    // Race condition: user edits slot 1, then switches to slot 2 before autosave fires.
    // The save must go to slot 1 (where the edits happened), not slot 2.
    vi.useFakeTimers();
    const mgr = new PatchManager();
    const savedSlots: number[] = [];
    vi.spyOn(mgr, "save").mockImplementation(async (_params, _name, slot) => {
      savedSlots.push(slot ?? mgr.currentSlot);
      return { patchId: 1, name: "P", slot: slot ?? mgr.currentSlot, parameters: {}, createdAt: 0, updatedAt: 0 };
    });

    mgr.selectSlot(1);               // editing slot 1
    mgr.markDirty({ cutoff: 5000 }); // edits on slot 1
    mgr.selectSlot(2);               // switch to slot 2 before autosave fires

    await vi.advanceTimersByTimeAsync(2000); // autosave fires
    expect(savedSlots).toHaveLength(1);
    expect(savedSlots[0]).toBe(1); // must save to slot 1, not 2
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
    store.activeModule = 2; // FLTR module — slot 0 = cutoff
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

  it("stepped param at max boundary: delta=+1 is a no-op (returns false)", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSCA module — slot 0 = waveform (5 steps, min=0, max=4)
    store.loadValues({ waveform: 4.0 }); // actual max value for waveform param

    // Positive delta at max should be a no-op
    const changed = store.processEncoderDelta(0, 1);
    expect(changed).toBe(false);
    expect(store.snapshot().waveform).toBeCloseTo(4.0, 4); // still at max
  });

  it("stepped param at min boundary: delta=-1 is a no-op (returns false)", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSCA module — slot 0 = waveform (min=0)
    store.loadValues({ waveform: 0.0 }); // min step

    const changed = store.processEncoderDelta(0, -1);
    expect(changed).toBe(false);
    expect(store.snapshot().waveform).toBeCloseTo(0.0, 4);
  });

  it("stepped param with misaligned value snaps to nearest step then advances", () => {
    const store = new ParameterStore();
    store.activeModule = 0; // OSCA — waveform: min=0, max=4, steps=5 → steps at values 0,1,2,3,4
    // Actual value 1.5 is between step 1 (value=1) and step 2 (value=2)
    // Normalized: 1.5/4 = 0.375 → Math.round(0.375 * 4) = Math.round(1.5) = 2 → next=3 → value=3
    store.loadValues({ waveform: 1.5 });

    const changed = store.processEncoderDelta(0, 1);
    expect(changed).toBe(true);
    expect(store.snapshot().waveform).toBeCloseTo(3.0, 4); // snapped to step 2 then advanced to step 3
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

  it("loadValues ignores unknown (stale) params without throwing", () => {
    // Old patches may contain params removed from SYNTH_PARAMS — must load gracefully
    const store = new ParameterStore();
    const staleParams = { cutoff: 5000, old_param_xyz: 0.5, another_removed: 1.0 };
    expect(() => store.loadValues(staleParams)).not.toThrow();
    expect(store.snapshot().cutoff).toBeCloseTo(5000, 0);
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

  it("loadAll silently skips patches with out-of-bounds slot numbers (DB corruption guard)", async () => {
    // Bypass save() clamping to insert a corrupted patch directly into IndexedDB.
    // loadAll() has a guard: idx < result.length → corrupted patches are silently dropped.
    const db = await openArctDB();
    await db.add("patches", {
      name: "Corrupted slot 9",
      slot: 9, // out of valid range 1-8
      parameters: { cutoff: 5000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const mgr = new PatchManager();
    const all = await mgr.loadAll();

    expect(all).toHaveLength(8); // always exactly 8 slots
    // The OOB patch is not present in any slot
    expect(all.every((p) => p === null || p.name !== "Corrupted slot 9")).toBe(true);
  });
});

// ── Factory preset completeness ──

describe("factory preset completeness", () => {
  const allParams = Object.values(SYNTH_PARAMS);

  for (const fp of FACTORY_PRESETS) {
    it(`preset "${fp.name}" snapshot has all params, all finite, all in bounds`, () => {
      const store = new ParameterStore();
      store.loadValues(fp.parameters);
      const snapshot = store.snapshot();

      for (const param of allParams) {
        expect(
          snapshot,
          `preset "${fp.name}" missing param "${param.path}"`
        ).toHaveProperty(param.path);

        const value = snapshot[param.path];
        expect(
          isFinite(value),
          `preset "${fp.name}" param "${param.path}" = ${value} is not finite`
        ).toBe(true);

        expect(
          value,
          `preset "${fp.name}" param "${param.path}" = ${value} < min ${param.min}`
        ).toBeGreaterThanOrEqual(param.min);

        expect(
          value,
          `preset "${fp.name}" param "${param.path}" = ${value} > max ${param.max}`
        ).toBeLessThanOrEqual(param.max);
      }
    });
  }
});

// ── ParameterStore constructor defaults ──

describe("ParameterStore constructor: fresh store snapshot equals all param defaults", () => {
  it("every SYNTH_PARAMS path is present in a fresh snapshot at exactly its default value", () => {
    const store = new ParameterStore();
    const snapshot = store.snapshot();

    for (const param of Object.values(SYNTH_PARAMS)) {
      expect(
        snapshot,
        `missing param "${param.path}" in fresh snapshot`
      ).toHaveProperty(param.path);

      expect(
        snapshot[param.path],
        `param "${param.path}" default mismatch: expected ${param.default}`
      ).toBeCloseTo(param.default, 2);
    }
  });
});
