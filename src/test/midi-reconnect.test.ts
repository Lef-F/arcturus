/**
 * MIDIManager reconnect tests — device disconnect/reconnect lifecycle.
 *
 * Verifies that when a MIDI device is physically unplugged and replugged,
 * the MIDIManager re-discovers it and resumes message routing correctly.
 *
 * Uses VirtualMIDIAccess.simulateStateChange() to inject hardware events
 * without touching the browser's real Web MIDI stack.
 *
 * Tests:
 *   1. Messages route correctly after initial discovery
 *   2. Disconnect: statechange fires → discoverDevices re-runs → no crash
 *   3. Reconnect: device re-appears → messages route again
 *   4. Reconnect fires onDevicesDiscovered callback
 *   5. Reconnect with different output port: listeners transferred to new port
 */

import { describe, it, expect } from "vitest";
import { MIDIManager } from "@/midi/manager";
import {
  createTestMIDIEnvironment,
  createVirtualDevice,
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
  it("initial discovery: KeyStep messages route to onKeystepMessage", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const received: Uint8Array[] = [];
    manager.onKeystepMessage = (data) => received.push(data);

    env.keystep.input.fireMessage(new Uint8Array([0x90, 60, 100]));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(new Uint8Array([0x90, 60, 100]));
  });

  it("disconnect: no crash when device removed, statechange fires", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const stateChanges: string[] = [];
    manager.onStateChange = (e) => stateChanges.push(e.port?.state ?? "unknown");

    // Disconnect should not throw
    expect(() => {
      env.access.simulateStateChange(env.keystep, "disconnected");
    }).not.toThrow();

    // Give discoverDevices() time to run (it uses a timeout internally)
    await new Promise((r) => setTimeout(r, 100));

    expect(stateChanges).toContain("disconnected");
  });

  it("reconnect: messages route again after device re-plugged", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    // Disconnect
    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    // Reconnect
    env.access.simulateStateChange(env.keystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    // Now messages should route again
    const received: Uint8Array[] = [];
    manager.onKeystepMessage = (data) => received.push(data);

    env.keystep.input.fireMessage(new Uint8Array([0x90, 62, 90]));

    expect(received).toHaveLength(1);
  });

  it("reconnect fires onDevicesDiscovered with the re-discovered device", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    const discovered: string[] = [];
    manager.onDevicesDiscovered = (devices) => {
      for (const d of devices) discovered.push(d.type);
    };

    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    env.access.simulateStateChange(env.keystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    expect(discovered).toContain("keystep");
  });

  it("BeatStep reconnect: messages route after disconnect/reconnect", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    // Disconnect BeatStep
    env.access.simulateStateChange(env.beatstep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    // Reconnect BeatStep
    env.access.simulateStateChange(env.beatstep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const received: Uint8Array[] = [];
    manager.onBeatstepMessage = (data) => received.push(data);

    env.beatstep.input.fireMessage(new Uint8Array([0xb0, 0x01, 65]));

    expect(received).toHaveLength(1);
  });

  it("reconnect with fresh device object: listener transfers correctly", async () => {
    const env = createTestMIDIEnvironment();
    const manager = await setupManager(env);

    // Disconnect old device
    env.access.simulateStateChange(env.keystep, "disconnected");
    await new Promise((r) => setTimeout(r, 100));

    // Create a replacement device (same name but fresh object — like hardware re-enumeration)
    const freshKeystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
    // Replace the device in env so simulateStateChange uses it (old listeners no longer needed)

    // Add replacement to access maps and fire connect
    env.access.inputs.set(freshKeystep.input.id, freshKeystep.input);
    env.access.outputs.set(freshKeystep.output.id, freshKeystep.output);
    env.access.simulateStateChange(freshKeystep, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const received: Uint8Array[] = [];
    manager.onKeystepMessage = (data) => received.push(data);

    // Fresh device should now route to manager
    freshKeystep.input.fireMessage(new Uint8Array([0x90, 64, 80]));

    expect(received).toHaveLength(1);
  });
});
