/**
 * MIDI Manager — Web MIDI API access, port enumeration, message routing.
 *
 * Exactly one device is "special": the BeatStep. It needs identification (so
 * we can run calibration once) and dedicated routing (its CCs/notes drive
 * encoders and pads, not the engine).
 *
 * Every other connected MIDI input is a "note source" — its notes, pitch
 * bend, aftertouch, mod wheel, and panic CCs go straight to the engine.
 * Note sources need no identification or calibration.
 */

import { isArturiaIdentityReply, parseIdentityReply, identifyDevice, identifyByPortName } from "./fingerprint";

// ── Types ──

export type MIDIMessageHandler = (data: Uint8Array) => void;

export interface MIDIDevicesState {
  /** True iff a BeatStep input/output pair is currently connected. */
  hasBeatstep: boolean;
  /** Names of every non-BeatStep MIDI input port currently connected. */
  noteSourceNames: string[];
}

// ── Manager ──

export class MIDIManager {
  private _access: MIDIAccess | null = null;

  // BeatStep — singular, identified
  private _beatstepInput: MIDIInput | null = null;
  private _beatstepOutput: MIDIOutput | null = null;

  // Note sources — every other input port
  private _noteSourceInputs = new Map<string, MIDIInput>();

  /** Fired when a message arrives from the BeatStep. */
  onBeatstepMessage?: MIDIMessageHandler;

  /** Fired when a message arrives from any non-BeatStep MIDI input. */
  onNoteSourceMessage?: MIDIMessageHandler;

  /** Fired when the set of connected devices changes (after each discovery pass). */
  onDevicesChanged?: (state: MIDIDevicesState) => void;

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
    this._access.addEventListener("statechange", (event) => {
      this.onStateChange?.(event as MIDIConnectionEvent);
      const port = (event as MIDIConnectionEvent).port;
      if (port?.state === "connected" || port?.state === "disconnected") {
        void this.discoverDevices();
      }
    });
    return this._access;
  }

  /**
   * Discover the BeatStep (if connected) and refresh the set of generic note
   * sources. Identification uses SysEx Identity Request first, port-name
   * fallback after the timeout (BeatStep cannot generate a SysEx reply).
   *
   * @param timeoutMs - How long to wait for SysEx replies (default 500ms)
   */
  discoverDevices(timeoutMs = 500): Promise<MIDIDevicesState> {
    if (!this._access) return Promise.resolve({ hasBeatstep: false, noteSourceNames: [] });

    return new Promise((resolve) => {
      const access = this._access!;
      const beatstepCandidates = new Map<string, { input: MIDIInput; output: MIDIOutput }>();
      const sysexListeners = new Map<string, (event: MIDIMessageEvent) => void>();
      let beatstepFound = false;

      // Pair every input with an output of the same name (Web MIDI port-pair convention).
      const inputsByName = new Map<string, MIDIInput>();
      access.inputs.forEach((input) => {
        if (input.name) inputsByName.set(input.name, input);
      });

      access.outputs.forEach((output) => {
        if (!output.name) return;
        const input = inputsByName.get(output.name);
        if (input) {
          beatstepCandidates.set(output.name, { input, output });
        }
      });

      const claimBeatstep = (input: MIDIInput, output: MIDIOutput) => {
        if (beatstepFound) return;
        beatstepFound = true;
        this._assignBeatstep(input, output);
      };

      // Pass 1: SysEx Identity Request to every paired output
      beatstepCandidates.forEach(({ input, output }, portName) => {
        const handler = (event: MIDIMessageEvent) => {
          if (!event.data || !isArturiaIdentityReply(event.data)) return;
          const fingerprint = parseIdentityReply(event.data);
          if (identifyDevice(fingerprint) === "beatstep") {
            claimBeatstep(input, output);
          }
        };
        sysexListeners.set(portName, handler);
        input.addEventListener("midimessage", handler);
        try {
          output.send(new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]));
        } catch {
          // Some ports refuse SysEx — port-name fallback will catch it below.
        }
      });

      setTimeout(() => {
        beatstepCandidates.forEach(({ input }, portName) => {
          const h = sysexListeners.get(portName);
          if (h) input.removeEventListener("midimessage", h);
        });

        // Pass 2: port-name fallback. BeatStep doesn't reply to SysEx so this
        // is the path that actually identifies it on real hardware.
        if (!beatstepFound) {
          for (const [portName, { input, output }] of beatstepCandidates) {
            if (identifyByPortName(portName) === "beatstep") {
              claimBeatstep(input, output);
              break;
            }
          }
        }

        // If a previously assigned BeatStep is no longer present, drop the
        // stale references so `hasBeatstep` reports the truth and `clock`
        // stops sending to a dead output on the next tick.
        if (this._beatstepInput && !beatstepFound) {
          let stillPresent = false;
          access.inputs.forEach((input) => { if (input === this._beatstepInput) stillPresent = true; });
          if (!stillPresent) this._releaseBeatstep();
        }

        // Anything that wasn't claimed as a BeatStep is a note source.
        this._refreshNoteSources(access, this._beatstepInput);

        const state: MIDIDevicesState = {
          hasBeatstep: this._beatstepInput !== null,
          noteSourceNames: Array.from(this._noteSourceInputs.values()).map((i) => i.name ?? "").filter(Boolean),
        };
        this.onDevicesChanged?.(state);
        resolve(state);
      }, timeoutMs);
    });
  }

  /** Send raw bytes to the BeatStep output. */
  sendToBeatstep(data: Uint8Array): void {
    try {
      this._beatstepOutput?.send(data);
    } catch {
      // Silently ignore send errors
    }
  }

  get beatstepInput(): MIDIInput | null { return this._beatstepInput; }
  get beatstepOutput(): MIDIOutput | null { return this._beatstepOutput; }
  get access(): MIDIAccess | null { return this._access; }
  get noteSourceCount(): number { return this._noteSourceInputs.size; }

  // ── Private ──

  private _assignBeatstep(input: MIDIInput, output: MIDIOutput): void {
    if (this._beatstepInput === input) return; // already assigned
    if (this._beatstepInput) {
      this._beatstepInput.removeEventListener("midimessage", this._beatstepListener);
    }
    this._beatstepInput = input;
    this._beatstepOutput = output;
    input.addEventListener("midimessage", this._beatstepListener);
  }

  private _releaseBeatstep(): void {
    this._beatstepInput?.removeEventListener("midimessage", this._beatstepListener);
    this._beatstepInput = null;
    this._beatstepOutput = null;
  }

  private _refreshNoteSources(access: MIDIAccess, beatstepInput: MIDIInput | null): void {
    // Build the new set from current access; detach listeners on any input
    // that disappeared, attach to anything new. Beatstep never counts as a
    // note source.
    const next = new Map<string, MIDIInput>();
    access.inputs.forEach((input) => {
      if (input === beatstepInput) return;
      next.set(input.id, input);
    });

    // Drop inputs that are no longer present.
    for (const [id, input] of this._noteSourceInputs) {
      if (!next.has(id)) {
        input.removeEventListener("midimessage", this._noteSourceListener);
        this._noteSourceInputs.delete(id);
      }
    }
    // Attach to any new ones.
    for (const [id, input] of next) {
      if (!this._noteSourceInputs.has(id)) {
        input.addEventListener("midimessage", this._noteSourceListener);
        this._noteSourceInputs.set(id, input);
      }
    }
  }

  private readonly _beatstepListener = (event: Event): void => {
    const data = (event as MIDIMessageEvent).data;
    if (data) this.onBeatstepMessage?.(data);
  };

  private readonly _noteSourceListener = (event: Event): void => {
    const data = (event as MIDIMessageEvent).data;
    if (data) this.onNoteSourceMessage?.(data);
  };
}
