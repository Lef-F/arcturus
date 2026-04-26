/**
 * Computer Keyboard Input — QWERTY notes, Z/X octave shift, focus filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ComputerKeyboardInput } from "./computer-keyboard";

describe("ComputerKeyboardInput", () => {
  let input: ComputerKeyboardInput;
  let noteOns: Array<{ channel: number; note: number; velocity: number }>;
  let noteOffs: Array<{ channel: number; note: number }>;
  let octaveChanges: number[];
  let programTaps: number[];
  let moduleTaps: number[];

  beforeEach(() => {
    input = new ComputerKeyboardInput();
    noteOns = [];
    noteOffs = [];
    octaveChanges = [];
    programTaps = [];
    moduleTaps = [];
    input.onNoteOn = (channel, note, velocity) => noteOns.push({ channel, note, velocity });
    input.onNoteOff = (channel, note) => noteOffs.push({ channel, note });
    input.onOctaveChange = (octave) => octaveChanges.push(octave);
    input.onProgramTap = (slot) => programTaps.push(slot);
    input.onModuleTap = (slot) => moduleTaps.push(slot);
    input.attach();
  });

  afterEach(() => {
    input.detach();
  });

  function key(type: "keydown" | "keyup", k: string, opts: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...opts }));
  }

  /** Number-key dispatch needs `code` since `key` is layout-/shift-dependent ("!" on Shift+1). */
  function digit(type: "keydown" | "keyup", n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0, opts: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent(type, {
      key: opts.shiftKey ? "!@#$%^&*()"[n] ?? String(n) : String(n),
      code: `Digit${n}`,
      bubbles: true,
      ...opts,
    }));
  }

  it("default octave is 4 (C4 = MIDI 48)", () => {
    key("keydown", "a");
    expect(noteOns).toEqual([{ channel: 1, note: 48, velocity: 100 }]);
  });

  it("releases note on keyup", () => {
    key("keydown", "a");
    key("keyup", "a");
    expect(noteOffs).toEqual([{ channel: 1, note: 48 }]);
  });

  it("repeats are ignored (no double note-on)", () => {
    key("keydown", "a");
    key("keydown", "a", { repeat: true });
    key("keydown", "a", { repeat: true });
    expect(noteOns).toHaveLength(1);
  });

  it("Z shifts octave down, X shifts up", () => {
    key("keydown", "z");
    expect(input.octave).toBe(3);
    expect(octaveChanges).toEqual([3]);

    key("keydown", "x");
    key("keydown", "x");
    expect(input.octave).toBe(5);
    expect(octaveChanges).toEqual([3, 4, 5]);
  });

  it("octave is clamped to [0, 8]", () => {
    for (let i = 0; i < 10; i++) key("keydown", "z");
    expect(input.octave).toBe(0);

    for (let i = 0; i < 12; i++) key("keydown", "x");
    expect(input.octave).toBe(8);
  });

  it("W/E/T/Y/U produce sharps (C# D# F# G# A#)", () => {
    key("keydown", "w"); // C#4 = 49
    key("keydown", "e"); // D#4 = 51
    key("keydown", "t"); // F#4 = 54
    key("keydown", "y"); // G#4 = 56
    key("keydown", "u"); // A#4 = 58

    expect(noteOns.map((n) => n.note)).toEqual([49, 51, 54, 56, 58]);
  });

  it("K plays the next octave's C", () => {
    key("keydown", "k"); // C5 = 60 from oct 4? No — oct=4 means base 48, k=12 → 60
    expect(noteOns).toEqual([{ channel: 1, note: 60, velocity: 100 }]);
  });

  it("ignores keystrokes when an INPUT element has focus", () => {
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    document.body.appendChild(inputEl);
    inputEl.focus();

    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(noteOns).toHaveLength(0);

    document.body.removeChild(inputEl);
  });

  it("ignores keystrokes when contenteditable element has focus", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    div.focus();

    div.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(noteOns).toHaveLength(0);

    document.body.removeChild(div);
  });

  it("ignores Cmd/Ctrl/Alt-modified keys (browser shortcuts)", () => {
    key("keydown", "a", { metaKey: true });
    key("keydown", "a", { ctrlKey: true });
    key("keydown", "a", { altKey: true });
    expect(noteOns).toHaveLength(0);
  });

  it("releases all held notes on window blur", () => {
    key("keydown", "a");
    key("keydown", "s");
    expect(input.heldNoteCount).toBe(2);

    window.dispatchEvent(new Event("blur"));
    expect(input.heldNoteCount).toBe(0);
    expect(noteOffs).toHaveLength(2);
  });

  it("detach() removes listeners and releases held notes", () => {
    key("keydown", "a");
    expect(input.heldNoteCount).toBe(1);

    input.detach();
    expect(input.heldNoteCount).toBe(0);
    expect(noteOffs).toHaveLength(1);

    // After detach, further keys are ignored
    const before = noteOns.length;
    key("keydown", "s");
    expect(noteOns).toHaveLength(before);
  });

  it("attach() is idempotent — calling twice does not duplicate handlers", () => {
    input.attach(); // already attached in beforeEach
    key("keydown", "a");
    expect(noteOns).toHaveLength(1);
  });

  // ── Program/module pad bindings (1–8 / Shift+1–8) ──

  it("number keys 1–8 fire onProgramTap with slot 0–7", () => {
    digit("keydown", 1);
    digit("keydown", 8);
    expect(programTaps).toEqual([0, 7]);
    expect(moduleTaps).toEqual([]);
  });

  it("Shift + number keys 1–8 fire onModuleTap with slot 0–7", () => {
    digit("keydown", 1, { shiftKey: true });
    digit("keydown", 4, { shiftKey: true });
    expect(moduleTaps).toEqual([0, 3]);
    expect(programTaps).toEqual([]);
  });

  it("number key 9 / 0 fire neither callback (out of range)", () => {
    digit("keydown", 9);
    digit("keydown", 0);
    expect(programTaps).toEqual([]);
    expect(moduleTaps).toEqual([]);
  });

  it("Cmd/Ctrl + 1 does not fire onProgramTap (browser shortcut)", () => {
    digit("keydown", 1, { metaKey: true });
    digit("keydown", 1, { ctrlKey: true });
    expect(programTaps).toEqual([]);
  });

  it("number keys are ignored while a form input has focus", () => {
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    document.body.appendChild(inputEl);
    inputEl.focus();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true }));
    expect(programTaps).toEqual([]);
    document.body.removeChild(inputEl);
  });

  it("number keys do not double-trigger as notes", () => {
    digit("keydown", 1);
    expect(noteOns).toEqual([]);
  });
});
