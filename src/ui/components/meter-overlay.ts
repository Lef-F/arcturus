/**
 * MeterOverlay — reusable stereo level meter with clip detection.
 *
 * Renders two fill elements (left/right channels) inside a container.
 * Can operate in two modes:
 *   - "vertical" (bottom-up fill, for pads)
 *   - "horizontal" (center-out fill, for VU bars)
 *
 * Clip indicator: adds a CSS class on the container when clipping,
 * holds for 2 seconds after last clip event, then fades out.
 */

export type MeterMode = "vertical" | "horizontal";

export class MeterOverlay {
  private _left: HTMLElement;
  private _right: HTMLElement;
  private _host: HTMLElement;
  private _mode: MeterMode;
  private _clipTimer: ReturnType<typeof setTimeout> | null = null;
  private _clipClass: string;

  /**
   * @param host — the element to add the clip class to (e.g., the pad button or VU bar)
   * @param left — the left channel fill element
   * @param right — the right channel fill element
   * @param mode — "vertical" for bottom-up (pads), "horizontal" for center-out (VU bar)
   * @param clipClass — CSS class to add on clipping (default: host-specific)
   */
  constructor(host: HTMLElement, left: HTMLElement, right: HTMLElement, mode: MeterMode, clipClass: string) {
    this._host = host;
    this._left = left;
    this._right = right;
    this._mode = mode;
    this._clipClass = clipClass;
  }

  /**
   * Update stereo levels.
   * @param leftLevel — left channel RMS (0 = silence, 1 = unity, >1 = hot)
   * @param rightLevel — right channel RMS
   * @param clipping — true if either channel peak > 1.0
   */
  update(leftLevel: number, rightLevel: number, clipping: boolean): void {
    if (this._mode === "vertical") {
      // Bottom-up fill: 0→5%, 1.0→95%, sqrt perceptual scaling
      const toPct = (v: number) => Math.max(5, Math.min(95, Math.sqrt(Math.min(v, 1.5)) * 90 + 5));
      this._left.style.height = `${toPct(leftLevel)}%`;
      this._right.style.height = `${toPct(rightLevel)}%`;
    } else {
      // Center-out: 0→2%, 1.0→50% (full half), sqrt scaling
      const toPct = (v: number) => Math.max(2, Math.min(50, Math.sqrt(Math.min(v, 1.5)) * 48 + 2));
      this._left.style.width = `${toPct(leftLevel)}%`;
      this._right.style.width = `${toPct(rightLevel)}%`;

      // VU bar color: green → orange → red
      const maxLevel = Math.max(leftLevel, rightLevel);
      let color: string;
      if (clipping || maxLevel > 1.0) {
        color = "var(--red)";
      } else if (maxLevel > 0.5) {
        color = "var(--orange)";
      } else {
        color = "var(--green)";
      }
      this._left.style.background = color;
      this._right.style.background = color;
    }

    // Clip indicator: add class, hold for 2s, then fade
    if (clipping) {
      this._host.classList.add(this._clipClass);
      if (this._clipTimer) clearTimeout(this._clipTimer);
      this._clipTimer = setTimeout(() => {
        this._host.classList.remove(this._clipClass);
        this._clipTimer = null;
      }, 2000);
    }
  }

  /** Reset meter to zero. */
  clear(): void {
    if (this._mode === "vertical") {
      this._left.style.height = "0%";
      this._right.style.height = "0%";
    } else {
      this._left.style.width = "2%";
      this._right.style.width = "2%";
    }
    this._host.classList.remove(this._clipClass);
    if (this._clipTimer) { clearTimeout(this._clipTimer); this._clipTimer = null; }
  }
}
