/**
 * Unit tests for the PadHandler.
 */

import { describe, it, expect, vi } from "vitest";
import { PadHandler, buildPadLedMessage } from "./pads";

describe("PadHandler — row 1 (module select)", () => {
  it("Note On notes 44-51 fire onModuleSelect with slot 0-7", () => {
    const handler = new PadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    for (let i = 0; i < 8; i++) {
      handler.handleMessage(new Uint8Array([0x90, 44 + i, 100]));
    }

    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("channel-agnostic: ch10 (0x99) also fires onModuleSelect", () => {
    const handler = new PadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    handler.handleMessage(new Uint8Array([0x99, 44, 100]));
    handler.handleMessage(new Uint8Array([0x99, 51, 100]));

    expect(slots).toEqual([0, 7]);
  });

  it("Program Change (any channel) programs 0-7 fire onModuleSelect (configured / fake mode)", () => {
    const handler = new PadHandler();
    const slots: number[] = [];
    handler.onModuleSelect = (s) => slots.push(s);

    handler.handleMessage(new Uint8Array([0xc9, 3]));

    expect(slots).toEqual([3]);
  });

  it("Program Change > 7 is ignored", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0xc9, 8]));
    handler.handleMessage(new Uint8Array([0xc9, 127]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note On velocity 0 on row 1 does not fire onModuleSelect", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, 44, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note Off on row 1 does not fire onModuleSelect", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;

    handler.handleMessage(new Uint8Array([0x80, 44, 0]));

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("PadHandler — row 2 (patch select)", () => {
  it("Note On notes 36-43 fire onPatchSelect with slot 0-7", () => {
    const handler = new PadHandler();
    const slots: number[] = [];
    handler.onPatchSelect = (s) => slots.push(s);

    for (let i = 0; i < 8; i++) {
      handler.handleMessage(new Uint8Array([0x90, 36 + i, 100]));
    }

    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("Note On velocity 0 on row 2 does not fire onPatchSelect", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, 36, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("Note Off on row 2 does not fire onPatchSelect", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x80, 36, 0]));

    expect(cb).not.toHaveBeenCalled();
  });

  it("notes outside both rows are ignored", () => {
    const handler = new PadHandler();
    const cb = vi.fn();
    handler.onModuleSelect = cb;
    handler.onPatchSelect = cb;

    handler.handleMessage(new Uint8Array([0x90, 35, 100])); // below row 2
    handler.handleMessage(new Uint8Array([0x90, 52, 100])); // above row 1

    expect(cb).not.toHaveBeenCalled();
  });

  it("unrelated message returns false", () => {
    const handler = new PadHandler();
    expect(handler.handleMessage(new Uint8Array([0xb0, 1, 65]))).toBe(false);
  });
});

describe("buildPadLedMessage", () => {
  it("builds Note On ch10 message for padIndex 0 (row 1, pad 1) → note 44", () => {
    const msg = buildPadLedMessage(0, 127);
    expect(msg[0]).toBe(0x99); // Note On ch 10
    expect(msg[1]).toBe(44);   // note 44 = row 1 pad 1
    expect(msg[2]).toBe(127);
  });

  it("padIndex 7 (row 1, last pad) → note 51", () => {
    const msg = buildPadLedMessage(7, 127);
    expect(msg[1]).toBe(51);
  });

  it("padIndex 8 (row 2, first pad) → note 36", () => {
    const msg = buildPadLedMessage(8, 127);
    expect(msg[1]).toBe(36);
  });

  it("padIndex 15 (row 2, last pad) → note 43", () => {
    const msg = buildPadLedMessage(15, 60);
    expect(msg[1]).toBe(43);
    expect(msg[2]).toBe(60);
  });

  it("velocity 0 turns LED off", () => {
    const msg = buildPadLedMessage(0, 0);
    expect(msg[2]).toBe(0);
  });
});
