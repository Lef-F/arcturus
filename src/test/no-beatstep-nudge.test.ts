/**
 * No-BeatStep Nudge — mounts only when no BeatStep is connected, dismissible per session.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mountNoBeatstepNudge } from "@/ui/no-beatstep-nudge";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("mountNoBeatstepNudge", () => {
  it("renders text and dismiss button", () => {
    const handle = mountNoBeatstepNudge(container);
    expect(container.querySelector(".ambient-nudge")).not.toBeNull();
    expect(container.querySelector(".ambient-nudge-text")?.textContent).toContain("BeatStep");
    expect(container.querySelector(".ambient-nudge-close")).not.toBeNull();
    handle.destroy();
  });

  it("show() reveals the nudge with a visible class", () => {
    const handle = mountNoBeatstepNudge(container);
    handle.show();
    expect(container.querySelector(".ambient-nudge")?.classList.contains("ambient-nudge--visible")).toBe(true);
    handle.destroy();
  });

  it("hide() removes the visible class", () => {
    const handle = mountNoBeatstepNudge(container);
    handle.show();
    handle.hide();
    expect(container.querySelector(".ambient-nudge")?.classList.contains("ambient-nudge--visible")).toBe(false);
    handle.destroy();
  });

  it("clicking dismiss removes the nudge and prevents re-show in the same session", async () => {
    const handle = mountNoBeatstepNudge(container);
    handle.show();
    container.querySelector<HTMLButtonElement>(".ambient-nudge-close")!.click();

    // Removal is delayed to allow CSS transition
    await new Promise((r) => setTimeout(r, 350));
    expect(container.querySelector(".ambient-nudge")).toBeNull();

    // A new mount in the same session should not re-show after a previous dismissal
    const handle2 = mountNoBeatstepNudge(container);
    handle2.show();
    expect(container.querySelector(".ambient-nudge")?.classList.contains("ambient-nudge--visible")).toBe(false);
    handle2.destroy();
  });
});
