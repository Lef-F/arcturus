/**
 * Scene Latch Hint — one-shot bubble that retires permanently after first latch.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { mountSceneLatchHint, shouldShowSceneLatchHint, markSceneLatchHintSeen } from "@/ui/scene-latch-hint";
import { resetDB } from "@/state/db";

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDB();
});

/** Build the minimum DOM the hint needs to anchor to. */
function makeProgramPads(parent: HTMLElement): void {
  const row = document.createElement("div");
  row.className = "synth-program-pads";
  for (let i = 0; i < 8; i++) {
    const cell = document.createElement("div");
    cell.className = "pad-cell";
    const pad = document.createElement("button");
    pad.className = "pad";
    cell.appendChild(pad);
    row.appendChild(cell);
  }
  parent.appendChild(row);
}

describe("scene latch hint persistence", () => {
  it("shouldShowSceneLatchHint returns true for a fresh user", async () => {
    expect(await shouldShowSceneLatchHint()).toBe(true);
  });

  it("after markSceneLatchHintSeen, it returns false", async () => {
    await markSceneLatchHintSeen();
    expect(await shouldShowSceneLatchHint()).toBe(false);
  });
});

describe("mountSceneLatchHint", () => {
  it("renders a bubble pointing at the first program pad", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    makeProgramPads(container);

    const handle = mountSceneLatchHint(container);
    const bubble = container.querySelector(".scene-latch-hint");
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector(".scene-latch-hint-card")?.textContent).toMatch(/tap twice/i);
    expect(bubble?.querySelector(".scene-latch-hint-arrow")).not.toBeNull();
    handle.destroy();
    document.body.removeChild(container);
  });

  it("returns a no-op handle when there is no first program pad in the DOM", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // No .synth-program-pads at all
    const handle = mountSceneLatchHint(container);
    expect(container.querySelector(".scene-latch-hint")).toBeNull();
    expect(() => handle.dismiss()).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
    document.body.removeChild(container);
  });

  it("dismiss() persists the seen flag and removes the bubble", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    makeProgramPads(container);

    const handle = mountSceneLatchHint(container);
    handle.dismiss();

    // Persistence is async — wait for the IDB write to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(await shouldShowSceneLatchHint()).toBe(false);

    // Element removal happens after the CSS transition
    await new Promise((r) => setTimeout(r, 350));
    expect(container.querySelector(".scene-latch-hint")).toBeNull();

    document.body.removeChild(container);
  });

  it("destroy() removes the bubble WITHOUT marking seen (used on view teardown)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    makeProgramPads(container);

    const handle = mountSceneLatchHint(container);
    handle.destroy();

    await new Promise((r) => setTimeout(r, 350));
    expect(container.querySelector(".scene-latch-hint")).toBeNull();
    // Flag was NOT set — user hasn't done the action yet
    expect(await shouldShowSceneLatchHint()).toBe(true);

    document.body.removeChild(container);
  });

  it("dismiss() called twice is safe", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    makeProgramPads(container);

    const handle = mountSceneLatchHint(container);
    handle.dismiss();
    expect(() => handle.dismiss()).not.toThrow();

    document.body.removeChild(container);
  });
});
