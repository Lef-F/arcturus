/**
 * MIDI Manager — Web MIDI API access, port enumeration, message routing.
 * Entry point for all MIDI communication.
 */

export async function requestMidiAccess(): Promise<MIDIAccess> {
  if (!navigator.requestMIDIAccess) {
    throw new Error("Web MIDI API not supported in this browser.");
  }
  return navigator.requestMIDIAccess({ sysex: true });
}
