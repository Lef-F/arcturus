/**
 * Pad Component — Pressure-sensitive pad with LED state and live level meter.
 * Cyan glow for selected, orange for latched, green for triggered.
 * Bottom-up fill shows engine output level. Red border glow on clipping.
 */

export type PadState = "off" | "selected" | "latched" | "selected-latched" | "triggered" | "calibrating";

export class PadComponent {
  private _root: HTMLElement;
  private _state: PadState = "off";
  private _index: number;
  private _label: string;
  private _meterL: HTMLElement | null = null;
  private _meterR: HTMLElement | null = null;
  private _clipTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, index: number, label = "") {
    this._root = container;
    this._index = index;
    this._label = label || String(index + 1);
    this._render();
  }

  /** Update the pad's LED state. */
  setState(state: PadState): void {
    if (this._state === state) return;
    this._state = state;
    this._updateState();
  }

  /**
   * Update the live stereo level meter.
   * Left half fills from bottom for left channel, right half for right channel.
   */
  setLevel(left: number, right: number, clipping: boolean): void {
    if (!this._meterL || !this._meterR) return;

    // Map RMS to fill height with sqrt perceptual scaling
    const toPct = (v: number) => Math.max(5, Math.min(95, Math.sqrt(Math.min(v, 1.5)) * 90 + 5));
    this._meterL.style.height = `${toPct(left)}%`;
    this._meterR.style.height = `${toPct(right)}%`;

    // Clip glow: hold for 2s after last clip event
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    if (!btn) return;

    if (clipping) {
      btn.classList.add("pad--clipping");
      if (this._clipTimer) clearTimeout(this._clipTimer);
      this._clipTimer = setTimeout(() => {
        btn.classList.remove("pad--clipping");
        this._clipTimer = null;
      }, 2000);
    }
  }

  /** Clear the level meter. */
  clearLevel(): void {
    if (this._meterL) this._meterL.style.height = "0%";
    if (this._meterR) this._meterR.style.height = "0%";
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    btn?.classList.remove("pad--clipping");
    if (this._clipTimer) { clearTimeout(this._clipTimer); this._clipTimer = null; }
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
    this._meterL = this._root.querySelector<HTMLElement>(".pad-meter--left");
    this._meterR = this._root.querySelector<HTMLElement>(".pad-meter--right");
  }

  private _updateState(): void {
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    if (!btn) return;

    btn.classList.remove("pad--off", "pad--selected", "pad--latched", "pad--selected-latched", "pad--triggered", "pad--calibrating");
    btn.classList.add(`pad--${this._state}`);
    btn.setAttribute("aria-pressed", String(this._state !== "off"));
  }
}
