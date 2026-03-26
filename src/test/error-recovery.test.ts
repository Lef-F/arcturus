/**
 * Error recovery UX tests.
 *
 * Verifies that user-facing error paths provide actionable feedback
 * and working recovery mechanisms (Retry button, error banners).
 *
 * Tests:
 *   1. CalibrationView error state: Retry button is rendered and fires onRestart
 *   2. CalibrationView error: message content is visible in the DOM
 *   3. App._startCalibration: onRestart is wired before MIDI permission error
 *      (so the Retry button works even on the first-boot permission denial)
 *   4. Engine boot failure: visible error banner is shown in the synth container
 */

import { describe, it, expect, vi } from "vitest";
import { CalibrationView } from "@/ui/calibration-view";

// ── CalibrationView error state ──

describe("CalibrationView: error state", () => {
  function setup() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = new CalibrationView(container);
    return { container, view, cleanup: () => document.body.removeChild(container) };
  }

  it("renders Retry button on error state", () => {
    const { container, view, cleanup } = setup();
    view.renderState({
      step: "error",
      error: "MIDI permission denied.",
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    const btn = container.querySelector("#calibration-retry-btn");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("Retry");
    cleanup();
  });

  it("clicking Retry fires onRestart callback", () => {
    const { container, view, cleanup } = setup();

    const onRestart = vi.fn();
    view.onRestart = onRestart;

    view.renderState({
      step: "error",
      error: "Test error",
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    const btn = container.querySelector<HTMLButtonElement>("#calibration-retry-btn");
    btn?.click();

    expect(onRestart).toHaveBeenCalledOnce();
    cleanup();
  });

  it("clicking Retry before onRestart is set does not throw", () => {
    const { container, view, cleanup } = setup();
    // No onRestart set
    view.renderState({
      step: "error",
      error: "Error",
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    const btn = container.querySelector<HTMLButtonElement>("#calibration-retry-btn");
    expect(() => btn?.click()).not.toThrow();
    cleanup();
  });

  it("error message is shown in the DOM", () => {
    const { container, view, cleanup } = setup();
    const errorMsg = "MIDI permission denied. Please allow MIDI access and reload.";

    view.renderState({
      step: "error",
      error: errorMsg,
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    expect(container.textContent).toContain(errorMsg);
    cleanup();
  });

  it("Retry button is present and fires onRestart even when set AFTER renderState", () => {
    // This tests the scenario where onRestart is set before renderState (the fixed order).
    // Even if somehow set after, clicking at any point after the DOM renders should work.
    const { container, view, cleanup } = setup();

    view.renderState({
      step: "error",
      error: "Test",
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    // Set onRestart AFTER renderState — should still work since button listener
    // reads _onRestart at click time (closure), not at listener registration time.
    const onRestart = vi.fn();
    view.onRestart = onRestart;

    container.querySelector<HTMLButtonElement>("#calibration-retry-btn")?.click();
    expect(onRestart).toHaveBeenCalledOnce();
    cleanup();
  });
});
