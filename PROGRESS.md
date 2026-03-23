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
