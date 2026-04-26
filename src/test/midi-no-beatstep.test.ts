/**
 * MIDIManager: scenarios with no BeatStep present.
 *
 * Verifies the soft-fail path: every connected input becomes a generic note
 * source, no BeatStep is ever assigned, and onNoteSourceMessage routes
 * correctly even when there are multiple keyboards plugged in.
 */

import { describe, it, expect } from "vitest";
import { MIDIManager } from "@/midi/manager";
import {
  VirtualMIDIAccess,
  VirtualMIDIInput,
  VirtualMIDIOutput,
  createVirtualDevice,
  KEYSTEP_IDENTITY,
} from "./virtual-midi";

function makeKeyboard(name: string, id: string): { input: VirtualMIDIInput; output: VirtualMIDIOutput } {
  const opts = { id, name, manufacturer: "Generic", version: "1.0" };
  return { input: new VirtualMIDIInput(opts), output: new VirtualMIDIOutput(opts) };
}

describe("MIDIManager: no BeatStep scenarios", () => {
  it("hasBeatstep is false when no BeatStep port exists", async () => {
    const kb = makeKeyboard("MPK Mini", "mpk-1");
    const access = new VirtualMIDIAccess([kb]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    const state = await mgr.discoverDevices(50);
    expect(state.hasBeatstep).toBe(false);
    expect(state.noteSourceNames).toContain("MPK Mini");
    expect(mgr.beatstepInput).toBeNull();
  });

  it("routes notes from a non-BeatStep keyboard to onNoteSourceMessage", async () => {
    const kb = makeKeyboard("LaunchKey", "lk-1");
    const access = new VirtualMIDIAccess([kb]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    await mgr.discoverDevices(50);

    const received: Uint8Array[] = [];
    mgr.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    kb.input.fireMessage(new Uint8Array([0x90, 60, 100]));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(new Uint8Array([0x90, 60, 100]));
  });

  it("routes notes from MULTIPLE keyboards to the same onNoteSourceMessage", async () => {
    const a = makeKeyboard("Keyboard A", "a-1");
    const b = makeKeyboard("Keyboard B", "b-1");
    const access = new VirtualMIDIAccess([a, b]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    await mgr.discoverDevices(50);

    const received: Uint8Array[] = [];
    mgr.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    a.input.fireMessage(new Uint8Array([0x90, 60, 100]));
    b.input.fireMessage(new Uint8Array([0x90, 64, 110]));

    expect(received).toHaveLength(2);
  });

  it("a real KeyStep is treated as a generic note source (not special-cased)", async () => {
    const keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
    const access = new VirtualMIDIAccess([keystep]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    const state = await mgr.discoverDevices(50);
    expect(state.hasBeatstep).toBe(false);
    expect(state.noteSourceNames).toContain("KeyStep");

    // The KeyStep's messages flow through onNoteSourceMessage, NOT a dedicated callback.
    const received: Uint8Array[] = [];
    mgr.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    keystep.input.fireMessage(new Uint8Array([0xe0, 0x00, 0x40])); // pitch bend center
    expect(received).toHaveLength(1);
  });

  it("BeatStep messages do not leak into onNoteSourceMessage", async () => {
    const keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
    const opts = { id: "bs", name: "BeatStep", manufacturer: "Arturia", version: "1.0" };
    const beatstep = { input: new VirtualMIDIInput(opts), output: new VirtualMIDIOutput(opts) };
    const access = new VirtualMIDIAccess([keystep, beatstep]);

    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    await mgr.discoverDevices(50);

    const noteSourceMsgs: Uint8Array[] = [];
    const beatstepMsgs: Uint8Array[] = [];
    mgr.onNoteSourceMessage = (data: Uint8Array) => noteSourceMsgs.push(data);
    mgr.onBeatstepMessage = (data: Uint8Array) => beatstepMsgs.push(data);

    keystep.input.fireMessage(new Uint8Array([0x90, 60, 100]));
    beatstep.input.fireMessage(new Uint8Array([0xb0, 1, 70]));

    expect(noteSourceMsgs).toHaveLength(1);
    expect(noteSourceMsgs[0][0]).toBe(0x90);
    expect(beatstepMsgs).toHaveLength(1);
    expect(beatstepMsgs[0][0]).toBe(0xb0);
  });

  it("empty MIDIAccess produces an empty state — no errors", async () => {
    const access = new VirtualMIDIAccess([]);
    const mgr = new MIDIManager();
    (mgr as unknown as { _access: VirtualMIDIAccess })._access = access;

    const state = await mgr.discoverDevices(50);
    expect(state.hasBeatstep).toBe(false);
    expect(state.noteSourceNames).toEqual([]);
    expect(mgr.noteSourceCount).toBe(0);
  });
});
