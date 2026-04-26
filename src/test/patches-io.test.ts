/**
 * Patches I/O — round-trip envelope, validation errors, apply.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildExport,
  parseEnvelope,
  applyImport,
  PATCH_EXPORT_VERSION,
  InvalidEnvelopeError,
} from "@/state/patches-io";
import { PatchManager } from "@/state/patches";
import { resetIndexedDB } from "./helpers";

beforeEach(resetIndexedDB);

describe("buildExport", () => {
  it("returns an empty envelope when no patches exist", async () => {
    const env = await buildExport();
    expect(env.version).toBe(PATCH_EXPORT_VERSION);
    expect(env.patches).toEqual([]);
    expect(env.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("captures every saved patch in slot order", async () => {
    const pm = new PatchManager();
    await pm.save({ cutoff: 8000 }, "P1", 1);
    await pm.save({ cutoff: 6000 }, "P3", 3);
    await pm.save({ cutoff: 2000 }, "P2", 2);

    const env = await buildExport();
    expect(env.patches.map((p) => p.slot)).toEqual([1, 2, 3]);
    expect(env.patches[1].name).toBe("P2");
    expect(env.patches[2].parameters.cutoff).toBe(6000);
  });

  it("dedupes by slot defensively, keeping the most-recently-updated record", async () => {
    // Simulate a pre-existing duplicate by writing two records for the same slot
    // straight to the store (bypassing PatchManager.save which would update in place).
    const { saveBeatStepProfile: _ignore, savePatch } = await import("@/state/db");
    void _ignore;
    await savePatch({ name: "Old", slot: 4, parameters: { cutoff: 100 }, createdAt: 1, updatedAt: 1 });
    await savePatch({ name: "New", slot: 4, parameters: { cutoff: 9999 }, createdAt: 2, updatedAt: 2 });

    const env = await buildExport();
    const slot4Entries = env.patches.filter((p) => p.slot === 4);
    expect(slot4Entries).toHaveLength(1);
    expect(slot4Entries[0].name).toBe("New");
    expect(slot4Entries[0].parameters.cutoff).toBe(9999);
  });
});

describe("dedupePatchesBySlot", () => {
  it("is a no-op when every slot has at most one record", async () => {
    const { dedupePatchesBySlot, savePatch } = await import("@/state/db");
    await savePatch({ name: "A", slot: 1, parameters: {}, createdAt: 1, updatedAt: 1 });
    await savePatch({ name: "B", slot: 2, parameters: {}, createdAt: 1, updatedAt: 1 });
    expect(await dedupePatchesBySlot()).toBe(0);
  });

  it("removes the older duplicate and keeps the most-recent record", async () => {
    const { dedupePatchesBySlot, savePatch, getAllPatches } = await import("@/state/db");
    await savePatch({ name: "Old", slot: 3, parameters: { cutoff: 100 }, createdAt: 1, updatedAt: 1 });
    await savePatch({ name: "Newer", slot: 3, parameters: { cutoff: 9999 }, createdAt: 2, updatedAt: 5 });
    await savePatch({ name: "Newest", slot: 3, parameters: { cutoff: 4242 }, createdAt: 3, updatedAt: 9 });

    const removed = await dedupePatchesBySlot();
    expect(removed).toBe(2);

    const remaining = (await getAllPatches()).filter((p) => p.slot === 3);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("Newest");
  });

  it("returns 0 on an empty store without throwing", async () => {
    const { dedupePatchesBySlot } = await import("@/state/db");
    expect(await dedupePatchesBySlot()).toBe(0);
  });
});

describe("parseEnvelope", () => {
  function envelope(patches: unknown): string {
    return JSON.stringify({ version: 1, exportedAt: "2026-04-25T00:00:00Z", patches });
  }

  it("round-trips a built export", async () => {
    const pm = new PatchManager();
    await pm.save({ cutoff: 8000, res: 0.5 }, "Init", 1);

    const exported = await buildExport();
    const json = JSON.stringify(exported);
    const parsed = parseEnvelope(json);

    expect(parsed.patches).toHaveLength(1);
    expect(parsed.patches[0].name).toBe("Init");
    expect(parsed.patches[0].parameters).toEqual({ cutoff: 8000, res: 0.5 });
  });

  it("rejects non-JSON input", () => {
    expect(() => parseEnvelope("{not json")).toThrow(InvalidEnvelopeError);
  });

  it("rejects unsupported version", () => {
    const json = JSON.stringify({ version: 99, exportedAt: "x", patches: [] });
    expect(() => parseEnvelope(json)).toThrow(/Unsupported version/);
  });

  it("rejects missing patches array", () => {
    const json = JSON.stringify({ version: 1, exportedAt: "x" });
    expect(() => parseEnvelope(json)).toThrow(/Missing or non-array `patches`/);
  });

  it("rejects out-of-range slot", () => {
    expect(() => parseEnvelope(envelope([{ slot: 9, name: "x", parameters: {} }]))).toThrow(/slot must be 1–8/);
  });

  it("rejects non-numeric parameter value", () => {
    expect(() => parseEnvelope(envelope([{ slot: 1, name: "x", parameters: { cutoff: "loud" } }]))).toThrow(/finite number/);
  });

  it("rejects NaN parameter value", () => {
    expect(() => parseEnvelope(envelope([{ slot: 1, name: "x", parameters: { cutoff: NaN } }]))).toThrow(/finite number/);
  });

  it("accepts a minimal valid envelope", () => {
    const parsed = parseEnvelope(envelope([{ slot: 4, name: "Lead", parameters: { cutoff: 5000 } }]));
    expect(parsed.patches[0].slot).toBe(4);
    expect(parsed.patches[0].parameters.cutoff).toBe(5000);
  });
});

describe("applyImport", () => {
  it("writes every slot in the envelope into IndexedDB", async () => {
    const pm = new PatchManager();
    const envelope = {
      version: PATCH_EXPORT_VERSION as 1,
      exportedAt: new Date().toISOString(),
      patches: [
        { slot: 2, name: "Pad", parameters: { cutoff: 4000 } },
        { slot: 5, name: "Bass", parameters: { cutoff: 800 } },
      ],
    };

    const written = await applyImport(envelope, pm);
    expect(written).toBe(2);

    const all = await pm.loadAll();
    expect(all[1]?.name).toBe("Pad");
    expect(all[1]?.parameters.cutoff).toBe(4000);
    expect(all[4]?.name).toBe("Bass");
  });

  it("leaves slots not mentioned in the envelope alone", async () => {
    const pm = new PatchManager();
    await pm.save({ cutoff: 1234 }, "Existing", 7);

    const envelope = {
      version: PATCH_EXPORT_VERSION as 1,
      exportedAt: new Date().toISOString(),
      patches: [{ slot: 1, name: "New", parameters: { cutoff: 9999 } }],
    };

    await applyImport(envelope, pm);

    const all = await pm.loadAll();
    expect(all[0]?.name).toBe("New");
    expect(all[6]?.name).toBe("Existing"); // slot 7 untouched
    expect(all[6]?.parameters.cutoff).toBe(1234);
  });

  it("overwrites an existing slot in place (no duplicate records)", async () => {
    const pm = new PatchManager();
    await pm.save({ cutoff: 1000 }, "Old", 3);

    const envelope = {
      version: PATCH_EXPORT_VERSION as 1,
      exportedAt: new Date().toISOString(),
      patches: [{ slot: 3, name: "New", parameters: { cutoff: 9000 } }],
    };
    await applyImport(envelope, pm);

    const all = await pm.loadAll();
    const slot3 = all[2];
    expect(slot3?.name).toBe("New");
    expect(slot3?.parameters.cutoff).toBe(9000);

    // Ensure there's still only one record for slot 3
    const slot3Records = all.filter((p) => p?.slot === 3);
    expect(slot3Records).toHaveLength(1);
  });
});
