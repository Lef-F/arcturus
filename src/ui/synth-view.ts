/**
 * Synth View — Main performance interface, BeatStep-shaped layout.
 * 8×2 encoder grid + 8×2 pad grid + waveform display.
 */

import { EncoderComponent } from "./components/encoder";
import { PadComponent, type PadState } from "./components/pad";
import { WaveformComponent } from "./components/waveform";
import { SYNTH_PARAMS, ENCODER_PARAM_NAMES } from "@/audio/params";

export class SynthView {
  private _root: HTMLElement;
  private _encoders: EncoderComponent[] = [];
  private _pads: PadComponent[] = [];
  private _waveform: WaveformComponent | null = null;

  /** Called when user clicks a pad (fires for both top and bottom rows). */
  onPadClick?: (padIndex: number) => void;

  /** Called when user scrolls on an encoder knob. delta: +1 CW, -1 CCW, larger = faster. */
  onEncoderScroll?: (encoderIndex: number, delta: number) => void;

  constructor(container: HTMLElement) {
    this._root = container;
    this._render();
  }

  /** Update an encoder's displayed value. */
  setEncoderValue(index: number, normalized: number, displayText?: string): void {
    this._encoders[index]?.setValue(normalized, displayText);
  }

  /** Update a pad's LED state. */
  setPadState(padIndex: number, state: PadState): void {
    this._pads[padIndex]?.setState(state);
  }

  /** Attach an AnalyserNode to the waveform display. */
  setAnalyser(analyser: AnalyserNode): void {
    this._waveform?.setAnalyser(analyser);
  }

  /** Update the BPM display in the status bar. */
  setBpm(bpm: number): void {
    const el = this._root.querySelector(".synth-bpm");
    if (el) el.textContent = `${Math.round(bpm)} BPM`;
  }

  /** Update the voice count display. */
  setVoiceCount(active: number, max: number): void {
    const el = this._root.querySelector(".synth-voices");
    if (el) el.textContent = `${active}/${max} V`;
  }

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="synth-view">
        <div class="synth-header">
          <span class="synth-title">ARCTURUS</span>
          <span class="synth-bpm">120 BPM</span>
          <span class="synth-voices">0/8 V</span>
        </div>
        <div class="synth-waveform"></div>
        <div class="synth-encoders"></div>
        <div class="synth-pads"></div>
      </div>
    `;

    // Waveform
    const waveformEl = this._root.querySelector<HTMLElement>(".synth-waveform")!;
    this._waveform = new WaveformComponent(waveformEl);

    // Encoders (16 total: 2 rows of 8)
    const encoderGrid = this._root.querySelector<HTMLElement>(".synth-encoders")!;
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement("div");
      cell.className = "encoder-cell";
      encoderGrid.appendChild(cell);
      const paramName = ENCODER_PARAM_NAMES[i];
      const param = SYNTH_PARAMS[paramName];
      const label = param?.label ?? `E${i + 1}`;
      this._encoders.push(new EncoderComponent(cell, label));

      // Mouse-wheel directly on a knob controls that encoder
      cell.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const speed = Math.abs(e.deltaY) > 50 ? 3 : 1;
        const delta = (e.deltaY < 0 ? 1 : -1) * speed;
        this.onEncoderScroll?.(i, delta);
      }, { passive: false });
    }

    // Pads (16 total: 2 rows of 8)
    // Top row (0-7): patch slots P1-P8
    // Bottom row (8-15): chromatic note triggers C3-B3
    const PAD_NOTES = ["C3","C#3","D3","D#3","E3","F3","F#3","G3"];
    const padGrid = this._root.querySelector<HTMLElement>(".synth-pads")!;
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement("div");
      cell.className = "pad-cell";
      padGrid.appendChild(cell);
      const label = i < 8 ? `P${i + 1}` : PAD_NOTES[i - 8];
      const pad = new PadComponent(cell, i, label);
      cell.querySelector(".pad")?.addEventListener("click", () => {
        this.onPadClick?.(i);
      });
      this._pads.push(pad);
    }
  }
}
