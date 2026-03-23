/**
 * MIDI Manager — Web MIDI API access, port enumeration, message routing.
 */

import type { DeviceFingerprint } from "@/types";
import {
  IDENTITY_REQUEST,
  isArturiaIdentityReply,
  parseIdentityReply,
  identifyDevice,
} from "./fingerprint";

// ── Types ──

export type DeviceType = "keystep" | "beatstep";

export interface DiscoveredDevice {
  type: DeviceType;
  fingerprint: DeviceFingerprint;
  inputPort: MIDIInput;
  outputPort: MIDIOutput;
  portName: string;
}

export type MIDIMessageHandler = (data: Uint8Array) => void;

// ── Manager ──

export class MIDIManager {
  private _access: MIDIAccess | null = null;
  private _keystepInput: MIDIInput | null = null;
  private _beatstepInput: MIDIInput | null = null;
  private _keystepOutput: MIDIOutput | null = null;
  private _beatstepOutput: MIDIOutput | null = null;

  /** Fired when a message arrives from the KeyStep. */
  onKeystepMessage?: MIDIMessageHandler;
  /** Fired when a message arrives from the BeatStep. */
  onBeatstepMessage?: MIDIMessageHandler;
  /** Fired when devices are discovered / re-discovered. */
  onDevicesDiscovered?: (devices: DiscoveredDevice[]) => void;
  /** Fired when a port connection state changes. */
  onStateChange?: (event: MIDIConnectionEvent) => void;

  /**
   * Request MIDI access from the browser.
   * Throws if the Web MIDI API is unavailable.
   */
  async requestAccess(): Promise<MIDIAccess> {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI API not supported in this browser.");
    }
    this._access = await navigator.requestMIDIAccess({ sysex: true });
    this._access.onstatechange = (event) => {
      this.onStateChange?.(event as MIDIConnectionEvent);
      // Re-run discovery if a port connects or disconnects
      if (
        (event as MIDIConnectionEvent).port?.state === "connected" ||
        (event as MIDIConnectionEvent).port?.state === "disconnected"
      ) {
        void this.discoverDevices();
      }
    };
    return this._access;
  }

  /**
   * Discover Arturia devices by sending SysEx Identity Requests to all
   * output ports and listening for Identity Replies on all input ports.
   *
   * @param timeoutMs - How long to wait for replies (default 500ms)
   */
  discoverDevices(timeoutMs = 500): Promise<DiscoveredDevice[]> {
    if (!this._access) return Promise.resolve([]);

    return new Promise((resolve) => {
      const pending = new Map<string, { input: MIDIInput; output: MIDIOutput }>();
      const discovered: DiscoveredDevice[] = [];
      const listeners = new Map<
        string,
        (event: MIDIMessageEvent) => void
      >();

      // Match inputs and outputs by name (port.name may be null on some browsers)
      const inputsByName = new Map<string, MIDIInput>();
      this._access!.inputs.forEach((input) => {
        if (input.name) inputsByName.set(input.name, input);
      });

      this._access!.outputs.forEach((output) => {
        if (!output.name) return;
        const input = inputsByName.get(output.name);
        if (input) {
          pending.set(output.name, { input, output });
        }
      });

      // Set up listeners on all matched inputs
      pending.forEach(({ input, output }, portName) => {
        const handler = (event: MIDIMessageEvent) => {
          if (!event.data) return;
          if (!isArturiaIdentityReply(event.data)) return;

          const fingerprint = parseIdentityReply(event.data);
          const type = identifyDevice(fingerprint);
          if (type) {
            discovered.push({ type, fingerprint, inputPort: input, outputPort: output, portName });
            this._assignDevice(type, input, output);
          }
        };
        listeners.set(portName, handler);
        input.addEventListener("midimessage", handler);
        output.send(IDENTITY_REQUEST);
      });

      // Clean up and resolve after timeout
      setTimeout(() => {
        pending.forEach(({ input }, portName) => {
          const h = listeners.get(portName);
          if (h) input.removeEventListener("midimessage", h);
        });
        this.onDevicesDiscovered?.(discovered);
        resolve(discovered);
      }, timeoutMs);
    });
  }

  /** Route an incoming MIDI message from the appropriate device handler. */
  private _handleInput(deviceType: DeviceType, data: Uint8Array): void {
    if (deviceType === "keystep") {
      this.onKeystepMessage?.(data);
    } else {
      this.onBeatstepMessage?.(data);
    }
  }

  private _assignDevice(
    type: DeviceType,
    input: MIDIInput,
    output: MIDIOutput
  ): void {
    // Remove old listener if re-assigning
    if (type === "keystep") {
      this._keystepInput?.removeEventListener("midimessage", this._keystepListener);
      this._keystepInput = input;
      this._keystepOutput = output;
      input.addEventListener("midimessage", this._keystepListener);
    } else {
      this._beatstepInput?.removeEventListener("midimessage", this._beatstepListener);
      this._beatstepInput = input;
      this._beatstepOutput = output;
      input.addEventListener("midimessage", this._beatstepListener);
    }
  }

  private readonly _keystepListener = (event: Event): void => {
    const data = (event as MIDIMessageEvent).data;
    if (data) this._handleInput("keystep", data);
  };

  private readonly _beatstepListener = (event: Event): void => {
    const data = (event as MIDIMessageEvent).data;
    if (data) this._handleInput("beatstep", data);
  };

  /** Send raw bytes to the KeyStep output. */
  sendToKeystep(data: Uint8Array): void {
    try {
      this._keystepOutput?.send(data);
    } catch {
      // Silently ignore send errors
    }
  }

  /** Send raw bytes to the BeatStep output. */
  sendToBeatstep(data: Uint8Array): void {
    try {
      this._beatstepOutput?.send(data);
    } catch {
      // Silently ignore send errors
    }
  }

  get keystepOutput(): MIDIOutput | null { return this._keystepOutput; }
  get beatstepOutput(): MIDIOutput | null { return this._beatstepOutput; }
  get keystepInput(): MIDIInput | null { return this._keystepInput; }
  get beatstepInput(): MIDIInput | null { return this._beatstepInput; }
  get access(): MIDIAccess | null { return this._access; }
}
