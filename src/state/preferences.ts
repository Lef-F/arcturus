/**
 * Preference keys + helpers — single source of truth for free-form UI state
 * stored in the IndexedDB config store via `getPreference` / `setPreference`
 * (db.ts).
 *
 * Centralised so renames / version bumps happen in one place. The `_v1` suffix
 * lets us cleanly invalidate a flag if the underlying meaning changes (just
 * bump to `_v2`; the old key becomes inert and the user sees the prompt once).
 */

import { getPreference, setPreference } from "./db";

export const PREF_WELCOMED = "welcomed_v1";
export const PREF_SCENE_LATCH_HINT_SEEN = "scene_latch_hint_seen_v1";
export const PREF_LAST_SLOT = "last_slot_v1";

/** True iff the user has not yet seen the one-shot identified by `key`. Falsy on read errors. */
export async function hasSeenPreference(key: string): Promise<boolean> {
  try {
    return (await getPreference<boolean>(key)) === true;
  } catch {
    return false;
  }
}

/** Persist that the one-shot identified by `key` has been seen. Best-effort. */
export async function markPreferenceSeen(key: string): Promise<void> {
  try {
    await setPreference<boolean>(key, true);
  } catch {
    // Best-effort — losing this flag just means the user sees the prompt again.
  }
}
