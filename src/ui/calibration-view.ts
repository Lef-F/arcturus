/**
 * Calibration View — Visual calibration flow using real encoder/pad components.
 *
 * Phase 1: Welcome — "Start Calibration" button
 * Phase 2: Encoder calibration — 16 encoders highlighted one at a time + master
 * Phase 3: Pad calibration — 16 pads highlighted one at a time (row 1 then row 2)
 * Phase 4: Complete — auto-proceed or button
 */

import type { CalibrationState } from "@/midi/calibration";
import { EncoderComponent } from "./components/encoder";
import { PadComponent } from "./components/pad";
import { MODULES } from "@/audio/params";

// ── CalibrationView ──

export class CalibrationView {
  private _root: HTMLElement;
  private _onComplete?: () => void;
  private _onSkip?: () => void;

  // Component instances for encoder/pad phases
  private _encoders: EncoderComponent[] = [];
  private _encoderCells: HTMLElement[] = [];
  private _masterEncoder: EncoderComponent | null = null;
  private _masterCell: HTMLElement | null = null;
  private _pads: PadComponent[] = [];
  private _currentPhase: "idle" | "encoders" | "pads" | "complete" | "error" = "idle";

  constructor(container: HTMLElement) {
    this._root = container;
  }

  set onComplete(fn: () => void) { this._onComplete = fn; }
  set onSkip(fn: () => void) { this._onSkip = fn; }

  /** Render initial state with a "Start Calibration" prompt. */
  renderIdle(): void {
    this._currentPhase = "idle";
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration">
        <h1 class="calibration-title">Arcturus Setup</h1>
        <p class="calibration-body">
          Connect your <strong>KeyStep</strong> and <strong>BeatStep</strong> via USB,
          then click <em>Start Calibration</em>.
        </p>
        <button class="btn btn-primary" id="calibration-start-btn">
          Start Calibration
        </button>
      </div>
    `;
  }

  /** Render a "Saved profiles found — skip?" prompt. */
  renderSkipPrompt(): void {
    this._currentPhase = "idle";
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration">
        <h1 class="calibration-title">Devices Recognized</h1>
        <p class="calibration-body">
          Saved calibration profiles found. You can skip setup and go straight to playing.
        </p>
        <div class="calibration-actions">
          <button class="btn btn-primary" id="calibration-skip-btn">
            Continue to Synth
          </button>
          <button class="btn btn-secondary" id="calibration-recalibrate-btn">
            Recalibrate
          </button>
        </div>
      </div>
    `;

    this._root.querySelector("#calibration-skip-btn")?.addEventListener("click", () => {
      this._onSkip?.();
    });
  }

  /** Update the view to reflect the current calibration state. */
  renderState(state: CalibrationState): void {
    switch (state.step) {
      case "discovering":
        this._renderDiscovering();
        break;

      case "characterizing_encoders":
        if (this._currentPhase !== "encoders") {
          this._buildEncoderPhase();
        }
        this._updateEncoderHighlight(state.encodersFound, false);
        break;

      case "characterizing_master":
        if (this._currentPhase !== "encoders") {
          this._buildEncoderPhase();
        }
        this._updateEncoderHighlight(16, !state.masterFound); // all 16 done, master active
        break;

      case "characterizing_pad_row1":
        if (this._currentPhase !== "pads") {
          this._buildPadPhase();
        }
        this._updatePadHighlight(state.padsFound, 1);
        break;

      case "characterizing_pad_row2":
        if (this._currentPhase !== "pads") {
          this._buildPadPhase();
        }
        // Row 1 complete (8 pads learned), row 2 in progress
        this._updatePadHighlight(state.padsFound, 2);
        break;

      case "saving":
        // Brief flash — don't rebuild UI
        break;

      case "complete":
        this._renderComplete();
        break;

      case "error":
        this._renderError(state.error ?? "Unknown error");
        break;

      default:
        this._renderDiscovering();
    }
  }

  // ── Phase builders ──

  private _renderDiscovering(): void {
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration">
        <h1 class="calibration-title">Discovering Devices</h1>
        <p class="calibration-body">Looking for KeyStep and BeatStep...</p>
        <div class="calibration-hint">This should only take a moment.</div>
      </div>
    `;
  }

  private _buildEncoderPhase(): void {
    this._currentPhase = "encoders";
    this._encoders = [];
    this._encoderCells = [];

    this._root.innerHTML = `
      <div class="calibration-view calibration-view--wide" role="main" aria-label="Encoder Calibration">
        <h1 class="calibration-title">Encoder Calibration</h1>
        <p class="calibration-instruction" id="cal-instruction">Turn encoder <strong>1 of 16</strong></p>
        <div class="synth-controls" style="pointer-events:none">
          <div class="synth-master" id="cal-master"></div>
          <div class="synth-encoders" id="cal-encoders"></div>
        </div>
        <p class="calibration-progress-text" id="cal-progress">0 of 16 learned</p>
      </div>
    `;

    // Build master encoder
    const masterEl = this._root.querySelector<HTMLElement>("#cal-master")!;
    this._masterCell = masterEl;
    this._masterEncoder = new EncoderComponent(masterEl, "MASTER", 0);
    masterEl.classList.add("encoder-cell--inactive");

    // Build 16 encoders in 4 quadrants
    const encoderGrid = this._root.querySelector<HTMLElement>("#cal-encoders")!;
    const quadrantSlots = [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15]];
    for (const slots of quadrantSlots) {
      const quadrant = document.createElement("div");
      quadrant.className = "encoder-quadrant";
      encoderGrid.appendChild(quadrant);
      for (const i of slots) {
        const cell = document.createElement("div");
        cell.className = "encoder-cell encoder-cell--inactive";
        quadrant.appendChild(cell);
        this._encoderCells[i] = cell;
        this._encoders.push(new EncoderComponent(cell, `E${i + 1}`, 0));
      }
    }

    // Highlight first encoder
    this._encoderCells[0]?.classList.remove("encoder-cell--inactive");
    this._encoderCells[0]?.classList.add("encoder-cell--calibrating");
  }

  private _updateEncoderHighlight(encodersFound: number, masterActive: boolean): void {
    const instruction = this._root.querySelector<HTMLElement>("#cal-instruction");
    const progress = this._root.querySelector<HTMLElement>("#cal-progress");

    // Update all encoder cells
    for (let i = 0; i < 16; i++) {
      const cell = this._encoderCells[i];
      if (!cell) continue;
      cell.classList.remove("encoder-cell--inactive", "encoder-cell--calibrating", "encoder-cell--learned");

      if (i < encodersFound) {
        cell.classList.add("encoder-cell--learned");
        this._encoders[i]?.setValue(1, "");
        this._encoders[i]?.reconfigure("", 0);
      } else if (i === encodersFound && encodersFound < 16) {
        cell.classList.add("encoder-cell--calibrating");
      } else {
        cell.classList.add("encoder-cell--inactive");
      }
    }

    // Master encoder state
    if (this._masterCell) {
      this._masterCell.classList.remove("encoder-cell--inactive", "encoder-cell--calibrating", "encoder-cell--learned");
      if (masterActive) {
        this._masterCell.classList.add("encoder-cell--calibrating");
      } else if (encodersFound >= 16 && !masterActive) {
        this._masterCell.classList.add("encoder-cell--learned");
        this._masterEncoder?.setValue(1, "");
        this._masterEncoder?.reconfigure("", 0);
      } else {
        this._masterCell.classList.add("encoder-cell--inactive");
      }
    }

    // Update instruction text
    if (instruction) {
      if (encodersFound < 16) {
        instruction.innerHTML = `Turn encoder <strong>${encodersFound + 1} of 16</strong>`;
      } else if (masterActive) {
        instruction.innerHTML = `Turn the <strong>large encoder</strong> (top-left of BeatStep)`;
      } else {
        instruction.innerHTML = `All encoders learned!`;
      }
    }

    if (progress) {
      progress.textContent = `${Math.min(encodersFound, 16)} of 16 learned`;
    }
  }

  private _buildPadPhase(): void {
    this._currentPhase = "pads";
    this._pads = [];

    this._root.innerHTML = `
      <div class="calibration-view calibration-view--wide" role="main" aria-label="Pad Calibration">
        <h1 class="calibration-title">Pad Calibration</h1>
        <p class="calibration-instruction" id="cal-instruction">Press <strong>pad 1</strong> (top-left)</p>
        <p class="calibration-hint" style="margin-bottom:12px">Module pads (top row)</p>
        <div class="synth-module-pads" id="cal-pads-row1" style="pointer-events:none"></div>
        <p class="calibration-hint" style="margin:12px 0 8px">Program pads (bottom row)</p>
        <div class="synth-program-pads" id="cal-pads-row2" style="pointer-events:none"></div>
      </div>
    `;

    // Build row 1 (module pads)
    const row1 = this._root.querySelector<HTMLElement>("#cal-pads-row1")!;
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement("div");
      cell.className = "pad-cell";
      row1.appendChild(cell);
      const label = MODULES[i]?.label ?? `M${i + 1}`;
      this._pads.push(new PadComponent(cell, i, label));
    }

    // Build row 2 (program pads)
    const row2 = this._root.querySelector<HTMLElement>("#cal-pads-row2")!;
    for (let i = 0; i < 8; i++) {
      const cell = document.createElement("div");
      cell.className = "pad-cell";
      row2.appendChild(cell);
      this._pads.push(new PadComponent(cell, 8 + i, `P${i + 1}`));
    }

    // Highlight first pad
    this._pads[0]?.setState("calibrating");
  }

  private _updatePadHighlight(padsFound: number, row: 1 | 2): void {
    const instruction = this._root.querySelector<HTMLElement>("#cal-instruction");

    // Row 1 pads (indices 0-7)
    for (let i = 0; i < 8; i++) {
      if (row === 1) {
        if (padsFound > 0) {
          // Row 1 pad pressed — cascade all 8 as learned
          this._pads[i]?.setState("triggered");
        } else if (i === 0) {
          this._pads[i]?.setState("calibrating");
        } else {
          this._pads[i]?.setState("off");
        }
      } else {
        // Row 2 active — row 1 all learned
        this._pads[i]?.setState("triggered");
      }
    }

    // Row 2 pads (indices 8-15)
    for (let i = 0; i < 8; i++) {
      if (row === 2) {
        if (padsFound > 0) {
          this._pads[8 + i]?.setState("triggered");
        } else if (i === 0) {
          this._pads[8 + i]?.setState("calibrating");
        } else {
          this._pads[8 + i]?.setState("off");
        }
      } else {
        this._pads[8 + i]?.setState("off");
      }
    }

    if (instruction) {
      if (row === 1 && padsFound === 0) {
        instruction.innerHTML = `Press <strong>pad 1</strong> (top-left)`;
      } else if (row === 2 && padsFound === 0) {
        instruction.innerHTML = `Press <strong>pad 9</strong> (bottom-left)`;
      } else {
        instruction.innerHTML = `Row ${row} learned!`;
      }
    }
  }

  private _renderComplete(): void {
    this._currentPhase = "complete";
    // Auto-proceed to synth after a brief flash
    setTimeout(() => this._onComplete?.(), 300);
  }

  private _renderError(message: string): void {
    this._currentPhase = "error";
    this._root.innerHTML = `
      <div class="calibration-view calibration-view--error" role="alert">
        <h1 class="calibration-title">Setup Failed</h1>
        <p class="calibration-body calibration-body--error">${message}</p>
        <button class="btn btn-secondary" id="calibration-retry-btn">
          Retry
        </button>
      </div>
    `;
  }
}
