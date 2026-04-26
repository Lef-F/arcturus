/**
 * Preference keys — single source of truth for free-form UI state stored in
 * the IndexedDB config store via `getPreference` / `setPreference` (db.ts).
 *
 * Centralised so renames / version bumps happen in one place. The `_v1` suffix
 * lets us cleanly invalidate a flag if the underlying meaning changes (just
 * bump to `_v2`; the old key becomes inert and the user sees the prompt once).
 */

export const PREF_WELCOMED = "welcomed_v1";
export const PREF_SCENE_LATCH_HINT_SEEN = "scene_latch_hint_seen_v1";
