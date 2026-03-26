/**
 * Patches — Save/load, autosave (debounced 2s), slot management.
 *
 * Slot 1-8 maps to BeatStep top-row pads (Program Change 0-7).
 * Autosave: any parameter change triggers a 2s debounced save to the current slot.
 */

import type { Patch } from "@/types";
import {
  savePatch,
  updatePatch,
  getPatchBySlot,
  getAllPatches,
  deletePatch,
} from "./db";

const AUTOSAVE_DELAY_MS = 2000;
const SLOT_MIN = 1;
const SLOT_MAX = 8;

// ── PatchManager ──

export class PatchManager {
  private _currentSlot = 1;
  private _autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _dirty = false;

  /** Called after a patch loads successfully. */
  onPatchLoad?: (patch: Patch) => void;

  /** Called after a patch saves. */
  onPatchSave?: (patch: Patch) => void;

  /** Called when an autosave or save fails. */
  onSaveError?: (err: unknown) => void;

  /** Called when the current slot changes. */
  onSlotChange?: (slot: number) => void;

  get currentSlot(): number {
    return this._currentSlot;
  }

  // ── Patch load ──

  /**
   * Load a patch from the given slot (1-8).
   * Returns the loaded patch or null if the slot is empty.
   */
  async load(slot: number): Promise<Patch | null> {
    const clamped = clampSlot(slot);
    const patch = await getPatchBySlot(clamped);
    if (!patch) return null;
    this._currentSlot = clamped;
    this._dirty = false;
    this.onPatchLoad?.(patch);
    this.onSlotChange?.(clamped);
    return patch;
  }

  // ── Patch save ──

  /**
   * Save parameter values to the given slot (defaults to current slot).
   */
  async save(parameters: Record<string, number>, name?: string, slot?: number): Promise<Patch> {
    const targetSlot = clampSlot(slot ?? this._currentSlot);
    const existing = await getPatchBySlot(targetSlot);
    const now = Date.now();

    if (existing) {
      const updated: Patch = {
        ...existing,
        parameters,
        name: name ?? existing.name,
        updatedAt: now,
      };
      await updatePatch(updated);
      this._dirty = false;
      this.onPatchSave?.(updated);
      return updated;
    }

    const patchId = await savePatch({
      name: name ?? `Patch ${targetSlot}`,
      slot: targetSlot,
      parameters,
      createdAt: now,
      updatedAt: now,
    });

    const newPatch: Patch = {
      patchId,
      name: name ?? `Patch ${targetSlot}`,
      slot: targetSlot,
      parameters,
      createdAt: now,
      updatedAt: now,
    };
    this._dirty = false;
    this.onPatchSave?.(newPatch);
    return newPatch;
  }

  // ── Autosave ──

  /**
   * Mark parameters as dirty and schedule autosave.
   * Call this whenever a parameter changes.
   */
  markDirty(parameters: Record<string, number>): void {
    this._dirty = true;
    if (this._autosaveTimer !== null) {
      clearTimeout(this._autosaveTimer);
    }
    this._autosaveTimer = setTimeout(() => {
      if (this._dirty) {
        this.save(parameters).catch((err: unknown) => { this.onSaveError?.(err); });
      }
    }, AUTOSAVE_DELAY_MS);
  }

  /** Cancel any pending autosave. */
  cancelAutosave(): void {
    if (this._autosaveTimer !== null) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  get isDirty(): boolean {
    return this._dirty;
  }

  // ── Slot switching ──

  /**
   * Switch to a slot. Does not load parameters (caller decides whether to load).
   * Fires onSlotChange.
   */
  selectSlot(slot: number): void {
    this._currentSlot = clampSlot(slot);
    this.onSlotChange?.(this._currentSlot);
  }

  // ── Batch operations ──

  /** Load all patches from IndexedDB. Returns slots 1-8 with nulls for empty. */
  async loadAll(): Promise<Array<Patch | null>> {
    const patches = await getAllPatches();
    const result: Array<Patch | null> = new Array(SLOT_MAX - SLOT_MIN + 1).fill(null);
    for (const p of patches) {
      const idx = p.slot - SLOT_MIN;
      if (idx >= 0 && idx < result.length) {
        result[idx] = p;
      }
    }
    return result;
  }

  /** Delete a patch from a slot. */
  async deleteSlot(slot: number): Promise<void> {
    const clamped = clampSlot(slot);
    const existing = await getPatchBySlot(clamped);
    if (existing?.patchId !== undefined) {
      await deletePatch(existing.patchId);
    }
  }
}

// ── Helpers ──

function clampSlot(slot: number): number {
  return Math.max(SLOT_MIN, Math.min(SLOT_MAX, Math.round(slot)));
}
