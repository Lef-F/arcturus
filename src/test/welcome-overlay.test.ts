/**
 * Welcome Overlay — first-visit gating + dismissal flow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mountWelcomeOverlay, shouldShowWelcome, markWelcomeSeen } from "@/ui/welcome-overlay";
import { resetIndexedDB } from "./helpers";

beforeEach(resetIndexedDB);

describe("welcome flag persistence", () => {
  it("shouldShowWelcome returns true for a fresh user", async () => {
    expect(await shouldShowWelcome()).toBe(true);
  });

  it("after markWelcomeSeen, shouldShowWelcome returns false", async () => {
    await markWelcomeSeen();
    expect(await shouldShowWelcome()).toBe(false);
  });
});

describe("mountWelcomeOverlay", () => {
  it("renders title, body, and start-playing button", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const overlay = mountWelcomeOverlay(container);
    expect(overlay.querySelector(".welcome-title")?.textContent).toContain("Arcturus");
    expect(overlay.querySelector(".welcome-cta")).not.toBeNull();
    expect(overlay.querySelector("kbd")).not.toBeNull(); // keyboard hints
    document.body.removeChild(container);
  });

  it("clicking start-playing dismisses overlay and persists welcomed flag", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const overlay = mountWelcomeOverlay(container);
    overlay.querySelector<HTMLButtonElement>("#welcome-cta")!.click();

    // Wait for the IDB write to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(await shouldShowWelcome()).toBe(false);
    document.body.removeChild(container);
  });

  it("Escape key dismisses overlay", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const overlay = mountWelcomeOverlay(container);
    expect(overlay.parentElement).toBe(container);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Marked as leaving — actual removal happens after the CSS transition
    expect(overlay.classList.contains("welcome-overlay--leaving")).toBe(true);
    document.body.removeChild(container);
  });

  it("calls onDismiss callback when overlay is dismissed", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let dismissed = false;
    const overlay = mountWelcomeOverlay(container, { onDismiss: () => { dismissed = true; } });
    overlay.querySelector<HTMLButtonElement>("#welcome-cta")!.click();

    expect(dismissed).toBe(true);
    document.body.removeChild(container);
  });
});
