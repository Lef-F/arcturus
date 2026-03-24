/**
 * Calibration View — First-run flow: permission, device identification, encoder characterization.
 *
 * Renders a step-by-step calibration UI into a provided container element.
 * Updates reactively as CalibrationController state changes.
 */

import type { CalibrationState } from "@/midi/calibration";

// ── Step labels ──

const STEP_LABELS: Record<CalibrationState["step"], string> = {
  idle: "Ready",
  requesting_permission: "Requesting MIDI permission…",
  discovering: "Discovering devices…",
  identify_device_1: "Identifying devices",
  identify_device_2: "Identifying devices",
  characterizing_encoders: "Characterizing encoders",
  characterizing_master: "Master encoder",
  saving: "Saving calibration…",
  complete: "Calibration complete!",
  error: "Calibration failed",
};

// ── CalibrationView ──

export class CalibrationView {
  private _root: HTMLElement;
  private _onComplete?: () => void;
  private _onSkip?: () => void;

  constructor(container: HTMLElement) {
    this._root = container;
  }

  /** Called when calibration completes successfully. */
  set onComplete(fn: () => void) {
    this._onComplete = fn;
  }

  /** Called when the user skips calibration (existing profiles found). */
  set onSkip(fn: () => void) {
    this._onSkip = fn;
  }

  /** Render initial state with a "Start Calibration" prompt. */
  renderIdle(): void {
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
    const label = STEP_LABELS[state.step];

    switch (state.step) {
      case "discovering":
        this._renderProgress(label, "Broadcasting SysEx identity request…", 0.1);
        break;

      case "identify_device_1":
        this._renderAction(
          label,
          "Turn any knob on your <strong>BeatStep</strong> to identify it."
        );
        break;

      case "identify_device_2":
        this._renderProgress(label, "Device 1 identified. Identifying device 2…", 0.5);
        break;

      case "characterizing_encoders": {
        const found = state.encodersFound;
        const progress = 0.6 + (found / 16) * 0.3;
        const body =
          found < 16
            ? `Turn encoder <strong>${found + 1} of 16</strong> on the BeatStep.`
            : "All encoders captured!";
        this._renderProgress(label, body, progress);
        break;
      }

      case "characterizing_master":
        this._renderAction(
          label,
          "Turn the <strong>large encoder</strong> (top-left of BeatStep) to set it as master volume."
        );
        break;

      case "saving":
        this._renderProgress(label, "Writing profiles to IndexedDB…", 0.95);
        break;

      case "complete":
        this._renderComplete();
        break;

      case "error":
        this._renderError(state.error ?? "Unknown error");
        break;

      default:
        this._renderProgress(label, "", 0.05);
    }
  }

  // ── Private render helpers ──

  private _renderProgress(title: string, body: string, progress: number): void {
    const pct = Math.round(progress * 100);
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration">
        <h1 class="calibration-title">${title}</h1>
        <p class="calibration-body">${body}</p>
        <div class="calibration-progress" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="calibration-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }

  private _renderAction(title: string, body: string): void {
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration">
        <h1 class="calibration-title">${title}</h1>
        <p class="calibration-body">${body}</p>
        <div class="calibration-hint">Waiting for hardware input…</div>
      </div>
    `;
  }

  private _renderComplete(): void {
    this._root.innerHTML = `
      <div class="calibration-view" role="main" aria-label="Calibration complete">
        <h1 class="calibration-title">Calibration Complete</h1>
        <p class="calibration-body">Both devices identified and encoder mappings saved.</p>
        <button class="btn btn-primary" id="calibration-done-btn">
          Go to Synth
        </button>
      </div>
    `;
    this._root.querySelector("#calibration-done-btn")?.addEventListener("click", () => {
      this._onComplete?.();
    });
  }

  private _renderError(message: string): void {
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
