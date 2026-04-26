/**
 * UI component tests — DOM rendering, value updates, pad states.
 * Uses happy-dom environment (from vite.config.ts).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EncoderComponent } from "@/ui/components/encoder";
import { PadComponent, type PadState } from "@/ui/components/pad";
import { WaveformComponent } from "@/ui/components/waveform";
import { SynthView } from "@/ui/synth-view";
import { ConfigView } from "@/ui/config-view";

// ── DOM helpers ──

function makeContainer(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

// ── EncoderComponent ──

describe("EncoderComponent", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("renders with label", () => {
    new EncoderComponent(container, "Cut");
    expect(container.querySelector(".encoder-label")?.textContent).toBe("Cut");
  });

  it("renders SVG with arc path", () => {
    new EncoderComponent(container, "Cut");
    expect(container.querySelector(".encoder-arc")).not.toBeNull();
    expect(container.querySelector(".encoder-track")).not.toBeNull();
  });

  it("setValue updates value text", () => {
    const enc = new EncoderComponent(container, "Cut");
    enc.setValue(0.5, "5000 Hz");
    expect(container.querySelector(".encoder-value")?.textContent).toBe("5000 Hz");
  });

  it("setValue clamps to 0-1", () => {
    const enc = new EncoderComponent(container, "Cut");
    enc.setValue(2.0);
    expect(enc.normalized).toBe(1);
    enc.setValue(-1.0);
    expect(enc.normalized).toBe(0);
  });

  it("setValue updates aria-valuenow", () => {
    const enc = new EncoderComponent(container, "Cut");
    enc.setValue(0.75);
    const el = container.querySelector(".encoder");
    expect(el?.getAttribute("aria-valuenow")).toBe("0.75");
  });

  it("arc path changes after setValue", () => {
    const enc = new EncoderComponent(container, "Cut");
    const before = container.querySelector(".encoder-arc")?.getAttribute("d");
    enc.setValue(0.8);
    const after = container.querySelector(".encoder-arc")?.getAttribute("d");
    expect(before).not.toBe(after);
  });

  it("has role=slider for accessibility", () => {
    new EncoderComponent(container, "Cut");
    const el = container.querySelector(".encoder");
    expect(el?.getAttribute("role")).toBe("slider");
  });
});

// ── PadComponent ──

describe("PadComponent", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("renders with index label", () => {
    new PadComponent(container, 0);
    expect(container.querySelector(".pad-label")?.textContent).toBe("1");
  });

  it("renders with custom label", () => {
    new PadComponent(container, 0, "A");
    expect(container.querySelector(".pad-label")?.textContent).toBe("A");
  });

  it("initial state is off", () => {
    const pad = new PadComponent(container, 0);
    expect(pad.state).toBe("off");
    expect(container.querySelector(".pad")?.classList.contains("pad--off")).toBe(true);
  });

  it("setState(selected) applies selected class", () => {
    const pad = new PadComponent(container, 0);
    pad.setState("selected");
    expect(container.querySelector(".pad")?.classList.contains("pad--selected")).toBe(true);
    expect(container.querySelector(".pad")?.classList.contains("pad--off")).toBe(false);
  });

  it("setState(triggered) applies triggered class", () => {
    const pad = new PadComponent(container, 0);
    pad.setState("triggered");
    expect(container.querySelector(".pad")?.classList.contains("pad--triggered")).toBe(true);
  });

  it("setState(off) returns to off state", () => {
    const pad = new PadComponent(container, 0);
    pad.setState("triggered");
    pad.setState("off");
    expect(container.querySelector(".pad")?.classList.contains("pad--off")).toBe(true);
    expect(pad.state).toBe("off");
  });

  it("updates aria-pressed for non-off states", () => {
    const pad = new PadComponent(container, 0);
    pad.setState("selected");
    expect(container.querySelector(".pad")?.getAttribute("aria-pressed")).toBe("true");
    pad.setState("off");
    expect(container.querySelector(".pad")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("returns correct index", () => {
    const pad = new PadComponent(container, 7);
    expect(pad.index).toBe(7);
  });
});

// ── WaveformComponent ──

describe("WaveformComponent", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("renders a canvas element", () => {
    new WaveformComponent(container);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.querySelector(".waveform-canvas")).not.toBeNull();
  });

  it("has aria role for accessibility", () => {
    new WaveformComponent(container);
    const el = container.querySelector(".waveform");
    expect(el?.getAttribute("role")).toBe("img");
  });

  it("stop() can be called without error before setAnalyser", () => {
    const wf = new WaveformComponent(container);
    expect(() => wf.stop()).not.toThrow();
  });
});

// ── SynthView ──

describe("SynthView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("renders 16 encoders", () => {
    new SynthView(container);
    expect(container.querySelectorAll(".synth-encoders .encoder").length).toBe(16);
  });

  it("renders 16 pads", () => {
    new SynthView(container);
    expect(container.querySelectorAll(".pad").length).toBe(16);
  });

  it("setEncoderValue updates encoder display", () => {
    const view = new SynthView(container);
    view.setEncoderValue(0, 0.5, "5000 Hz");
    const firstValue = container.querySelectorAll(".synth-encoders .encoder-value")[0];
    expect(firstValue?.textContent).toBe("5000 Hz");
  });

  it("setVoiceCount updates voice display", () => {
    const view = new SynthView(container);
    view.setVoiceCount(3, 8);
    expect(container.querySelector(".synth-voices")?.textContent).toBe("3/8 V");
  });

  it("renders a three-dots menu button in the header", () => {
    new SynthView(container);
    const btn = container.querySelector<HTMLButtonElement>(".synth-menu-btn");
    expect(btn).not.toBeNull();
    expect(btn?.querySelectorAll(".synth-menu-dot")).toHaveLength(3);
    expect(btn?.getAttribute("aria-label")).toBe("Menu");
  });

  it("onMenuOpen fires when the three-dots button is clicked", () => {
    const view = new SynthView(container);
    let opens = 0;
    view.onMenuOpen = () => { opens++; };
    container.querySelector<HTMLButtonElement>(".synth-menu-btn")?.click();
    expect(opens).toBe(1);
  });

  it("menuAnchor returns the three-dots button element", () => {
    const view = new SynthView(container);
    expect(view.menuAnchor).toBe(container.querySelector(".synth-menu-btn"));
  });

  it("has synth title", () => {
    new SynthView(container);
    expect(container.querySelector(".synth-title")?.textContent).toBe("ARCTURUS");
  });
});

// ── ConfigView ──

describe("ConfigView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("renders hidden by default", () => {
    new ConfigView(container);
    expect(container.querySelector(".config-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("show() makes panel visible", () => {
    const cv = new ConfigView(container);
    cv.show();
    expect(cv.isVisible).toBe(true);
    expect(container.querySelector(".config-panel")?.hasAttribute("hidden")).toBe(false);
  });

  it("hide() hides the panel", () => {
    const cv = new ConfigView(container);
    cv.show();
    cv.hide();
    expect(cv.isVisible).toBe(false);
    expect(container.querySelector(".config-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("setConfig populates form fields", () => {
    const cv = new ConfigView(container);
    cv.setConfig({ sampleRate: 44100, bufferSize: 256, maxVoices: 4 });
    expect(container.querySelector<HTMLSelectElement>("#config-sample-rate")?.value).toBe("44100");
    expect(container.querySelector<HTMLSelectElement>("#config-buffer-size")?.value).toBe("256");
    expect(container.querySelector<HTMLInputElement>("#config-max-voices")?.value).toBe("4");
  });

  it("save button fires onSave callback", () => {
    const cv = new ConfigView(container);
    const configs: Array<object> = [];
    cv.onSave = (cfg) => configs.push(cfg);
    cv.show();
    container.querySelector<HTMLButtonElement>("#config-save-btn")?.click();
    expect(configs.length).toBe(1);
  });

  it("recalibrate button fires onRecalibrate callback", () => {
    const cv = new ConfigView(container);
    let called = false;
    cv.onRecalibrate = () => { called = true; };
    container.querySelector<HTMLButtonElement>("#config-recalibrate-btn")?.click();
    expect(called).toBe(true);
  });

  it("close button calls hide()", () => {
    const cv = new ConfigView(container);
    cv.show();
    container.querySelector<HTMLButtonElement>(".config-close")?.click();
    expect(cv.isVisible).toBe(false);
  });
});

// ── Pad state transitions ──

describe("Pad state machine", () => {
  it("all valid state transitions work without throwing", () => {
    const container = makeContainer();
    const pad = new PadComponent(container, 0);
    const states: PadState[] = ["off", "selected", "triggered", "off"];
    for (const state of states) {
      expect(() => pad.setState(state)).not.toThrow();
      expect(pad.state).toBe(state);
    }
  });
});
