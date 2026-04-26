/**
 * Synth View — Main performance interface, BeatStep-shaped layout.
 * 8×2 encoder grid + 8 module selector pads + 8 program pads + waveform display.
 */

import { EncoderComponent } from "./components/encoder";
import { PadComponent, type PadState } from "./components/pad";
import { WaveformComponent } from "./components/waveform";
import { MeterOverlay } from "./components/meter-overlay";
import { buildEncoderGrid, buildPadGrid } from "./components/grid-builders";
import type { SynthParam, VizMode } from "@/types";

/** Pixels of vertical drag that produce one full encoder "tick" (matches a wheel notch). */
const DRAG_PIXELS_PER_TICK = 4;

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
  private _vuMeter: MeterOverlay | null = null;

  /** Called when user clicks a module pad (top row, 0–7). */
  onModuleSelect?: (moduleIndex: number) => void;

  /** Called when user clicks a program pad (bottom row, 0–7). */
  onProgramSelect?: (programIndex: number) => void;

  /** Called when user scrolls or drags an encoder knob. */
  onEncoderScroll?: (encoderIndex: number, delta: number) => void;

  /** Called when user scrolls or drags the master encoder. */
  onMasterScroll?: (delta: number) => void;

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

  /** Update a program pad's stereo level meter. */
  setProgramPadLevel(index: number, left: number, right: number, clipping: boolean): void {
    this._programPads[index]?.setLevel(left, right, clipping);
  }

  /** Clear a program pad's level meter. */
  clearProgramPadLevel(index: number): void {
    this._programPads[index]?.clearLevel();
  }

  /** Update the global stereo VU bar between pad rows. */
  setVuLevel(left: number, right: number, clipping: boolean): void {
    this._vuMeter?.update(left, right, clipping);
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

  /** Update the voice count display. */
  setVoiceCount(active: number, max: number): void {
    const el = this._root.querySelector(".synth-voices");
    if (el) el.textContent = `${active}/${max} V`;
  }

  /** The DOM element that should anchor any header dropdown menu. */
  get menuAnchor(): HTMLButtonElement | null {
    return this._root.querySelector<HTMLButtonElement>(".synth-menu-btn");
  }

  /** Fired when the user clicks the three-dots header button. */
  onMenuOpen?: () => void;

  // ── Private ──

  private _render(): void {
    this._root.innerHTML = `
      <div class="synth-view">
        <div class="synth-header">
          <span class="synth-title">ARCTURUS</span>
          <span class="synth-spacer"></span>
          <span class="synth-voices">0/8 V</span>
          <button class="synth-menu-btn" aria-label="Menu" aria-haspopup="menu">
            <span class="synth-menu-dot"></span>
            <span class="synth-menu-dot"></span>
            <span class="synth-menu-dot"></span>
          </button>
        </div>
        <div class="synth-waveform"></div>
        <div class="synth-controls"></div>
      </div>
    `;

    const menuBtn = this._root.querySelector<HTMLButtonElement>(".synth-menu-btn");
    menuBtn?.addEventListener("click", () => this.onMenuOpen?.());

    // Waveform
    const waveformEl = this._root.querySelector<HTMLElement>(".synth-waveform")!;
    this._waveform = new WaveformComponent(waveformEl);
    if (this._waveform) {
      this._waveform.onModeChange = (mode) => this.onVizModeChange?.(mode);
    }

    // Encoder grid (master + 16 encoders) via shared builder
    const controlsEl = this._root.querySelector<HTMLElement>(".synth-controls")!;
    const { encoders, cells, masterEncoder, masterCell } = buildEncoderGrid(controlsEl);
    this._encoders = encoders;
    this._encoderCells = cells;
    this._masterEncoder = masterEncoder;

    // Wire scroll + drag on each encoder cell
    for (let i = 0; i < cells.length; i++) {
      this._wireEncoderInput(cells[i], (delta) => this.onEncoderScroll?.(i, delta));
    }
    // Master encoder shares the same input idiom
    this._wireEncoderInput(masterCell, (delta) => this.onMasterScroll?.(delta));

    // Pad grids (module + VU bar + program) via shared builder
    const viewEl = this._root.querySelector<HTMLElement>(".synth-view")!;
    const { modulePads, programPads, vuBar } = buildPadGrid(viewEl);
    this._modulePads = modulePads;
    const vuLeft = vuBar.querySelector<HTMLElement>(".synth-vu-left");
    const vuRight = vuBar.querySelector<HTMLElement>(".synth-vu-right");
    if (vuLeft && vuRight) {
      this._vuMeter = new MeterOverlay(vuBar, vuLeft, vuRight, "horizontal", "synth-vu-bar--clipping");
    }
    this._programPads = programPads;

    // Wire pad click events
    for (let i = 0; i < modulePads.length; i++) {
      const cell = this._root.querySelectorAll(".synth-module-pads .pad-cell")[i];
      cell?.querySelector(".pad")?.addEventListener("click", () => this.onModuleSelect?.(i));
    }
    for (let i = 0; i < programPads.length; i++) {
      const cell = this._root.querySelectorAll(".synth-program-pads .pad-cell")[i];
      cell?.querySelector(".pad")?.addEventListener("click", () => this.onProgramSelect?.(i));
    }
  }

  /**
   * Attach scroll and vertical-drag handlers to an encoder cell.
   * Both produce the same delta units the BeatStep encoder would —
   * the consumer treats them identically.
   */
  private _wireEncoderInput(cell: HTMLElement, emit: (delta: number) => void): void {
    cell.classList.add("encoder-cell--interactive");

    cell.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const speed = Math.abs(e.deltaY) > 50 ? 3 : 1;
      const delta = (e.deltaY < 0 ? 1 : -1) * speed;
      emit(delta);
    }, { passive: false });

    let dragOriginY = 0;
    let accumulatedPx = 0;
    let dragging = false;
    let pointerId: number | null = null;

    cell.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // primary button only
      dragging = true;
      pointerId = e.pointerId;
      dragOriginY = e.clientY;
      accumulatedPx = 0;
      cell.setPointerCapture(e.pointerId);
      cell.classList.add("encoder-cell--dragging");
    });

    cell.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      // Up = positive (clockwise), down = negative — matches scroll sign.
      const dy = dragOriginY - e.clientY;
      const totalPx = dy + accumulatedPx;
      const ticks = (totalPx >= 0 ? Math.floor(totalPx / DRAG_PIXELS_PER_TICK) : -Math.floor(-totalPx / DRAG_PIXELS_PER_TICK));
      if (ticks !== 0) {
        emit(ticks);
        const consumed = ticks * DRAG_PIXELS_PER_TICK;
        dragOriginY = e.clientY;
        accumulatedPx = totalPx - consumed;
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      try { cell.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      cell.classList.remove("encoder-cell--dragging");
    };
    cell.addEventListener("pointerup", endDrag);
    cell.addEventListener("pointercancel", endDrag);
  }
}
