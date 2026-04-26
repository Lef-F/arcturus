/**
 * Config persistence — load/save ArctConfig from IndexedDB.
 */

import type { ArctConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { getConfig, setConfig } from "./db";

/**
 * Load the full config from IndexedDB.
 * Returns DEFAULT_CONFIG merged with any stored overrides.
 */
export async function loadConfig(): Promise<ArctConfig> {
  const stored: Partial<ArctConfig> = {};
  const keys: (keyof ArctConfig)[] = [
    "sampleRate",
    "bufferSize",
    "maxVoices",
    "vizMode",
  ];
  for (const key of keys) {
    const val = await getConfig(key);
    if (val !== undefined) {
      (stored as Record<string, unknown>)[key] = val;
    }
  }
  return { ...DEFAULT_CONFIG, ...stored };
}

/**
 * Save a partial config update to IndexedDB.
 * Only stores the provided keys.
 */
export async function saveConfig(config: Partial<ArctConfig>): Promise<void> {
  const entries = Object.entries(config) as Array<[keyof ArctConfig, ArctConfig[keyof ArctConfig]]>;
  await Promise.all(
    entries.map(([key, value]) => setConfig(key, value))
  );
}
