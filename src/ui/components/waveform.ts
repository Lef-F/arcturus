/**
 * WaveformComponent — Multi-mode audio visualization.
 * Click the display to cycle modes.
 *
 * SCOPE    — triggered oscilloscope with CRT phosphor glow
 * X·Y      — Lissajous: signal vs quarter-period-delayed signal
 * 3D TIME  — perspective waterfall spectrogram (scrolling history)
 * SPECTRUM — FFT bars with peak hold, cyan→orange heat gradient
 */

import type { VizMode } from "@/types";

// ── Constants ──

const MODES: VizMode[] = ["scope", "lissajous", "time3d", "spectral"];

const MODE_LABELS: Record<VizMode, string> = {
  scope:    "SCOPE",
  lissajous:"X · Y",
  time3d:   "3D TIME",
  spectral: "SPECTRUM",
};

// Phosphor Observer palette
const BG       = "#0e0e12";
const CYAN     = "#26fedc";
const ORANGE   = "#ff9062";
const GREEN    = "#a4ff00";

const HISTORY_ROWS  = 52;
const SPECTRAL_BINS = 80;

// ── Component ──

export class WaveformComponent {
  private _root: HTMLElement;
  private _canvas: HTMLCanvasElement | null = null;
  private _analyser: AnalyserNode | null = null;
  private _animFrameId: number | null = null;

  private _timeBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private _freqBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private _mode: VizMode = "time3d";

  // 3D Time rolling history
  private _history: Float32Array<ArrayBuffer>[] = [];
  private _historyHead = 0;

  // Spectral peak hold
  private _peaks: Float32Array<ArrayBuffer> = new Float32Array(SPECTRAL_BINS);

  // Pre-computed log-frequency → FFT bin map (built once per analyser)
  private _binMap: Int32Array = new Int32Array(SPECTRAL_BINS);

  constructor(container: HTMLElement) {
    this._root = container;
    this._render();
    this._drawIdle();
  }

  /** Attach an AnalyserNode and start the animation loop. */
  setAnalyser(analyser: AnalyserNode): void {
    this._analyser = analyser;
    this._timeBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
    this._freqBuf = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
    this._history = Array.from({ length: HISTORY_ROWS }, () => new Float32Array(SPECTRAL_BINS) as Float32Array<ArrayBuffer>);
    this._peaks   = new Float32Array(SPECTRAL_BINS) as Float32Array<ArrayBuffer>;

    // Build log-frequency → FFT bin lookup table (20 Hz–20 kHz, one entry per display bin).
    // Each octave gets equal screen space — essential for musical content to spread properly.
    const nyquist  = analyser.context.sampleRate / 2;
    const minFreq  = 20;
    const maxFreq  = Math.min(nyquist, 20000);
    const fftSize  = analyser.fftSize;
    const binCount = analyser.frequencyBinCount;
    for (let i = 0; i < SPECTRAL_BINS; i++) {
      const freq = minFreq * Math.pow(maxFreq / minFreq, i / (SPECTRAL_BINS - 1));
      this._binMap[i] = Math.min(binCount - 1, Math.round(freq * fftSize / analyser.context.sampleRate));
    }

    this._startLoop();
  }

  /** Called when the user clicks to change mode. Persist this in app. */
  onModeChange?: (mode: VizMode) => void;

  /** Restore a previously saved mode (call before setAnalyser). */
  setMode(mode: VizMode): void {
    this._mode = mode;
    const label = this._root.querySelector<HTMLElement>(".waveform-mode-label");
    if (label) label.textContent = MODE_LABELS[mode];
  }

  /** Stop animation and release analyser. */
  stop(): void {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this._analyser = null;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="waveform" role="img" aria-label="Audio visualization">
        <canvas class="waveform-canvas"></canvas>
        <span class="waveform-mode-label">${MODE_LABELS[this._mode]}</span>
      </div>
    `;

    this._canvas = this._root.querySelector<HTMLCanvasElement>(".waveform-canvas");

    this._root.style.cursor = "pointer";
    this._root.addEventListener("click", () => {
      const idx = MODES.indexOf(this._mode);
      this._mode = MODES[(idx + 1) % MODES.length];
      const label = this._root.querySelector<HTMLElement>(".waveform-mode-label");
      if (label) label.textContent = MODE_LABELS[this._mode];
      this.onModeChange?.(this._mode);
    });

    if (this._canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = this._canvas.getBoundingClientRect();
      this._canvas.width  = (rect.width  || 960) * dpr;
      this._canvas.height = (rect.height || 160) * dpr;
      this._canvas.getContext("2d")?.scale(dpr, dpr);
    }
  }

  private _drawIdle(): void {
    const r = this._rc();
    if (!r) return;
    const { ctx, w, h } = r;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(38,254,220,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  private _startLoop(): void {
    const tick = () => {
      this._draw();
      this._animFrameId = requestAnimationFrame(tick);
    };
    this._animFrameId = requestAnimationFrame(tick);
  }

  private _draw(): void {
    if (!this._canvas || !this._analyser) return;
    switch (this._mode) {
      case "scope":     this._drawScope();    break;
      case "lissajous": this._drawLissajous(); break;
      case "time3d":    this._drawTime3D();    break;
      case "spectral":  this._drawSpectral();  break;
    }
  }

  /** Helper — get context + logical dimensions. */
  private _rc(): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
    if (!this._canvas) return null;
    const ctx = this._canvas.getContext("2d");
    if (!ctx) return null;
    const dpr = window.devicePixelRatio || 1;
    return { ctx, w: this._canvas.width / dpr, h: this._canvas.height / dpr };
  }

  // ── SCOPE ──────────────────────────────────────────────────────────────

  private _drawScope(): void {
    const r = this._rc();
    if (!r || !this._analyser) return;
    const { ctx, w, h } = r;

    this._analyser.getFloatTimeDomainData(this._timeBuf);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Subtle center line
    ctx.strokeStyle = "rgba(38,254,220,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Find first upward zero-crossing for trigger stability
    let start = 0;
    for (let i = 1; i < this._timeBuf.length - 1; i++) {
      if (this._timeBuf[i - 1] < 0 && this._timeBuf[i] >= 0) {
        start = i;
        break;
      }
    }

    const len  = Math.min(this._timeBuf.length - start, Math.floor(this._timeBuf.length * 0.75));
    const step = w / len;

    // Phosphor glow: draw twice — wide dim pass + sharp bright pass
    for (const pass of [
      { blur: 10, color: "rgba(38,254,220,0.35)", width: 3.5 },
      { blur: 0,  color: CYAN,                    width: 1.5 },
    ]) {
      ctx.shadowColor = CYAN;
      ctx.shadowBlur  = pass.blur;
      ctx.strokeStyle = pass.color;
      ctx.lineWidth   = pass.width;
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const x = i * step;
        const y = (1 - (this._timeBuf[start + i] + 1) / 2) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // ── LISSAJOUS ──────────────────────────────────────────────────────────

  private _drawLissajous(): void {
    const r = this._rc();
    if (!r || !this._analyser) return;
    const { ctx, w, h } = r;

    this._analyser.getFloatTimeDomainData(this._timeBuf);

    // Phosphor trail — slow fade instead of full clear
    ctx.fillStyle = "rgba(14,14,18,0.18)";
    ctx.fillRect(0, 0, w, h);

    const N       = this._timeBuf.length;
    const quarter = Math.floor(N / 4);
    const cx      = w / 2;
    const cy      = h / 2;
    const scale   = Math.min(w, h) * 0.43;

    // Glow pass
    ctx.shadowColor = CYAN;
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = "rgba(38,254,220,0.5)";
    ctx.lineWidth   = 3;
    ctx.beginPath();
    for (let i = 0; i < N - quarter - 1; i++) {
      const x = cx + this._timeBuf[i] * scale;
      const y = cy + this._timeBuf[i + quarter] * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Sharp pass
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    for (let i = 0; i < N - quarter - 1; i++) {
      const x = cx + this._timeBuf[i] * scale;
      const y = cy + this._timeBuf[i + quarter] * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Center crosshair
    ctx.strokeStyle = "rgba(38,254,220,0.08)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();
  }

  // ── 3D TIME ────────────────────────────────────────────────────────────

  private _drawTime3D(): void {
    const r = this._rc();
    if (!r || !this._analyser) return;
    const { ctx, w, h } = r;

    // Sample and store frequency row using log-scaled bin map
    this._analyser.getFloatFrequencyData(this._freqBuf);
    const row = this._history[this._historyHead];
    for (let i = 0; i < SPECTRAL_BINS; i++) {
      row[i] = Math.max(0, Math.min(1, (this._freqBuf[this._binMap[i]] + 100) / 100));
    }
    this._historyHead = (this._historyHead + 1) % HISTORY_ROWS;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const horizon  = h * 0.08;
    const floor    = h * 0.98;
    const ampMax   = h * 0.60;

    // Draw oldest→newest (back→front) for correct painter's order
    for (let ri = 0; ri < HISTORY_ROWS; ri++) {
      const age   = (this._historyHead + ri) % HISTORY_ROWS;
      const t     = ri / (HISTORY_ROWS - 1);          // 0 = back, 1 = front
      const py    = horizon + (floor - horizon) * t;   // baseline for this row
      const xSc   = 0.35 + 0.65 * t;                  // x gets wider toward front
      const xOff  = (w - w * xSc) / 2;

      // Interpolate color: back = deep teal dim, front = bright cyan
      const alpha = 0.08 + 0.92 * t;
      const cr    = Math.round(38  * 1);
      const cg    = Math.round(80  + 174 * t);         // 80→254
      const cb    = Math.round(120 + 100 * t);         // 120→220

      // Build terrain path
      const pts: [number, number][] = [];
      for (let bi = 0; bi < SPECTRAL_BINS; bi++) {
        const x   = xOff + (bi / (SPECTRAL_BINS - 1)) * w * xSc;
        const amp = this._history[age][bi];
        const y   = py - amp * ampMax * (0.3 + 0.7 * t);
        pts.push([x, y]);
      }

      // Fill to baseline (hidden-line removal)
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let bi = 1; bi < pts.length; bi++) ctx.lineTo(pts[bi][0], pts[bi][1]);
      ctx.lineTo(pts[pts.length - 1][0], py);
      ctx.lineTo(pts[0][0], py);
      ctx.closePath();
      ctx.fillStyle = `rgba(14,14,18,0.92)`;
      ctx.fill();

      // Stroke terrain
      if (t > 0.9) {
        ctx.shadowColor = CYAN;
        ctx.shadowBlur  = 8;
      }
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      ctx.lineWidth   = t > 0.9 ? 1.8 : t > 0.6 ? 1.0 : 0.6;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let bi = 1; bi < pts.length; bi++) ctx.lineTo(pts[bi][0], pts[bi][1]);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Orange peaks on the front row only
      if (t > 0.95) {
        for (let bi = 0; bi < pts.length; bi++) {
          if (this._history[age][bi] > 0.65) {
            ctx.fillStyle = ORANGE;
            ctx.shadowColor = ORANGE;
            ctx.shadowBlur  = 10;
            ctx.fillRect(pts[bi][0] - 1, pts[bi][1] - 1, 2, 2);
            ctx.shadowBlur = 0;
          }
        }
      }
    }
  }

  // ── SPECTRUM ───────────────────────────────────────────────────────────

  private _drawSpectral(): void {
    const r = this._rc();
    if (!r || !this._analyser) return;
    const { ctx, w, h } = r;

    this._analyser.getFloatFrequencyData(this._freqBuf);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Subtle horizontal grid
    ctx.strokeStyle = "rgba(38,254,220,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = h * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const gap    = 2;
    const barW   = w / SPECTRAL_BINS;

    for (let i = 0; i < SPECTRAL_BINS; i++) {
      const amp  = Math.max(0, Math.min(1, (this._freqBuf[this._binMap[i]] + 100) / 100));

      if (amp < 0.01) continue;

      const x    = i * barW;
      const barH = amp * h;
      const y    = h - barH;

      // Heat gradient: cold cyan → hot orange → white tip
      const grad = ctx.createLinearGradient(x, y, x, h);
      if (amp > 0.75) {
        grad.addColorStop(0,   "rgba(255,255,220,0.95)");
        grad.addColorStop(0.3, ORANGE);
        grad.addColorStop(1,   "rgba(38,254,220,0.15)");
        ctx.shadowColor = ORANGE;
        ctx.shadowBlur  = 14;
      } else if (amp > 0.45) {
        grad.addColorStop(0,   ORANGE);
        grad.addColorStop(1,   "rgba(38,254,220,0.2)");
        ctx.shadowColor = CYAN;
        ctx.shadowBlur  = 6;
      } else {
        grad.addColorStop(0,   CYAN);
        grad.addColorStop(1,   "rgba(38,254,220,0.08)");
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = grad;
      ctx.fillRect(x + gap / 2, y, barW - gap, barH);
      ctx.shadowBlur = 0;

      // Peak hold
      if (amp >= this._peaks[i]) {
        this._peaks[i] = amp;
      } else {
        this._peaks[i] = Math.max(0, this._peaks[i] - 0.002);
      }
      if (this._peaks[i] > 0.03) {
        const peakColor = this._peaks[i] > 0.75 ? ORANGE : this._peaks[i] > 0.45 ? GREEN : CYAN;
        ctx.fillStyle   = peakColor;
        ctx.shadowColor = peakColor;
        ctx.shadowBlur  = 6;
        ctx.fillRect(x + gap / 2, h - this._peaks[i] * h - 2, barW - gap, 2);
        ctx.shadowBlur = 0;
      }
    }
  }
}
