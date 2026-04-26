/**
 * Patches I/O — export and import the eight patch slots as JSON.
 *
 * Round-trip envelope:
 *   { version, exportedAt, patches: [{ slot, name, parameters }, …] }
 *
 * Empty slots are omitted from the export. Import replaces every slot
 * mentioned in the file (others are left alone) — no merge logic, no
 * backwards-compat shims for older envelope shapes.
 */

import type { Patch } from "@/types";
import { PatchManager } from "./patches";
import { getAllPatches } from "./db";

export const PATCH_EXPORT_VERSION = 1 as const;

export interface PatchEnvelope {
  version: typeof PATCH_EXPORT_VERSION;
  exportedAt: string; // ISO 8601
  patches: Array<{
    slot: number;
    name: string;
    parameters: Record<string, number>;
  }>;
}

// ── Build / parse ──

export async function buildExport(): Promise<PatchEnvelope> {
  const patches = await getAllPatches();
  // Collapse any duplicate-per-slot records to the most-recent one so the
  // exported file is deterministic even if the store is in a degenerate state.
  const bySlot = new Map<number, Patch>();
  for (const p of patches) {
    const existing = bySlot.get(p.slot);
    if (!existing || p.updatedAt > existing.updatedAt) {
      bySlot.set(p.slot, p);
    }
  }
  const sorted = Array.from(bySlot.values()).sort((a, b) => a.slot - b.slot);
  return {
    version: PATCH_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    patches: sorted.map((p: Patch) => ({
      slot: p.slot,
      name: p.name,
      parameters: p.parameters,
    })),
  };
}

export class InvalidEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEnvelopeError";
  }
}

/**
 * Validate and parse a JSON string into a PatchEnvelope.
 * Throws InvalidEnvelopeError with a human-readable reason on failure.
 */
export function parseEnvelope(json: string): PatchEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new InvalidEnvelopeError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new InvalidEnvelopeError("Top-level value must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== PATCH_EXPORT_VERSION) {
    throw new InvalidEnvelopeError(`Unsupported version: ${String(obj.version)} (expected ${PATCH_EXPORT_VERSION}).`);
  }
  if (!Array.isArray(obj.patches)) {
    throw new InvalidEnvelopeError("Missing or non-array `patches` field.");
  }
  const patches: PatchEnvelope["patches"] = [];
  for (const [i, entry] of obj.patches.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new InvalidEnvelopeError(`patches[${i}] is not an object.`);
    }
    const e = entry as Record<string, unknown>;
    const slot = typeof e.slot === "number" ? e.slot : NaN;
    if (!Number.isFinite(slot) || slot < 1 || slot > 8) {
      throw new InvalidEnvelopeError(`patches[${i}].slot must be 1–8 (got ${String(e.slot)}).`);
    }
    if (typeof e.name !== "string") {
      throw new InvalidEnvelopeError(`patches[${i}].name must be a string.`);
    }
    if (!e.parameters || typeof e.parameters !== "object") {
      throw new InvalidEnvelopeError(`patches[${i}].parameters must be an object.`);
    }
    const params = e.parameters as Record<string, unknown>;
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new InvalidEnvelopeError(`patches[${i}].parameters.${k} must be a finite number.`);
      }
      cleaned[k] = v;
    }
    patches.push({ slot: Math.round(slot), name: e.name, parameters: cleaned });
  }
  return {
    version: PATCH_EXPORT_VERSION,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
    patches,
  };
}

// ── Apply ──

/**
 * Replace every slot mentioned in the envelope. Slots not present in the
 * envelope are left alone. Returns the number of slots written.
 *
 * Saves run in parallel — each PatchManager.save targets a different slot,
 * so there's no write-write contention. Cuts an 8-patch import from
 * ~8× single-save latency to ~1× on typical IndexedDB.
 */
export async function applyImport(envelope: PatchEnvelope, patchManager: PatchManager): Promise<number> {
  await Promise.all(envelope.patches.map((p) => patchManager.save(p.parameters, p.name, p.slot)));
  return envelope.patches.length;
}

// ── Browser-side helpers (download / file pick) ──

/** Trigger a JSON file download in the browser. */
export function downloadEnvelope(envelope: PatchEnvelope, filename = defaultFilename()): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on next tick so Safari has a chance to start the download
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Open a file picker and resolve with the parsed JSON text.
 * Resolves with null if the user dismisses the dialog.
 */
export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        settled = true;
        cleanup();
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        settled = true;
        cleanup();
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => {
        settled = true;
        cleanup();
        reject(reader.error ?? new Error("FileReader failed"));
      };
      reader.readAsText(file);
    });

    // Cancel detection: the focus returns to the window without a change event.
    const onFocus = () => {
      // Defer so a real `change` event still gets a chance to fire first.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, 200);
    };
    window.addEventListener("focus", onFocus, { once: true });

    function cleanup() {
      window.removeEventListener("focus", onFocus);
      input.remove();
    }

    input.click();
  });
}

function defaultFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `arcturus-presets-${stamp}.json`;
}
