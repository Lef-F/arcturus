/**
 * Pads — BeatStep pad handling.
 * Top row (pads 0-7): patch selection via Program Change on channel 10.
 * Bottom row (pads 8-15): performance triggers via Note On on channel 10.
 *
 * BeatStep default pad notes: 36-51 (C2-D#3).
 * Program Change channel: channel 10 (status byte 0xC9).
 */

// ── MIDI constants ──
const PROGRAM_CHANGE_STATUS = 0xc9; // Program Change on channel 10
const NOTE_ON_STATUS = 0x99;        // Note On on channel 10
const NOTE_OFF_STATUS = 0x89;       // Note Off on channel 10

/** First MIDI note for BeatStep bottom row pads (pads 8-15) */
const PAD_BASE_NOTE = 36;

// ── Callbacks ──

export type PatchSelectHandler = (slot: number) => void; // slot 0-7
export type TriggerHandler = (padIndex: number, velocity: number) => void; // padIndex 8-15

// ── PadHandler ──

export class PadHandler {
  /** Called when a top-row pad selects a patch slot (0-7). */
  onPatchSelect?: PatchSelectHandler;
  /** Called when a bottom-row pad triggers (padIndex 8-15, velocity 1-127). */
  onTrigger?: TriggerHandler;
  /** Called when a bottom-row pad is released. */
  onTriggerRelease?: (padIndex: number) => void;

  /**
   * Process a raw MIDI message from the BeatStep pads.
   * Returns true if handled.
   */
  handleMessage(data: Uint8Array): boolean {
    if (data.length < 2) return false;

    const status = data[0];

    // Program Change → top row patch select
    if (status === PROGRAM_CHANGE_STATUS) {
      const program = data[1] & 0x7f;
      // Programs 0-7 map to patch slots 0-7
      if (program <= 7) {
        this.onPatchSelect?.(program);
      }
      return true;
    }

    // Note On → bottom row trigger
    if (status === NOTE_ON_STATUS && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      const padIndex = note - PAD_BASE_NOTE;

      if (padIndex >= 8 && padIndex <= 15) {
        if (velocity === 0) {
          this.onTriggerRelease?.(padIndex);
        } else {
          this.onTrigger?.(padIndex, velocity);
        }
        return true;
      }
    }

    // Note Off → bottom row release
    if (status === NOTE_OFF_STATUS && data.length >= 3) {
      const note = data[1];
      const padIndex = note - PAD_BASE_NOTE;
      if (padIndex >= 8 && padIndex <= 15) {
        this.onTriggerRelease?.(padIndex);
        return true;
      }
    }

    return false;
  }
}

// ── LED feedback ──

/**
 * Build a Note On message to light up a BeatStep pad LED.
 * Send to BeatStep output to indicate the active patch slot.
 *
 * @param padIndex - 0-15 (0 = pad 1 top row, 8 = pad 9 bottom row)
 * @param velocity - LED brightness / color (127 = full on, 0 = off)
 */
export function buildPadLedMessage(padIndex: number, velocity: number): Uint8Array {
  const note = PAD_BASE_NOTE + padIndex;
  return new Uint8Array([NOTE_ON_STATUS, note & 0x7f, velocity & 0x7f]);
}
