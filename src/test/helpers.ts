/**
 * Test helpers — convenience functions for simulating hardware interactions.
 */

import type { VirtualMIDIInput, VirtualMIDIOutput } from "./virtual-midi";
import { createTestMIDIEnvironment } from "./virtual-midi";

export { createTestMIDIEnvironment };

/**
 * Returns a virtual MIDI environment with both KeyStep and BeatStep connected.
 * Injects the virtual MIDIAccess into the global navigator mock.
 */
export function createTestMidiAccess(): ReturnType<typeof createTestMIDIEnvironment> {
  return createTestMIDIEnvironment();
}

/**
 * Simulate a BeatStep encoder turn.
 * @param input - the BeatStep's VirtualMIDIInput
 * @param encoderIndex - 0-15 (maps to CC 1-16 on channel 1)
 * @param direction - "cw" (clockwise) or "ccw" (counter-clockwise)
 * @param speed - 1 (slow) to 6 (fast), controls the delta magnitude
 */
export function simulateEncoderTurn(
  input: VirtualMIDIInput,
  encoderIndex: number,
  direction: "cw" | "ccw",
  speed: 1 | 2 | 3 | 4 | 5 | 6 = 1
): void {
  // BeatStep encoders default CC numbers: encoder 0 → CC 1, encoder 1 → CC 2, ...
  const cc = encoderIndex + 1;
  // Binary Offset (Relative 1): 64 = no movement, >64 = CW, <64 = CCW
  const value = direction === "cw" ? 64 + speed : 64 - speed;
  // CC message: status 0xB0 (channel 1), cc, value
  input.fireMessage(new Uint8Array([0xb0, cc, value]));
}

/**
 * Simulate a Note On from the KeyStep.
 * @param input - the KeyStep's VirtualMIDIInput
 * @param note - MIDI note number (0-127)
 * @param velocity - velocity (1-127, default 100)
 */
export function simulateNoteOn(
  input: VirtualMIDIInput,
  note: number,
  velocity = 100
): void {
  input.fireMessage(new Uint8Array([0x90, note & 0x7f, velocity & 0x7f]));
}

/**
 * Simulate a Note Off from the KeyStep.
 * @param input - the KeyStep's VirtualMIDIInput
 * @param note - MIDI note number (0-127)
 */
export function simulateNoteOff(input: VirtualMIDIInput, note: number): void {
  input.fireMessage(new Uint8Array([0x80, note & 0x7f, 0]));
}

/**
 * Simulate a BeatStep pad press (Note On from pad row).
 * @param input - the BeatStep's VirtualMIDIInput
 * @param padIndex - 0-15 (0-7 = top row, 8-15 = bottom row)
 * @param velocity - velocity (1-127, default 100)
 */
export function simulatePadPress(
  input: VirtualMIDIInput,
  padIndex: number,
  velocity = 100
): void {
  // BeatStep pad notes: pads 0-15 → notes 36-51
  const note = 36 + padIndex;
  input.fireMessage(new Uint8Array([0x99, note & 0x7f, velocity & 0x7f]));
}

/**
 * Simulate a Program Change (BeatStep top row pad).
 * @param input - the BeatStep's VirtualMIDIInput
 * @param program - program number (0-7 for slots 1-8)
 */
export function simulateProgramChange(
  input: VirtualMIDIInput,
  program: number
): void {
  input.fireMessage(new Uint8Array([0xc9, program & 0x7f]));
}

/**
 * Simulate pitch bend from the KeyStep.
 * @param input - the KeyStep's VirtualMIDIInput
 * @param value - 14-bit pitch bend value (0-16383, center=8192)
 */
export function simulatePitchBend(
  input: VirtualMIDIInput,
  value: number
): void {
  const lsb = value & 0x7f;
  const msb = (value >> 7) & 0x7f;
  input.fireMessage(new Uint8Array([0xe0, lsb, msb]));
}

/**
 * Simulate channel aftertouch from the KeyStep.
 * @param input - the KeyStep's VirtualMIDIInput
 * @param pressure - pressure value (0-127)
 */
export function simulateAftertouch(
  input: VirtualMIDIInput,
  pressure: number
): void {
  input.fireMessage(new Uint8Array([0xd0, pressure & 0x7f]));
}

/**
 * Wait for an outgoing MIDI message that satisfies a predicate.
 * Polls the output's sentMessages list until the predicate matches or timeout.
 * @param output - the VirtualMIDIOutput to watch
 * @param predicate - returns true when the expected message arrives
 * @param timeout - milliseconds to wait (default 200)
 */
export function waitForMessage(
  output: VirtualMIDIOutput,
  predicate: (msg: Uint8Array) => boolean,
  timeout = 200
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = output.sentMessages.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - start >= timeout) {
        reject(new Error("waitForMessage: timeout"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}
