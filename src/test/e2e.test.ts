/**
 * E2E smoke test — boots the virtual MIDI environment and verifies
 * the test harness works end-to-end: SysEx identity, encoder simulation,
 * note simulation.
 */

import { describe, it, expect } from "vitest";
import {
  createTestMIDIEnvironment,
  KEYSTEP_IDENTITY,
  BEATSTEP_IDENTITY,
  type VirtualMIDIInput,
} from "./virtual-midi";
import {
  simulateEncoderTurn,
  simulateNoteOn,
  simulateNoteOff,
  simulatePadPress,
  simulateProgramChange,
  simulatePitchBend,
  simulateAftertouch,
  TEST_HARDWARE_MAPPING,
} from "./helpers";
import { IDENTITY_REQUEST, ARTURIA_MANUFACTURER_ID } from "@/midi/fingerprint";

/** Attach a message collector to an input, guarding against null data. */
function collectMessages(input: VirtualMIDIInput): Uint8Array[] {
  const messages: Uint8Array[] = [];
  input.onmidimessage = (e) => {
    if (e.data !== null) messages.push(e.data);
  };
  return messages;
}

/** Send Identity Request and return the reply bytes. */
async function getIdentityReply(
  output: { send(data: Uint8Array): void },
  input: VirtualMIDIInput
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    input.onmidimessage = (e) => {
      if (e.data !== null) resolve(e.data);
      else reject(new Error("null data in identity reply"));
    };
    output.send(IDENTITY_REQUEST);
  });
}

describe("Virtual MIDI Test Harness", () => {
  it("creates test environment with two devices", () => {
    const { access, keystep, beatstep } = createTestMIDIEnvironment();
    expect(access.inputs.size).toBe(2);
    expect(access.outputs.size).toBe(2);
    expect(keystep.input.name).toBe("KeyStep");
    expect(beatstep.input.name).toBe("BeatStep");
  });

  it("both devices respond to SysEx identity request", async () => {
    const { keystep, beatstep } = createTestMIDIEnvironment();

    const keystepReplies: Uint8Array[] = [];
    const beatstepReplies: Uint8Array[] = [];

    keystep.input.onmidimessage = (e) => { if (e.data) keystepReplies.push(e.data); };
    beatstep.input.onmidimessage = (e) => { if (e.data) beatstepReplies.push(e.data); };

    keystep.output.send(IDENTITY_REQUEST);
    beatstep.output.send(IDENTITY_REQUEST);

    await new Promise((r) => setTimeout(r, 10));

    expect(keystepReplies).toHaveLength(1);
    expect(beatstepReplies).toHaveLength(1);
  });

  it("KeyStep identity reply contains correct Arturia manufacturer ID", async () => {
    const { keystep } = createTestMIDIEnvironment();
    const bytes = await getIdentityReply(keystep.output, keystep.input);

    // F0 7E <deviceId> 06 02 <manufacturer x3> <family x2> <model x2> <fw x4> F7
    expect(bytes[0]).toBe(0xf0);
    expect(bytes[1]).toBe(0x7e);
    expect(bytes[3]).toBe(0x06);
    expect(bytes[4]).toBe(0x02);
    expect(bytes[5]).toBe(ARTURIA_MANUFACTURER_ID[0]);
    expect(bytes[6]).toBe(ARTURIA_MANUFACTURER_ID[1]);
    expect(bytes[7]).toBe(ARTURIA_MANUFACTURER_ID[2]);
    expect(bytes[bytes.length - 1]).toBe(0xf7);
  });

  it("KeyStep and BeatStep have different model codes", async () => {
    const { keystep, beatstep } = createTestMIDIEnvironment();

    const ksBytes = await getIdentityReply(keystep.output, keystep.input);
    const bsBytes = await getIdentityReply(beatstep.output, beatstep.input);

    // Model codes at bytes 10-11: F0 7E id 06 02 mfr0 mfr1 mfr2 fam0 fam1 mdl0 mdl1 ...
    const ksModel: [number, number] = [ksBytes[10], ksBytes[11]];
    const bsModel: [number, number] = [bsBytes[10], bsBytes[11]];

    expect(ksModel).toEqual(KEYSTEP_IDENTITY.modelCode);
    expect(bsModel).toEqual(BEATSTEP_IDENTITY.modelCode);
    expect(ksModel).not.toEqual(bsModel);
  });

  it("simulateEncoderTurn — slow CW produces CC value 65", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulateEncoderTurn(beatstep.input, 0, "cw", 1);

    expect(messages).toHaveLength(1);
    expect(messages[0][0]).toBe(0xb0); // CC on channel 1
    expect(messages[0][1]).toBe(1);    // encoder 0 → CC 1
    expect(messages[0][2]).toBe(65);   // 64 + 1 = 65 (slow CW)
  });

  it("simulateEncoderTurn — slow CCW produces CC value 63", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulateEncoderTurn(beatstep.input, 0, "ccw", 1);

    expect(messages[0][2]).toBe(63); // 64 - 1 = 63 (slow CCW)
  });

  it("simulateEncoderTurn — fast CW produces CC value 70", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulateEncoderTurn(beatstep.input, 3, "cw", 6);

    expect(messages[0][1]).toBe(4);  // encoder 3 → CC 4
    expect(messages[0][2]).toBe(70); // 64 + 6 = 70 (fast CW)
  });

  it("simulateEncoderTurn — fast CCW produces CC value 58", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulateEncoderTurn(beatstep.input, 15, "ccw", 6);

    expect(messages[0][1]).toBe(16); // encoder 15 → CC 16
    expect(messages[0][2]).toBe(58); // 64 - 6 = 58 (fast CCW)
  });

  it("simulateNoteOn / simulateNoteOff produce correct MIDI bytes", () => {
    const { keystep } = createTestMIDIEnvironment();
    const messages = collectMessages(keystep.input);

    simulateNoteOn(keystep.input, 60, 100);
    simulateNoteOff(keystep.input, 60);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(new Uint8Array([0x90, 60, 100]));
    expect(messages[1]).toEqual(new Uint8Array([0x80, 60, 0]));
  });

  it("simulatePadPress produces correct MIDI bytes", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulatePadPress(beatstep.input, 0, 90);

    // padIndex 0 → padRow1Notes[0] (module select row)
    expect(messages[0]).toEqual(new Uint8Array([0x99, TEST_HARDWARE_MAPPING.padRow1Notes[0], 90]));
  });

  it("simulateProgramChange produces correct MIDI bytes", () => {
    const { beatstep } = createTestMIDIEnvironment();
    const messages = collectMessages(beatstep.input);

    simulateProgramChange(beatstep.input, 3);

    expect(messages[0][0]).toBe(0xc9);
    expect(messages[0][1]).toBe(3);
  });

  it("simulatePitchBend produces correct 14-bit encoding", () => {
    const { keystep } = createTestMIDIEnvironment();
    const messages = collectMessages(keystep.input);

    simulatePitchBend(keystep.input, 8192); // center

    expect(messages[0][0]).toBe(0xe0);
    // 8192 = 0x2000; LSB = bits 0-6 = 0x00, MSB = bits 7-13 = 0x40
    expect(messages[0][1]).toBe(0x00);
    expect(messages[0][2]).toBe(0x40);
  });

  it("simulateAftertouch produces correct MIDI bytes", () => {
    const { keystep } = createTestMIDIEnvironment();
    const messages = collectMessages(keystep.input);

    simulateAftertouch(keystep.input, 64);

    expect(messages[0]).toEqual(new Uint8Array([0xd0, 64]));
  });

  it("output captures sent messages", () => {
    const { beatstep } = createTestMIDIEnvironment();

    beatstep.output.send(new Uint8Array([0x90, 36, 127]));
    beatstep.output.send(new Uint8Array([0x80, 36, 0]));

    expect(beatstep.output.sentMessages).toHaveLength(2);
    expect(beatstep.output.sentMessages[0]).toEqual(new Uint8Array([0x90, 36, 127]));
  });

  it("addEventListener on input receives messages", () => {
    const { keystep } = createTestMIDIEnvironment();
    const received: Uint8Array[] = [];

    keystep.input.addEventListener("midimessage", (e) => {
      const data = (e as MIDIMessageEvent).data;
      if (data) received.push(data);
    });

    simulateNoteOn(keystep.input, 69, 80);

    expect(received).toHaveLength(1);
    expect(received[0][0]).toBe(0x90);
  });
});
