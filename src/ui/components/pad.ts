/**
 * Pad Component — Pressure-sensitive pad with LED state visualization.
 * Stereo level metering via MeterOverlay.
 */

import { MeterOverlay } from "./meter-overlay";

export type PadState = "off" | "selected" | "latched" | "selected-latched" | "triggered" | "calibrating";

export class PadComponent {
  private _root: HTMLElement;
  private _state: PadState = "off";
  private _index: number;
  private _label: string;
  private _meter: MeterOverlay | null = null;

  constructor(container: HTMLElement, index: number, label = "") {
    this._root = container;
    this._index = index;
    this._label = label || String(index + 1);
    this._render();
  }

  setState(state: PadState): void {
    if (this._state === state) return;
    this._state = state;
    this._updateState();
  }

  setLevel(left: number, right: number, clipping: boolean): void {
    this._meter?.update(left, right, clipping);
  }

  clearLevel(): void {
    this._meter?.clear();
  }

  get state(): PadState { return this._state; }
  get index(): number { return this._index; }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <button class="pad pad--off"
              data-pad-index="${this._index}"
              aria-label="Pad ${this._label}"
              aria-pressed="false">
        <div class="pad-meter pad-meter--left"></div>
        <div class="pad-meter pad-meter--right"></div>
        <span class="pad-label">${this._label}</span>
      </button>
    `;

    const btn = this._root.querySelector<HTMLButtonElement>(".pad")!;
    const meterL = this._root.querySelector<HTMLElement>(".pad-meter--left")!;
    const meterR = this._root.querySelector<HTMLElement>(".pad-meter--right")!;
    this._meter = new MeterOverlay(btn, meterL, meterR, "vertical", "pad--clipping");
  }

  private _updateState(): void {
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    if (!btn) return;
    btn.classList.remove("pad--off", "pad--selected", "pad--latched", "pad--selected-latched", "pad--triggered", "pad--calibrating");
    btn.classList.add(`pad--${this._state}`);
    btn.setAttribute("aria-pressed", String(this._state !== "off"));
  }
}
