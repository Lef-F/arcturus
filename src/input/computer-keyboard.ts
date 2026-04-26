/**
 * Computer Keyboard Input — QWERTY plays notes, Z/X shift octaves.
 *
 * Always available — coexists with any plugged-in MIDI keyboard. No virtual
 * MIDI port; we just call the same callbacks the MIDI note router uses.
 *
 * Layout:
 *   A S D F G H J K  →  C  D  E  F  G  A  B  C
 *      W E   T Y U   →    C# D#   F# G# A#
 *   Z = octave down, X = octave up
 *
 * Typing into form inputs (text/number/textarea/contenteditable) is ignored
 * so users can edit fields without the synth eating their keystrokes.
 */

const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0,  // C
  w: 1,  // C#
  s: 2,  // D
  e: 3,  // D#
  d: 4,  // E
  f: 5,  // F
  t: 6,  // F#
  g: 7,  // G
  y: 8,  // G#
  h: 9,  // A
  u: 10, // A#
  j: 11, // B
  k: 12, // C (next octave)
};

const DEFAULT_VELOCITY = 100;
const MIN_OCTAVE = 0;
const MAX_OCTAVE = 8;
const DEFAULT_OCTAVE = 4;

export class ComputerKeyboardInput {
  private _octave = DEFAULT_OCTAVE;
  private _heldNotes = new Set<number>();
  private _attached = false;

  /** Fires when a QWERTY note key is pressed (synthetic Note On). */
  onNoteOn?: (channel: number, note: number, velocity: number) => void;

  /** Fires when a QWERTY note key is released (synthetic Note Off). */
  onNoteOff?: (channel: number, note: number) => void;

  /** Fires when Z/X shifts the octave. */
  onOctaveChange?: (octave: number) => void;

  get octave(): number { return this._octave; }
  get heldNoteCount(): number { return this._heldNotes.size; }

  attach(): void {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener("keydown", this._handleKeyDown);
    document.addEventListener("keyup", this._handleKeyUp);
    window.addEventListener("blur", this._releaseAll);
  }

  detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener("keydown", this._handleKeyDown);
    document.removeEventListener("keyup", this._handleKeyUp);
    window.removeEventListener("blur", this._releaseAll);
    this._releaseAll();
  }

  // ── Private ──

  /** Skip when the user is typing into a form field. */
  private _isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === "INPUT") {
      const type = (target as HTMLInputElement).type;
      // Numeric/range/checkbox aren't text-bearing in the usual sense, but the
      // safe default is to suppress typing notes whenever any input has focus.
      return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
    }
    return tag === "TEXTAREA" || tag === "SELECT";
  }

  private _setOctave(next: number): void {
    const clamped = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, next));
    if (clamped === this._octave) return;
    this._octave = clamped;
    this.onOctaveChange?.(this._octave);
  }

  private _releaseAll = (): void => {
    if (this._heldNotes.size === 0) return;
    for (const note of this._heldNotes) {
      this.onNoteOff?.(1, note);
    }
    this._heldNotes.clear();
  };

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't hijack browser shortcuts
    if (this._isTextInput(e.target)) return;

    const key = e.key.toLowerCase();

    if (key === "z") {
      this._setOctave(this._octave - 1);
      return;
    }
    if (key === "x") {
      this._setOctave(this._octave + 1);
      return;
    }

    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined) return;

    const note = this._octave * 12 + semitone;
    if (note < 0 || note > 127) return;
    if (this._heldNotes.has(note)) return;

    this._heldNotes.add(note);
    this.onNoteOn?.(1, note, DEFAULT_VELOCITY);
  };

  private _handleKeyUp = (e: KeyboardEvent): void => {
    if (this._isTextInput(e.target)) return;
    const key = e.key.toLowerCase();
    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined) return;

    const note = this._octave * 12 + semitone;
    if (!this._heldNotes.has(note)) return;
    this._heldNotes.delete(note);
    this.onNoteOff?.(1, note);
  };
}
