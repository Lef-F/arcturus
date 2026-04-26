/**
 * Calibration flow — characterize a connected BeatStep so the app knows which
 * CC each encoder sends and which note each pad emits. Runs once per fresh
 * BeatStep; the saved profile lets us skip calibration on subsequent boots.
 *
 * Steps:
 *   1. Find the BeatStep (port-name + SysEx fingerprint)
 *   2. Wait for any input from it (avoids accidental encoder assignment)
 *   3. Master encoder: user turns the large top-left knob
 *   4. 16 encoders in order, top-left → bottom-right
 *   5. Pad row 1 — press all 8 module pads
 *   6. Pad row 2 — press all 8 program pads
 *   7. Save the BeatStep profile to IndexedDB
 *
 * No timeouts inside steps — every step waits for the user.
 */

import type { DeviceFingerprint, EncoderCalibration, BeatStepMapping } from "@/types";
import { isArturiaIdentityReply, parseIdentityReply, identifyDevice, identifyByPortName, IDENTITY_REQUEST } from "./fingerprint";
import { persistBeatStepProfile } from "@/state/hardware-map";

// ── Calibration state ──

export type CalibrationStep =
  | "idle"
  | "discovering"
  | "no_beatstep"
  | "waiting_to_begin"
  | "characterizing_master"
  | "characterizing_encoders"
  | "characterizing_pad_row1"
  | "characterizing_pad_row2"
  | "saving"
  | "complete"
  | "error";

export interface CalibrationState {
  step: CalibrationStep;
  error: string | null;
  encoderCCs: number[];
  encodersFound: number;
  masterFound: boolean;
  padsFound: number; // 0 or 1 for current row (base-note capture)
  padRow: 1 | 2;
}

// ── Calibration result ──

export interface CalibrationResult {
  fingerprint: DeviceFingerprint;
  portName: string;
  mapping: BeatStepMapping;
  encoderCalibration: EncoderCalibration[];
}

interface BeatStepDevice {
  fingerprint: DeviceFingerprint;
  portName: string;
  input: MIDIInput;
  output: MIDIOutput;
}

// ── Calibration controller ──

export class CalibrationController {
  /** Brief delay to prevent accidental input assignment. Set to 0 for tests. */
  settleMs = 500;

  private _access: MIDIAccess | null = null;
  state: CalibrationState = {
    step: "idle",
    error: null,
    encoderCCs: [],
    encodersFound: 0,
    masterFound: false,
    padsFound: 0,
    padRow: 1,
  };

  onStateChange?: (state: CalibrationState) => void;

  /** If set, calling finalizeEncoders() during characterization resolves with current results. */
  private _finalizeEncoders?: () => void;

  /**
   * Skip the rest of encoder characterization and proceed with whatever CCs
   * have been found so far. No-op if not currently in the encoder step.
   * Useful when a user has fewer than 16 working encoders.
   */
  finalizeEncoders(): void {
    this._finalizeEncoders?.();
  }

  // ── Public API ──

  /**
   * Run the calibration flow. Returns null if no BeatStep is connected
   * (state.step === "no_beatstep"). Throws only on unexpected errors.
   */
  async run(access: MIDIAccess): Promise<CalibrationResult | null> {
    this._access = access;
    this._setState({ step: "discovering" });

    const beatstep = await this._findBeatstep();
    if (!beatstep) {
      this._setState({ step: "no_beatstep" });
      return null;
    }

    this._setState({ step: "waiting_to_begin" });
    await this._waitForAnyInput(beatstep.input);
    if (this.settleMs > 0) await _sleep(this.settleMs);

    // Master encoder FIRST (leftmost — user expects it first).
    // Register the listener BEFORE setState so it's ready when autoRespond fires.
    const masterPromise = this._characterizeMasterEncoder(beatstep.input);
    this._setState({ step: "characterizing_master", masterFound: false });
    const masterCC = await masterPromise;
    this._setState({ masterFound: true });
    if (this.settleMs > 0) await _sleep(this.settleMs);

    const encoderPromise = this._characterizeEncoders(beatstep.input, masterCC);
    this._setState({ step: "characterizing_encoders" });
    const encoderCalibration = await encoderPromise;
    if (this.settleMs > 0) await _sleep(this.settleMs);

    const allCCs = [...encoderCalibration.map((c) => c.cc), masterCC];

    const padRow1Promise = this._characterizePadRow(beatstep.input, allCCs, 8);
    this._setState({ step: "characterizing_pad_row1", padsFound: 0, padRow: 1 });
    const padRow1Notes = await padRow1Promise;
    // No settle delay between pad rows — user flows naturally from pad 8 to pad 9

    const padRow2Promise = this._characterizePadRow(beatstep.input, allCCs, 8);
    this._setState({ step: "characterizing_pad_row2", padsFound: 0, padRow: 2 });
    const padRow2Notes = await padRow2Promise;

    const mapping: BeatStepMapping = {
      encoders: encoderCalibration.map((c) => ({ index: c.encoderIndex, cc: c.cc })),
      masterCC,
      padRow1Notes,
      padRow2Notes,
    };

    this._setState({ step: "saving" });
    await persistBeatStepProfile(beatstep.fingerprint, beatstep.portName, mapping, encoderCalibration);

    this._setState({ step: "complete" });

    return {
      fingerprint: beatstep.fingerprint,
      portName: beatstep.portName,
      mapping,
      encoderCalibration,
    };
  }

  // ── Private helpers ──

  /**
   * Find a connected BeatStep — port-name first (instant), SysEx fallback.
   * Returns null if no BeatStep is found.
   */
  private async _findBeatstep(): Promise<BeatStepDevice | null> {
    if (!this._access) return null;

    const inputsByName = new Map<string, MIDIInput>();
    this._access.inputs.forEach((input) => {
      if (input.name) inputsByName.set(input.name, input);
    });

    // Pass 1: port name (instant, and the only thing that works on real BeatSteps)
    for (const [portName, input] of inputsByName) {
      if (identifyByPortName(portName) !== "beatstep") continue;
      const output = Array.from(this._access.outputs.values()).find((o) => o.name === portName);
      if (!output) continue;
      const fingerprint: DeviceFingerprint = {
        manufacturerId: [0x00, 0x20, 0x6b],
        familyCode: [0x02, 0x00],
        modelCode: [0x05, 0x00],
        firmwareVersion: [0x00, 0x00, 0x00, 0x00],
      };
      return { fingerprint, portName, input, output };
    }

    // Pass 2: SysEx (in case the port has a non-standard name)
    return new Promise((resolve) => {
      let found: BeatStepDevice | null = null;
      const listeners = new Map<string, (e: Event) => void>();

      this._access!.outputs.forEach((output) => {
        if (!output.name) return;
        const input = inputsByName.get(output.name);
        if (!input) return;

        const portName = output.name;
        const handler = (event: Event) => {
          if (found) return;
          const data = (event as MIDIMessageEvent).data;
          if (!data || !isArturiaIdentityReply(data)) return;
          const fingerprint = parseIdentityReply(data);
          if (identifyDevice(fingerprint) === "beatstep") {
            found = { fingerprint, portName, input, output };
          }
        };

        listeners.set(portName, handler);
        input.addEventListener("midimessage", handler);
        try {
          output.send(IDENTITY_REQUEST);
        } catch {
          // Ignore — handler simply won't fire
        }
      });

      setTimeout(() => {
        listeners.forEach((handler, portName) => {
          inputsByName.get(portName)?.removeEventListener("midimessage", handler);
        });
        resolve(found);
      }, 2000);
    });
  }

  /**
   * Wait for any MIDI input from the BeatStep (encoder turn, pad press, anything).
   * Used as a "press any key to begin" gate.
   */
  private _waitForAnyInput(input: MIDIInput): Promise<void> {
    return new Promise((resolve) => {
      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 2) return;
        const status = data[0] & 0xf0;
        // Accept CC, Note On (with velocity), ignore SysEx/poly AT
        if (status === 0xb0 || (status === 0x90 && data.length >= 3 && data[2] > 0)) {
          input.removeEventListener("midimessage", handler);
          resolve();
        }
      };
      input.addEventListener("midimessage", handler);
    });
  }

  /**
   * Characterize master encoder — waits for a CC message (no timeout).
   */
  private _characterizeMasterEncoder(input: MIDIInput): Promise<number> {
    return new Promise((resolve) => {
      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        if ((data[0] & 0xf0) !== 0xb0) return;
        input.removeEventListener("midimessage", handler);
        resolve(data[1]);
      };
      input.addEventListener("midimessage", handler);
    });
  }

  /**
   * Characterize 16 encoder CCs. Excludes master CC.
   * No timeout — waits until all 16 are found.
   */
  private _characterizeEncoders(input: MIDIInput, masterCC: number): Promise<EncoderCalibration[]> {
    return new Promise((resolve) => {
      const seenCCs = new Set<number>();
      const orderedCCs: number[] = [];

      const finish = () => {
        input.removeEventListener("midimessage", handler);
        this._finalizeEncoders = undefined;
        resolve(buildEncoderCalibration(orderedCCs));
      };

      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        if ((data[0] & 0xf0) !== 0xb0) return;
        const cc = data[1];
        if (cc === masterCC) return; // ignore master encoder
        if (seenCCs.has(cc)) return;
        seenCCs.add(cc);
        orderedCCs.push(cc);
        this._setState({
          encoderCCs: [...orderedCCs],
          encodersFound: orderedCCs.length,
        });
        if (orderedCCs.length >= 16) {
          finish();
        }
      };

      // Allow caller to finalize early (partial discovery)
      this._finalizeEncoders = () => {
        if (orderedCCs.length > 0) finish();
      };

      input.addEventListener("midimessage", handler);
    });
  }

  /**
   * Capture a row of pads — user presses all N pads in sequence.
   * Accepts any unique Note On. Deduplicates within the row.
   * No timeout — waits until all N unique pads are pressed.
   */
  private _characterizePadRow(input: MIDIInput, excludedCCs: number[], count: number): Promise<number[]> {
    const excluded = new Set(excludedCCs);
    return new Promise((resolve) => {
      const notes: number[] = [];
      const seen = new Set<number>();

      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        if (status === 0xb0 && excluded.has(data[1])) return;
        if (status === 0xa0) return; // poly aftertouch
        if (status !== 0x90 || data[2] === 0) return;
        const note = data[1];
        if (seen.has(note)) return; // already captured this pad
        seen.add(note);
        notes.push(note);
        this._setState({ padsFound: notes.length });

        if (notes.length >= count) {
          input.removeEventListener("midimessage", handler);
          resolve(notes);
        }
      };

      input.addEventListener("midimessage", handler);
    });
  }

  private _setState(partial: Partial<CalibrationState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }
}

// ── Helpers ──

function buildEncoderCalibration(ccNumbers: number[]): EncoderCalibration[] {
  return ccNumbers.slice(0, 16).map((cc, i) => ({
    encoderIndex: i,
    cc,
    deadzone: 2,
    accelerationCurve: [1, 2, 3, 4, 5, 6],
    sensitivity: 1 / 64,
  }));
}

function _sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
