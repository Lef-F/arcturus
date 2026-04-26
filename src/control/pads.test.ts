/**
 * Unit tests for the PadHandler.
 */

import { describe, it, expect, vi } from "vitest";
import { PadHandler, buildPadLedMessage } from "./pads";
import { TEST_BEATSTEP_MAPPING } from "@/test/helpers";

const ROW1_BASE = TEST_BEATSTEP_MAPPING.padRow1Notes[0]; // 44
const ROW2_BASE = TEST_BEATSTEP_MAPPING.padRow2Notes[0]; // 36

function makePadHandler(): PadHandler {
  const handler = new PadHandler();
  handler.setPadNotes(ROW1_BASE, ROW2_BASE);
  return handler;
}

describe("PadHandler — row 1 (module select)", () => {
  it("Note On notes fire onModuleSelect with slot 0-7", () => {
    const handler = makePadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    for (let i = 0; i < 8; i++) {
      handler.handleMessage(new Uint8Array([0x90, ROW1_BASE + i, 100]));
    }

    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("channel-agnostic: ch10 (0x99) also fires onModuleSelect", () => {
    const handler = makePadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    handler.handleMessage(new Uint8Array([0x99, ROW1_BASE, 100]));
    handler.handleMessage(new Uint8Array([0x99, ROW1_BASE + 7, 100]));

    expect(slots).toEqual([0, 7]);
  });

  it("Program Change (any channel) programs 0-7 fire onModuleSelect (configured / fake mode)", () => {
    const handler = makePadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    handler.handleMessage(new Uint8Array([0xc9, 3]));

    expect(slots).toEqual([3]);
  });

  it("Program Change > 7 is ignored", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0xc9, 8]));
    handler.handleMessage(new Uint8Array([0xc9, 127]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note On velocity 0 on row 1 does not fire onModuleSelect", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, ROW1_BASE, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note Off on row 1 does not fire onModuleSelect", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0x80, ROW1_BASE, 0]));

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("PadHandler — row 2 (patch select)", () => {
  it("Note On notes fire onPatchSelect with slot 0-7", () => {
    const handler = makePadHandler();
    const slots: number[] = [];
    handler.onPatchSelect = (s) => slots.push(s);

    for (let i = 0; i < 8; i++) {
      handler.handleMessage(new Uint8Array([0x90, ROW2_BASE + i, 100]));
    }

    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("Note On velocity 0 on row 2 does not fire onPatchSelect", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, ROW2_BASE, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note Off on row 2 does not fire onPatchSelect", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x80, ROW2_BASE, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("notes outside both rows are ignored", () => {
    const handler = makePadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, ROW2_BASE - 1, 100])); // below row 2
    handler.handleMessage(new Uint8Array([0x90, ROW1_BASE + 8, 100])); // above row 1

    expect(cb).not.toHaveBeenCalled();
  });

  it("unrelated message returns false", () => {
    const handler = makePadHandler();
    expect(handler.handleMessage(new Uint8Array([0xb0, 1, 65]))).toBe(false);
  });

  it("unconfigured handler returns false for note messages", () => {
    const handler = new PadHandler(); // no setPadNotes
    expect(handler.handleMessage(new Uint8Array([0x90, ROW1_BASE, 100]))).toBe(false);
  });

  it("unconfigured handler still handles Program Change", () => {
    const handler = new PadHandler(); // no setPadNotes
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);
    handler.handleMessage(new Uint8Array([0xc9, 3]));
    expect(slots).toEqual([3]);
  });
});

describe("buildPadLedMessage", () => {
  it("builds Note On ch10 message for padIndex 0 (row 1, pad 1)", () => {
    const msg = buildPadLedMessage(0, 127, ROW1_BASE, ROW2_BASE);
    expect(msg[0]).toBe(0x99);
    expect(msg[1]).toBe(ROW1_BASE);
    expect(msg[2]).toBe(127);
  });

  it("padIndex 7 (row 1, last pad)", () => {
    const msg = buildPadLedMessage(7, 127, ROW1_BASE, ROW2_BASE);
    expect(msg[1]).toBe(ROW1_BASE + 7);
  });

  it("padIndex 8 (row 2, first pad)", () => {
    const msg = buildPadLedMessage(8, 127, ROW1_BASE, ROW2_BASE);
    expect(msg[1]).toBe(ROW2_BASE);
  });

  it("padIndex 15 (row 2, last pad)", () => {
    const msg = buildPadLedMessage(15, 60, ROW1_BASE, ROW2_BASE);
    expect(msg[1]).toBe(ROW2_BASE + 7);
    expect(msg[2]).toBe(60);
  });

  it("velocity 0 turns LED off", () => {
    const msg = buildPadLedMessage(0, 0, ROW1_BASE, ROW2_BASE);
    expect(msg[2]).toBe(0);
  });
});
