/**
 * SceneLatchManager — per-program note latching for stackable sound layers.
 *
 * Tracks which notes are physically held on the KeyStep and which have been
 * "latched" (sustained indefinitely) per program. A double-tap on the focused
 * program pad toggles latch: held notes become latched, or latched notes are
 * released.
 *
 * Single-engine caveat: latched notes adopt the current program's sound on
 * patch switch. True independent layers require multi-engine (future work).
 */

// ── Types ──

export interface LatchedNote {
  note: number;
  channel: number;
  velocity: number;
}

export type LatchAction =
  | { type: "focus"; program: number }
  | { type: "latch"; program: number; notes: LatchedNote[] }
  | { type: "unlatch"; program: number; notes: LatchedNote[] };

// ── SceneLatchManager ──

export class SceneLatchManager {
  /** Notes currently latched per program (sustaining indefinitely). */
  private _latched = new Map<number, Map<number, LatchedNote>>(); // program → (note → LatchedNote)

  /** Notes currently physically held on the KeyStep (not yet latched). */
  private _held = new Map<number, LatchedNote>(); // note → LatchedNote

  /** Currently focused program index (0-7). */
  private _focused = 0;

  /** Timestamp of last program pad tap (for double-tap detection). */
  private _lastTapTime = 0;

  /** Double-tap window in milliseconds. */
  static readonly DOUBLE_TAP_MS = 350;

  // ── Note tracking ──

  /**
   * Track a note-on from the KeyStep.
   * Call this before forwarding to the engine.
   */
  noteOn(channel: number, note: number, velocity: number): void {
    this._held.set(note, { note, channel, velocity });
  }

  /**
   * Handle a note-off from the KeyStep.
   * Returns true if the note is latched and the keyOff should be suppressed.
   */
  noteOff(_channel: number, note: number): boolean {
    this._held.delete(note);
    const latchSet = this._latched.get(this._focused);
    return latchSet?.has(note) ?? false;
  }

  /** Get all currently held (non-latched) notes. */
  getHeldNotes(): LatchedNote[] {
    return [...this._held.values()];
  }

  /** Clear all held note tracking (e.g., on program switch). */
  clearHeld(): void {
    this._held.clear();
  }

  // ── Latch state ──

  /** Whether a program has any latched notes. */
  isLatched(program: number): boolean {
    const s = this._latched.get(program);
    return s !== undefined && s.size > 0;
  }

  /** Get latched notes for a program. */
  getLatchedNotes(program: number): LatchedNote[] {
    const s = this._latched.get(program);
    return s ? [...s.values()] : [];
  }

  /** Whether a specific note is latched on the focused program. */
  isNoteLatched(note: number): boolean {
    return this._latched.get(this._focused)?.has(note) ?? false;
  }

  /** Get the currently focused program. */
  get focusedProgram(): number {
    return this._focused;
  }

  // ── Program pad interaction ──

  /**
   * Handle a program pad tap. Returns the action taken.
   *
   * - Tap a different program → focus (always).
   * - Double-tap the focused program → toggle latch.
   *   - If notes are held → latch them.
   *   - If program has latched notes (and no held notes) → unlatch all.
   */
  handleProgramTap(program: number, now = Date.now()): LatchAction {
    const isDoubleTap =
      program === this._focused &&
      now - this._lastTapTime < SceneLatchManager.DOUBLE_TAP_MS;

    this._lastTapTime = now;

    if (program !== this._focused) {
      this._focused = program;
      return { type: "focus", program };
    }

    if (!isDoubleTap) {
      // Single tap on already-focused program — no-op focus
      return { type: "focus", program };
    }

    // Double-tap on focused program → toggle latch
    if (this._held.size > 0) {
      // Latch currently held notes
      return this._latchHeldNotes(program);
    }

    if (this.isLatched(program)) {
      // Unlatch all notes on this program
      return this._unlatchProgram(program);
    }

    // Double-tap but nothing to latch/unlatch
    return { type: "focus", program };
  }

  /**
   * Set focused program directly (e.g., on startup or programmatic switch).
   * Does not trigger latch logic.
   */
  setFocusedProgram(program: number): void {
    this._focused = program;
    this._lastTapTime = 0; // reset double-tap timer
  }

  /**
   * Clear all latched notes across all programs.
   * Returns all notes that need keyOff sent.
   */
  clearAll(): LatchedNote[] {
    const all: LatchedNote[] = [];
    for (const latchSet of this._latched.values()) {
      for (const n of latchSet.values()) all.push(n);
    }
    this._latched.clear();
    this._held.clear();
    return all;
  }

  // ── Private ──

  private _latchHeldNotes(program: number): LatchAction {
    let latchSet = this._latched.get(program);
    if (!latchSet) {
      latchSet = new Map();
      this._latched.set(program, latchSet);
    }
    const notes: LatchedNote[] = [];
    for (const n of this._held.values()) {
      latchSet.set(n.note, { ...n });
      notes.push({ ...n });
    }
    return { type: "latch", program, notes };
  }

  private _unlatchProgram(program: number): LatchAction {
    const latchSet = this._latched.get(program);
    const notes = latchSet ? [...latchSet.values()] : [];
    this._latched.delete(program);
    return { type: "unlatch", program, notes };
  }
}
