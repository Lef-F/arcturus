/**
 * Virtual MIDI Device — mock implementation of the Web MIDI API.
 * Simulates MIDIAccess with virtual KeyStep and BeatStep devices.
 */

import { IDENTITY_REQUEST, ARTURIA_MANUFACTURER_ID } from "@/midi/fingerprint";

// ── SysEx identity bytes for virtual devices ──

/** KeyStep: family [0x02, 0x00], model [0x04, 0x00] */
export const KEYSTEP_IDENTITY: Readonly<{
  familyCode: [number, number];
  modelCode: [number, number];
  firmwareVersion: [number, number, number, number];
}> = {
  familyCode: [0x02, 0x00],
  modelCode: [0x04, 0x00],
  firmwareVersion: [0x01, 0x00, 0x00, 0x00],
};

/** BeatStep: family [0x02, 0x00], model [0x05, 0x00] */
export const BEATSTEP_IDENTITY: Readonly<{
  familyCode: [number, number];
  modelCode: [number, number];
  firmwareVersion: [number, number, number, number];
}> = {
  familyCode: [0x02, 0x00],
  modelCode: [0x05, 0x00],
  firmwareVersion: [0x01, 0x00, 0x00, 0x00],
};

// ── Identity reply builder ──

function buildIdentityReply(
  deviceId: number,
  identity: typeof KEYSTEP_IDENTITY
): Uint8Array {
  return new Uint8Array([
    0xf0,
    0x7e,
    deviceId & 0x7f,
    0x06,
    0x02,
    ...ARTURIA_MANUFACTURER_ID,
    ...identity.familyCode,
    ...identity.modelCode,
    ...identity.firmwareVersion,
    0xf7,
  ]);
}

// ── Virtual MIDI Port base ──

interface VirtualMIDIPortOptions {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
}

// ── Virtual MIDI Output ──

export class VirtualMIDIOutput implements MIDIOutput {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly version: string;
  readonly type = "output" as const;
  readonly state = "connected" as const;
  readonly connection = "open" as const;
  onstatechange: ((event: Event) => void) | null = null;

  sentMessages: Uint8Array[] = [];

  // When set, this function is called with each sent message
  // allowing the paired input to react (e.g. SysEx loopback)
  private _onSend?: (data: Uint8Array) => void;

  constructor(opts: VirtualMIDIPortOptions, onSend?: (data: Uint8Array) => void) {
    this.id = opts.id;
    this.name = opts.name;
    this.manufacturer = opts.manufacturer;
    this.version = opts.version;
    this._onSend = onSend;
  }

  send(data: Uint8Array | number[], _timestamp?: number): void {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.sentMessages.push(bytes);
    this._onSend?.(bytes);
  }

  clear(): void {
    this.sentMessages = [];
  }

  open(): Promise<MIDIPort> {
    return Promise.resolve(this);
  }

  close(): Promise<MIDIPort> {
    return Promise.resolve(this);
  }

  addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {}

  removeEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {}

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

// ── Virtual MIDI Input ──

export class VirtualMIDIInput implements MIDIInput {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly version: string;
  readonly type = "input" as const;
  readonly state = "connected" as const;
  readonly connection = "open" as const;
  onstatechange: ((event: Event) => void) | null = null;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null = null;

  private _listeners: Array<(event: MIDIMessageEvent) => void> = [];

  constructor(opts: VirtualMIDIPortOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.manufacturer = opts.manufacturer;
    this.version = opts.version;
  }

  /** Fire a MIDI message as if it came from hardware. */
  fireMessage(data: Uint8Array): void {
    const event = new MessageEvent("midimessage", { data }) as MIDIMessageEvent;
    this.onmidimessage?.(event);
    for (const listener of this._listeners) {
      listener(event);
    }
  }

  open(): Promise<MIDIPort> {
    return Promise.resolve(this);
  }

  close(): Promise<MIDIPort> {
    return Promise.resolve(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (type === "midimessage" && typeof listener === "function") {
      this._listeners.push(listener as (event: MIDIMessageEvent) => void);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {
    if (type === "midimessage" && typeof listener === "function") {
      this._listeners = this._listeners.filter((l) => l !== listener);
    }
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

// ── Virtual Device pair (input + output with SysEx loopback) ──

function isIdentityRequest(data: Uint8Array): boolean {
  if (data.length !== IDENTITY_REQUEST.length) return false;
  return IDENTITY_REQUEST.every((b, i) => data[i] === b);
}

export interface VirtualDevice {
  input: VirtualMIDIInput;
  output: VirtualMIDIOutput;
}

export function createVirtualDevice(
  name: string,
  deviceId: number,
  identity: typeof KEYSTEP_IDENTITY
): VirtualDevice {
  const opts: VirtualMIDIPortOptions = {
    id: `virtual-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    manufacturer: "Arturia",
    version: "1.0",
  };

  const input = new VirtualMIDIInput(opts);

  const output = new VirtualMIDIOutput(opts, (data: Uint8Array) => {
    if (isIdentityRequest(data)) {
      // Simulate hardware responding to identity request
      const reply = buildIdentityReply(deviceId, identity);
      // Use a microtask to simulate async hardware response
      queueMicrotask(() => input.fireMessage(reply));
    }
  });

  return { input, output };
}

// ── Virtual MIDI Access ──

export class VirtualMIDIAccess implements MIDIAccess {
  readonly sysexEnabled: boolean = true;
  readonly inputs: Map<string, MIDIInput>;
  readonly outputs: Map<string, MIDIOutput>;
  onstatechange: ((event: MIDIConnectionEvent) => void) | null = null;

  constructor(devices: VirtualDevice[]) {
    const inputs = new Map<string, MIDIInput>();
    const outputs = new Map<string, MIDIOutput>();

    for (const device of devices) {
      inputs.set(device.input.id, device.input);
      outputs.set(device.output.id, device.output);
    }

    this.inputs = inputs;
    this.outputs = outputs;
  }

  addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {}

  removeEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {}

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

// ── Factory: create standard two-device test environment ──

export interface TestMIDIEnvironment {
  access: VirtualMIDIAccess;
  keystep: VirtualDevice;
  beatstep: VirtualDevice;
}

export function createTestMIDIEnvironment(): TestMIDIEnvironment {
  const keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
  const beatstep = createVirtualDevice("BeatStep", 0x02, BEATSTEP_IDENTITY);

  const access = new VirtualMIDIAccess([keystep, beatstep]);

  return { access, keystep, beatstep };
}
