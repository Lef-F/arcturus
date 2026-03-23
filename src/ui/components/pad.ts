/**
 * Pad Component — Pressure-sensitive pad with LED state visualization.
 * Cyan glow for selected patch, green for triggered notes.
 */

export type PadState = "off" | "selected" | "triggered";

export class PadComponent {
  private _root: HTMLElement;
  private _state: PadState = "off";
  private _index: number;
  private _label: string;

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

  get state(): PadState {
    return this._state;
  }

  get index(): number {
    return this._index;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <button class="pad pad--off"
              data-pad-index="${this._index}"
              aria-label="Pad ${this._label}"
              aria-pressed="false">
        <span class="pad-label">${this._label}</span>
      </button>
    `;
  }

  private _updateState(): void {
    const btn = this._root.querySelector<HTMLButtonElement>(".pad");
    if (!btn) return;

    btn.classList.remove("pad--off", "pad--selected", "pad--triggered");
    btn.classList.add(`pad--${this._state}`);
    btn.setAttribute("aria-pressed", String(this._state !== "off"));
  }
}
