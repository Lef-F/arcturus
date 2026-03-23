/**
 * Meter Component — Level meter, CPU load bar.
 */

export class MeterComponent {
  private _root: HTMLElement;
  private _level = 0;
  private _label: string;

  constructor(container: HTMLElement, label = "") {
    this._root = container;
    this._label = label;
    this._render();
  }

  /** Update the meter level (0-1 normalized). */
  setLevel(level: number): void {
    this._level = Math.max(0, Math.min(1, level));
    this._update();
  }

  get level(): number {
    return this._level;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="meter" role="meter"
           aria-label="${this._label}"
           aria-valuemin="0" aria-valuemax="1"
           aria-valuenow="${this._level}">
        <div class="meter-track">
          <div class="meter-bar" style="width:${this._level * 100}%"></div>
        </div>
        ${this._label ? `<span class="meter-label">${this._label}</span>` : ""}
      </div>
    `;
  }

  private _update(): void {
    const bar = this._root.querySelector<HTMLElement>(".meter-bar");
    if (bar) bar.style.width = `${this._level * 100}%`;
    this._root.querySelector(".meter")?.setAttribute("aria-valuenow", String(this._level));
  }
}
