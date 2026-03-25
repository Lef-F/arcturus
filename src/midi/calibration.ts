/**
 * Calibration flow — first-run device identification and encoder/pad characterization.
 *
 * Steps:
 *   1. MIDI permission granted
 *   2. Discover devices by port name (instant) + SysEx fallback (2s for KeyStep)
 *   3. Encoder CC characterization: user turns encoders 1→16 in order
 *   4. Master encoder: user turns the large top-left knob
 *   5. Pad row 1: user presses pad 1 (top-left)
 *   6. Pad row 2: user presses pad 9 (bottom-left)
 *   7. Save profile to IndexedDB
 */

import type { DeviceFingerprint, EncoderCalibration, HardwareMapping } from "@/types";
import { isArturiaIdentityReply, parseIdentityReply, identifyDevice, identifyByPortName } from "./fingerprint";
import { persistHardwareProfile } from "@/state/hardware-map";

// ── Calibration state ──

export type CalibrationStep =
  | "idle"
  | "requesting_permission"
  | "discovering"
  | "characterizing_encoders"
  | "characterizing_master"
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
  padsFound: number; // 0-8 for current row
  padRow: 1 | 2;
}

// ── Calibration result ──

export interface CalibrationResult {
  keystep: { fingerprint: DeviceFingerprint; portName: string };
  beatstep: {
    fingerprint: DeviceFingerprint;
    portName: string;
    mapping: HardwareMapping;
    encoderCalibration: EncoderCalibration[];
  };
}

type DiscoveredDevice = {
  fingerprint: DeviceFingerprint;
  portName: string;
  input: MIDIInput;
  output: MIDIOutput;
};

// ── Calibration controller ──

export class CalibrationController {
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

  /** Called whenever the state changes — wire to UI updates. */
  onStateChange?: (state: CalibrationState) => void;

  // ── Public API ──

  /**
   * Run the full calibration sequence.
   * @param access - MIDIAccess from requestMIDIAccess({ sysex: true })
   * @param timeoutMs - timeout for each characterization step (default 30s)
   */
  async run(access: MIDIAccess, timeoutMs = 30000): Promise<CalibrationResult> {
    this._access = access;
    this._setState({ step: "discovering" });

    // Step 1: Discover devices — port name first, SysEx fallback for KeyStep
    const discovered = await this._discoverDevices();
    if (discovered.length < 2) {
      return this._error(
        `Only ${discovered.length} Arturia device(s) found. Connect both KeyStep and BeatStep.`
      );
    }

    // Assign roles by port name
    const beatstepDevice = discovered.find((d) => identifyByPortName(d.portName) === "beatstep");
    const keystepDevice = discovered.find((d) => identifyByPortName(d.portName) === "keystep")
      ?? discovered.find((d) => d !== beatstepDevice);

    if (!beatstepDevice || !keystepDevice) {
      return this._error("Could not identify BeatStep and KeyStep. Check port names.");
    }

    // Step 2: Characterize BeatStep encoder CC numbers
    this._setState({ step: "characterizing_encoders" });
    const encoderCalibration = await this._characterizeEncoders(
      beatstepDevice.input,
      timeoutMs
    );

    // Step 3: Characterize master encoder (large top-left knob)
    this._setState({ step: "characterizing_master", masterFound: false });
    const masterCC = await this._characterizeMasterEncoder(
      beatstepDevice.input,
      encoderCalibration.map((c) => c.cc),
      timeoutMs
    );
    this._setState({ masterFound: masterCC !== -1 });

    // Step 4: Characterize pad row 1 — user presses all 8 module pads in order
    this._setState({ step: "characterizing_pad_row1", padsFound: 0, padRow: 1 });
    const padRow1Notes = await this._characterizePadRowFull(
      beatstepDevice.input,
      encoderCalibration.map((c) => c.cc),
      8,
      timeoutMs
    );

    // Step 5: Characterize pad row 2 — user presses all 8 program pads in order
    this._setState({ step: "characterizing_pad_row2", padsFound: 0, padRow: 2 });
    const padRow2Notes = await this._characterizePadRowFull(
      beatstepDevice.input,
      encoderCalibration.map((c) => c.cc),
      8,
      timeoutMs
    );

    // Build unified hardware mapping
    const mapping: HardwareMapping = {
      encoders: encoderCalibration.map((c) => ({ index: c.encoderIndex, cc: c.cc })),
      masterCC,
      padRow1Notes,
      padRow2Notes,
    };

    // Step 6: Save profiles
    this._setState({ step: "saving" });
    await Promise.all([
      persistHardwareProfile(
        keystepDevice.fingerprint,
        keystepDevice.portName,
        "performer"
      ),
      persistHardwareProfile(
        beatstepDevice.fingerprint,
        beatstepDevice.portName,
        "control_plane",
        mapping,
        encoderCalibration,
      ),
    ]);

    this._setState({ step: "complete" });

    return {
      keystep: { fingerprint: keystepDevice.fingerprint, portName: keystepDevice.portName },
      beatstep: {
        fingerprint: beatstepDevice.fingerprint,
        portName: beatstepDevice.portName,
        mapping,
        encoderCalibration,
      },
    };
  }

  // ── Private helpers ──

  /**
   * Discover Arturia devices — port-name first (instant), SysEx fallback (2s).
   */
  private async _discoverDevices(): Promise<DiscoveredDevice[]> {
    if (!this._access) return [];
    const found: DiscoveredDevice[] = [];

    // Build port name → input/output map
    const inputsByName = new Map<string, MIDIInput>();
    this._access.inputs.forEach((input) => {
      if (input.name) inputsByName.set(input.name, input);
    });

    // Pass 1: identify by port name (instant)
    inputsByName.forEach((input, portName) => {
      const type = identifyByPortName(portName);
      if (!type) return;
      const output = Array.from(this._access!.outputs.values()).find(
        (o) => o.name === portName
      );
      if (!output) return;
      const fingerprint: DeviceFingerprint = {
        manufacturerId: [0x00, 0x20, 0x6b],
        familyCode: [0x02, 0x00],
        modelCode: [0x00, 0x00],
        firmwareVersion: [0x00, 0x00, 0x00, 0x00],
      };
      found.push({ fingerprint, portName, input, output });
    });

    // If both found by name, we're done — no SysEx wait needed
    if (found.length >= 2) return found;

    // Pass 2: SysEx identity for remaining ports (2s timeout — mainly for KeyStep)
    const IDENTITY_REQUEST = new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    const foundNames = new Set(found.map((d) => d.portName));

    return new Promise((resolve) => {
      const listeners = new Map<string, (e: Event) => void>();

      this._access!.outputs.forEach((output) => {
        if (!output.name || foundNames.has(output.name)) return;
        const input = inputsByName.get(output.name);
        if (!input) return;

        const portName = output.name;
        const handler = (event: Event) => {
          const data = (event as MIDIMessageEvent).data;
          if (!data || !isArturiaIdentityReply(data)) return;
          const fp = parseIdentityReply(data);
          const type = identifyDevice(fp);
          if (type && !found.find((d) => d.portName === portName)) {
            found.push({ fingerprint: fp, portName, input, output });
          }
        };

        listeners.set(portName, handler);
        input.addEventListener("midimessage", handler);
        output.send(IDENTITY_REQUEST);
      });

      setTimeout(() => {
        listeners.forEach((handler, portName) => {
          const inp = inputsByName.get(portName);
          inp?.removeEventListener("midimessage", handler);
        });
        resolve(found);
      }, 2000); // short timeout — KeyStep responds fast if connected
    });
  }

  /**
   * Characterize encoder CC numbers by asking user to turn each encoder.
   * Records the first 16 unique CC numbers seen.
   */
  private _characterizeEncoders(
    input: MIDIInput,
    timeoutMs: number
  ): Promise<EncoderCalibration[]> {
    return new Promise((resolve) => {
      const seenCCs = new Set<number>();
      const orderedCCs: number[] = [];

      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        if (status !== 0xb0) return;
        const cc = data[1];
        if (!seenCCs.has(cc)) {
          seenCCs.add(cc);
          orderedCCs.push(cc);
          this._setState({
            encoderCCs: [...orderedCCs],
            encodersFound: orderedCCs.length,
          });
          if (orderedCCs.length >= 16) {
            input.removeEventListener("midimessage", handler);
            resolve(buildEncoderCalibration(orderedCCs));
          }
        }
      };

      input.addEventListener("midimessage", handler);

      setTimeout(() => {
        input.removeEventListener("midimessage", handler);
        resolve(buildEncoderCalibration(orderedCCs));
      }, timeoutMs);
    });
  }

  /**
   * Wait for the user to turn the large master encoder (top-left).
   * Excludes CCs already claimed by the 16 regular encoders.
   */
  private _characterizeMasterEncoder(
    input: MIDIInput,
    knownEncoderCCs: number[],
    timeoutMs: number
  ): Promise<number> {
    const excluded = new Set(knownEncoderCCs);
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        if ((data[0] & 0xf0) !== 0xb0) return;
        const cc = data[1];
        if (excluded.has(cc)) return;
        if (resolved) return;
        resolved = true;
        input.removeEventListener("midimessage", handler);
        resolve(cc);
      };

      input.addEventListener("midimessage", handler);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          input.removeEventListener("midimessage", handler);
          resolve(-1);
        }
      }, timeoutMs);
    });
  }

  /**
   * Characterize a full pad row by capturing N unique Note On messages.
   * Updates padsFound state on each pad press for visual feedback.
   */
  private _characterizePadRowFull(
    input: MIDIInput,
    knownEncoderCCs: number[],
    count: number,
    timeoutMs: number
  ): Promise<number[]> {
    const excluded = new Set(knownEncoderCCs);
    return new Promise((resolve) => {
      const notes: number[] = [];
      const seenNotes = new Set<number>();

      const handler = (event: Event) => {
        const data = (event as MIDIMessageEvent).data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        if (status === 0xb0 && excluded.has(data[1])) return;
        if (status === 0xa0) return; // poly aftertouch
        if (status !== 0x90 || data[2] === 0) return;
        const note = data[1];
        if (seenNotes.has(note)) return; // ignore duplicate presses
        seenNotes.add(note);
        notes.push(note);
        this._setState({ padsFound: notes.length });
        if (notes.length >= count) {
          input.removeEventListener("midimessage", handler);
          resolve(notes);
        }
      };

      input.addEventListener("midimessage", handler);

      setTimeout(() => {
        input.removeEventListener("midimessage", handler);
        resolve(notes); // return whatever we got
      }, timeoutMs);
    });
  }

  private _setState(partial: Partial<CalibrationState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }

  private _error(message: string): never {
    this._setState({ step: "error", error: message });
    throw new Error(message);
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
