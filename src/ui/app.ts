/**
 * App — Root UI component, view routing.
 *
 * Boot is permissive: the synth view always mounts, regardless of which (if
 * any) hardware is plugged in. Calibration only runs when a fresh BeatStep
 * is detected and not yet known.
 *
 * Inputs are layered:
 *   - Computer keyboard (QWERTY notes + Z/X octave) is always live.
 *   - Any non-BeatStep MIDI input is a generic note source.
 *   - The BeatStep, if present + calibrated, drives encoders + pads.
 *   - Mouse drives encoders + pads in all cases.
 */

import type { BeatStepMapping } from "@/types";
import { CalibrationController } from "@/midi/calibration";
import { CalibrationView } from "./calibration-view";
import { SynthView } from "./synth-view";
import { ConfigView } from "./config-view";
import { loadConfig, saveConfig } from "@/state/config";
import { hasSavedBeatStepProfile, loadBeatStepProfile, profileToMapping } from "@/state/hardware-map";
import { MIDIManager } from "@/midi/manager";
import { EnginePool } from "@/audio/engine-pool";
import { MeterController } from "./meter-controller";
import { ParameterStore, getModuleParams, SYNTH_PARAMS } from "@/audio/params";
import { formatParam } from "./format-param";
import { ControlMapper } from "@/control/mapper";
import { NoteHandler } from "@/control/note-handler";
import { PadHandler, buildPadLedMessage } from "@/control/pads";
import { SceneLatchManager } from "@/control/scene-latch";
import { PatchManager } from "@/state/patches";
import { MidiClock } from "@/midi/clock";
import { createFactoryPatches } from "@/state/factory-presets";
import { ComputerKeyboardInput } from "@/input/computer-keyboard";
import { mountWelcomeOverlay, shouldShowWelcome } from "./welcome-overlay";
import { mountNoBeatstepNudge, type NudgeHandle } from "./no-beatstep-nudge";
import { mountCalibratePrompt } from "./calibrate-prompt";
import { mountSceneLatchHint, shouldShowSceneLatchHint, type SceneLatchHintHandle } from "./scene-latch-hint";
import { mountHeaderMenu, type HeaderMenuHandle } from "./header-menu";
import { showToast } from "./toast";
import { buildExport, downloadEnvelope, pickJsonFile, parseEnvelope, applyImport, InvalidEnvelopeError } from "@/state/patches-io";
import { dedupePatchesBySlot } from "@/state/db";
import synthDsp from "@/audio/synth.dsp?raw";
import effectsDsp from "@/audio/effects.dsp?raw";

export class App {
  private _container: HTMLElement;
  private _calibrationView: CalibrationView;
  private _ctx: AudioContext;

  /** Acquired once and reused across calibration + synth view. */
  private _midiAccess: MIDIAccess | null = null;

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

  /**
   * Bootstrap the application.
   *
   * Decision tree:
   *   - First-ever visit → welcome overlay (then continue to whichever path below)
   *   - Saved BeatStep profile → mount synth with that mapping
   *   - BeatStep connected but unknown → calibration view
   *   - No BeatStep at all → mount synth without a mapping (mouse + keyboard only)
   */
  async boot(): Promise<void> {
    const savedMapping = await this._tryLoadSavedMapping();
    if (savedMapping) {
      this._mountSynthView(savedMapping);
      return;
    }

    // No saved profile — see if a BeatStep is currently connected.
    const beatstepLooksConnected = await this._isBeatstepConnected();
    if (beatstepLooksConnected) {
      void this._startCalibration();
    } else {
      this._mountSynthView(null);
    }
  }

  // ── Private ──

  private async _tryLoadSavedMapping(): Promise<BeatStepMapping | null> {
    try {
      if (!(await hasSavedBeatStepProfile())) return null;
      const profile = await loadBeatStepProfile();
      if (!profile) return null;
      const mapping = profileToMapping(profile);
      if (mapping.padRow1Notes.length === 8 && mapping.padRow2Notes.length === 8 && mapping.encoders.length >= 16) {
        return mapping;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async _isBeatstepConnected(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) return false;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      this._midiAccess = access;
      // Quick port-name scan only — full SysEx-based detection happens during calibration.
      let found = false;
      access.inputs.forEach((input) => {
        const name = input.name?.toLowerCase() ?? "";
        if (name.includes("beatstep") || name.includes("beat step")) found = true;
      });
      return found;
    } catch {
      return false;
    }
  }

  private async _startCalibration(): Promise<void> {
    this._calibrationView.onRestart = () => {
      this._calibrationView = new CalibrationView(this._container);
      void this._startCalibration();
    };
    this._calibrationView.onSkip = () => {
      // User chose to continue without the BeatStep this session.
      this._mountSynthView(null);
    };

    let access: MIDIAccess | null = this._midiAccess;
    if (!access) {
      try {
        access = await navigator.requestMIDIAccess({ sysex: true });
        this._midiAccess = access;
      } catch {
        // Permission denied or browser doesn't support Web MIDI.
        // Don't trap the user — fall through to the keyboard/mouse experience.
        this._mountSynthView(null);
        return;
      }
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
      masterFound: false,
      padsFound: 0,
      padRow: 1,
    });

    try {
      const result = await controller.run(access);
      if (!result) {
        // BeatStep wasn't found after all (maybe disconnected during the wait).
        this._mountSynthView(null);
        return;
      }
      this._calibrationView.renderState(controller.state);
      this._calibrationView.onComplete = () => this._mountSynthView(result.mapping);
    } catch {
      this._calibrationView.renderState(controller.state);
    }
  }

  private _mountSynthView(mapping: BeatStepMapping | null): void {
    this._container.innerHTML = "";

    // "Tap to start" overlay — shown if AudioContext is suspended
    if (this._ctx.state === "suspended") {
      const tapOverlay = document.createElement("div");
      tapOverlay.className = "tap-to-start-overlay";
      tapOverlay.innerHTML = `<span class="tap-to-start-text">tap anywhere to start</span>`;
      this._container.appendChild(tapOverlay);
      const removeOverlay = () => { if (tapOverlay.parentNode) tapOverlay.remove(); };
      tapOverlay.addEventListener("click", () => {
        void this._ctx.resume();
        removeOverlay();
      });
      this._ctx.addEventListener("statechange", () => {
        if (this._ctx.state === "running") removeOverlay();
      });
    }

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

    // Welcome overlay (first visit only) and scene-latch hint share the same
    // attention budget. Show the welcome first, then mount the hint when the
    // welcome dismisses — or skip straight to the hint on subsequent visits.
    let sceneLatchHint: SceneLatchHintHandle | null = null;

    const maybeShowSceneLatchHint = async () => {
      if (sceneLatchHint) return; // already mounted
      if (await shouldShowSceneLatchHint()) {
        sceneLatchHint = mountSceneLatchHint(this._container);
      }
    };

    void shouldShowWelcome().then((wants) => {
      if (wants) {
        mountWelcomeOverlay(this._container, {
          onDismiss: () => void maybeShowSceneLatchHint(),
        });
      } else {
        // No welcome to wait on — give the synth a beat to settle, then nudge.
        setTimeout(() => void maybeShowSceneLatchHint(), 1200);
      }
    });

    // Ambient nudge mounts only when we know there's no BeatStep around.
    let nudge: NudgeHandle | null = null;
    if (!mapping) {
      nudge = mountNoBeatstepNudge(this._container);
      // Delay so it doesn't crowd the welcome overlay
      setTimeout(() => nudge?.show(), 1500);
    }

    // ── Audio + Control subsystems ──
    const pool = new EnginePool();
    const store = new ParameterStore();

    // ControlMapper + PadHandler are BeatStep-specific. They exist only when
    // we have a mapping. Mouse drives the same callbacks regardless.
    const mapper = mapping
      ? new ControlMapper(mapping.encoders.map((e) => ({ ccNumber: e.cc })), mapping.masterCC)
      : null;
    if (mapper) {
      mapper.setAllEncoderModes("relative");
      mapper.setStore(store);
    }

    const noteHandler = new NoteHandler();
    const padHandler = mapping ? new PadHandler() : null;
    if (padHandler && mapping) {
      padHandler.setPadNotes(mapping.padRow1Notes[0], mapping.padRow2Notes[0]);
    }

    const patchManager = new PatchManager();
    const sceneLatch = new SceneLatchManager();
    const clock = new MidiClock(120);
    const midi = new MIDIManager();

    // Computer keyboard — always live (skip target form fields internally)
    const keyboard = new ComputerKeyboardInput();
    keyboard.attach();

    const ctx = this._ctx;

    if (import.meta.env.DEV) {
      void import("@/dev/debug-overlay").then(({ mountDevDebug }) => mountDevDebug(ctx, pool));
    }

    // ── Active module state ──
    let activeModule = 0;

    // ── Helpers ──

    const activeEngine = () => pool.getActiveEngine();

    const refreshEncoderDisplays = () => {
      const moduleParams = getModuleParams(activeModule);
      for (let i = 0; i < 16; i++) {
        const param = moduleParams[i];
        if (param) {
          const norm = store.getNormalized(param.path);
          synthView.setEncoderParam(i, param, norm, formatParam(norm, param));
        } else {
          synthView.setEncoderParam(i, null, 0, "");
        }
      }
      const masterNorm = store.getNormalized("master");
      synthView.setMasterValue(masterNorm, formatParam(masterNorm, SYNTH_PARAMS.master));
    };

    const updateVoiceCount = () => {
      const engine = activeEngine();
      synthView.setVoiceCount(pool.totalActiveVoices, engine?.maxVoices ?? 8);
    };

    const selectModuleLed = (idx: number) => {
      for (let i = 0; i < 8; i++) {
        synthView.setModulePadState(i, i === idx ? "selected" : "off");
        if (mapping) {
          midi.sendToBeatstep(buildPadLedMessage(i, i === idx ? 127 : 0, mapping.padRow1Notes[0], mapping.padRow2Notes[0]));
        }
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
        if (mapping) {
          midi.sendToBeatstep(buildPadLedMessage(8 + i, vel, mapping.padRow1Notes[0], mapping.padRow2Notes[0]));
        }
      }
    };

    const applyPatch = (parameters: Record<string, number>) => {
      store.loadValues(parameters);
    };

    // ── Engine Pool startup ──
    const audioReady = pool.boot(ctx, synthDsp, effectsDsp).then(async () => {
      const saved = parseInt(localStorage.getItem("arcturus-last-slot") ?? "1", 10);
      const startSlot = isNaN(saved) ? 1 : Math.max(1, Math.min(8, saved));
      const startProgram = startSlot - 1;

      // Cleanup: drop any duplicate patch records per slot (legacy from
      // early seeding logic). No-op for fresh installs.
      const removed = await dedupePatchesBySlot().catch(() => 0);
      if (removed > 0) {
        console.log(`[Arcturus] Removed ${removed} duplicate patch record(s).`);
      }

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
      noteHandler.setEngine(engine);
      if (pool.analyser) synthView.setAnalyser(pool.analyser);

      if (initPatch) {
        applyPatch(initPatch.parameters);
      } else {
        patchManager.selectSlot(startSlot);
      }
      refreshEncoderDisplays();
      selectModuleLed(activeModule);
      sceneLatch.setFocusedProgram(startProgram);
      updateProgramLeds();

      console.log("[Arcturus] Engine pool ready. ctx.state =", ctx.state);
    }).catch((err: unknown) => {
      console.error("[Arcturus] Engine pool failed to start:", err);
      const banner = document.createElement("div");
      banner.className = "engine-error-banner";
      banner.textContent = "Audio engine failed to start. Reload the page to retry.";
      synthContainer.prepend(banner);
    });

    // ── Patch save error → brief toast notification ──
    patchManager.onSaveError = () => {
      showToast({ message: "Patch save failed — check browser storage", variant: "error", durationMs: 3000 });
    };

    // ── Encoder scroll/drag → active module's param ──
    synthView.onEncoderScroll = (slot, delta) => {
      const param = getModuleParams(activeModule)[slot];
      if (param) store.processParamDelta(param.path, delta, 1 / 64);
    };

    // ── Master scroll/drag → master volume ──
    synthView.onMasterScroll = (delta) => {
      store.processParamDelta("master", delta, 1 / 64);
      synthView.flashMaster();
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
        engine.setParamValue(path, value);
        const norm = store.getNormalized("master");
        synthView.setMasterValue(norm, formatParam(norm, SYNTH_PARAMS.master));
      } else {
        engine.setParamValue(path, value);
      }
      if (path === "cutoff") {
        noteHandler.setBaseCutoff(value);
      }
      // Update encoder display if the changed param is in the active module
      const moduleParams = getModuleParams(activeModule);
      for (let i = 0; i < moduleParams.length; i++) {
        const param = moduleParams[i];
        if (param?.path === path) {
          const norm = store.getNormalized(path);
          synthView.setEncoderValue(i, norm, formatParam(norm, param));
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
        // First-ever latch: the user just discovered the feature — retire the hint.
        sceneLatchHint?.dismiss();
        sceneLatchHint = null;
        updateProgramLeds();
        return;
      }

      if (action.type === "unlatch") {
        const engine = pool.getEngine(action.program);
        if (engine) {
          for (const n of action.notes) {
            engine.keyOff(n.channel, n.note, 0);
          }
        }
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
        return;
      }

      await patchManager.save(store.snapshot()).catch((err: unknown) => { patchManager.onSaveError?.(err); });

      const currentEngine = activeEngine();
      if (currentEngine) {
        for (const n of sceneLatch.getHeldNotes()) {
          currentEngine.keyOff(n.channel, n.note, 0);
        }
      }
      sceneLatch.clearHeld();

      const prevIsLatched = sceneLatch.isLatched(prevProgram);
      if (!prevIsLatched && pool.engineCount > 1) {
        pool.releaseEngine(prevProgram);
      }

      const loaded = await patchManager.load(programIndex + 1);
      const patchParams = loaded?.parameters;

      const targetEngine = await pool.getOrCreateEngine(programIndex, patchParams);
      pool.setActiveProgram(programIndex);
      noteHandler.setEngine(targetEngine);

      if (loaded) {
        applyPatch(loaded.parameters);
        refreshEncoderDisplays();
      } else {
        patchManager.selectSlot(programIndex + 1);
      }
      localStorage.setItem("arcturus-last-slot", String(programIndex + 1));
      updateProgramLeds();
      updateVoiceCount();
    };
    synthView.onProgramSelect = (programIndex) => void handleProgramTap(programIndex);

    // ── BeatStep pad routing (when present) ──
    if (padHandler) {
      padHandler.onModuleSelect = (slot) => {
        synthView.onModuleSelect?.(slot);
      };
      padHandler.onPatchSelect = (slot) => void handleProgramTap(slot);
    }

    // ── Transport / mod wheel ──
    noteHandler.onTransport = (action) => {
      if (action === "start") clock.start();
      else if (action === "continue") clock.continue();
      else clock.stop();
    };
    noteHandler.onModWheel = (norm) => {
      store.setNormalized("lfo_depth", norm);
    };

    if (mapper) {
      mapper.onMasterDelta = (delta) => {
        store.processParamDelta("master", delta, 1);
        synthView.flashMaster();
      };
    }

    // ── Note source dispatch (any non-BeatStep MIDI input) ──
    const dispatchNoteSourceMessage = (data: Uint8Array) => {
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

      noteHandler.handleMessage(data);
      updateVoiceCount();
    };

    midi.onNoteSourceMessage = dispatchNoteSourceMessage;
    midi.onBeatstepMessage = (data) => {
      mapper?.handleMessage(data);
      padHandler?.handleMessage(data);
    };

    // ── Computer keyboard wiring (always live) ──
    keyboard.onNoteOn = (channel, note, velocity) => {
      if (pool.ctx?.state === "suspended") void pool.ctx.resume();
      sceneLatch.noteOn(channel, note, velocity);
      noteHandler.noteOn(channel, note, velocity);
      updateVoiceCount();
    };
    keyboard.onNoteOff = (channel, note) => {
      if (sceneLatch.noteOff(channel, note)) {
        updateVoiceCount();
        return;
      }
      noteHandler.noteOff(channel, note);
      updateVoiceCount();
    };
    keyboard.onOctaveChange = (octave) => {
      // Brief HUD update so the user sees the shift took effect.
      const el = document.querySelector(".synth-voices");
      if (el) {
        const original = el.textContent;
        el.textContent = `OCT ${octave}`;
        el.classList.add("synth-voices--flash");
        setTimeout(() => {
          el.classList.remove("synth-voices--flash");
          el.textContent = original ?? "";
        }, 800);
      }
    };

    // ── Live stereo metering ──
    const meters = new MeterController(pool, synthView);
    meters.start();

    // ── MIDI bring-up (always — even if no BeatStep, generic keyboards still work) ──
    void audioReady;
    if (mapping) {
      console.log(`[Arcturus] BeatStep mapping loaded: ${mapping.encoders.length} encoders, master CC ${mapping.masterCC}, pads row1=[${mapping.padRow1Notes[0]}..${mapping.padRow1Notes[7]}], row2=[${mapping.padRow2Notes[0]}..${mapping.padRow2Notes[7]}]`);
    } else {
      console.log("[Arcturus] No BeatStep mapping — encoders/pads driven by mouse, notes by computer keyboard or generic MIDI input.");
    }

    midi.onDevicesChanged = (state) => {
      if (state.hasBeatstep) {
        nudge?.hide();
        if (midi.beatstepOutput) clock.setOutput(midi.beatstepOutput);
        // BeatStep is connected — but is it calibrated?
        if (!mapping) {
          this._promptCalibrationForHotPlug();
        }
      } else {
        nudge?.show();
      }
    };

    midi.requestAccess()
      .then(async () => {
        if (midi.beatstepOutput) clock.setOutput(midi.beatstepOutput);
        return midi.discoverDevices();
      })
      .catch((err: unknown) => {
        console.warn("[Arcturus] MIDI not available:", err);
      });

    // ── Header three-dots menu (Export / Import / Re-calibrate / Settings) ──
    let headerMenu: HeaderMenuHandle | null = null;
    const menuAnchor = synthView.menuAnchor;
    if (menuAnchor) {
      headerMenu = mountHeaderMenu(this._container, menuAnchor, [
        {
          id: "export",
          label: "Export presets",
          hint: "Save all eight programs to a JSON file.",
          onSelect: async () => {
            try {
              const env = await buildExport();
              if (env.patches.length === 0) {
                showToast({ message: "No patches to export yet." });
                return;
              }
              downloadEnvelope(env);
              showToast({ message: `Exported ${env.patches.length} preset${env.patches.length === 1 ? "" : "s"}.` });
            } catch (err) {
              console.error("[Arcturus] Export failed:", err);
              showToast({ message: "Export failed — check the console.", variant: "error" });
            }
          },
        },
        {
          id: "import",
          label: "Import presets",
          hint: "Replace matching slots from a JSON file.",
          onSelect: async () => {
            try {
              const json = await pickJsonFile();
              if (!json) return; // user cancelled
              const env = parseEnvelope(json);
              const written = await applyImport(env, patchManager);
              // Reload the patch in the active slot so the engine reflects the new params.
              const reloaded = await patchManager.load(patchManager.currentSlot);
              if (reloaded) {
                store.loadValues(reloaded.parameters);
                refreshEncoderDisplays();
              }
              showToast({ message: `Imported ${written} preset${written === 1 ? "" : "s"}.` });
            } catch (err) {
              if (err instanceof InvalidEnvelopeError) {
                showToast({ message: `Import failed: ${err.message}`, variant: "error" });
              } else {
                console.error("[Arcturus] Import failed:", err);
                showToast({ message: "Import failed — check the console.", variant: "error" });
              }
            }
          },
        },
        {
          id: "recalibrate",
          label: "Re-calibrate BeatStep",
          hint: "Re-teach the app which CC each knob sends.",
          onSelect: () => {
            headerMenu?.close();
            this._calibrationView = new CalibrationView(this._container);
            void this._startCalibration();
          },
        },
        {
          id: "settings",
          label: "Settings",
          hint: "Sample rate, buffer size, voice count.",
          onSelect: () => configView.show(),
        },
      ]);
      synthView.onMenuOpen = () => headerMenu?.open();
    }
  }

  /**
   * A BeatStep was plugged in mid-session and we have no mapping for it.
   * Show a non-blocking toast offering to enter calibration; if accepted,
   * tear down the synth view and run the calibration flow.
   */
  private _hotPlugPromptShown = false;
  private _promptCalibrationForHotPlug(): void {
    if (this._hotPlugPromptShown) return;
    this._hotPlugPromptShown = true;
    mountCalibratePrompt(this._container, {
      onCalibrate: () => {
        this._hotPlugPromptShown = false;
        this._container.innerHTML = "";
        this._calibrationView = new CalibrationView(this._container);
        void this._startCalibration();
      },
      onDismiss: () => {
        this._hotPlugPromptShown = false;
      },
    });
  }
}
