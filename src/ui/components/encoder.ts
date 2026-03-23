/**
 * Encoder Component — SVG rotary encoder visualization with arc indicator.
 * OP-1-inspired circular design with inner shadow + gradient.
 */

// ── Constants ──

const SVG_SIZE = 64;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;
const TRACK_RADIUS = 24;
const TRACK_STROKE = 4;

/** Arc goes from 135° (min) to 405° (max): 270° total range. */
const ARC_START_DEG = 135;
const ARC_RANGE_DEG = 270;

// ── Geometry helpers ──

function polarToXY(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function buildArcPath(normalized: number): string {
  const clamped = Math.max(0.001, Math.min(0.999, normalized));
  const endDeg = ARC_START_DEG + clamped * ARC_RANGE_DEG;
  const [sx, sy] = polarToXY(CX, CY, TRACK_RADIUS, ARC_START_DEG);
  const [ex, ey] = polarToXY(CX, CY, TRACK_RADIUS, endDeg);
  const largeArc = clamped > 0.5 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${TRACK_RADIUS} ${TRACK_RADIUS} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

// ── EncoderComponent ──

export class EncoderComponent {
  private _root: HTMLElement;
  private _normalized = 0;
  private _label: string;
  private _valueText = "";

  constructor(container: HTMLElement, label: string) {
    this._root = container;
    this._label = label;
    this._render();
  }

  /** Update the display value (0-1 normalized). */
  setValue(normalized: number, displayText?: string): void {
    this._normalized = Math.max(0, Math.min(1, normalized));
    this._valueText = displayText ?? this._normalized.toFixed(2);
    this._updateArc();
    this._updateText();
  }

  get normalized(): number {
    return this._normalized;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="encoder" role="slider"
           aria-label="${this._label}"
           aria-valuemin="0" aria-valuemax="1"
           aria-valuenow="${this._normalized}">
        <svg class="encoder-svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}">
          <circle class="encoder-track"
            cx="${CX}" cy="${CY}" r="${TRACK_RADIUS}"
            fill="none" stroke="#333" stroke-width="${TRACK_STROKE}"
            stroke-linecap="round" />
          <path class="encoder-arc"
            d="${buildArcPath(this._normalized)}"
            fill="none" stroke="var(--cyan, #26fedc)"
            stroke-width="${TRACK_STROKE}" stroke-linecap="round" />
          <circle class="encoder-knob" cx="${CX}" cy="${CY}" r="12"
            fill="#2a2a2e" stroke="#444" stroke-width="1" />
        </svg>
        <div class="encoder-label">${this._label}</div>
        <div class="encoder-value">${this._valueText}</div>
      </div>
    `;
  }

  private _updateArc(): void {
    const arc = this._root.querySelector<SVGPathElement>(".encoder-arc");
    arc?.setAttribute("d", buildArcPath(this._normalized));
    this._root.querySelector(".encoder")?.setAttribute("aria-valuenow", String(this._normalized));
  }

  private _updateText(): void {
    const valEl = this._root.querySelector(".encoder-value");
    if (valEl) valEl.textContent = this._valueText;
  }
}
