/**
 * Waveform Component — Oscilloscope / waveform display using AnalyserNode.
 * Rendered in OLED-style dark inset panel.
 */

export class WaveformComponent {
  private _root: HTMLElement;
  private _canvas: HTMLCanvasElement | null = null;
  private _analyser: AnalyserNode | null = null;
  private _animFrameId: number | null = null;
  private _buffer: Float32Array<ArrayBuffer> = new Float32Array(0);

  constructor(container: HTMLElement) {
    this._root = container;
    this._render();
  }

  /** Attach an AnalyserNode and start the animation loop. */
  setAnalyser(analyser: AnalyserNode): void {
    this._analyser = analyser;
    this._buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
    this._startLoop();
  }

  /** Stop the animation loop and release the analyser reference. */
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
      <div class="waveform" role="img" aria-label="Waveform display">
        <canvas class="waveform-canvas" width="256" height="64"></canvas>
      </div>
    `;
    this._canvas = this._root.querySelector<HTMLCanvasElement>(".waveform-canvas");
  }

  private _startLoop(): void {
    const draw = () => {
      this._draw();
      this._animFrameId = requestAnimationFrame(draw);
    };
    this._animFrameId = requestAnimationFrame(draw);
  }

  private _draw(): void {
    if (!this._canvas || !this._analyser) return;
    const ctx = this._canvas.getContext("2d");
    if (!ctx) return;

    this._analyser.getFloatTimeDomainData(this._buffer);

    const w = this._canvas.width;
    const h = this._canvas.height;

    ctx.fillStyle = "#0e0e12";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#26fedc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = w / this._buffer.length;
    for (let i = 0; i < this._buffer.length; i++) {
      const x = i * step;
      const y = (1 - (this._buffer[i] + 1) / 2) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}
