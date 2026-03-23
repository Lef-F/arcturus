/**
 * App — Root UI component, view routing between calibration/synth/config views.
 *
 * Boot sequence:
 *   1. Check IndexedDB for saved hardware profiles.
 *   2a. Profiles found → show skip prompt → go to synth view.
 *   2b. No profiles → start calibration flow.
 *   3. After calibration (or skip) → mount synth view.
 */

import { CalibrationController } from "@/midi/calibration";
import { CalibrationView } from "./calibration-view";
import { hasSavedProfiles } from "@/state/hardware-map";

export class App {
  private _container: HTMLElement;
  private _calibrationView: CalibrationView;

  constructor(container: HTMLElement) {
    this._container = container;
    this._calibrationView = new CalibrationView(container);
  }

  /** Bootstrap the application. */
  async boot(): Promise<void> {
    // Check for existing calibration profiles
    let hasProfiles = false;
    try {
      hasProfiles = await hasSavedProfiles();
    } catch {
      // IndexedDB unavailable (private browsing, etc.) — proceed to calibration
    }

    if (hasProfiles) {
      this._calibrationView.renderSkipPrompt();
      this._calibrationView.onSkip = () => this._mountSynthView();
      // Wire recalibrate button (rendered inside skip prompt)
      this._container.querySelector("#calibration-recalibrate-btn")?.addEventListener("click", () => {
        this._startCalibration();
      });
    } else {
      this._calibrationView.renderIdle();
      this._container.querySelector("#calibration-start-btn")?.addEventListener("click", () => {
        this._startCalibration();
      });
    }
  }

  // ── Private ──

  private async _startCalibration(): Promise<void> {
    let access: MIDIAccess;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      this._calibrationView.renderState({
        step: "error",
        error: "MIDI permission denied. Please allow MIDI access and reload.",
        encoderCCs: [],
        encodersFound: 0,
      });
      return;
    }

    const controller = new CalibrationController();
    controller.onStateChange = (state) => {
      this._calibrationView.renderState(state);
    };

    this._calibrationView.renderState({
      step: "discovering",
      error: null,
      encoderCCs: [],
      encodersFound: 0,
    });

    try {
      await controller.run(access);
      this._calibrationView.renderState(controller.state);
      this._calibrationView.onComplete = () => this._mountSynthView();
    } catch (err) {
      // Error state is set by CalibrationController before throwing
      this._calibrationView.renderState(controller.state);
    }
  }

  private _mountSynthView(): void {
    // M6: SynthView will be mounted here once implemented
    this._container.innerHTML = `
      <div class="synth-view" role="main">
        <p style="color: var(--color-fg-muted); text-align: center; padding: 2rem;">
          Synth view coming in M6
        </p>
      </div>
    `;
  }
}
