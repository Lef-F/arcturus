/**
 * Pads — BeatStep pad handling.
 *
 * Row 1 (pads 1-8)  — module select.
 *   Detected as: Note On (any channel), base note from calibration profile.
 *                OR Program Change (any channel) programs 0-7 (fake controllers).
 *
 * Row 2 (pads 9-16) — program (patch) select.
 *   Detected as: Note On (any channel), base note from calibration profile.
 *
 * Base notes are set from the hardware profile via setPadNotes().
 */

// ── MIDI constants ──
// Channel-agnostic: mask with 0xf0 to match any MIDI channel.
const NOTE_ON_TYPE = 0x90;
const NOTE_OFF_TYPE = 0x80;
const PROGRAM_CHANGE_TYPE = 0xc0;

/** Default BeatStep row 1 (pads 1-8) base note — module select */
export const DEFAULT_MODULE_ROW_BASE = 44;
/** Default BeatStep row 2 (pads 9-16) base note — patch select */
export const DEFAULT_PATCH_ROW_BASE = 36;

// ── Callbacks ──

export type PadSelectHandler = (slot: number) => void; // slot 0-7

// ── PadHandler ──

export class PadHandler {
  /** Called when a row-1 pad selects a module slot (0-7). */
  onModuleSelect?: PadSelectHandler;
  /** Called when a row-2 pad selects a patch slot (0-7). */
  onPatchSelect?: PadSelectHandler;

  private _moduleBase = DEFAULT_MODULE_ROW_BASE;
  private _patchBase = DEFAULT_PATCH_ROW_BASE;

  /** Set pad note ranges from calibration profile. */
  setPadNotes(moduleRowBase: number, patchRowBase: number): void {
    this._moduleBase = moduleRowBase;
    this._patchBase = patchRowBase;
  }

  get moduleRowBase(): number { return this._moduleBase; }
  get patchRowBase(): number { return this._patchBase; }

  /**
   * Process a raw MIDI message from the BeatStep pads.
   * Returns true if handled.
   */
  handleMessage(data: Uint8Array): boolean {
    if (data.length < 2) return false;

    const statusType = data[0] & 0xf0;

    // Program Change (any channel) → row 1 module select
    // (BeatStep configured mode or fake controllers)
    if (statusType === PROGRAM_CHANGE_TYPE) {
      const program = data[1] & 0x7f;
      if (program <= 7) {
        this.onModuleSelect?.(program);
        return true;
      }
      return false;
    }

    if ((statusType === NOTE_ON_TYPE || statusType === NOTE_OFF_TYPE) && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      const isOn = statusType === NOTE_ON_TYPE && velocity > 0;

      // Row 1: module select
      if (note >= this._moduleBase && note < this._moduleBase + 8) {
        if (isOn) this.onModuleSelect?.(note - this._moduleBase);
        return true;
      }

      // Row 2: patch select
      if (note >= this._patchBase && note < this._patchBase + 8) {
        if (isOn) this.onPatchSelect?.(note - this._patchBase);
        return true;
      }
    }

    return false;
  }
}

// ── LED feedback ──

/**
 * Build a Note On message to set a BeatStep pad LED.
 * Send to BeatStep output port.
 *
 * @param padIndex - 0-7 = row 1, 8-15 = row 2
 * @param velocity - 1-127 = on, 0 = off
 * @param moduleBase - base note for row 1 (from calibration)
 * @param patchBase - base note for row 2 (from calibration)
 */
export function buildPadLedMessage(
  padIndex: number,
  velocity: number,
  moduleBase = DEFAULT_MODULE_ROW_BASE,
  patchBase = DEFAULT_PATCH_ROW_BASE,
): Uint8Array {
  const note = padIndex < 8
    ? moduleBase + padIndex
    : patchBase + (padIndex - 8);
  // BeatStep LED control requires Note On on channel 10 (0x99) regardless of
  // which channel the pads send on.
  return new Uint8Array([0x99, note & 0x7f, velocity & 0x7f]);
}
