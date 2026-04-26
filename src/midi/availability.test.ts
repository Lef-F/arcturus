/**
 * MIDI availability classification — Safari (no API), Firefox (gated), and
 * unexpected errors all need to land in the right bucket so the boot path
 * shows the right notice copy.
 */

import { describe, it, expect, afterEach } from "vitest";
import { classifyMidiError, detectMidiSupport } from "./availability";

const realNavigator = globalThis.navigator;

afterEach(() => {
  // Restore the real navigator after any test that swapped it out.
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true, writable: true });
});

describe("detectMidiSupport", () => {
  it("returns 'supported' when navigator.requestMIDIAccess exists", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { requestMIDIAccess: () => Promise.resolve({} as MIDIAccess) },
      configurable: true,
      writable: true,
    });
    expect(detectMidiSupport()).toBe("supported");
  });

  it("returns 'unsupported' when navigator has no requestMIDIAccess (Safari)", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });
    expect(detectMidiSupport()).toBe("unsupported");
  });

  it("returns 'unsupported' when navigator is undefined (non-browser env)", () => {
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true, writable: true });
    expect(detectMidiSupport()).toBe("unsupported");
  });
});

describe("classifyMidiError", () => {
  it("classifies Firefox's site-permission-add-on rejection as 'needs-addon'", () => {
    const err = new DOMException("WebMIDI requires a site permission add-on to activate", "SecurityError");
    expect(classifyMidiError(err).kind).toBe("needs-addon");
  });

  it("classifies a 'requires extension' message as 'needs-addon' (defensive synonym)", () => {
    expect(classifyMidiError(new Error("This feature requires a browser extension")).kind).toBe("needs-addon");
  });

  it("classifies a 'permission' message as 'needs-addon' (defensive synonym)", () => {
    expect(classifyMidiError(new Error("Site permission required")).kind).toBe("needs-addon");
  });

  it("classifies a generic NotAllowedError as 'error' (real failure, not a gating message)", () => {
    const result = classifyMidiError(new DOMException("MIDI access denied", "NotAllowedError"));
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error).toBeInstanceOf(DOMException);
    }
  });

  it("classifies a non-Error rejection by stringifying it", () => {
    const result = classifyMidiError("nope");
    expect(result.kind).toBe("error");
  });
});
