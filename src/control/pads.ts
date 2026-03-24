/**
 * Pads — BeatStep pad handling.
 *
 * Row 1 (pads 1-8)  — module select.
 *   Detected as: Note On (any channel) notes 44-51 (BeatStep factory default)
 *                OR Program Change (any channel) programs 0-7 (configured mode / fake controllers)
 *
 * Row 2 (pads 9-16) — program (patch) select.
 *   Detected as: Note On (any channel) notes 36-43 (BeatStep factory default)
 */

// ── MIDI constants ──
// Channel-agnostic: mask with 0xf0 to match any MIDI channel.
const NOTE_ON_TYPE = 0x90;
const NOTE_OFF_TYPE = 0x80;
const PROGRAM_CHANGE_TYPE = 0xc0;

/** BeatStep row 1 (pads 1-8) base note — module select */
const MODULE_ROW_BASE = 44; // notes 44-51
/** BeatStep row 2 (pads 9-16) base note — patch select */
const PATCH_ROW_BASE = 36; // notes 36-43

// ── Callbacks ──

export type PadSelectHandler = (slot: number) => void; // slot 0-7

// ── PadHandler ──

export class PadHandler {
  /** Called when a row-1 pad selects a module slot (0-7). */
  onModuleSelect?: PadSelectHandler;
  /** Called when a row-2 pad selects a patch slot (0-7). */
  onPatchSelect?: PadSelectHandler;

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

      // Row 1: notes 44-51 → module select
      if (note >= MODULE_ROW_BASE && note < MODULE_ROW_BASE + 8) {
        if (isOn) this.onModuleSelect?.(note - MODULE_ROW_BASE);
        return true;
      }

      // Row 2: notes 36-43 → patch select
      if (note >= PATCH_ROW_BASE && note < PATCH_ROW_BASE + 8) {
        if (isOn) this.onPatchSelect?.(note - PATCH_ROW_BASE);
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
 * Physical layout:
 *   padIndex 0-7  = row 1 (pads 1-8),  notes 44-51 → module select LEDs
 *   padIndex 8-15 = row 2 (pads 9-16), notes 36-43 → patch select LEDs
 *
 * @param padIndex - 0-7 = row 1, 8-15 = row 2
 * @param velocity - 1-127 = on, 0 = off
 */
export function buildPadLedMessage(padIndex: number, velocity: number): Uint8Array {
  // Row 1 (padIndex 0-7) → notes 44-51; row 2 (padIndex 8-15) → notes 36-43
  const note = padIndex < 8
    ? MODULE_ROW_BASE + padIndex
    : PATCH_ROW_BASE + (padIndex - 8);
  // BeatStep LED control requires Note On on channel 10 (0x99) regardless of
  // which channel the pads send on.
  return new Uint8Array([0x99, note & 0x7f, velocity & 0x7f]);
}
