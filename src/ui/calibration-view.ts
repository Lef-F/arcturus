/**
 * Calibration View — Visual calibration flow reusing the real encoder/pad grid components.
 *
 * Phase 1: Welcome — "Start Calibration" button
 * Phase 2: Encoder calibration — real encoder grid, highlight one at a time + master
 * Phase 3: Pad calibration — real pad grid, highlight each pad 1→16
 * Phase 4: Complete — auto-proceed to synth
 */

import type { CalibrationState } from "@/midi/calibration";
import { buildEncoderGrid, buildPadGrid, type EncoderGridResult, type PadGridResult } from "./components/grid-builders";

// ── CalibrationView ──

export class CalibrationView {
  private _root: HTMLElement;
  private _onComplete?: () => void;
  private _onSkip?: () => void;

  // Component refs for encoder/pad phases
  private _encoderGrid: EncoderGridResult | null = null;
  private _padGrid: PadGridResult | null = null;
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
        if (this._currentPhase !== "encoders") this._buildEncoderPhase();
        this._updateEncoderHighlight(state.encodersFound, false);
        break;

      case "characterizing_master":
        if (this._currentPhase !== "encoders") this._buildEncoderPhase();
        this._updateEncoderHighlight(16, !state.masterFound);
        break;

      case "characterizing_pad_row1":
        if (this._currentPhase !== "pads") this._buildPadPhase();
        this._updatePadHighlight(state.padsFound, 1);
        break;

      case "characterizing_pad_row2":
        if (this._currentPhase !== "pads") this._buildPadPhase();
        this._updatePadHighlight(state.padsFound, 2);
        break;

      case "saving":
        break; // brief flash — don't rebuild

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

    this._root.innerHTML = `
      <div class="calibration-view calibration-view--wide" role="main" aria-label="Encoder Calibration">
        <h1 class="calibration-title">Encoder Calibration</h1>
        <p class="calibration-instruction" id="cal-instruction">Turn encoder <strong>1 of 16</strong></p>
        <div class="synth-controls" id="cal-controls" style="pointer-events:none"></div>
        <p class="calibration-progress-text" id="cal-progress">0 of 16 learned</p>
      </div>
    `;

    // Build the real encoder grid using the shared builder
    const controlsEl = this._root.querySelector<HTMLElement>("#cal-controls")!;
    this._encoderGrid = buildEncoderGrid(controlsEl);

    // Start with everything inactive, first encoder highlighted
    this._encoderGrid.masterCell.classList.add("encoder-cell--inactive");
    for (let i = 0; i < 16; i++) {
      this._encoderGrid.cells[i]?.classList.add("encoder-cell--inactive");
    }
    this._encoderGrid.cells[0]?.classList.remove("encoder-cell--inactive");
    this._encoderGrid.cells[0]?.classList.add("encoder-cell--calibrating");
  }

  private _updateEncoderHighlight(encodersFound: number, masterActive: boolean): void {
    if (!this._encoderGrid) return;
    const { encoders, cells, masterEncoder, masterCell } = this._encoderGrid;
    const instruction = this._root.querySelector<HTMLElement>("#cal-instruction");
    const progress = this._root.querySelector<HTMLElement>("#cal-progress");

    for (let i = 0; i < 16; i++) {
      const cell = cells[i];
      if (!cell) continue;
      cell.classList.remove("encoder-cell--inactive", "encoder-cell--calibrating", "encoder-cell--learned");

      if (i < encodersFound) {
        cell.classList.add("encoder-cell--learned");
        encoders[i]?.setValue(1, "");
        encoders[i]?.reconfigure("", 0);
      } else if (i === encodersFound && encodersFound < 16) {
        cell.classList.add("encoder-cell--calibrating");
      } else {
        cell.classList.add("encoder-cell--inactive");
      }
    }

    // Master encoder
    masterCell.classList.remove("encoder-cell--inactive", "encoder-cell--calibrating", "encoder-cell--learned");
    if (masterActive) {
      masterCell.classList.add("encoder-cell--calibrating");
    } else if (encodersFound >= 16 && !masterActive) {
      masterCell.classList.add("encoder-cell--learned");
      masterEncoder.setValue(1, "");
      masterEncoder.reconfigure("", 0);
    } else {
      masterCell.classList.add("encoder-cell--inactive");
    }

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

    this._root.innerHTML = `
      <div class="calibration-view calibration-view--wide" role="main" aria-label="Pad Calibration">
        <h1 class="calibration-title">Pad Calibration</h1>
        <p class="calibration-instruction" id="cal-instruction">Press <strong>pad 1</strong> (top-left)</p>
        <div id="cal-pads" style="pointer-events:none"></div>
        <p class="calibration-progress-text" id="cal-progress">0 of 16 learned</p>
      </div>
    `;

    // Build the real pad grid using the shared builder
    const padsEl = this._root.querySelector<HTMLElement>("#cal-pads")!;
    this._padGrid = buildPadGrid(padsEl);

    // Highlight first pad
    this._padGrid.modulePads[0]?.setState("calibrating");
  }

  private _updatePadHighlight(padsFound: number, row: 1 | 2): void {
    if (!this._padGrid) return;
    const { modulePads, programPads } = this._padGrid;
    const instruction = this._root.querySelector<HTMLElement>("#cal-instruction");
    const progress = this._root.querySelector<HTMLElement>("#cal-progress");

    // Row 1 (module pads)
    for (let i = 0; i < 8; i++) {
      if (row === 1) {
        if (i < padsFound) {
          modulePads[i]?.setState("triggered"); // learned
        } else if (i === padsFound) {
          modulePads[i]?.setState("calibrating"); // active
        } else {
          modulePads[i]?.setState("off");
        }
      } else {
        // Row 2 active — all of row 1 is learned
        modulePads[i]?.setState("triggered");
      }
    }

    // Row 2 (program pads)
    for (let i = 0; i < 8; i++) {
      if (row === 2) {
        if (i < padsFound) {
          programPads[i]?.setState("triggered");
        } else if (i === padsFound) {
          programPads[i]?.setState("calibrating");
        } else {
          programPads[i]?.setState("off");
        }
      } else {
        programPads[i]?.setState("off");
      }
    }

    // Total pads learned across both rows
    const totalLearned = row === 1 ? padsFound : 8 + padsFound;

    if (instruction) {
      const padNum = row === 1 ? padsFound + 1 : 8 + padsFound + 1;
      if ((row === 1 && padsFound < 8) || (row === 2 && padsFound < 8)) {
        instruction.innerHTML = `Press <strong>pad ${padNum}</strong>`;
      } else {
        instruction.innerHTML = `All pads learned!`;
      }
    }
    if (progress) {
      progress.textContent = `${totalLearned} of 16 learned`;
    }
  }

  private _renderComplete(): void {
    this._currentPhase = "complete";
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
