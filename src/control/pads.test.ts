/**
 * Unit tests for the PadHandler.
 */

import { describe, it, expect, vi } from "vitest";
import { PadHandler, buildPadLedMessage } from "./pads";

describe("PadHandler", () => {
  it("Program Change (channel 10) fires onPatchSelect with slot 0-7", () => {
    const handler = new PadHandler();
    const slots: number[] = [];
    handler.onPatchSelect = (slot) => slots.push(slot);

    handler.handleMessage(new Uint8Array([0xc9, 3])); // Program 3

    expect(slots).toEqual([3]);
  });

  it("Program Change > 7 is ignored", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0xc9, 8]));
    handler.handleMessage(new Uint8Array([0xc9, 127]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note On (channel 10) on bottom row pad fires onTrigger", () => {
    const handler = new PadHandler();
    const triggers: Array<[number, number]> = [];
    handler.onTrigger = (idx, vel) => triggers.push([idx, vel]);

    // Pad 8 = note 44 (PAD_BASE_NOTE 36 + 8 = 44)
    handler.handleMessage(new Uint8Array([0x99, 44, 100]));

    expect(triggers).toHaveLength(1);
    expect(triggers[0][0]).toBe(8);
    expect(triggers[0][1]).toBe(100);
  });

  it("Note On (channel 10) on top row note is ignored", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onTrigger = cb;

    // Pad 0 would be note 36, but top row = pads 0-7, only bottom (8-15) trigger
    handler.handleMessage(new Uint8Array([0x99, 36, 100])); // pad 0

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note On velocity 0 on bottom row fires onTriggerRelease", () => {
    const handler = new PadHandler();
    const released: number[] = [];
    handler.onTriggerRelease = (idx) => released.push(idx);

    handler.handleMessage(new Uint8Array([0x99, 44, 0])); // pad 8, vel 0

    expect(released).toEqual([8]);
  });

  it("Note Off on bottom row fires onTriggerRelease", () => {
    const handler = new PadHandler();
    const released: number[] = [];
    handler.onTriggerRelease = (idx) => released.push(idx);

    handler.handleMessage(new Uint8Array([0x89, 44, 0])); // Note Off pad 8

    expect(released).toEqual([8]);
  });

  it("all 8 bottom row pads fire with correct indices", () => {
    const handler = new PadHandler();
    const indices: number[] = [];
    handler.onTrigger = (idx) => indices.push(idx);

    for (let i = 8; i <= 15; i++) {
      handler.handleMessage(new Uint8Array([0x99, 36 + i, 100]));
    }

    expect(indices).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("unrelated message returns false", () => {
    const handler = new PadHandler();
    expect(handler.handleMessage(new Uint8Array([0xb0, 1, 65]))).toBe(false);
  });
});

describe("buildPadLedMessage", () => {
  it("builds Note On message for pad 0 at full velocity", () => {
    const msg = buildPadLedMessage(0, 127);
    expect(msg[0]).toBe(0x99); // Note On ch 10
    expect(msg[1]).toBe(36);   // note 36
    expect(msg[2]).toBe(127);
  });

  it("builds Note On message for pad 15 (last pad)", () => {
    const msg = buildPadLedMessage(15, 60);
    expect(msg[1]).toBe(51); // 36 + 15 = 51
    expect(msg[2]).toBe(60);
  });

  it("velocity 0 turns LED off", () => {
    const msg = buildPadLedMessage(0, 0);
    expect(msg[2]).toBe(0);
  });
});
