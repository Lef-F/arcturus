/**
 * Calibration flow — first-run device identification and encoder characterization.
 *
 * Steps:
 *   1. MIDI permission granted
 *   2. Broadcast SysEx Identity Request
 *   3. Wait for Identity Replies (identifies KeyStep + BeatStep)
 *   4. Sequential knob-turn identification: "Turn any knob on Device 1"
 *   5. Encoder CC characterization: record CC numbers for all 16 encoders
 *   6. Store calibration profile in IndexedDB
 */

import type { DeviceFingerprint, EncoderCalibration } from "@/types";
import { isArturiaIdentityReply, parseIdentityReply, identifyDevice } from "./fingerprint";
import { persistHardwareProfile } from "@/state/hardware-map";

// ── Calibration state ──

export type CalibrationStep =
  | "idle"
  | "requesting_permission"
  | "discovering"
  | "identify_device_1"
  | "identify_device_2"
  | "characterizing_encoders"
  | "saving"
  | "complete"
  | "error";

export interface CalibrationState {
  step: CalibrationStep;
  error: string | null;
  device1?: { fingerprint: DeviceFingerprint; portName: string; input: MIDIInput; output: MIDIOutput };
  device2?: { fingerprint: DeviceFingerprint; portName: string; input: MIDIInput; output: MIDIOutput };
  encoderCCs: number[]; // discovered CC numbers for encoders 0-15
  encodersFound: number; // how many encoder CCs have been discovered so far
}

// ── Calibration result ──

export interface CalibrationResult {
  keystep: { fingerprint: DeviceFingerprint; portName: string };
  beatstep: {
    fingerprint: DeviceFingerprint;
    portName: string;
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
  };

  /** Called whenever the state changes — wire to UI updates. */
  onStateChange?: (state: CalibrationState) => void;

  // ── Public API ──

  /**
   * Run the full calibration sequence.
   * Requires MIDI access to be already granted (call navigator.requestMIDIAccess first).
   *
   * @param access - MIDIAccess from requestMIDIAccess({ sysex: true })
   * @param timeoutMs - timeout for each discovery/identification step (default 10s)
   */
  async run(access: MIDIAccess, timeoutMs = 10000): Promise<CalibrationResult> {
    this._access = access;
    this._setState({ step: "discovering" });

    // Step 1: Discover Arturia devices via SysEx
    const discovered = await this._discoverDevices(timeoutMs);
    if (discovered.length < 2) {
      return this._error(
        `Only ${discovered.length} Arturia device(s) found. Connect both KeyStep and BeatStep.`
      );
    }

    // Step 2: Identify which device is which (turn-a-knob flow)
    this._setState({ step: "identify_device_1" });
    const device1 = await this._identifyByEncoderTurn(discovered, timeoutMs);
    if (!device1) {
      return this._error("Device 1 identification timed out. Please turn a knob.");
    }
    this.state.device1 = device1;
    this._setState({ step: "identify_device_2" });

    // Device 2 is whichever wasn't identified as device 1
    const device2Candidate = discovered.find((d) => d.input !== device1.input);
    if (!device2Candidate) {
      return this._error("Could not identify second device.");
    }
    this.state.device2 = {
      fingerprint: device2Candidate.fingerprint,
      portName: device2Candidate.portName,
      input: device2Candidate.input,
      output: device2Candidate.output,
    };

    // Assign roles: device that responded to encoder turn is BeatStep (control_plane)
    // The other is KeyStep (performer)
    const beatstepDevice = this.state.device1;
    const keystepDevice = this.state.device2;

    // Step 3: Characterize BeatStep encoder CC numbers
    this._setState({ step: "characterizing_encoders" });
    const encoderCalibration = await this._characterizeEncoders(
      beatstepDevice.input,
      timeoutMs
    );

    // Step 4: Save profiles
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
        encoderCalibration
      ),
    ]);

    this._setState({ step: "complete" });

    return {
      keystep: { fingerprint: keystepDevice.fingerprint, portName: keystepDevice.portName },
      beatstep: {
        fingerprint: beatstepDevice.fingerprint,
        portName: beatstepDevice.portName,
        encoderCalibration,
      },
    };
  }

  // ── Private helpers ──

  private async _discoverDevices(timeoutMs: number): Promise<DiscoveredDevice[]> {
    if (!this._access) return [];
    const IDENTITY_REQUEST = new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    const found: DiscoveredDevice[] = [];
    const listeners = new Map<string, (e: Event) => void>();

    // Build port name → input map
    const inputsByName = new Map<string, MIDIInput>();
    this._access.inputs.forEach((input) => {
      if (input.name) inputsByName.set(input.name, input);
    });

    return new Promise((resolve) => {
      this._access!.outputs.forEach((output) => {
        if (!output.name) return;
        const input = inputsByName.get(output.name);
        if (!input) return;

        const portName = output.name;
        const handler = (event: Event) => {
          const data = (event as MIDIMessageEvent).data;
          if (!data) return;
          if (!isArturiaIdentityReply(data)) return;
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
      }, timeoutMs);
    });
  }

  /**
   * Identify which device the user turns a knob on first.
   * Returns the device data for the device that generated a CC message.
   */
  private _identifyByEncoderTurn(
    discovered: DiscoveredDevice[],
    timeoutMs: number
  ): Promise<DiscoveredDevice | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const handlers: Array<{ input: MIDIInput; handler: (e: Event) => void }> = [];

      const cleanup = () => {
        for (const { input, handler } of handlers) {
          input.removeEventListener("midimessage", handler);
        }
      };

      for (const device of discovered) {
        const { input } = device;
        const handler = (event: Event) => {
          const data = (event as MIDIMessageEvent).data;
          if (!data) return;
          const status = data[0] & 0xf0;
          if (status !== 0xb0) return; // only CC messages
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(device);
        };
        handlers.push({ input, handler });
        input.addEventListener("midimessage", handler);
      }

      setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolve(null);
        }
      }, timeoutMs);
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
        // Use whatever we found, padding with default CC numbers if needed
        const padded = [...orderedCCs];
        for (let i = padded.length; i < 16; i++) {
          padded.push(i + 1); // default CC 1-16
        }
        resolve(buildEncoderCalibration(padded));
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
  return ccNumbers.slice(0, 16).map((_, i) => ({
    encoderIndex: i,
    deadzone: 2,
    accelerationCurve: [1, 2, 3, 4, 5, 6],
    sensitivity: 1 / 64,
  }));
}
