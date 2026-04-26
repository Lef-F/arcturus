/**
 * IndexedDB — Schema, migrations, CRUD operations.
 * Database: "arcturus"
 * Stores: beatstep_profiles, patches, config
 */

import { openDB, type IDBPDatabase } from "idb";
import type { BeatStepProfile, Patch, ArctConfig } from "@/types";

const DB_NAME = "arcturus";
/**
 * Schema version 2: dropped the role-based hardware_profiles store in favour of a
 * BeatStep-only beatstep_profiles store. The KeyStep was never a distinct device
 * (notes are standard MIDI) and the role concept was redundant. Old profiles are
 * not migrated — users re-pair the BeatStep on first boot after the upgrade.
 */
const DB_VERSION = 2;

// ── Schema ──

interface ArctDB {
  beatstep_profiles: {
    key: number;
    value: BeatStepProfile;
    indexes: { by_port: string };
  };
  patches: {
    key: number;
    value: Patch;
    indexes: { by_slot: number };
  };
  config: {
    key: string;
    value: { key: string; value: unknown };
  };
}

// ── DB instance (lazily initialized) ──

let _db: IDBPDatabase<ArctDB> | null = null;

export async function openArctDB(): Promise<IDBPDatabase<ArctDB>> {
  if (_db) return _db;

  _db = await openDB<ArctDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Clean break from v1: remove the legacy hardware_profiles store entirely.
      // Users re-pair BeatStep — no migration logic to maintain.
      if (oldVersion < 2 && db.objectStoreNames.contains("hardware_profiles" as never)) {
        db.deleteObjectStore("hardware_profiles" as never);
      }

      if (!db.objectStoreNames.contains("beatstep_profiles")) {
        const profileStore = db.createObjectStore("beatstep_profiles", {
          keyPath: "profileId",
          autoIncrement: true,
        });
        profileStore.createIndex("by_port", "portName");
      }

      if (!db.objectStoreNames.contains("patches")) {
        const patchStore = db.createObjectStore("patches", {
          keyPath: "patchId",
          autoIncrement: true,
        });
        patchStore.createIndex("by_slot", "slot");
      }

      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "key" });
      }
    },
  });

  return _db;
}

/** Reset the DB instance (used in tests). */
export function resetDB(): void {
  _db = null;
}

// ── BeatStep Profile CRUD ──

export async function saveBeatStepProfile(profile: Omit<BeatStepProfile, "profileId">): Promise<number> {
  const db = await openArctDB();
  return db.add("beatstep_profiles", { ...profile } as BeatStepProfile) as Promise<number>;
}

export async function updateBeatStepProfile(profile: BeatStepProfile): Promise<void> {
  const db = await openArctDB();
  await db.put("beatstep_profiles", profile);
}

export async function getAllBeatStepProfiles(): Promise<BeatStepProfile[]> {
  const db = await openArctDB();
  return db.getAll("beatstep_profiles");
}

export async function getBeatStepProfileByPort(portName: string): Promise<BeatStepProfile | undefined> {
  const db = await openArctDB();
  return db.getFromIndex("beatstep_profiles", "by_port", portName);
}

export async function deleteBeatStepProfile(profileId: number): Promise<void> {
  const db = await openArctDB();
  return db.delete("beatstep_profiles", profileId);
}

// ── Patch CRUD ──

export async function savePatch(patch: Omit<Patch, "patchId">): Promise<number> {
  const db = await openArctDB();
  return db.add("patches", { ...patch } as Patch) as Promise<number>;
}

export async function updatePatch(patch: Patch): Promise<void> {
  const db = await openArctDB();
  await db.put("patches", patch);
}

export async function getPatchBySlot(slot: number): Promise<Patch | undefined> {
  const db = await openArctDB();
  return db.getFromIndex("patches", "by_slot", slot);
}

export async function getAllPatches(): Promise<Patch[]> {
  const db = await openArctDB();
  return db.getAll("patches");
}

export async function deletePatch(patchId: number): Promise<void> {
  const db = await openArctDB();
  return db.delete("patches", patchId);
}

/**
 * Collapse multiple patch records that share a slot down to one each.
 *
 * The `patches` store is keyed on `patchId`, so it can technically hold many
 * records per slot. Earlier seeding logic occasionally created duplicates
 * (one record was autosaved into; the other sat frozen forever), and they
 * surface in exports. This pass keeps the most-recently-updated record per
 * slot and deletes the rest. Returns the number of records removed.
 */
export async function dedupePatchesBySlot(): Promise<number> {
  const db = await openArctDB();
  const all = await db.getAll("patches");
  if (all.length === 0) return 0;

  const bySlot = new Map<number, Patch[]>();
  for (const p of all) {
    if (!bySlot.has(p.slot)) bySlot.set(p.slot, []);
    bySlot.get(p.slot)!.push(p);
  }

  let removed = 0;
  for (const records of bySlot.values()) {
    if (records.length <= 1) continue;
    // Keep the most-recent (highest updatedAt). Tie-break by lowest patchId so
    // we keep the record autosave has been writing into (the by_slot index
    // returns the lowest patchId, which is what save() updates).
    records.sort((a, b) => (b.updatedAt - a.updatedAt) || ((a.patchId ?? 0) - (b.patchId ?? 0)));
    for (const stale of records.slice(1)) {
      if (stale.patchId !== undefined) {
        await db.delete("patches", stale.patchId);
        removed++;
      }
    }
  }
  return removed;
}

// ── Config CRUD ──

export async function setConfig<K extends keyof ArctConfig>(
  key: K,
  value: ArctConfig[K]
): Promise<void> {
  const db = await openArctDB();
  await db.put("config", { key, value });
}

export async function getConfig<K extends keyof ArctConfig>(
  key: K
): Promise<ArctConfig[K] | undefined> {
  const db = await openArctDB();
  const entry = await db.get("config", key);
  return entry?.value as ArctConfig[K] | undefined;
}

export async function getAllConfig(): Promise<Partial<ArctConfig>> {
  const db = await openArctDB();
  const entries = await db.getAll("config");
  const result: Partial<ArctConfig> = {};
  for (const entry of entries) {
    (result as Record<string, unknown>)[entry.key] = entry.value;
  }
  return result;
}

// ── Generic preference store (free-form, used for welcome flag, etc.) ──

/**
 * Read an arbitrary preference key from the config store.
 * Useful for UI state that isn't part of ArctConfig (e.g. "have we shown the welcome overlay?").
 */
export async function getPreference<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openArctDB();
  const entry = await db.get("config", key);
  return entry?.value as T | undefined;
}

/** Write an arbitrary preference key to the config store. */
export async function setPreference<T = unknown>(key: string, value: T): Promise<void> {
  const db = await openArctDB();
  await db.put("config", { key, value });
}
