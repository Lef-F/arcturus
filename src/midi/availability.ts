/**
 * MIDI availability classification — turns the three real outcomes of trying
 * to use Web MIDI into a typed enum so the boot path can render the right
 * UI without sprinkling regex matching across app.ts.
 *
 * Outcomes:
 *   - "supported"    — `navigator.requestMIDIAccess` exists; permission may
 *                      still need to be granted, but we should attempt it
 *   - "unsupported"  — the API isn't shipped (Safari, iOS browsers)
 *   - "needs-addon"  — the API is shipped but the request rejected with
 *                      Firefox's "WebMIDI requires a site permission add-on
 *                      to activate" (or a similarly-phrased gating message)
 *   - "error"        — anything else (logged at warn level, treated as a bug)
 */

export type MidiAvailability =
  | { kind: "supported" }
  | { kind: "unsupported" }
  | { kind: "needs-addon" }
  | { kind: "error"; error: unknown };

/** Synchronous check for the Web MIDI API surface. Doesn't touch permissions. */
export function detectMidiSupport(): "supported" | "unsupported" {
  if (typeof navigator === "undefined") return "unsupported";
  return typeof navigator.requestMIDIAccess === "function" ? "supported" : "unsupported";
}

/**
 * Classify an error thrown by `navigator.requestMIDIAccess()`.
 * Firefox's gated path throws a DOMException whose message includes
 * "site permission add-on"; we match a few synonyms defensively.
 */
export function classifyMidiError(err: unknown): MidiAvailability {
  const msg = err instanceof Error ? err.message : String(err);
  if (/add-on|extension|permission/i.test(msg)) {
    return { kind: "needs-addon" };
  }
  return { kind: "error", error: err };
}
