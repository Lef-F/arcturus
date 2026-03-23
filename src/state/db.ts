/**
 * IndexedDB — Schema, migrations, CRUD operations.
 * Database: "arcturus"
 * Stores: hardware_profiles, patches, config
 */

import { openDB, type IDBPDatabase } from "idb";
import type { HardwareProfile, Patch, ArctConfig } from "@/types";

const DB_NAME = "arcturus";
const DB_VERSION = 1;

// ── Schema ──

interface ArctDB {
  hardware_profiles: {
    key: number;
    value: HardwareProfile;
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
    upgrade(db) {
      // hardware_profiles store
      if (!db.objectStoreNames.contains("hardware_profiles")) {
        const profileStore = db.createObjectStore("hardware_profiles", {
          keyPath: "profileId",
          autoIncrement: true,
        });
        profileStore.createIndex("by_port", "portName");
      }

      // patches store
      if (!db.objectStoreNames.contains("patches")) {
        const patchStore = db.createObjectStore("patches", {
          keyPath: "patchId",
          autoIncrement: true,
        });
        patchStore.createIndex("by_slot", "slot");
      }

      // config store
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

// ── Hardware Profile CRUD ──

export async function saveHardwareProfile(
  profile: Omit<HardwareProfile, "profileId">
): Promise<number> {
  const db = await openArctDB();
  return db.add("hardware_profiles", { ...profile } as HardwareProfile) as Promise<number>;
}

export async function updateHardwareProfile(profile: HardwareProfile): Promise<void> {
  const db = await openArctDB();
  await db.put("hardware_profiles", profile);
}

export async function getAllHardwareProfiles(): Promise<HardwareProfile[]> {
  const db = await openArctDB();
  return db.getAll("hardware_profiles");
}

export async function getHardwareProfileByPort(portName: string): Promise<HardwareProfile | undefined> {
  const db = await openArctDB();
  return db.getFromIndex("hardware_profiles", "by_port", portName);
}

export async function deleteHardwareProfile(profileId: number): Promise<void> {
  const db = await openArctDB();
  return db.delete("hardware_profiles", profileId);
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
