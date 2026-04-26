/**
 * Factory presets tests — verify all 8 presets are valid and can round-trip.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { FACTORY_PRESETS, createFactoryPatches } from "@/state/factory-presets";
import { SYNTH_PARAMS, ParameterStore } from "@/audio/params";
import { PatchManager } from "@/state/patches";
import { resetIndexedDB } from "./helpers";

beforeEach(resetIndexedDB);

describe("FACTORY_PRESETS", () => {
  it("contains exactly 8 presets", () => {
    expect(FACTORY_PRESETS).toHaveLength(8);
  });

  it("each preset has a unique name", () => {
    const names = FACTORY_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(8);
  });

  it("each preset has all parameter paths from SYNTH_PARAMS", () => {
    const allPaths = Object.values(SYNTH_PARAMS).map((p) => p.path);
    for (const preset of FACTORY_PRESETS) {
      for (const path of allPaths) {
        expect(preset.parameters[path], `${preset.name} missing param: ${path}`).toBeDefined();
      }
    }
  });

  it("no preset contains stale keys (paths removed from SYNTH_PARAMS)", () => {
    const allPaths = new Set(Object.values(SYNTH_PARAMS).map((p) => p.path));
    for (const preset of FACTORY_PRESETS) {
      for (const path of Object.keys(preset.parameters)) {
        expect(allPaths.has(path), `${preset.name} has stale param: ${path}`).toBe(true);
      }
    }
  });

  it("all preset values are within valid ranges", () => {
    for (const preset of FACTORY_PRESETS) {
      for (const [path, value] of Object.entries(preset.parameters)) {
        const param = Object.values(SYNTH_PARAMS).find((p) => p.path === path);
        if (!param) continue;
        expect(value, `${preset.name}.${path} = ${value} below min ${param.min}`)
          .toBeGreaterThanOrEqual(param.min);
        expect(value, `${preset.name}.${path} = ${value} above max ${param.max}`)
          .toBeLessThanOrEqual(param.max);
      }
    }
  });
});

describe("createFactoryPatches", () => {
  it("creates 8 patches with slots 1-8", () => {
    const patches = createFactoryPatches();
    expect(patches).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(patches[i].slot).toBe(i + 1);
      expect(patches[i].name).toBe(FACTORY_PRESETS[i].name);
    }
  });
});

describe("Factory preset round-trip via ParameterStore", () => {
  it("loadValues + snapshot preserves preset values", () => {
    const store = new ParameterStore();
    for (const preset of FACTORY_PRESETS) {
      store.loadValues(preset.parameters);
      const snap = store.snapshot();
      for (const [path, original] of Object.entries(preset.parameters)) {
        expect(snap[path], `${preset.name}.${path} round-trip failed`)
          .toBeCloseTo(original, 4);
      }
    }
  });
});

describe("Factory preset seeding via PatchManager", () => {
  it("saves and loads all 8 factory presets", async () => {
    const mgr = new PatchManager();
    const factory = createFactoryPatches();
    for (const fp of factory) {
      await mgr.save(fp.parameters, fp.name, fp.slot);
    }

    const all = await mgr.loadAll();
    expect(all.filter((p) => p !== null)).toHaveLength(8);
    expect(all[0]?.name).toBe("Init");
    expect(all[7]?.name).toBe("Discovery");
  });

  it("P3 Fat Bass has voices=1 (mono)", async () => {
    const mgr = new PatchManager();
    const factory = createFactoryPatches();
    for (const fp of factory) {
      await mgr.save(fp.parameters, fp.name, fp.slot);
    }

    const bass = await mgr.load(3);
    expect(bass?.parameters.voices).toBe(1);
  });

  it("P8 Discovery has poly mod values pre-set", async () => {
    const mgr = new PatchManager();
    const factory = createFactoryPatches();
    for (const fp of factory) {
      await mgr.save(fp.parameters, fp.name, fp.slot);
    }

    const discovery = await mgr.load(8);
    expect(discovery?.parameters.poly_fenv_freq).toBeGreaterThan(0);
    expect(discovery?.parameters.poly_oscb_filt).toBeGreaterThan(0);
  });
});
