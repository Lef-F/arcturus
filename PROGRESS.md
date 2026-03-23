# Arcturus — Progress Log

## M-1: Project Initialization — COMPLETE
**Date:** 2026-03-23
**What was built:**
- Git repo initialized, remote set to github.com:Lef-F/arcturus-dev.git
- Research plan authored (hardware fingerprinting, MIDI mapping, Faust DSP, clock architecture, calibration flow, effects chain, polyphony strategy)
- Implementation spec authored (tech stack, project structure, UI architecture, design system, milestones)
- Project scaffolded: Vite + TypeScript + Tailwind v4 + pnpm
- Full module directory structure with types, placeholder modules, and design tokens
- Design system defined: Phosphor Observer evolved with OP-1 (primary) + Serum (secondary) inspiration

**What was tested:**
- `pnpm typecheck` — passes
- `pnpm build` — succeeds

**Known issues:** None

**Next:** M0 (Test Infrastructure)

## M0: Test Infrastructure — COMPLETE
**Date:** 2026-03-23
**What was built:**
- Installed Vitest 4.1.0, @vitest/coverage-v8, happy-dom
- Configured Vitest in vite.config.ts (happy-dom environment, coverage via v8)
- Added test scripts: `test`, `test:watch`, `test:e2e`, `test:coverage`
- `src/test/virtual-midi.ts`: Full mock of Web MIDI API — VirtualMIDIInput, VirtualMIDIOutput, VirtualMIDIAccess; virtual KeyStep and BeatStep with SysEx Identity Request/Reply loopback
- `src/test/virtual-audio.ts`: VirtualAudioContext, VirtualAudioWorkletNode, VirtualAudioParam, VirtualAnalyserNode — no actual audio output
- `src/test/helpers.ts`: simulateEncoderTurn, simulateNoteOn/Off, simulatePadPress, simulateProgramChange, simulatePitchBend, simulateAftertouch, waitForMessage, createTestMidiAccess
- `src/test/e2e.test.ts`: 15-test E2E smoke test covering: SysEx identity, model code differentiation, encoder relative CC encoding, note/pad/transport helpers, output message capture

**What was tested:**
- `pnpm test` — 15/15 passing
- `pnpm typecheck` — clean

**Known issues:** None

**Next:** M1 (Audio Engine Foundation)

## M1: Audio Engine Foundation — COMPLETE
**Date:** 2026-03-23
**What was built:**
- Installed @grame/faustwasm 0.15.7
- Copied libfaust-wasm files to public/libfaust-wasm/ for browser serving
- src/audio/synth.dsp: single-voice subtractive synth (4-waveform osc + detune → moog ladder filter + filter envelope → ADSR amp envelope)
- src/audio/effects.dsp: overdrive (cubicnl) → chorus (fdelay+LFO) → delay (feedback) → reverb (zita_rev1_stereo) → master vol
- src/audio/params.ts: full parameter registry (16 params × encoders), normalizedToParam/paramToNormalized, soft takeover with approach-direction tracking, ParameterStore class
- src/audio/engine.ts: SynthEngine class with injectable test nodes, routes synth/fx params to correct nodes, midiNoteToHz helper

**What was tested:**
- params.test.ts: 21 tests — linear/log scaling, round-trips, soft takeover direction logic, ParameterStore CRUD
- engine.test.ts: 16 tests — keyOn/keyOff, param routing to correct nodes, start/stop lifecycle
- pnpm test: 54/54 passing
- pnpm typecheck: clean
- pnpm build: succeeds

**Known issues:**
- Manual browser test not verified (requires real AudioContext + WASM)
- Faust DSP not runtime-verified (will test in browser manually per AGENTS.md spec)

**Next:** M2 (MIDI Input)

## M2: MIDI Input — COMPLETE
**Date:** 2026-03-23
**What was built:**
- src/midi/fingerprint.ts: isArturiaIdentityReply, parseIdentityReply, identifyDevice (keystep/beatstep), broadcastIdentityRequest
- src/midi/manager.ts: MIDIManager — requestAccess, discoverDevices (SysEx handshake), message routing to onKeystepMessage/onBeatstepMessage, re-discovery on state change
- src/control/encoder.ts: parseRelativeCC (Binary Offset), parseEncoderDelta (with ×1-6 acceleration), EncoderManager (CC→encoder index routing, remappable)
- src/control/keystep.ts: KeyStepHandler — note on/off, pitch bend → detune (cents), channel aftertouch → filter cutoff (additive), transport FA/FB/FC
- src/control/mapper.ts: ControlMapper — wires EncoderManager → ParameterStore → SynthEngine, voice limit on encoder 16
- src/control/pads.ts: PadHandler — Program Change → patch select, Note On → trigger, Note Off → release, buildPadLedMessage for LED feedback

**What was tested:**
- encoder.test.ts: 17 tests (CC parsing, acceleration, EncoderManager routing, remapping)
- keystep.test.ts: 11 tests (note, pitch bend, aftertouch, transport)
- pads.test.ts: 12 tests (program change, triggers, LED builder)
- midi-to-engine.test.ts: 14 tests (full virtual MIDI → engine integration)
- pnpm test: 112/112 passing
- pnpm typecheck: clean, pnpm build: succeeds

**Known issues:** None

**Next:** M3 (Calibration Flow)

## M3: Calibration Flow — COMPLETE
**Date:** 2026-03-23
**What was built:**
- src/state/db.ts: IndexedDB schema (arcturus v1) with hardware_profiles, patches, config stores; full CRUD via `idb` library
- src/state/hardware-map.ts: persistHardwareProfile (upsert by port name), findMatchingProfile (port-then-fingerprint), hasSavedProfiles, loadProfilesByRole
- src/midi/calibration.ts: CalibrationController with full run() sequence — SysEx discovery, encoder-turn device identification, 16-CC encoder characterization, IndexedDB save; reactive onStateChange callbacks
- src/ui/calibration-view.ts: CalibrationView — renderIdle, renderSkipPrompt, renderState (progress bars, action prompts, complete/error screens)
- src/ui/app.ts: App boot — checks hasSavedProfiles(), shows skip prompt or starts calibration; wires CalibrationController → CalibrationView; placeholder synth view mount
- src/test/setup.ts: Global test setup installing fake-indexeddb/auto for IndexedDB support in happy-dom
- src/test/calibration-flow.test.ts: 11 tests using reactive onStateChange + queueMicrotask pattern

**What was tested:**
- `pnpm test` — 123/123 passing
- `pnpm typecheck` — clean
- `pnpm build` — succeeds (1.10 kB JS, 29.33 kB CSS)

**Known issues:**
- Manual browser test not verified (requires real MIDI hardware)
- CalibrationView uses innerHTML (XSS-safe for static strings; error messages come from controller, not user input)

**Next:** M4 (Clock & Polyphony)

## M4: Clock & Polyphony — COMPLETE
**Date:** 2026-03-23
**What was built:**
- src/midi/clock.ts: MidiClock class — 24 PPQN lookahead scheduler using setInterval+performance.now(); sends 0xF8 timing pulses with hardware timestamps, 0xFA start, 0xFB continue, 0xFC stop; configurable BPM, lookahead window, schedule interval
- src/audio/synth.dsp: Added `declare nvoices "8"` for Faust 8-voice polyphonic compilation
- src/audio/engine.ts: Upgraded to FaustPolyDspGenerator; keyOn/keyOff use poly interface when available (fallback to param-based for test stubs); activeVoices tracking; maxVoices cap; transport wiring via KeyStepHandler.onTransport at app layer
- src/audio/engine.test.ts: 8 new polyphony/voice-tracking tests
- src/midi/clock.test.ts: 14 tests — pulse rate, BPM accuracy, transport messages, timestamps, stop behavior

**What was tested:**
- `pnpm test` — 144/144 passing
- `pnpm typecheck` — clean
- `pnpm build` — succeeds

**Known issues:**
- Manual browser test not verified (requires real AudioContext + WASM)

**Next:** M5 (Effects Chain)

## M5: Effects Chain — COMPLETE
**Date:** 2026-03-23
**What was built:**
- effects.dsp was already complete (overdrive, chorus, delay, reverb) from M1
- Encoder routing to effects params (E9-E15) was already in ENCODER_PARAM_NAMES from M2
- src/midi/clock.ts: Added getDelayTimeForBeat(), DelaySubdivision type, MidiClock.getDelayTime(), MidiClock.onBpmChange callback
- src/audio/effects.test.ts: 34 tests — encoder→param routing, param bounds, all 7 subdivision types, BPM change callbacks

**What was tested:**
- `pnpm test` — 178/178 passing
- `pnpm typecheck` — clean

**Next:** M6 (UI)
