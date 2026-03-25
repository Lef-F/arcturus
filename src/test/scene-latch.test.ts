/**
 * Scene Latch — per-program note latching tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SceneLatchManager } from "@/control/scene-latch";

describe("SceneLatchManager", () => {
  let latch: SceneLatchManager;

  beforeEach(() => {
    latch = new SceneLatchManager();
  });

  // ── Double-tap detection ──

  describe("double-tap detection", () => {
    it("single tap on different program returns focus action", () => {
      const action = latch.handleProgramTap(3, 1000);
      expect(action).toEqual({ type: "focus", program: 3 });
      expect(latch.focusedProgram).toBe(3);
    });

    it("single tap on focused program returns focus (no-op)", () => {
      latch.setFocusedProgram(2);
      const action = latch.handleProgramTap(2, 1000);
      expect(action).toEqual({ type: "focus", program: 2 });
    });

    it("double-tap on focused program with held notes latches them", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);
      latch.noteOn(1, 64, 80);

      // First tap
      latch.handleProgramTap(0, 1000);
      // Second tap within window
      const action = latch.handleProgramTap(0, 1200);

      expect(action.type).toBe("latch");
      if (action.type === "latch") {
        expect(action.notes).toHaveLength(2);
        expect(action.notes.map((n) => n.note).sort()).toEqual([60, 64]);
      }
      expect(latch.isLatched(0)).toBe(true);
    });

    it("double-tap outside window does not latch", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);

      latch.handleProgramTap(0, 1000);
      const action = latch.handleProgramTap(0, 1500); // 500ms > 350ms window

      expect(action.type).toBe("focus");
      expect(latch.isLatched(0)).toBe(false);
    });

    it("double-tap on focused program with latched notes unlatches", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);

      // Latch
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);
      expect(latch.isLatched(0)).toBe(true);

      // Unlatch (need another double-tap — release held notes first so it unlatches)
      latch.noteOff(1, 60); // note-off suppressed but note removed from held
      latch.clearHeld();
      latch.handleProgramTap(0, 2000);
      const action = latch.handleProgramTap(0, 2200);

      expect(action.type).toBe("unlatch");
      if (action.type === "unlatch") {
        expect(action.notes).toHaveLength(1);
        expect(action.notes[0].note).toBe(60);
      }
      expect(latch.isLatched(0)).toBe(false);
    });

    it("tap on different program always just focuses", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);

      const action = latch.handleProgramTap(3, 1000);
      expect(action.type).toBe("focus");
      expect(latch.focusedProgram).toBe(3);
      // Held notes are still tracked (not cleared by focus change)
      expect(latch.getHeldNotes()).toHaveLength(1);
    });
  });

  // ── Note tracking ──

  describe("note tracking", () => {
    it("tracks note-on and note-off", () => {
      latch.noteOn(1, 60, 100);
      latch.noteOn(1, 64, 80);
      expect(latch.getHeldNotes()).toHaveLength(2);

      latch.noteOff(1, 60);
      expect(latch.getHeldNotes()).toHaveLength(1);
      expect(latch.getHeldNotes()[0].note).toBe(64);
    });

    it("noteOff returns false when note is not latched", () => {
      latch.noteOn(1, 60, 100);
      expect(latch.noteOff(1, 60)).toBe(false);
    });

    it("noteOff returns true when note is latched (suppress keyOff)", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);

      // Latch the note
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      // Note-off should be suppressed
      expect(latch.noteOff(1, 60)).toBe(true);
    });

    it("clearHeld empties the held set", () => {
      latch.noteOn(1, 60, 100);
      latch.noteOn(1, 64, 80);
      latch.clearHeld();
      expect(latch.getHeldNotes()).toHaveLength(0);
    });
  });

  // ── Latch state ──

  describe("latch state", () => {
    it("isLatched returns false for programs with no latched notes", () => {
      expect(latch.isLatched(0)).toBe(false);
      expect(latch.isLatched(7)).toBe(false);
    });

    it("getLatchedNotes returns empty array for unlatched program", () => {
      expect(latch.getLatchedNotes(0)).toEqual([]);
    });

    it("isNoteLatched checks the focused program", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      expect(latch.isNoteLatched(60)).toBe(true);
      expect(latch.isNoteLatched(64)).toBe(false);
    });

    it("multiple programs can be latched independently", () => {
      // Latch on program 0
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      // Switch to program 2
      latch.clearHeld();
      latch.handleProgramTap(2, 2000);

      // Latch on program 2
      latch.noteOn(1, 72, 90);
      latch.handleProgramTap(2, 3000);
      latch.handleProgramTap(2, 3200);

      expect(latch.isLatched(0)).toBe(true);
      expect(latch.isLatched(2)).toBe(true);
      expect(latch.isLatched(1)).toBe(false);
      expect(latch.getLatchedNotes(0)[0].note).toBe(60);
      expect(latch.getLatchedNotes(2)[0].note).toBe(72);
    });
  });

  // ── Panic reset ──

  describe("clearAll (panic reset)", () => {
    it("clears all latched notes across all programs", () => {
      // Latch on program 0
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      // Latch on program 3
      latch.clearHeld();
      latch.handleProgramTap(3, 2000);
      latch.noteOn(1, 72, 90);
      latch.handleProgramTap(3, 3000);
      latch.handleProgramTap(3, 3200);

      const released = latch.clearAll();
      expect(released).toHaveLength(2);
      expect(released.map((n) => n.note).sort()).toEqual([60, 72]);
      expect(latch.isLatched(0)).toBe(false);
      expect(latch.isLatched(3)).toBe(false);
      expect(latch.getHeldNotes()).toHaveLength(0);
    });

    it("returns empty array when nothing is latched", () => {
      expect(latch.clearAll()).toEqual([]);
    });
  });

  // ── setFocusedProgram ──

  describe("setFocusedProgram", () => {
    it("resets double-tap timer", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);

      // First tap
      latch.handleProgramTap(0, 1000);

      // Programmatic focus change resets timer
      latch.setFocusedProgram(0);

      // This should be a fresh first tap, not a double-tap
      const action = latch.handleProgramTap(0, 1200);
      expect(action.type).toBe("focus");
      expect(latch.isLatched(0)).toBe(false);
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("double-tap with no held notes and no latch returns focus", () => {
      latch.setFocusedProgram(0);
      latch.handleProgramTap(0, 1000);
      const action = latch.handleProgramTap(0, 1200);
      expect(action.type).toBe("focus");
    });

    it("latching same note twice replaces it (no duplicates)", () => {
      latch.setFocusedProgram(0);
      latch.noteOn(1, 60, 100);
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      // Latch again with different velocity
      latch.noteOn(1, 60, 127);
      latch.handleProgramTap(0, 2000);
      latch.handleProgramTap(0, 2200);

      const latched = latch.getLatchedNotes(0);
      expect(latched).toHaveLength(1);
      expect(latched[0].velocity).toBe(127);
    });

    it("double-tap with held notes when already latched adds to existing latch", () => {
      latch.setFocusedProgram(0);

      // Latch note 60
      latch.noteOn(1, 60, 100);
      latch.handleProgramTap(0, 1000);
      latch.handleProgramTap(0, 1200);

      // Hold note 64 and double-tap again — should add to latch (held takes priority)
      latch.noteOn(1, 64, 90);
      latch.handleProgramTap(0, 2000);
      const action = latch.handleProgramTap(0, 2200);

      expect(action.type).toBe("latch");
      // Both notes should be latched
      expect(latch.getLatchedNotes(0)).toHaveLength(2);
    });
  });
});
