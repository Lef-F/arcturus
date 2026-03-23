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
import { SynthView } from "./synth-view";
import { ConfigView } from "./config-view";
import { hasSavedProfiles } from "@/state/hardware-map";
import { MIDIManager } from "@/midi/manager";
import { SynthEngine } from "@/audio/engine";
import { ParameterStore, ENCODER_PARAM_NAMES, SYNTH_PARAMS, normalizedToParam } from "@/audio/params";
import { ControlMapper } from "@/control/mapper";
import { KeyStepHandler } from "@/control/keystep";
import { PadHandler, buildPadLedMessage } from "@/control/pads";
import { PatchManager } from "@/state/patches";
import { MidiClock } from "@/midi/clock";
import synthDsp from "@/audio/synth.dsp?raw";
import effectsDsp from "@/audio/effects.dsp?raw";

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
    } catch {
      // Error state is set by CalibrationController before throwing
      this._calibrationView.renderState(controller.state);
    }
  }

  private _mountSynthView(): void {
    this._container.innerHTML = "";

    // Config overlay (hidden initially)
    const configContainer = document.createElement("div");
    configContainer.className = "config-overlay";
    this._container.appendChild(configContainer);
    const configView = new ConfigView(configContainer);
    configView.onRecalibrate = () => {
      this._calibrationView = new CalibrationView(this._container);
      this._startCalibration();
    };

    // Synth view
    const synthContainer = document.createElement("div");
    synthContainer.className = "synth-container";
    this._container.appendChild(synthContainer);
    const synthView = new SynthView(synthContainer);

    // ── Audio + Control subsystems ──
    const engine = new SynthEngine();
    const store = new ParameterStore();
    const mapper = new ControlMapper();
    mapper.setStore(store);
    mapper.setEngine(engine);

    const keystepHandler = new KeyStepHandler();
    const padHandler = new PadHandler();
    const patchManager = new PatchManager();
    const clock = new MidiClock(120);

    // ── MIDI Manager ──
    const midi = new MIDIManager();

    // Start audio engine immediately — the user gesture was clicking "Continue to Synth".
    // Faust compilation is slow (10-30s), so we kick it off now rather than on first note.
    let audioReady: Promise<void>;
    {
      const ctx = new AudioContext();
      audioReady = engine.start(ctx, synthDsp, effectsDsp).then(() => {
        keystepHandler.setEngine(engine);
        if (engine.analyser) synthView.setAnalyser(engine.analyser);
        // Initialise encoder displays from default values
        for (let i = 0; i < 16; i++) {
          const name = ENCODER_PARAM_NAMES[i];
          const param = SYNTH_PARAMS[name];
          if (param) {
            const norm = store.getNormalized(param.path);
            synthView.setEncoderValue(i, norm, _formatParam(norm, param));
          }
        }
      }).catch((err: unknown) => {
        console.error("[Arcturus] Audio engine failed to start:", err);
      });
    }

    // ── Parameter change → encoder UI + autosave ──
    store.onParamChange = (path, _value) => {
      for (let i = 0; i < ENCODER_PARAM_NAMES.length; i++) {
        const name = ENCODER_PARAM_NAMES[i];
        const param = SYNTH_PARAMS[name];
        if (param?.path === path) {
          const norm = store.getNormalized(path);
          synthView.setEncoderValue(i, norm, _formatParam(norm, param));
        }
      }
      patchManager.markDirty(store.snapshot());
    };

    // ── Voice limit change → engine + UI ──
    mapper.onVoiceLimitChange = (voices) => {
      engine.maxVoices = voices;
      synthView.setVoiceCount(engine.activeVoices, voices);
    };

    // ── Pad: patch select (top row) ──
    padHandler.onPatchSelect = async (slot) => {
      // slot 0-7 → internal slot 1-8
      const loaded = await patchManager.load(slot + 1);
      if (loaded) {
        store.loadValues(loaded.parameters);
        // Re-apply all params to engine
        for (const [path, value] of Object.entries(loaded.parameters)) {
          engine.setParamValue(path, value);
        }
      }
      // Update pad LEDs: selected = cyan, others off
      for (let i = 0; i < 8; i++) {
        synthView.setPadState(i, i === slot ? "selected" : "off");
      }
      // Send LED feedback to BeatStep if available
      for (let i = 0; i < 8; i++) {
        midi.sendToBeatstep(buildPadLedMessage(i, i === slot ? 127 : 0));
      }
    };

    // ── Pad: trigger (bottom row) ──
    padHandler.onTrigger = (padIndex, velocity) => {
      synthView.setPadState(padIndex, "triggered");
      engine.keyOn(1, 48 + (padIndex - 8), velocity);
    };
    padHandler.onTriggerRelease = (padIndex) => {
      synthView.setPadState(padIndex, "off");
      engine.keyOff(1, 48 + (padIndex - 8), 0);
    };

    // ── Pad click from UI (mouse/touch) ──
    synthView.onPadClick = (i) => {
      if (i < 8) {
        void padHandler.onPatchSelect?.(i);
      } else {
        // Wait for engine to be ready before triggering notes from UI clicks
        void audioReady.then(() => {
          padHandler.onTrigger?.(i, 100);
          setTimeout(() => padHandler.onTriggerRelease?.(i), 200);
        });
      }
    };

    // ── Transport ──
    keystepHandler.onTransport = (action) => {
      if (action === "start") {
        clock.start();
      } else if (action === "continue") {
        clock.continue();
      } else {
        clock.stop();
      }
    };

    clock.onBpmChange = (bpm) => {
      synthView.setBpm(bpm);
    };

    // ── MIDI routing ──
    midi.onKeystepMessage = (data) => {
      keystepHandler.handleMessage(data);
      synthView.setVoiceCount(engine.activeVoices, engine.maxVoices);
    };

    midi.onBeatstepMessage = (data) => {
      mapper.handleMessage(data);
      padHandler.handleMessage(data);
    };

    // ── Connect MIDI ──
    midi.requestAccess().then(() => {
      clock.setOutput(midi.beatstepOutput ?? midi.keystepOutput ?? ({} as MIDIOutput));
      return midi.discoverDevices();
    }).catch((err: unknown) => {
      console.warn("[Arcturus] MIDI not available:", err);
    });
  }
}

// ── Helpers ──

function _formatParam(normalized: number, param: { min: number; max: number; scale: string; unit?: string }): string {
  const value = normalizedToParam(normalized, param as Parameters<typeof normalizedToParam>[1]);
  if (param.unit === "Hz") {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  }
  if (param.unit === "s") {
    return value < 0.1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
  }
  if (param.unit === "¢") {
    return `${Math.round(value)}¢`;
  }
  return value % 1 === 0 ? `${value}` : `${value.toFixed(2)}`;
}
