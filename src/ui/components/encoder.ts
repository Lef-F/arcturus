/**
 * Encoder Component — SVG rotary encoder visualization.
 * Continuous params: smooth arc indicator.
 * Discrete params (steps > 1): dot indicators at each step position.
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
  // largeArc flag: 1 when arc spans more than 180°, i.e. > 180/270 ≈ 66.7% of travel
  const largeArc = clamped * ARC_RANGE_DEG > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${TRACK_RADIUS} ${TRACK_RADIUS} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

function buildStepDots(normalized: number, steps: number): string {
  const activeStep = Math.round(normalized * (steps - 1));
  let dots = "";
  for (let i = 0; i < steps; i++) {
    const stepNorm = steps > 1 ? i / (steps - 1) : 0;
    const angleDeg = ARC_START_DEG + stepNorm * ARC_RANGE_DEG;
    const [x, y] = polarToXY(CX, CY, TRACK_RADIUS, angleDeg);
    const active = i === activeStep;
    dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${active ? 4 : 2.5}" fill="${active ? "var(--cyan, #26fedc)" : "#555"}" />`;
  }
  return dots;
}

// ── EncoderComponent ──

export class EncoderComponent {
  private _root: HTMLElement;
  private _normalized = 0;
  private _label: string;
  private _valueText = "";
  private _steps: number;

  constructor(container: HTMLElement, label: string, steps = 0) {
    this._root = container;
    this._label = label;
    this._steps = steps;
    this._render();
  }

  /** Update the display value (0-1 normalized). */
  setValue(normalized: number, displayText?: string): void {
    this._normalized = Math.max(0, Math.min(1, normalized));
    this._valueText = displayText ?? this._normalized.toFixed(2);
    this._updateIndicator();
    this._updateText();
  }

  /** Change the label and step count without a full re-render. */
  reconfigure(label: string, steps: number): void {
    if (this._label === label && this._steps === steps) return;
    const modeChanged = (this._steps > 1) !== (steps > 1);
    this._label = label;
    this._steps = steps;
    if (modeChanged) {
      // Arc ↔ dots switch requires a full re-render
      this._render();
    } else {
      const labelEl = this._root.querySelector(".encoder-label");
      if (labelEl) labelEl.textContent = label;
      this._updateIndicator();
    }
  }

  get normalized(): number {
    return this._normalized;
  }

  // ── Private ──

  private _render(): void {
    const indicator = this._steps > 1
      ? `<g class="encoder-steps">${buildStepDots(this._normalized, this._steps)}</g>`
      : `<path class="encoder-arc"
          d="${buildArcPath(this._normalized)}"
          fill="none" stroke="var(--cyan, #26fedc)"
          stroke-width="${TRACK_STROKE}" stroke-linecap="round" />`;

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
          ${indicator}
          <circle class="encoder-knob" cx="${CX}" cy="${CY}" r="12"
            fill="#2a2a2e" stroke="#444" stroke-width="1" />
        </svg>
        <div class="encoder-label">${this._label}</div>
        <div class="encoder-value">${this._valueText}</div>
      </div>
    `;
  }

  private _updateIndicator(): void {
    if (this._steps > 1) {
      const stepsEl = this._root.querySelector<SVGGElement>(".encoder-steps");
      if (stepsEl) stepsEl.innerHTML = buildStepDots(this._normalized, this._steps);
    } else {
      const arc = this._root.querySelector<SVGPathElement>(".encoder-arc");
      arc?.setAttribute("d", buildArcPath(this._normalized));
    }
    this._root.querySelector(".encoder")?.setAttribute("aria-valuenow", String(this._normalized));
  }

  private _updateText(): void {
    const valEl = this._root.querySelector(".encoder-value");
    if (valEl) valEl.textContent = this._valueText;
  }
}
