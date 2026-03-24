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
import { loadConfig, saveConfig } from "@/state/config";
import { hasSavedProfiles } from "@/state/hardware-map";
import { MIDIManager } from "@/midi/manager";
import { SynthEngine } from "@/audio/engine";
import { ParameterStore, getModuleParams, normalizedToParam, SYNTH_PARAMS } from "@/audio/params";
import { ControlMapper } from "@/control/mapper";
import { BEATSTEP_FACTORY_ENCODER_CCS } from "@/control/encoder";
import { KeyStepHandler } from "@/control/keystep";
import { PadHandler, buildPadLedMessage } from "@/control/pads";
import { PatchManager } from "@/state/patches";
import { MidiClock } from "@/midi/clock";
import { createFactoryPatches } from "@/state/factory-presets";
import { loadProfilesByRole } from "@/state/hardware-map";
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
    let hasProfiles = false;
    try {
      hasProfiles = await hasSavedProfiles();
    } catch {
      // IndexedDB unavailable — proceed to calibration
    }

    if (hasProfiles) {
      this._calibrationView.renderSkipPrompt();
      this._calibrationView.onSkip = () => this._mountSynthView();
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
      void this._startCalibration();
    };

    // Synth view
    const synthContainer = document.createElement("div");
    synthContainer.className = "synth-container";
    this._container.appendChild(synthContainer);
    const synthView = new SynthView(synthContainer);

    // Restore saved viz mode
    void loadConfig().then((cfg) => synthView.setVizMode(cfg.vizMode));
    synthView.onVizModeChange = (mode) => void saveConfig({ vizMode: mode });

    // ── Audio + Control subsystems ──
    const engine = new SynthEngine();
    const store = new ParameterStore();
    const mapper = new ControlMapper();
    mapper.setStore(store);

    const keystepHandler = new KeyStepHandler();
    const padHandler = new PadHandler();
    const patchManager = new PatchManager();
    const clock = new MidiClock(120);
    const midi = new MIDIManager();

    const ctx = new AudioContext();
    void ctx.resume();

    if (import.meta.env.DEV) {
      _mountDevDebug(ctx, engine);
    }

    // ── Active module state ──
    let activeModule = 0;

    // ── Helpers ──

    const refreshEncoderDisplays = () => {
      const moduleParams = getModuleParams(activeModule);
      for (let i = 0; i < 16; i++) {
        const param = moduleParams[i];
        if (param) {
          const norm = store.getNormalized(param.path);
          synthView.setEncoderParam(i, param, norm, _formatParam(norm, param));
        } else {
          synthView.setEncoderParam(i, null, 0, "");
        }
      }
      const masterNorm = store.getNormalized("master");
      synthView.setMasterValue(masterNorm, _formatParam(masterNorm, SYNTH_PARAMS.master));
    };

    const selectModuleLed = (idx: number) => {
      for (let i = 0; i < 8; i++) {
        synthView.setModulePadState(i, i === idx ? "selected" : "off");
        // Row 1 LEDs: padIndex 0-7 → notes 44-51
        midi.sendToBeatstep(buildPadLedMessage(i, i === idx ? 127 : 0));
      }
    };

    const selectProgramLed = (idx: number) => { // idx is 0-based (program slot - 1)
      for (let i = 0; i < 8; i++) {
        synthView.setProgramPadState(i, i === idx ? "selected" : "off");
        // Row 2 LEDs: padIndex 8-15 → notes 36-43
        midi.sendToBeatstep(buildPadLedMessage(8 + i, i === idx ? 127 : 0));
      }
    };

    const applyPatch = (parameters: Record<string, number>) => {
      store.loadValues(parameters);
    };

    // ── Engine startup ──
    const audioReady = engine.start(ctx, synthDsp, effectsDsp).then(async () => {
      keystepHandler.setEngine(engine);
      if (engine.analyser) synthView.setAnalyser(engine.analyser);

      // Seed factory presets on first boot (if no patches exist)
      const allPatches = await patchManager.loadAll();
      const hasAnyPatch = allPatches.some((p) => p !== null);
      if (!hasAnyPatch) {
        const factory = createFactoryPatches();
        for (const fp of factory) {
          await patchManager.save(fp.parameters, fp.name, fp.slot);
        }
        console.log("[Arcturus] Factory presets seeded (8 programs).");
      }

      // Load last-used program, fall back to slot 1
      const saved = parseInt(localStorage.getItem("arcturus-last-slot") ?? "1", 10);
      const startSlot = isNaN(saved) ? 1 : Math.max(1, Math.min(8, saved));
      const initPatch = await patchManager.load(startSlot);
      if (initPatch) {
        applyPatch(initPatch.parameters);
      } else {
        patchManager.selectSlot(startSlot);
      }
      refreshEncoderDisplays();
      selectModuleLed(activeModule);
      selectProgramLed(patchManager.currentSlot - 1);

      console.log("[Arcturus] Engine ready. ctx.state =", ctx.state);
    }).catch((err: unknown) => {
      console.error("[Arcturus] Audio engine failed to start:", err);
    });

    // ── Encoder scroll → active module's param ──
    synthView.onEncoderScroll = (slot, delta) => {
      const param = getModuleParams(activeModule)[slot];
      if (param) store.processParamDelta(param.path, delta, 1 / 64);
    };

    // ── Parameter change → engine + encoder display + autosave ──
    store.onParamChange = (path, value) => {
      if (path === "voices") {
        engine.maxVoices = Math.round(value);
        synthView.setVoiceCount(engine.activeVoices, engine.maxVoices);
      } else if (path === "unison") {
        engine.unison = value >= 0.5;
        engine.setParamValue(path, value);
      } else {
        engine.setParamValue(path, value);
      }
      if (path === "cutoff") {
        keystepHandler.setBaseCutoff(value);
      }
      if (path === "master") {
        const norm = store.getNormalized("master");
        synthView.setMasterValue(norm, _formatParam(norm, SYNTH_PARAMS.master));
      }
      // Update encoder display if the changed param is in the active module
      const moduleParams = getModuleParams(activeModule);
      for (let i = 0; i < moduleParams.length; i++) {
        const param = moduleParams[i];
        if (param?.path === path) {
          const norm = store.getNormalized(path);
          synthView.setEncoderValue(i, norm, _formatParam(norm, param));
          synthView.flashEncoder(i);
        }
      }
      patchManager.markDirty(store.snapshot());
    };

    // ── Module pad (top row) → switch active module ──
    synthView.onModuleSelect = (moduleIndex) => {
      activeModule = moduleIndex;
      store.activeModule = moduleIndex;
      refreshEncoderDisplays();
      selectModuleLed(moduleIndex);
    };

    // ── Program pad (bottom row) → save current + load selected ──
    synthView.onProgramSelect = async (programIndex) => {
      await patchManager.save(store.snapshot()).catch(() => {});
      const loaded = await patchManager.load(programIndex + 1);
      if (loaded) {
        applyPatch(loaded.parameters);
        refreshEncoderDisplays();
      } else {
        patchManager.selectSlot(programIndex + 1);
      }
      localStorage.setItem("arcturus-last-slot", String(programIndex + 1));
      selectProgramLed(programIndex);
    };

    // ── BeatStep row 1 → module select ──
    padHandler.onModuleSelect = (slot) => {
      synthView.onModuleSelect?.(slot);
    };

    // ── BeatStep row 2 → program select ──
    padHandler.onPatchSelect = async (slot) => {
      void synthView.onProgramSelect?.(slot);
    };

    // ── Transport ──
    keystepHandler.onTransport = (action) => {
      if (action === "start") clock.start();
      else if (action === "continue") clock.continue();
      else clock.stop();
    };
    keystepHandler.onModWheel = (norm) => {
      store.setNormalized("lfo_depth", norm);
    };
    mapper.onMasterDelta = (delta) => {
      store.processParamDelta("master", delta, 1);
      synthView.flashMaster();
    };
    clock.onBpmChange = (bpm) => synthView.setBpm(bpm);

    // ── MIDI routing ──
    midi.onKeystepMessage = (data) => {
      if (engine.ctx?.state === "suspended") void engine.ctx.resume();
      keystepHandler.handleMessage(data);
      synthView.setVoiceCount(engine.activeVoices, engine.maxVoices);
    };
    midi.onBeatstepMessage = (data) => {
      mapper.handleMessage(data);
      padHandler.handleMessage(data);
    };

    // ── Connect MIDI ──
    void audioReady; // ensure engine starts even before MIDI connects
    midi.requestAccess()
      .then(async () => {
        // Apply encoder CC map: stored calibration profile, or BeatStep factory defaults.
        // Mode: "relative" = Binary Offset (center=64), requires MIDI Control Center config.
        //       "absolute" = factory default (values 0-127), works but drifts from parameter position.
        // Switch to "relative" after configuring BeatStep in MIDI Control Center for best feel.
        mapper.setAllEncoderModes("relative"); // "absolute" | "relative" | "relative2" | "relative3" — match BeatStep MIDI Control Center setting
        const profiles = await loadProfilesByRole();
        const beatstepProfile = profiles.control_plane;
        if (beatstepProfile?.encoderCalibration.length) {
          for (const cal of beatstepProfile.encoderCalibration) {
            mapper.setEncoderCC(cal.encoderIndex, cal.cc);
          }
          console.log("[Arcturus] Encoder CC map loaded from calibration profile.");
        } else {
          // No calibration saved — use BeatStep factory CC assignments so encoders
          // work out of the box without running the calibration flow.
          BEATSTEP_FACTORY_ENCODER_CCS.forEach((cc, i) => mapper.setEncoderCC(i, cc));
          console.log("[Arcturus] No calibration profile — using BeatStep factory CC map.");
        }
        clock.setOutput(midi.beatstepOutput ?? midi.keystepOutput ?? ({} as MIDIOutput));
        return midi.discoverDevices();
      })
      .catch((err: unknown) => {
        console.warn("[Arcturus] MIDI not available:", err);
      });
  }
}

// ── Dev debug overlay ──

function _mountDevDebug(ctx: AudioContext, engine: SynthEngine): void {
  const panel = document.createElement("div");
  panel.id = "dev-audio-debug";
  panel.style.cssText = `
    position:fixed; top:0; right:0; z-index:10000;
    background:#111; color:#26fedc; font-family:monospace; font-size:11px;
    padding:8px 12px; border-bottom-left-radius:8px; border:1px solid #333;
    display:flex; flex-direction:column; gap:4px; min-width:220px;
  `;

  const testBtn = document.createElement("button");
  testBtn.textContent = "▶ Test Tone (1s)";
  testBtn.style.cssText = "background:#26fedc22;border:1px solid #26fedc;color:#26fedc;padding:2px 8px;cursor:pointer;font-family:monospace;font-size:11px;";
  testBtn.onclick = () => {
    void ctx.resume().then(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    });
  };
  panel.appendChild(testBtn);

  const statusLine = document.createElement("div");
  panel.appendChild(statusLine);
  const levelLine = document.createElement("div");
  panel.appendChild(levelLine);

  const tick = () => {
    statusLine.textContent = `ctx: ${ctx.state} | engine: ${engine.isRunning ? "ready" : "compiling…"}`;
    const analyser = engine.analyser;
    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      const bars = Math.round(peak * 40);
      levelLine.textContent = `sig: ${"█".repeat(bars)}${"░".repeat(Math.max(0, 40 - bars))} ${peak.toFixed(4)}`;
    } else {
      levelLine.textContent = "sig: (analyser not ready)";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  document.body.appendChild(panel);
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
