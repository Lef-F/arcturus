# Arcturus — TODO

## Active Tasks

### M0: Test Infrastructure — COMPLETE (2026-03-23)
- [x] Install Vitest + happy-dom + coverage
- [x] Configure Vitest in vite.config.ts
- [x] Create `src/test/` directory structure
- [x] Build Virtual MIDI Device (`src/test/virtual-midi.ts`) — mock Web MIDI API with virtual KeyStep + BeatStep that respond to SysEx identity requests
- [x] Build Virtual Audio Context (`src/test/virtual-audio.ts`) — mock AudioContext/AudioWorklet for unit tests
- [x] Build test helpers (`src/test/helpers.ts`) — createTestMidiAccess(), simulateEncoderTurn(), simulateNoteOn(), etc.
- [x] Build E2E smoke test (`src/test/e2e.test.ts`) — virtual MIDI harness: SysEx identity, encoder simulation, note/pad/transport helpers
- [x] Add test scripts to package.json
- [x] Verify: `pnpm test` runs and passes (15 tests passing)

### M1: Audio Engine Foundation — COMPLETE (2026-03-23)
- [x] Install `@grame/faustwasm` (0.15.7)
- [x] Write `src/audio/synth.dsp` — single-voice: saw/sq/tri/sin osc → moog ladder filter → ADSR
- [x] Write `src/audio/effects.dsp` — overdrive → chorus → delay → reverb → master
- [x] Implement `src/audio/engine.ts` — Faust WASM compile, AudioWorkletNode, keyOn/keyOff/setParamValue
- [x] Implement parameter scaling and soft takeover in `src/audio/params.ts`
- [x] Write unit tests (params.test.ts: 21 tests, engine.test.ts: 16 tests)
- [ ] Manual test: trigger note via browser console → hear sound (requires real browser)

### M2: MIDI Input — COMPLETE (2026-03-23)
- [x] Implement `src/midi/manager.ts` — request access, enumerate ports, route messages, re-discover on state change
- [x] Implement `src/midi/fingerprint.ts` — SysEx identity request/reply, isArturiaIdentityReply, parseIdentityReply, identifyDevice
- [x] Implement `src/control/keystep.ts` — note on/off, pitch bend→detune, aftertouch→cutoff, transport FA/FB/FC
- [x] Implement `src/control/encoder.ts` — Binary Offset relative CC parsing, acceleration ×1-6, EncoderManager
- [x] Implement `src/control/mapper.ts` — EncoderManager → ParameterStore → engine, voice limit encoder
- [x] Implement `src/control/pads.ts` — Program Change (top row), Note triggers (bottom row), LED feedback builder
- [x] Write tests: encoder.test.ts (17 tests), keystep.test.ts (11 tests), pads.test.ts (12 tests), midi-to-engine.test.ts (14 tests)

### M3: Calibration Flow
- [ ] Implement `src/midi/calibration.ts` — full calibration sequence
- [ ] Implement `src/state/db.ts` — IndexedDB schema and CRUD
- [ ] Implement `src/state/hardware-map.ts` — profile persistence
- [ ] Implement `src/ui/calibration-view.ts` — step-by-step UI
- [ ] Implement skip-calibration logic
- [ ] Write tests: calibration with virtual MIDI, profile persistence

### M4: Clock & Polyphony
- [ ] Implement `src/midi/clock.ts` — AudioWorklet master clock, lookahead scheduling
- [ ] Upgrade Faust DSP to 8-voice polyphony
- [ ] Implement active voice limit via Encoder 16
- [ ] Implement transport control (play/stop)
- [ ] Write tests: clock timing, polyphony, voice stealing

### M5: Effects Chain
- [ ] Complete all Faust effects (overdrive, chorus, delay, reverb)
- [ ] Wire effects to Encoders 9-15
- [ ] Implement delay tempo sync
- [ ] Write tests: effect parameters respond to encoder changes

### M6: UI
- [ ] Implement design tokens (Phosphor Observer + OP-1 aesthetic)
- [ ] Build encoder component (SVG, arc indicator, label, value)
- [ ] Build pad component (glow states)
- [ ] Build waveform component (AnalyserNode oscilloscope)
- [ ] Build synth-view (BeatStep-shaped layout)
- [ ] Build config-view (hidden menu)
- [ ] Wire UI to MIDI/engine state
- [ ] Write tests: render, value updates, pad states

### M7: Patches & State
- [ ] Implement patch CRUD + autosave
- [ ] Implement patch load via pad (Program Change)
- [ ] Implement soft takeover on patch switch
- [ ] Implement pad LED feedback
- [ ] Implement config persistence
- [ ] Write tests: save/load/autosave/soft takeover

### M8: Integration & Polish
- [ ] Full integration test
- [ ] Production build verification
- [ ] Preview server with COOP/COEP
- [ ] Run all permanent audits
- [ ] Fix all findings
- [ ] Re-run audits until clean

---

## Permanent Tasks (run these repeatedly, never mark complete)

- [ ] **AUDIT: Test coverage** — Run all tests. Find untested code paths. Write tests for them. Target: every exported function has at least one test. Every user-facing flow has an integration test.

- [ ] **AUDIT: Type safety** — Run `pnpm typecheck`. Fix all errors. Then look for `any` types, type assertions (`as`), and non-null assertions (`!`). Replace with proper types or runtime checks. Target: zero `any` in production code.

- [ ] **AUDIT: Error handling** — Trace every async call, every hardware interaction, every IndexedDB operation. What happens when it fails? Does the user see a helpful message? Does the system recover gracefully? Add error handling where missing.

- [ ] **AUDIT: Performance** — Profile the audio path. Is the AudioWorklet render budget (<2.67ms at 48kHz) being respected? Are there unnecessary allocations in the hot path? Are DOM updates batched? Fix any issues found.

- [ ] **AUDIT: UX polish** — Open the app. Use it as a musician would (with the virtual MIDI test harness). Is the feedback instant? Are transitions smooth? Do encoder values feel responsive? Does the waveform display look good? Fix anything that feels off.

- [ ] **AUDIT: Code quality** — Run linter. Read through every file changed in the last milestone. Look for: dead code, duplicated logic, unclear naming, missing JSDoc on public APIs, functions longer than 40 lines. Refactor.

- [ ] **AUDIT: Documentation sync** — Read IMPLEMENTATION.md. Does it still match the code? Update any sections that have drifted. Check that TODO.md is current. Update PROGRESS.md.

- [ ] **AUDIT: Build & deploy** — Run `pnpm build`. Does it succeed? Is the output size reasonable? Test with `pnpm preview`. Does everything work with COOP/COEP headers? Fix any issues.
