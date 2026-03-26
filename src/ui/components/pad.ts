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
  private _meterEl: HTMLElement | null = null;
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
   * Update the live level meter.
   * @param level — RMS level (0 = silence, 1 = unity, >1 = clipping)
   * @param clipping — true if peak > 1.0
   */
  setLevel(level: number, clipping: boolean): void {
    if (!this._meterEl) return;

    // Map RMS to fill height: 0→5%, 0.3→40%, 1.0→95%
    // Use sqrt for perceptual scaling (quiet sounds still visible)
    const clamped = Math.min(level, 1.5);
    const pct = Math.max(5, Math.min(95, Math.sqrt(clamped) * 90 + 5));
    this._meterEl.style.height = `${pct}%`;

    // Clip glow: add class, hold for 2s after last clip event
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

  /** Clear the level meter (e.g., when engine is released). */
  clearLevel(): void {
    if (this._meterEl) this._meterEl.style.height = "0%";
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
        <div class="pad-meter"></div>
        <span class="pad-label">${this._label}</span>
      </button>
    `;
    this._meterEl = this._root.querySelector<HTMLElement>(".pad-meter");
  }

  private _updateState(): void {
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    if (!btn) return;

    btn.classList.remove("pad--off", "pad--selected", "pad--latched", "pad--selected-latched", "pad--triggered", "pad--calibrating");
    btn.classList.add(`pad--${this._state}`);
    btn.setAttribute("aria-pressed", String(this._state !== "off"));
  }
}
