/**
 * MIDI Compatibility Notice — variants, link targets, and shared session dismissal.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mountMidiNotice } from "@/ui/midi-notice";
import { mountNoBeatstepNudge } from "@/ui/no-beatstep-nudge";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("mountMidiNotice", () => {
  it("renders an 'unsupported' notice with a link to the browser-support doc", () => {
    const handle = mountMidiNotice(container, "unsupported");
    const text = container.querySelector(".ambient-nudge-text")?.textContent ?? "";
    expect(text).toMatch(/doesn't support/i);
    expect(text).toMatch(/Web MIDI/);

    const link = container.querySelector<HTMLAnchorElement>(".ambient-nudge-link");
    expect(link).not.toBeNull();
    expect(link!.href).toContain("docs/BROWSER_SUPPORT.md");
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
    handle.destroy();
  });

  it("renders a 'needs-addon' notice with a Firefox-anchored link", () => {
    const handle = mountMidiNotice(container, "needs-addon");
    const text = container.querySelector(".ambient-nudge-text")?.textContent ?? "";
    expect(text).toMatch(/Firefox/i);

    const link = container.querySelector<HTMLAnchorElement>(".ambient-nudge-link");
    expect(link!.href).toContain("BROWSER_SUPPORT.md#firefox");
    handle.destroy();
  });

  it("show() adds the visible class; hide() removes it", () => {
    const handle = mountMidiNotice(container, "unsupported");
    const el = container.querySelector(".ambient-nudge")!;
    expect(el.classList.contains("ambient-nudge--visible")).toBe(false);
    handle.show();
    expect(el.classList.contains("ambient-nudge--visible")).toBe(true);
    handle.hide();
    expect(el.classList.contains("ambient-nudge--visible")).toBe(false);
    handle.destroy();
  });

  it("destroy() removes the element", () => {
    const handle = mountMidiNotice(container, "unsupported");
    expect(container.querySelector(".ambient-nudge")).not.toBeNull();
    handle.destroy();
    expect(container.querySelector(".ambient-nudge")).toBeNull();
  });

  it("dismiss click silences a subsequently-mounted no-beatstep nudge in the same session", async () => {
    // Both notices share `_dismissedThisSession` — this is the documented
    // contract so the user only has to dismiss once.
    const handle = mountMidiNotice(container, "unsupported");
    handle.show();
    container.querySelector<HTMLButtonElement>(".ambient-nudge-close")!.click();
    await new Promise((r) => setTimeout(r, 350));

    const nudge = mountNoBeatstepNudge(container);
    nudge.show();
    expect(container.querySelector(".ambient-nudge")?.classList.contains("ambient-nudge--visible")).toBe(false);
    nudge.destroy();
  });
});
