/**
 * Synth View — Main performance interface, BeatStep-shaped layout.
 * 8×2 encoder grid + 8 module selector pads + 8 program pads + waveform display.
 */

import { EncoderComponent } from "./components/encoder";
import { PadComponent, type PadState } from "./components/pad";
import { WaveformComponent } from "./components/waveform";
import { MODULES } from "@/audio/params";
import type { SynthParam } from "@/types";

export class SynthView {
  private _root: HTMLElement;
  private _encoders: EncoderComponent[] = [];
  private _modulePads: PadComponent[] = [];
  private _programPads: PadComponent[] = [];
  private _waveform: WaveformComponent | null = null;

  /** Called when user clicks a module pad (top row, 0–7). */
  onModuleSelect?: (moduleIndex: number) => void;

  /** Called when user clicks a program pad (bottom row, 0–7). */
  onProgramSelect?: (programIndex: number) => void;

  /** Called when user scrolls on an encoder knob. */
  onEncoderScroll?: (encoderIndex: number, delta: number) => void;

  constructor(container: HTMLElement) {
    this._root = container;
    this._render();
  }

  /** Update an encoder's displayed value and label from a SynthParam (or clear it). */
  setEncoderParam(index: number, param: SynthParam | null, normalized: number, displayText?: string): void {
    if (param) {
      this._encoders[index]?.reconfigure(param.label, param.steps ?? 0);
      this._encoders[index]?.setValue(normalized, displayText);
    } else {
      this._encoders[index]?.reconfigure("—", 0);
      this._encoders[index]?.setValue(0, "");
    }
  }

  /** Update an encoder's displayed value without changing its label/steps. */
  setEncoderValue(index: number, normalized: number, displayText?: string): void {
    this._encoders[index]?.setValue(normalized, displayText);
  }

  /** Update a module pad's LED state. */
  setModulePadState(index: number, state: PadState): void {
    this._modulePads[index]?.setState(state);
  }

  /** Update a program pad's LED state. */
  setProgramPadState(index: number, state: PadState): void {
    this._programPads[index]?.setState(state);
  }

  /**
   * Compatibility shim: routes to module (0–7) or program (8–15) pads by index.
   * @deprecated Use setModulePadState / setProgramPadState directly.
   */
  setPadState(padIndex: number, state: PadState): void {
    if (padIndex < 8) this.setModulePadState(padIndex, state);
    else this.setProgramPadState(padIndex - 8, state);
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
        <div class="synth-module-pads"></div>
        <div class="synth-program-pads"></div>
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
      this._encoders.push(new EncoderComponent(cell, `E${i + 1}`, 0));

      cell.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const speed = Math.abs(e.deltaY) > 50 ? 3 : 1;
        const delta = (e.deltaY < 0 ? 1 : -1) * speed;
        this.onEncoderScroll?.(i, delta);
      }, { passive: false });
    }

    // Module pads (top row, 0–7) — module selectors
    const modulePadGrid = this._root.querySelector<HTMLElement>(".synth-module-pads")!;
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement("div");
      cell.className = "pad-cell";
      modulePadGrid.appendChild(cell);
      const label = MODULES[i]?.label ?? `M${i + 1}`;
      const pad = new PadComponent(cell, i, label);
      cell.querySelector(".pad")?.addEventListener("click", () => this.onModuleSelect?.(i));
      this._modulePads.push(pad);
    }

    // Program pads (bottom row, 0–7) — program selectors
    const programPadGrid = this._root.querySelector<HTMLElement>(".synth-program-pads")!;
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement("div");
      cell.className = "pad-cell";
      programPadGrid.appendChild(cell);
      const pad = new PadComponent(cell, i, `P${i + 1}`);
      cell.querySelector(".pad")?.addEventListener("click", () => this.onProgramSelect?.(i));
      this._programPads.push(pad);
    }
  }
}
