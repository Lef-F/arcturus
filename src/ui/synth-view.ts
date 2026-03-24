/**
 * Synth View — Main performance interface, BeatStep-shaped layout.
 * 8×2 encoder grid + 8 module selector pads + 8 program pads + waveform display.
 */

import { EncoderComponent } from "./components/encoder";
import { PadComponent, type PadState } from "./components/pad";
import { WaveformComponent } from "./components/waveform";
import { MODULES } from "@/audio/params";
import type { SynthParam, VizMode } from "@/types";

export class SynthView {
  private _root: HTMLElement;
  private _encoders: EncoderComponent[] = [];
  private _encoderCells: HTMLElement[] = [];
  private _masterEncoder: EncoderComponent | null = null;
  private _masterTouchTimer: ReturnType<typeof setTimeout> | null = null;
  private _touchTimers = new Map<number, ReturnType<typeof setTimeout>>();
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
    const cell = this._encoderCells[index];
    if (param) {
      this._encoders[index]?.reconfigure(param.label, param.steps ?? 0);
      this._encoders[index]?.setValue(normalized, displayText);
      cell?.classList.remove("encoder-cell--inactive");
      cell?.classList.add("encoder-cell--active");
    } else {
      this._encoders[index]?.reconfigure("—", 0);
      this._encoders[index]?.setValue(0, "");
      cell?.classList.remove("encoder-cell--active");
      cell?.classList.add("encoder-cell--inactive");
    }
  }

  /** Briefly highlight an encoder cell (mimics hover) when physically turned. */
  flashEncoder(index: number): void {
    const cell = this._encoderCells[index];
    if (!cell) return;
    cell.classList.add("encoder-cell--touched");
    const existing = this._touchTimers.get(index);
    if (existing) clearTimeout(existing);
    this._touchTimers.set(index, setTimeout(() => {
      cell.classList.remove("encoder-cell--touched");
      this._touchTimers.delete(index);
    }, 800));
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

  /** Restore the saved visualization mode. */
  setVizMode(mode: VizMode): void {
    this._waveform?.setMode(mode);
  }

  /** Called when user clicks to change visualization mode. */
  onVizModeChange?: (mode: VizMode) => void;

  /** Update the master volume display (normalized 0–1). */
  setMasterValue(normalized: number, displayText?: string): void {
    this._masterEncoder?.setValue(normalized, displayText);
  }

  /** Briefly highlight the master encoder when physically turned. */
  flashMaster(): void {
    const el = this._root.querySelector<HTMLElement>(".synth-master");
    if (!el) return;
    el.classList.add("synth-master--touched");
    if (this._masterTouchTimer) clearTimeout(this._masterTouchTimer);
    this._masterTouchTimer = setTimeout(() => {
      el.classList.remove("synth-master--touched");
      this._masterTouchTimer = null;
    }, 800);
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
        <div class="synth-controls">
          <div class="synth-master"></div>
          <div class="synth-encoders"></div>
        </div>
        <div class="synth-module-pads"></div>
        <div class="synth-program-pads"></div>
      </div>
    `;

    // Waveform
    const waveformEl = this._root.querySelector<HTMLElement>(".synth-waveform")!;
    this._waveform = new WaveformComponent(waveformEl);

    // Waveform mode change callback
    if (this._waveform) {
      this._waveform.onModeChange = (mode) => this.onVizModeChange?.(mode);
    }

    // Master volume encoder (large BeatStep knob, top-left)
    const masterEl = this._root.querySelector<HTMLElement>(".synth-master")!;
    this._masterEncoder = new EncoderComponent(masterEl, "MASTER", 0);

    // Encoders (16 total: 4 quadrants of 4, matching BeatStep physical layout)
    const encoderGrid = this._root.querySelector<HTMLElement>(".synth-encoders")!;
    const quadrantSlots = [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15]];
    for (const slots of quadrantSlots) {
      const quadrant = document.createElement("div");
      quadrant.className = "encoder-quadrant";
      encoderGrid.appendChild(quadrant);
      for (const i of slots) {
        const cell = document.createElement("div");
        cell.className = "encoder-cell";
        quadrant.appendChild(cell);
        this._encoderCells[i] = cell;
        this._encoders.push(new EncoderComponent(cell, `E${i + 1}`, 0));
        cell.addEventListener("wheel", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const speed = Math.abs(e.deltaY) > 50 ? 3 : 1;
          const delta = (e.deltaY < 0 ? 1 : -1) * speed;
          this.onEncoderScroll?.(i, delta);
        }, { passive: false });
      }
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
