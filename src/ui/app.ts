/**
 * App — Root UI component, view routing between calibration/synth/config views.
 *
 * Boot sequence:
 *   1. Check IndexedDB for saved hardware profiles.
 *   2a. Profiles found → show skip prompt → go to synth view.
 *   2b. No profiles → start calibration flow.
 *   3. After calibration (or skip) → mount synth view.
 */

import type { HardwareMapping } from "@/types";
import { CalibrationController } from "@/midi/calibration";
import { CalibrationView } from "./calibration-view";
import { SynthView } from "./synth-view";
import { ConfigView } from "./config-view";
import { loadConfig, saveConfig } from "@/state/config";
import { hasSavedProfiles, loadProfilesByRole, profileToMapping } from "@/state/hardware-map";
import { MIDIManager } from "@/midi/manager";
import { EnginePool } from "@/audio/engine-pool";
import { ParameterStore, getModuleParams, normalizedToParam, SYNTH_PARAMS } from "@/audio/params";
import { ControlMapper } from "@/control/mapper";
import { KeyStepHandler } from "@/control/keystep";
import { PadHandler, buildPadLedMessage } from "@/control/pads";
import { SceneLatchManager } from "@/control/scene-latch";
import { PatchManager } from "@/state/patches";
import { MidiClock } from "@/midi/clock";
import { createFactoryPatches } from "@/state/factory-presets";
import synthDsp from "@/audio/synth.dsp?raw";
import effectsDsp from "@/audio/effects.dsp?raw";

export class App {
  private _container: HTMLElement;
  private _calibrationView: CalibrationView;
  private _ctx: AudioContext;

  constructor(container: HTMLElement) {
    this._container = container;
    this._calibrationView = new CalibrationView(container);

    // Create AudioContext early. Browsers may block auto-start until a user gesture.
    // We try aggressively: on any DOM event AND on any MIDI input.
    this._ctx = new AudioContext();
    this._setupContextResume();
  }

  /**
   * Aggressively resume the AudioContext.
   * Tries on DOM gestures (click/touch/key) and also on MIDI input.
   * Firefox allows resume from any context; Chrome requires a DOM gesture.
   * We try both to cover all browsers.
   */
  private _setupContextResume(): void {
    const tryResume = () => {
      if (this._ctx.state === "suspended") {
        void this._ctx.resume();
      }
    };

    // DOM gestures (Chrome requirement)
    const onGesture = () => {
      tryResume();
      if (this._ctx.state === "running") {
        document.removeEventListener("click", onGesture);
        document.removeEventListener("touchstart", onGesture);
        document.removeEventListener("keydown", onGesture);
      }
    };
    document.addEventListener("click", onGesture);
    document.addEventListener("touchstart", onGesture);
    document.addEventListener("keydown", onGesture);

    // MIDI input — works on Firefox, doesn't hurt on Chrome
    if (navigator.requestMIDIAccess) {
      void navigator.requestMIDIAccess({ sysex: true }).then((access) => {
        access.inputs.forEach((input) => {
          input.addEventListener("midimessage", tryResume, { once: true });
        });
      }).catch(() => {});
    }

    tryResume(); // try immediately
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
      const profiles = await loadProfilesByRole();
      const beatstepProfile = profiles.control_plane;
      const mapping = beatstepProfile ? profileToMapping(beatstepProfile) : null;

      if (mapping && mapping.padRow1Notes.length === 8 && mapping.padRow2Notes.length === 8 && mapping.encoders.length >= 16) {
        // Complete mapping — skip straight to synth, no prompt
        this._mountSynthView(mapping);
        return;
      }
      // Incomplete mapping — go straight to calibration
      void this._startCalibration();
    } else {
      // No profiles — go straight to calibration
      void this._startCalibration();
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
        masterFound: false,
        padsFound: 0,
        padRow: 1,
      });
      return;
    }

    const controller = new CalibrationController();
    controller.onStateChange = (state) => {
      this._calibrationView.renderState(state);
    };

    this._calibrationView.onRestart = () => {
      // Abort current calibration and restart from scratch
      this._calibrationView = new CalibrationView(this._container);
      void this._startCalibration();
    };

    this._calibrationView.renderState({
      step: "discovering",
      error: null,
      encoderCCs: [],
      encodersFound: 0,
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    try {
      const result = await controller.run(access);
      this._calibrationView.renderState(controller.state);
      this._calibrationView.onComplete = () => this._mountSynthView(result.beatstep.mapping);
    } catch {
      this._calibrationView.renderState(controller.state);
    }
  }

  private _mountSynthView(mapping: HardwareMapping): void {
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

    // ── Audio + Control subsystems (configured from mapping) ──
    const pool = new EnginePool();
    const store = new ParameterStore();
    const encoderStates = mapping.encoders.map((e) => ({ ccNumber: e.cc }));
    const mapper = new ControlMapper(encoderStates, mapping.masterCC);
    mapper.setAllEncoderModes("relative");
    mapper.setStore(store);

    const keystepHandler = new KeyStepHandler();
    const padHandler = new PadHandler();
    padHandler.setPadNotes(mapping.padRow1Notes[0], mapping.padRow2Notes[0]);
    const patchManager = new PatchManager();
    const sceneLatch = new SceneLatchManager();
    const clock = new MidiClock(120);
    const midi = new MIDIManager();

    const ctx = this._ctx;

    if (import.meta.env.DEV) {
      _mountDevDebug(ctx, pool);
    }

    // ── Active module state ──
    let activeModule = 0;

    // ── Helpers ──

    /** Get the active engine (the one receiving notes + param changes). */
    const activeEngine = () => pool.getActiveEngine();

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

    const updateVoiceCount = () => {
      const engine = activeEngine();
      synthView.setVoiceCount(pool.totalActiveVoices, engine?.maxVoices ?? 8);
    };

    const selectModuleLed = (idx: number) => {
      for (let i = 0; i < 8; i++) {
        synthView.setModulePadState(i, i === idx ? "selected" : "off");
        midi.sendToBeatstep(buildPadLedMessage(i, i === idx ? 127 : 0, mapping.padRow1Notes[0], mapping.padRow2Notes[0]));
      }
    };

    const updateProgramLeds = () => {
      const focused = sceneLatch.focusedProgram;
      for (let i = 0; i < 8; i++) {
        const isFocused = i === focused;
        const isLatched = sceneLatch.isLatched(i);
        let vel: number;
        if (isFocused) {
          synthView.setProgramPadState(i, isLatched ? "selected-latched" : "selected");
          vel = 127;
        } else if (isLatched) {
          synthView.setProgramPadState(i, "latched");
          vel = 40;
        } else {
          synthView.setProgramPadState(i, "off");
          vel = 0;
        }
        midi.sendToBeatstep(buildPadLedMessage(8 + i, vel, mapping.padRow1Notes[0], mapping.padRow2Notes[0]));
      }
    };

    const applyPatch = (parameters: Record<string, number>) => {
      store.loadValues(parameters);
    };

    const restoreMaster = () => {
      const saved = localStorage.getItem("arcturus-master");
      if (saved !== null) {
        const value = parseFloat(saved);
        if (!isNaN(value)) store.setNormalized("master", Math.max(0, Math.min(1, value)));
      }
    };

    // ── Engine Pool startup ──
    const audioReady = pool.boot(ctx, synthDsp, effectsDsp).then(async () => {
      // Create the initial engine for the active program
      const saved = parseInt(localStorage.getItem("arcturus-last-slot") ?? "1", 10);
      const startSlot = isNaN(saved) ? 1 : Math.max(1, Math.min(8, saved));
      const startProgram = startSlot - 1;

      // Seed factory presets on first boot
      const allPatches = await patchManager.loadAll();
      const hasAnyPatch = allPatches.some((p) => p !== null);
      if (!hasAnyPatch) {
        const factory = createFactoryPatches();
        for (const fp of factory) {
          await patchManager.save(fp.parameters, fp.name, fp.slot);
        }
        console.log("[Arcturus] Factory presets seeded (8 programs).");
      }

      // Load initial patch BEFORE creating engine (pre-apply to prevent clicks)
      const initPatch = await patchManager.load(startSlot);
      const engine = await pool.getOrCreateEngine(startProgram, initPatch?.parameters);
      pool.setActiveProgram(startProgram);
      keystepHandler.setEngine(engine);
      if (pool.analyser) synthView.setAnalyser(pool.analyser);

      if (initPatch) {
        applyPatch(initPatch.parameters);
        restoreMaster();
      } else {
        patchManager.selectSlot(startSlot);
        restoreMaster();
      }
      refreshEncoderDisplays();
      selectModuleLed(activeModule);
      sceneLatch.setFocusedProgram(startProgram);
      updateProgramLeds();

      console.log("[Arcturus] Engine pool ready. ctx.state =", ctx.state);
    }).catch((err: unknown) => {
      console.error("[Arcturus] Engine pool failed to start:", err);
    });

    // ── Encoder scroll → active module's param ──
    synthView.onEncoderScroll = (slot, delta) => {
      const param = getModuleParams(activeModule)[slot];
      if (param) store.processParamDelta(param.path, delta, 1 / 64);
    };

    // ── Parameter change → active engine + encoder display + autosave ──
    store.onParamChange = (path, value) => {
      const engine = activeEngine();
      if (!engine) return;

      if (path === "voices") {
        engine.maxVoices = Math.round(value);
        updateVoiceCount();
      } else if (path === "unison") {
        engine.unison = value >= 0.5;
        engine.setParamValue(path, value);
      } else if (path === "master") {
        // Master volume is global — routed to pool's masterGain
        pool.setParamValue("master", value);
        const norm = store.getNormalized("master");
        synthView.setMasterValue(norm, _formatParam(norm, SYNTH_PARAMS.master));
        localStorage.setItem("arcturus-master", String(norm));
      } else {
        engine.setParamValue(path, value);
      }
      if (path === "cutoff") {
        keystepHandler.setBaseCutoff(value);
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

    // ── Program pad (bottom row) → focus/latch with multi-engine support ──
    const handleProgramTap = async (programIndex: number) => {
      const action = sceneLatch.handleProgramTap(programIndex);

      if (action.type === "latch") {
        updateProgramLeds();
        return;
      }

      if (action.type === "unlatch") {
        // Release latched notes — if this program has its own engine, destroy it
        const engine = pool.getEngine(action.program);
        if (engine) {
          for (const n of action.notes) {
            engine.keyOff(n.channel, n.note, 0);
          }
        }
        // If this is not the active program's engine, release it
        if (action.program !== pool.activeProgram) {
          pool.releaseEngine(action.program);
        }
        updateProgramLeds();
        updateVoiceCount();
        return;
      }

      // action.type === "focus" — switch program
      const prevProgram = patchManager.currentSlot - 1;
      if (programIndex === prevProgram) {
        return; // re-tap same program (first tap of potential double-tap)
      }

      // Save current patch params
      await patchManager.save(store.snapshot()).catch(() => {});

      // Release non-latched held notes from current program
      const currentEngine = activeEngine();
      if (currentEngine) {
        for (const n of sceneLatch.getHeldNotes()) {
          currentEngine.keyOff(n.channel, n.note, 0);
        }
      }
      sceneLatch.clearHeld();

      // If current program is latched, its engine stays alive (frozen).
      // If not latched, release it (unless it's the only engine — reuse it).
      const prevIsLatched = sceneLatch.isLatched(prevProgram);
      if (!prevIsLatched && pool.engineCount > 1) {
        pool.releaseEngine(prevProgram);
      }

      // Load target patch FIRST so we can pre-apply params to prevent clicks
      const loaded = await patchManager.load(programIndex + 1);
      const patchParams = loaded?.parameters;

      // Get or create engine — pre-apply patch params before audio starts
      const targetEngine = await pool.getOrCreateEngine(programIndex, patchParams);
      pool.setActiveProgram(programIndex);
      keystepHandler.setEngine(targetEngine);

      // Apply patch to store (updates encoder displays + marks as active)
      if (loaded) {
        applyPatch(loaded.parameters);
        restoreMaster();
        refreshEncoderDisplays();
      } else {
        patchManager.selectSlot(programIndex + 1);
      }
      localStorage.setItem("arcturus-last-slot", String(programIndex + 1));
      updateProgramLeds();
      updateVoiceCount();
    };
    synthView.onProgramSelect = (programIndex) => void handleProgramTap(programIndex);

    // ── BeatStep row 1 → module select ──
    padHandler.onModuleSelect = (slot) => {
      synthView.onModuleSelect?.(slot);
    };

    // ── BeatStep row 2 → program select ──
    padHandler.onPatchSelect = (slot) => void handleProgramTap(slot);

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

    // ── MIDI routing (with scene latch interception) ──
    midi.onKeystepMessage = (data) => {
      if (pool.ctx?.state === "suspended") void pool.ctx.resume();

      if (data.length >= 3) {
        const type = data[0] & 0xf0;
        const channel = (data[0] & 0x0f) + 1;
        const note = data[1];
        const velocity = data[2];

        // Track note-ons for potential latching
        if (type === 0x90 && velocity > 0) {
          sceneLatch.noteOn(channel, note, velocity);
        }
        // Suppress note-off if the note is latched on the focused program
        if (type === 0x80 || (type === 0x90 && velocity === 0)) {
          if (sceneLatch.noteOff(channel, note)) {
            updateVoiceCount();
            return;
          }
        }
        // CC 123 (All Notes Off) — clear all latches, destroy frozen engines
        if (type === 0xb0 && data[1] === 123) {
          sceneLatch.clearAll();
          pool.panicReset();
          updateProgramLeds();
        }
      }

      keystepHandler.handleMessage(data);
      updateVoiceCount();
    };
    midi.onBeatstepMessage = (data) => {
      mapper.handleMessage(data);
      padHandler.handleMessage(data);
    };

    // ── Connect MIDI ──
    void audioReady;
    console.log(`[Arcturus] Mapping loaded: ${mapping.encoders.length} encoders, master CC ${mapping.masterCC}, pads row1=[${mapping.padRow1Notes[0]}..${mapping.padRow1Notes[7]}], row2=[${mapping.padRow2Notes[0]}..${mapping.padRow2Notes[7]}]`);
    midi.requestAccess()
      .then(async () => {
        clock.setOutput(midi.beatstepOutput ?? midi.keystepOutput ?? ({} as MIDIOutput));
        return midi.discoverDevices();
      })
      .catch((err: unknown) => {
        console.warn("[Arcturus] MIDI not available:", err);
      });
  }
}

// ── Dev debug overlay ──

function _mountDevDebug(ctx: AudioContext, pool: EnginePool): void {
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
    statusLine.textContent = `ctx: ${ctx.state} | engines: ${pool.engineCount}`;
    const analyser = pool.analyser;
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

function _formatParam(normalized: number, param: { min: number; max: number; scale: string; unit?: string; steps?: number; valueLabels?: string[] }): string {
  const value = normalizedToParam(normalized, param as Parameters<typeof normalizedToParam>[1]);
  if (param.valueLabels && param.steps && param.steps > 1) {
    const stepIndex = Math.round((value - param.min) / (param.max - param.min) * (param.steps - 1));
    return param.valueLabels[Math.max(0, Math.min(param.valueLabels.length - 1, stepIndex))] ?? `${Math.round(value)}`;
  }
  if (param.unit === "Hz") {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  }
  if (param.unit === "s") {
    return value < 0.1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
  }
  if (param.unit === "¢") {
    return `${Math.round(value)}¢`;
  }
  if (param.unit === "dB") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}`;
  }
  return value % 1 === 0 ? `${value}` : `${value.toFixed(2)}`;
}
