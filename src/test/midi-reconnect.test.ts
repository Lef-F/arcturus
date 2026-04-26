/**
 * MIDIManager reconnect tests — device disconnect/reconnect lifecycle.
 *
 * Verifies that when a MIDI device is physically unplugged and replugged,
 * the MIDIManager re-discovers it and resumes message routing correctly.
 *
 * Uses VirtualMIDIAccess.simulateStateChange() to inject hardware events
 * without touching the browser's real Web MIDI stack.
 */

import { describe, it, expect } from "vitest";
import { MIDIManager } from "@/midi/manager";
import {
  createTestMIDIEnvironment,
  createVirtualDevice,
  VirtualMIDIInput,
  VirtualMIDIOutput,
  VirtualMIDIAccess,
  KEYSTEP_IDENTITY,
} from "./virtual-midi";

/** Wire a MIDIManager to a VirtualMIDIAccess and discover devices. */
async function setupManager(env: ReturnType<typeof createTestMIDIEnvironment>) {
  const manager = new MIDIManager();
  // Bypass browser requestMIDIAccess — inject the virtual access directly
  (manager as unknown as Record<string, unknown>)["_access"] = env.access;
  // Attach statechange handler (normally done inside requestAccess).
  // Use 50ms discovery timeout (vs 500ms default) so tests don't take >500ms each.
  const discoverFn = (manager as unknown as Record<string, (t?: number) => Promise<unknown>>)["discoverDevices"].bind(manager);
  env.access.addEventListener("statechange", (event) => {
    (manager as unknown as Record<string, ((e: MIDIConnectionEvent) => void) | undefined>)["onStateChange"]?.(event as MIDIConnectionEvent);
    const port = (event as MIDIConnectionEvent).port;
    if (port?.state === "connected" || port?.state === "disconnected") {
      void discoverFn(50);
    }
  });
  await manager.discoverDevices(50);
  return manager;
}

describe("MIDIManager: device reconnect", () => {
  it("initial discovery: note source messages route to onNoteSourceMessage", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const received: Uint8Array[] = [];
    manager.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    env.keystep.input.fireMessage(new Uint8Array([0x90, 60, 100]));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(new Uint8Array([0x90, 60, 100]));
  });

  it("disconnect: no crash when device removed, statechange fires", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const stateChanges: string[] = [];
    manager.onStateChange = (e) => stateChanges.push(e.port?.state ?? "unknown");

    expect(() => {
      env.access.simulateStateChange(env.keystep, "disconnected");
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 100));

    expect(stateChanges).toContain("disconnected");
  });

  it("reconnect: messages route again after device re-plugged", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    env.access.simulateStateChange(env.keystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const received: Uint8Array[] = [];
    manager.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    env.keystep.input.fireMessage(new Uint8Array([0x90, 62, 90]));

    expect(received).toHaveLength(1);
  });

  it("reconnect fires onDevicesChanged with the re-discovered device", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const noteSourceCounts: number[] = [];
    manager.onDevicesChanged = (state) => {
      noteSourceCounts.push(state.noteSourceNames.length);
    };

    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    env.access.simulateStateChange(env.keystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    // Should have seen at least one state with the note source present after reconnect.
    expect(noteSourceCounts.some((n) => n >= 1)).toBe(true);
  });

  it("BeatStep reconnect: messages route after disconnect/reconnect", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    env.access.simulateStateChange(env.beatstep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    env.access.simulateStateChange(env.beatstep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const received: Uint8Array[] = [];
    manager.onBeatstepMessage = (data: Uint8Array) => received.push(data);

    env.beatstep.input.fireMessage(new Uint8Array([0xb0, 0x01, 65]));

    expect(received).toHaveLength(1);
  });

  it("reconnect with fresh device object: listener transfers correctly", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    // Create a replacement device (same name but fresh object — like hardware re-enumeration)
    const freshKeystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);

    env.access.inputs.set(freshKeystep.input.id, freshKeystep.input);
    env.access.outputs.set(freshKeystep.output.id, freshKeystep.output);
    env.access.simulateStateChange(freshKeystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const received: Uint8Array[] = [];
    manager.onNoteSourceMessage = (data: Uint8Array) => received.push(data);

    freshKeystep.input.fireMessage(new Uint8Array([0x90, 64, 80]));

    expect(received).toHaveLength(1);
  });
});

// ── SysEx timeout / name fallback ──

describe("MIDIManager: SysEx timeout — BeatStep identified by port name", () => {
  it("BeatStep (no SysEx reply) is discovered exactly once via name fallback", async () => {
    const keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);

    // Silent BeatStep: correct port name, but no SysEx loopback
    const silentInput = new VirtualMIDIInput({
      id: "silent-beatstep",
      name: "BeatStep",
      manufacturer: "Arturia",
      version: "1.0",
    });
    const silentOutput = new VirtualMIDIOutput({
      id: "silent-beatstep",
      name: "BeatStep",
      manufacturer: "Arturia",
      version: "1.0",
    });

    const access = new VirtualMIDIAccess([keystep, { input: silentInput, output: silentOutput }]);

    const manager = new MIDIManager();
    (manager as unknown as Record<string, unknown>)["_access"] = access;

    const states: { hasBeatstep: boolean; noteSourceNames: string[] }[] = [];
    manager.onDevicesChanged = (state) => states.push(state);

    await manager.discoverDevices(50);

    // BeatStep was identified
    expect(states[states.length - 1].hasBeatstep).toBe(true);
    // KeyStep is treated as a generic note source
    expect(states[states.length - 1].noteSourceNames).toContain("KeyStep");
  });

  it("silent BeatStep routes messages after name-fallback discovery", async () => {
    const keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
    const silentInput = new VirtualMIDIInput({
      id: "silent-beatstep",
      name: "BeatStep",
      manufacturer: "Arturia",
      version: "1.0",
    });
    const silentOutput = new VirtualMIDIOutput({
      id: "silent-beatstep",
      name: "BeatStep",
      manufacturer: "Arturia",
      version: "1.0",
    });
    const access = new VirtualMIDIAccess([keystep, { input: silentInput, output: silentOutput }]);

    const manager = new MIDIManager();
    (manager as unknown as Record<string, unknown>)["_access"] = access;

    await manager.discoverDevices(50);

    const received: Uint8Array[] = [];
    manager.onBeatstepMessage = (data: Uint8Array) => received.push(data);

    silentInput.fireMessage(new Uint8Array([0xb0, 0x01, 65]));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(new Uint8Array([0xb0, 0x01, 65]));
  });
});
