/**
 * KeyStep — processes incoming MIDI from the KeyStep Standard.
 * Handles: notes, pitch bend, aftertouch, transport messages.
 */

import type { SynthEngine } from "@/audio/engine";

// ── MIDI status bytes ──
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const CHANNEL_PRESSURE = 0xd0;
const PITCH_BEND = 0xe0;
const TRANSPORT_START = 0xfa;
const TRANSPORT_CONTINUE = 0xfb;
const TRANSPORT_STOP = 0xfc;

// ── MIDI CC numbers ──
const CC_ALL_NOTES_OFF = 123; // KeyStep triple-stop sends this

// ── Transport callback type ──
export type TransportAction = "start" | "continue" | "stop";
export type TransportHandler = (action: TransportAction) => void;

// ── Pitch bend to cents ──

/**
 * Reconstruct a 14-bit pitch bend value from two 7-bit bytes.
 * Center is 8192. Returns a value in the range [-8192, +8191].
 */
export function decodePitchBend(lsb: number, msb: number): number {
  return ((msb & 0x7f) << 7) | (lsb & 0x7f);
}

/**
 * Convert a 14-bit pitch bend value to semitones.
 * Assumes ±2 semitone range (standard KeyStep default).
 */
export function pitchBendToSemitones(value: number, rangeSemitones = 2): number {
  const centered = value - 8192;
  return (centered / 8192) * rangeSemitones;
}

// ── KeyStep Handler ──

export class KeyStepHandler {
  private _engine: SynthEngine | null = null;
  private _channel = 1; // MIDI channel (1-based)
  private _baseCutoff = 0; // base cutoff value before AT modulation

  /** Called when transport start/continue/stop is received. */
  onTransport?: TransportHandler;

  /** Called when pitch bend changes (value in semitones). */
  onPitchBend?: (semitones: number) => void;

  constructor(engine?: SynthEngine, channel = 1) {
    this._engine = engine ?? null;
    this._channel = channel;
  }

  /** Attach or replace the synth engine. */
  setEngine(engine: SynthEngine): void {
    this._engine = engine;
    this._baseCutoff = engine.getParamValue("cutoff");
  }

  /**
   * Process a raw MIDI message from the KeyStep.
   * Returns true if the message was handled.
   */
  handleMessage(data: Uint8Array): boolean {
    if (data.length === 0) return false;

    const status = data[0];
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    // Handle single-byte real-time transport messages
    if (data.length === 1) {
      return this._handleTransport(status);
    }

    // Only handle messages on our configured channel
    if (channel !== this._channel && type !== 0) {
      // Transport messages don't have a channel, handled above
    }

    if (type === NOTE_ON && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      if (velocity === 0) {
        // Note On with velocity 0 is a Note Off
        this._engine?.keyOff(channel, note, 0);
      } else {
        this._engine?.keyOn(channel, note, velocity);
      }
      return true;
    }

    if (type === NOTE_OFF && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      this._engine?.keyOff(channel, note, velocity);
      return true;
    }

    if (type === PITCH_BEND && data.length >= 3) {
      const semitones = pitchBendToSemitones(decodePitchBend(data[1], data[2]));
      this.onPitchBend?.(semitones);
      // Route pitch bend to oscillator detune
      this._engine?.setParamValue("detune", semitones * 100); // convert to cents
      return true;
    }

    if (type === CONTROL_CHANGE && data.length >= 3) {
      if (data[1] === CC_ALL_NOTES_OFF) {
        this._engine?.allNotesOff();
      }
      return true;
    }

    if ((status & 0xf0) === CHANNEL_PRESSURE && data.length >= 2) {
      const pressure = data[1] / 127; // normalize 0-1
      this._applyAftertouch(pressure);
      return true;
    }

    return false;
  }

  private _handleTransport(status: number): boolean {
    switch (status) {
      case TRANSPORT_START:
        this.onTransport?.("start");
        return true;
      case TRANSPORT_CONTINUE:
        this.onTransport?.("continue");
        return true;
      case TRANSPORT_STOP:
        this.onTransport?.("stop");
        return true;
      default:
        return false;
    }
  }

  /**
   * Aftertouch modulates filter cutoff: adds up to 2 octaves (+12kHz max)
   * of additional cutoff opening on top of the base cutoff setting.
   */
  private _applyAftertouch(pressure: number): void {
    if (!this._engine) return;
    this._baseCutoff = this._engine.getParamValue("cutoff");
    // Additive modulation: at full pressure, adds up to 2× the current cutoff (capped at 20kHz)
    const modded = Math.min(20000, this._baseCutoff * (1 + pressure * 2));
    this._engine.setParamValue("cutoff", modded);
  }
}
