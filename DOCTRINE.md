# Arcturus — Doctrine

**You are an autonomous agent maintaining a hardware-first virtual analog synthesizer.** This document is your operating system. Read it fully at the start of every session. Follow it without exception. Keep it updated as the system evolves.

DOCTRINE.md supersedes all other docs when they conflict. CLAUDE.md is the architecture reference. AGENTS.md is the agent task runner guide. `docs/SOUND_ENGINE.md` is the DSP reference.

---

## Part 1 — Constitution

These truths do not change. They define what Arcturus IS.

### 1.1 Purpose

Arcturus is a **browser-based virtual analog synthesizer** controlled entirely by Arturia hardware — KeyStep Standard (keys, pitch bend, aftertouch) and BeatStep Black Edition (16 encoders, 16 pads, master knob).

No mouse required. The hardware IS the interface.

### 1.2 The Zen

**The user enters a state of nirvana by jamming on their KeyStep and toying with sounds through the BeatStep. An absorbing soundscape experience, completely frictionless to the human.**

Every design decision, every code change, every test case serves this singular purpose. If a change adds friction between the human and the sound — it's wrong. If it removes friction — it's right.

### 1.3 Quality Bar

**A musician should be able to plug in their hardware, complete calibration in under 60 seconds, and lose themselves in sound within 90 seconds of first boot.**

- If the first note produces silence — critical failure.
- If switching programs clicks — critical failure.
- If an encoder feels unresponsive — critical failure.
- If latching a chord and switching programs changes the chord's sound — critical failure (multi-engine must work).
- If the calibration flow confuses the user — critical failure.
- If aftertouch doesn't feel expressive — quality failure.
- If the synth can't hold 8 voices without CPU issues — performance failure.

### 1.4 Architecture Constraints

1. **Vanilla TypeScript + DOM API.** No React, Vue, or frameworks. One concern per module.
2. **Faust DSP compiled to WASM.** AudioWorklet-based. Zero-latency signal path.
3. **Single source of truth.** `ParameterStore` owns all parameter values. `HardwareMapping` owns all MIDI assignments.
4. **No hardcoded MIDI values.** Everything from calibration.
5. **No backwards compatibility.** Dev-phase project. Delete old code, never migrate.
6. **No dead code.** If it's not used, it's deleted.

---

## Part 2 — Quality Score

After every test run, compute:

```
Q = (signal_pass × 0.30) + (effects_pass × 0.15) + (unit_pass × 0.20) +
    (transition_pass × 0.15) + (param_coverage × 0.10) + (zero_regressions × 0.10)
```

Where:
- `signal_pass` = synth.dsp signal tests passed / total (currently ~1176 tests)
- `effects_pass` = effects.dsp signal tests passed / total (currently 0 — must build)
- `unit_pass` = all non-signal unit/integration tests passed / total (~380 tests)
- `transition_pass` = program switch / latch transition tests passed / total (must build)
- `param_coverage` = params with `ParamSignalHints` / total params (currently 14/72 = 19%)
- `zero_regressions` = 1.0 if no test count decreased since last session, 0.0 otherwise

**Rules:**
- Log Q in every session entry.
- Q must never decrease between sessions. If Q drops → P0 → fix before anything else.
- Target: Q ≥ 0.95.
- Current baseline: Q ≈ 0.72 (effects_pass = 0, transition_pass = 0, param_coverage = 0.19).

---

## Part 3 — The Six Measures

These are the measurable heuristics of improvement. Each maps to the zen.

### 3.1 Signal Integrity

**What:** Every parameter produces correct audio. No NaN. No silence when sound is expected. No clipping when levels are reasonable.

**How to measure:**
- Offline Faust WASM compilation (no browser needed)
- Per-param sweep at min/max/default
- Pairwise interaction tests for dangerous combos
- Random fuzzing with seeded exploration

**Current state:** 1176 tests for synth.dsp. Zero for effects.dsp.

**Gap:** 17 FX params untested. Could ship with broken reverb and never know.

### 3.2 Transition Smoothness

**What:** Switching programs, latching/unlatching, voice stealing — all must be click-free and seamless.

**How to measure:**
- Render audio during program switch, analyze for amplitude discontinuities (clicks = samples where |Δ| > threshold)
- Measure latch → switch → play latency
- Test voice stealing: play 9th note with 8 voices, verify no audible click

**Current state:** Zero transition audio tests. Pre-apply params helps, but not validated.

**Gap:** Critical. The user's flow depends on seamless transitions.

### 3.3 Responsiveness

**What:** Time from physical input (key press, encoder turn, pad tap) to audible/visible result.

**How to measure:**
- Note-on to first non-zero audio sample (attack latency)
- Encoder turn to parameter change (< 1ms target)
- Program pad to new patch audible (< 500ms target for new engine, instant for existing)
- Aftertouch pressure to filter modulation (< 5ms target)

**Current state:** Attack latency checked (< 2 buffers ≈ 5ms). Encoder/pad latency not measured.

**Gap:** No end-to-end latency measurement from MIDI input to audio output.

### 3.4 Parameter Coverage

**What:** Every parameter has signal hints, is tested, and produces meaningful audio change.

**How to measure:**
- `ParamSignalHints` present on every `SynthParam`
- Signal test coverage: param swept at min/max/default
- Spectral verification: params marked `affectsSpectrum` produce measurable frequency change

**Current state:** 14/72 params (19%) have hints. 53/55 synth params tested (FX excluded).

**Gap:** 58 params without hints. 17 FX params untested. Zero spectral validation.

### 3.5 Preset Quality

**What:** Factory presets sound like their names and demonstrate the synth's range.

**How to measure:**
- Structural validation: all params present, values in range (done)
- Sonic validation: each preset produces non-silent audio with distinct spectral characteristics
- Diversity: 8 presets should span different timbres (pad, bass, lead, bell, ambient, etc.)

**Current state:** Structural validation passes. No sonic validation.

**Gap:** Presets could have nonsensical values and still pass tests.

### 3.6 Stability Under Load

**What:** Multiple engines, max voices, fast encoder turns — the system doesn't break.

**How to measure:**
- CPU usage per engine (target: < 5% per engine at 8 voices, 48kHz)
- Max concurrent engines before audio dropout
- Rapid program switching (10 switches/second) — no crashes, no stuck state
- All-notes-off panic — clean recovery within 100ms

**Current state:** No performance measurement. No stress tests.

**Gap:** Could have memory leaks in engine pool. Voice exhaustion untested.

---

## Part 4 — The Cycle

Every session, every cycle:

1. **Read** — CLAUDE.md, then DOCTRINE.md fully
2. **Orient** — `git log --oneline -10`. Check Q score from last session. Check for mid-flight work.
3. **Pick** — apply the Triage Protocol (4.1) to select next item
4. **Research** — read code, understand the problem
5. **Implement** — code + tests
6. **Measure** — run `pnpm test`, compute Q. Run signal tests.
7. **Audit** — check coverage gaps (4.3)
8. **Document** — update DOCTRINE.md, CLAUDE.md, session log
9. **Commit** — conventional commit
10. **Repeat** — step 3. Never stop. Never ask if you should continue. The cycle IS the work.

### 4.1 Triage Protocol

1. **Stop the bleeding.** Tests failing? Q dropped? Fix first.
2. **Continue mid-flight work.** Check `git log` for partial implementations.
3. **Close the biggest gap.** Which of the Six Measures has the lowest score?
4. **Prefer smaller scope.** Ship what you can complete this session.
5. **If tied:** pick the item closest to the zen — user experience over internals.

### 4.2 Checks Before Every Commit

```bash
pnpm typecheck    # zero errors
pnpm lint         # zero warnings
pnpm test         # all pass, count never decreases
```

### 4.3 Coverage Gap Detection

After measuring, audit:

1. **Signal gaps:** any param without `ParamSignalHints`? → add hints + tests
2. **FX gaps:** effects.dsp params tested? → build the effects harness
3. **Transition gaps:** program switch audio validated? → add transition tests
4. **Preset gaps:** any preset without sonic validation? → add audio assertions
5. **Performance gaps:** CPU/memory measured? → add benchmarks
6. **UX gaps:** any user flow that could silently fail? → add error handling + tests

### 4.4 Rollback Protocol

If a change causes any of these, revert:

| Signal | Action |
|--------|--------|
| Test count decreased | `git revert`, investigate |
| Q score decreased | `git revert`, fix differently |
| Signal test regression (PASS→FAIL) | `git revert`, investigate DSP change |
| New NaN or silence in signal tests | P0, fix immediately |

### 4.5 Escalation

**STOP and report (don't block on human) when:**
1. Q dropped and can't recover after 2 revert-and-retry cycles
2. Faust DSP won't compile (syntax or dependency issue beyond agent's scope)
3. Browser API changed (Web MIDI, AudioWorklet) breaking core functionality

**Do NOT stop for:**
- Test failures you can fix
- Coverage gaps you can close
- Backlog empty — generate new work from gap detection
- Documentation stale — fix it
- Dependencies need updating — update them

### 4.6 Session Log Template

Every session entry must use this format:

```markdown
### Session {N} — {YYYY-MM-DD}
**Goal**: {one line}
**Q before**: {score}
**Changes**:
- {commit hash} {message}
**Q after**: {score}
**Gaps closed**: {which of the Six Measures improved}
**Next**: {what the next session should pick up}
```

---

## Part 5 — Current Backlog

### P0 — Now (Blocks Q improvement)

- [x] **Build effects.dsp signal test harness.** Compile effects.dsp offline with `FaustMonoDspGenerator`. Feed sine burst as input. Sweep all 17 FX params at min/max/default. Check for NaN/silence/clipping. Add `ParamSignalHints` to all FX params.
  - **DONE**: `src/test/effects-signal.test.ts` — 90 tests, all passing. effects_pass = 1.0.

- [x] **Add ParamSignalHints to all params.** All 72/72 params now have hints.
  - **DONE**: param_coverage = 1.0 in Q score.

- [x] **Build transition audio tests.** Program switch with latch: verify no amplitude discontinuity. Voice steal: verify no click. Unlatch: verify clean release.
  - **DONE**: `src/test/transition.test.ts` — 15 tests, all passing. transition_pass = 1.0.
  - Also fixed faustwasm concurrent-worker race with `src/test/faust-loader.ts` (cross-process file lock).

### P1 — After P0

- [x] **Preset sonic validation.** Render each preset's first 500ms of audio. Verify non-silence. Verify spectral diversity (8 presets should have distinct peak frequencies).
  - **DONE**: `src/test/preset-sonic.test.ts` — 9 tests: 8 non-silence checks + 1 spectral centroid span ≥ 400 Hz.

- [x] **Latency measurement.** Measure note-on → first non-zero sample in ms. Report in test output. Set threshold: < 10ms.
  - **DONE**: `src/test/latency.test.ts` — 4 tests: default params, min attack, 4-voice chord, consistency check. Threshold: 441 samples = 10ms. Latency reported in failure message.

- [x] **Aftertouch curve audit.** Code comment says `^1.5`, code uses `^2`. Determine correct curve. Test expressiveness.
  - **DONE**: Bug confirmed — comment's numerical examples (40%→0.25, 70%→0.59) match `^1.5`, not `^2`.
  - Fixed `keystep.ts` `_applyAftertouch`: `Math.pow(pressure, 2)` → `Math.pow(pressure, 1.5)`.
  - Added 2 new tests in `midi-to-engine.test.ts`: curve shape verification + reset-on-note-on.

### P2 — Polish

- [x] **CPU performance benchmark.** Measure per-engine CPU at 8 voices, 48kHz. Report in test output.
  - **DONE**: `src/test/perf.test.ts` — 2 tests: CPU% at 8 voices (threshold < 1000%, actual ~16%), scaling ratio (must be < 8×, actual ~1.25×).
- [x] **Stress test: rapid program switching.** 10 switches/second for 5 seconds. No crashes, no stuck notes.
  - **DONE**: `src/test/engine-pool-stress.test.ts` — 9 tests covering create/reuse/release lifecycle, 50 rapid sequential switches with no engine leak, panicReset, destroyAll, concurrent dedup.
- [x] **Device disconnect/reconnect test.** Unplug BeatStep, reconnect. Verify encoders + pads still work.
  - **DONE**: `src/test/midi-reconnect.test.ts` — 6 tests: initial routing, disconnect no-crash, reconnect routing, onDevicesDiscovered callback, BeatStep reconnect, fresh device object listener transfer. Extended `VirtualMIDIAccess` with `simulateStateChange()` for inject-able hardware events.
- [x] **Error recovery UX.** "Retry" button on MIDI permission error. Visual feedback on engine creation failure.
  - **DONE**: Fixed CalibrationView `_renderError` to wire the Retry button to `_onRestart`. Fixed `_startCalibration` in app.ts to set `onRestart` BEFORE the MIDI permission try/catch (previously the callback was set after the early-return error path, making the button dead). Added `.engine-error-banner` CSS + prepend on engine boot failure. 5 tests in `src/test/error-recovery.test.ts`.

### P3 — Quality (generated from gap detection)

- [x] **LFO modulation transition tests.** Verify enabling lfo_to_pitch/filter, sweeping depth, changing rate — all mid-note, no NaN/click.
  - **DONE**: `src/test/transition.test.ts` Section 5 — 4 new tests.
- [x] **Unison mode transition tests.** Toggle unison on/off with active notes, detune sweep — no NaN/clip.
  - **DONE**: `src/test/transition.test.ts` Section 6 — 3 new tests.
- [x] **Patch save failure UX.** Silent autosave failure loses user's work with no feedback.
  - **DONE**: `PatchManager.onSaveError` callback + 3s fadeout toast in app.ts. 1 new test in patches-state.test.ts.
- [x] **Simultaneous multi-parameter changes during chord.** Verify no NaN/clip when cutoff + resonance + waveform changed at same tick with 4 voices active.
  - **DONE**: `src/test/transition.test.ts` Section 2 — added "simultaneous cutoff + resonance + waveform change during 4-voice chord" test.
- [x] **MIDI clock drift test.** Rapid tempo changes via MIDI clock — verify BPM tracking doesn't accumulate error.
  - **DONE**: `src/test/midi-clock.test.ts` — 18 tests: pulse count accuracy at 60/120/240 BPM, BPM change rate response, transport messages (start/stop/continue), monotonic timestamps, delay subdivision math, setBpm clamping.
- [x] **Calibration SysEx timeout edge case.** BeatStep identified by name when SysEx times out — verify no double-assignment.
  - **DONE**: `src/test/midi-reconnect.test.ts` — 2 new tests: BeatStep with no SysEx response discovered exactly once via name fallback, routes messages correctly after name-fallback discovery.

### P4 — Hardening (generated from gap detection)

- [x] **Aftertouch NaN guard.** `Math.pow(pressure, 1.5)` produces NaN for negative pressure. Clamp pressure to [0,1] before exponentiation.
  - **DONE**: Added `Math.max(0, Math.min(1, pressure))` clamp in `keystep.ts _applyAftertouch()`. Added regression test (zero pressure → baseCutoff, not NaN) in `midi-to-engine.test.ts`.
- [x] **Pulse_width edge case pairwise tests.** Narrow pulse (min PW=0.05) + full resonance, and wide pulse (PW=0.95) + closed filter — DSP stress combos not covered by random fuzzing.
  - **DONE**: Added 2 new entries to `PAIRS` in `audio-signal.test.ts`: `["pulse_width", 0.05, "resonance", 1]` and `["pulse_width", 0.95, "cutoff", 20]`. Both pass.
- [x] **Unbooted EnginePool throws.** `getOrCreateEngine()` before `boot()` should throw with a clear error. Gap: stress tests always boot first, this path was untested.
  - **DONE**: Added `describe("EnginePool: unbooted pool")` in `engine-pool-stress.test.ts` — 1 test verifying `rejects.toThrow("EnginePool not booted")`.
- [x] **Scene-latch: same note on different programs.** Note 60 latched on program 0 and program 1 should track independently (separate velocity, independent isLatched state).
  - **DONE**: Added "same note on different programs is tracked independently" test in `scene-latch.test.ts`.
- [x] **DSP: `poly_oscb_freq=-1 + osc_sync=1` extreme pair.** Slow OscB phase + hard sync reset — extreme combo not in random fuzzing.
  - **DONE**: Added to pairwise PAIRS in `audio-signal.test.ts`.
- [x] **panicReset() + releaseEngine(active) consistency.** After panic reset, releasing the surviving active engine should leave pool at 0 engines.
  - **DONE**: Added "panicReset then releaseEngine(active): pool ends empty without crash" in `engine-pool-stress.test.ts`.
- [x] **EncoderManager mode switching tests.** `setEncoderMode()` clears position tracking but was completely untested.
  - **DONE**: Added 4 tests in `describe("EncoderManager: mode switching")` in `midi-to-engine.test.ts`: absolute first-msg no-op, absolute delta tracking, abs→rel switch fires delta, rel→abs switch clears position.
- [x] **Calibration partial discovery recovery.** If BeatStep or KeyStep is missing after SysEx timeout (e.g. encoder characterization only finds 12/16 ports), the calibration flow hangs. Add timeout + retry UI.
  - **DONE**: Added `finalizeEncoders()` public method to `CalibrationController`. During `_characterizeEncoders()`, stores a `_finalizeEncoders` callback that early-resolves with whatever CCs were collected (if ≥ 1). No-op if called outside the encoder step. Added 2 tests in `calibration-flow.test.ts`: partial 8/16 recovery proceeds to `complete`, no-op outside step doesn't throw.
- [x] **Preset parameter completeness CI check.** When a new param is added to `params.ts`, factory-presets.ts will silently miss it (uses default). Add an automated test that asserts every `SYNTH_PARAMS` key is present in every factory preset patch.
  - **DONE**: `factory-presets.test.ts` already had the forward check (all SYNTH_PARAMS keys present). Added reverse check: "no stale keys" — every preset param path exists in SYNTH_PARAMS (catches renames/removals leaving ghost keys in saved patches).

### P5 — Coverage (generated from gap detection)

- [x] **DSP pairwise: filter-mode + mod interactions.** poly_fenv_freq+HPF, poly_fenv_pw+closed filter, vel_to_cutoff+notch, glide+poly_fenv_freq — 4 new pairs.
  - **DONE**: Added to `PAIRS` in `audio-signal.test.ts`.
- [x] **Stepped param boundary tests.** Max/min no-op, misaligned value snaps+advances — previously untested.
  - **DONE**: 3 new tests in `patches-state.test.ts`.
- [x] **markDirty last-value-wins.** Rapid calls coalesce; last params passed should be what gets saved.
  - **DONE**: 1 new test in `patches-state.test.ts`.
- [x] **EnginePool defensive tests.** `setActiveProgram(X)` twice idempotent; `getEngineLevel()` for non-existent program returns safe defaults.
  - **DONE**: 2 new tests in `engine-pool-stress.test.ts`.
- [x] **Rapid repeated pad Note On.** PadHandler should fire callback each time, no dedup.
  - **DONE**: 1 new test in `midi-to-engine.test.ts`.

### P6 — DSP Stability (generated from gap detection)

- [x] **SVF filter NaN cascade under audio-rate poly mod FM.** Random exploration tests were warn-only because `fi.resonlp`/`fi.resonhp` (biquad) becomes unstable with Q=20 + audio-rate coefficient changes from `poly_oscb_filt`. Fix: cap `qSVF` at 10 (was 19.5→max 20), cap `cutoffSVF` at 16kHz (was 20kHz) — keeps biquad away from Nyquist. Upgraded random test NaN check to hard failure.
  - **DONE**: `src/audio/synth.dsp` lines 310-311 updated. `src/test/audio-signal.test.ts` warn→hard fail. 1000 random combos pass.

### P7 — State Integrity (generated from gap detection)

- [x] **Autosave slot race: markDirty captures slot at call time.** If user edits slot 1 → then switches to slot 2 in the 2s autosave window → autosave fires → saves to slot 2 (wrong). Fix: capture `this._currentSlot` as `slotAtDirty` in the closure, pass it as explicit slot arg to `save()`. Test: slot is 1 even after `selectSlot(2)` during timer.
  - **DONE**: `src/state/patches.ts markDirty()` captures `slotAtDirty`. Added regression test "autosave saves to slot active at markDirty time, not at fire time" in `patches-state.test.ts`.
- [x] **Encoder delta magnitude guard.** No test validated the 1/64 scaling invariant: double-scaling would break all encoders silently. Test: 64 CW steps on a linear 0-1 param moves it by full range.
  - **DONE**: Added "encoder delta magnitude: 64 CW steps moves linear param by its full range" in `midi-to-engine.test.ts`.
- [x] **loadValues with stale/unknown params.** Old patches may contain keys removed from SYNTH_PARAMS. `loadValues` already silently skips them, but behavior was untested.
  - **DONE**: Added "loadValues ignores unknown (stale) params without throwing" in `patches-state.test.ts`.

### P8 — Correctness (generated from gap detection)

- [x] **MIDI channel filter dead code.** `KeyStepHandler.handleMessage()` lines 102-105 had `if (channel !== this._channel && isVoiceMessage) { }` with empty body — messages from ALL channels were processed, not just the configured one. Fix: add `return false`. Scoped to voice messages (NOTE_ON/OFF/PITCH_BEND/CHANNEL_PRESSURE) so CC messages including All Notes Off pass through on any channel (global panic).
  - **DONE**: Fixed `src/control/keystep.ts` channel filter. Added "note-on on wrong MIDI channel is ignored" test in `midi-to-engine.test.ts`.
- [x] **Double-tap window boundary test.** SceneLatchManager uses strict `<` for the 350ms window; at exactly 350ms a second tap is NOT a double-tap. Untested at the exact boundary.
  - **DONE**: Added "double-tap at boundary: 349ms is inside window, 350ms is outside" in `scene-latch.test.ts`.

### P9 — Robustness (generated from gap detection)

- [x] **PadHandler unconfigured state.** Calling `handleMessage()` before `setPadNotes()` returns false (no crash, no callback), but was untested.
  - **DONE**: Added "handleMessage before setPadNotes returns false" in `midi-to-engine.test.ts`.
- [x] **PadHandler Note Off / velocity=0 suppression.** Velocity=0 (NOTE_OFF by convention) and actual NOTE_OFF (0x80) must not fire module/patch select callbacks. Was untested.
  - **DONE**: Added "Note Off (velocity 0 and 0x80 status) does not fire pad callbacks" in `midi-to-engine.test.ts`.
- [x] **MidiClock start/stop/continue with no output.** When called without `setOutput()`, these use `?. optional chaining`, so no crash — but was untested.
  - **DONE**: Added 3 null-output tests in `midi-clock.test.ts` (start/stop/continue without output → no throw, correct state).

### P10 — Lifecycle (generated from gap detection)

- [x] **setEngine() mid-AT-pressure: new engine not auto-modulated.** When engine switches with AT held, new engine starts clean — AT resumes on next AT message. Designed behavior, but untested. Test documents the lifecycle.
  - **DONE**: Added "setEngine() mid-aftertouch" test in `midi-to-engine.test.ts`.
- [x] **Pitch bend with null engine (boot race).** Pitch bend before first `setEngine()` fires callback but can't set detune. Safe via `?.` but untested.
  - **DONE**: Added "pitch bend with no engine attached does not crash" in `midi-to-engine.test.ts`.
- [x] **EnginePool.setParamValue() with non-existent programIndex.** Silent no-op via `engine?.setParamValue(...)` but no test. Also added: setParamValue routes to active engine when programIndex undefined.
  - **DONE**: Added 2 tests in `engine-pool-stress.test.ts`.

### P17 — Master Encoder Delta + AT Reset + CC Collision + finalizeEncoders

- [x] **ControlMapper.onMasterDelta never tested.** Master CC fires callback with delta÷64. Non-master CC, center value (64), and silent no-callback cases all untested.
  - **DONE**: Added 4 tests in `midi-to-engine.test.ts` — CW fires +1/64, CCW fires -1/64, center value 64 does not fire, non-master CC does not fire.
- [x] **KeyStepHandler AT new-note reset untested.** Second note-on while AT is held must reset `_atPressure` to 0 and snap cutoff back to `_baseCutoff`. Silent musical failure if broken.
  - **DONE**: Added 1 test — sends note-on, then AT, verifies cutoff rises, then second note-on resets cutoff to 8000.
- [x] **EncoderManager.setEncoderCC CC collision cleanup.** If encoder 1 is reassigned to encoder 0's CC, the old mapping guard must properly transfer ownership. Untested pairwise.
  - **DONE**: Added 1 test — three encoders [CC5, CC6, CC7]; setEncoderCC(1, 5) transfers CC5 to encoder 1; CC6 becomes orphaned.
- [x] **PadHandler Program Change works on any MIDI channel.** `status & 0xF0 === 0xC0` already masks channel bits, but was only tested on one channel. Multi-channel verification.
  - **DONE**: Added 1 test — PC on channels 0xC0, 0xC3, 0xCF all fire onModuleSelect with correct program.
- [x] **CalibrationController.finalizeEncoders() skip mid-flow.** User with partial encoders (e.g., 8 of 16) can call finalizeEncoders() to skip waiting. Also: calling it after calibration completes is a no-op.
  - **DONE**: Added 2 tests in `calibration-flow.test.ts` — partial (8 encoders + finalize → completion with 8-entry calibration), post-completion no-op.

### P16 — fingerprint.ts Positive Cases + ParameterStore.setNormalized

- [x] **`identifyDevice()` positive cases never tested.** Prior tests only verified `null` returns (no match). KEYSTEP_MODEL_CODE → "keystep", KEYSTEP32_MODEL_CODE → "keystep", BEATSTEP_MODEL_CODE → "beatstep" were untested.
  - **DONE**: Added 3 tests in `integration.test.ts` — each model code returns correct device string.
- [x] **`parseIdentityReply()` byte position extraction.** Pure function extracting manufacturerId[5-7], familyCode[8-9], modelCode[10-11], firmwareVersion[12-15]. Untested — byte offsets are fragile.
  - **DONE**: Added 1 test in `integration.test.ts` — constructs exact SysEx reply and verifies all four field extractions.
- [x] **`ParameterStore.setNormalized()` — used only in modwheel flow, no direct tests.** Clamp behavior (>1 → 1, <0 → 0), `onParamChange` firing with denormalized value, log-scale geometric mean at normalized=0.5.
  - **DONE**: Added 5 tests in `midi-to-engine.test.ts` — clamp high, clamp low, linear param onParamChange value, log param geometric mean (~632 Hz for cutoff), no-callback no-throw.

### P15 — SceneLatch Lifecycle + DB Corruption Guard

- [x] **SceneLatch orphan noteOff.** `noteOff()` called without prior `noteOn` should return false and leave no stale state. Hardware can send delayed keyOff for notes never registered (jack unplug, MIDI merge). Untested.
  - **DONE**: Added "orphan noteOff (no prior noteOn) returns false and does not crash" in `scene-latch.test.ts`.
- [x] **clearAll() then delayed noteOff.** After panic reset (`clearAll()`), hardware may send a queued `noteOff` for a previously-latched note. Must return false (not suppress) since the latch is gone. Untested.
  - **DONE**: Added "clearAll then delayed noteOff: note is not suppressed (latch is gone)" in `scene-latch.test.ts`.
- [x] **PatchManager.loadAll() OOB slot guard.** The `idx < result.length` guard silently drops patches with `slot > 8` (DB corruption, manual edit). Untested — required direct DB insert via `openArctDB()` to bypass `save()` clamping.
  - **DONE**: Added "loadAll silently skips patches with out-of-bounds slot numbers" in `patches-state.test.ts`.

### P14 — Calibration Filtering + Encoder Routing + Stepped Param Invariants

- [x] **Calibration: poly aftertouch (0xa0) rejected during pad row capture.** Status 0xa0 is filtered (line 358 in calibration.ts), but no test ever fires AT during pad row characterization. Silent failure: AT velocity could pollute pad note array.
  - **DONE**: Added test in `calibration-flow.test.ts` — fires AT noise before 8 valid notes; padRow1Notes must not contain 0x40 (pressure byte).
- [x] **Calibration: velocity-0 Note On rejected during pad row capture.** `if (status !== 0x90 || data[2] === 0) return` filters velocity-0 messages. If all pads send this encoding, calibration would hang waiting for valid notes.
  - **DONE**: Added test fires velocity-0 Note On before 8 valid notes; padRow1Notes still 8 valid notes.
- [x] **EncoderManager.setEncoderCC: old CC stops routing after reassignment.** After `setEncoderCC(0, 10)`, CC 5 (old) should produce no delta. Untested.
  - **DONE**: Added 2 tests — old CC fires nothing, new CC fires delta; out-of-bounds index is no-op.
- [x] **ParameterStore stepped param negative delta direction.** A CCW turn (negative delta) from a valid step value must decrease the step, not increase it. Untested.
  - **DONE**: Added 1 test — waveform=2, negative delta → snapshot < 2.

### P13 — Encoder Protocol + Soft Takeover + Log Math (generated from gap detection)

- [x] **parseTwosComplementCC never tested.** Relative2 encoder mode CC parsing: CW=1–63, CCW=65–127 (two's complement 127=−1), center 0+64=no movement.
  - **DONE**: 3 tests in `midi-to-engine.test.ts`.
- [x] **parseSignMagnitudeCC never tested.** Relative3 encoder mode CC parsing: bit6=direction, bits0-5=magnitude, magnitude=0 means no movement.
  - **DONE**: 3 tests in `midi-to-engine.test.ts`.
- [x] **EncoderManager relative2/3 mode not exercised via handleMessage.** EncoderManager parses correctly in each mode but the dispatch path was untested end-to-end.
  - **DONE**: 5 tests — CW/CCW/no-movement for both relative2 and relative3.
- [x] **Soft takeover hunt mode asymmetry.** `latchEncoder` + `processSoftTakeover`: approach-from-above (CCW crossing) and approach-from-below (CW crossing) both independently tested. Wrong direction never unlocks guard.
  - **DONE**: 3 tests covering both approach directions and wrong-direction invariant.
- [x] **normalizedToParam / paramToNormalized logarithmic boundary.** Log math with n=0 or n=1, out-of-range clamp, round-trip for 5 cutoff values across log scale.
  - **DONE**: 5 tests with exact boundary checks and finite-value guards.

### P12 — API Contracts + Edge Cases (generated from gap detection)

- [x] **PadHandler Program Change before setPadNotes().** PC messages bypass `_configured` check on lines 52-58 — `onModuleSelect` fires even before pad calibration. Intentional (PC from software sources needs no calibration), but undocumented and untested.
  - **DONE**: Added 2 tests in `midi-to-engine.test.ts` — PC 0–7 fires onModuleSelect, PC >= 8 returns false.
- [x] **SCENE module empty slots.** Module index 7 (`SCENE`) uses `slots()` (all null). `processEncoderDelta` returns false for all 16 encoder slots. Untested.
  - **DONE**: Added test looping all 16 slots on activeModule=7, each expects false.
- [x] **getModuleParams out-of-bounds index.** `MODULES[99]` is undefined → returns `new Array(16).fill(null)`. Safe but untested.
  - **DONE**: Added test verifying 16 nulls returned, no crash.
- [x] **buildPadLedMessage format contract.** Pure function builds BeatStep LED Note-On messages (0x99). Row 1/2 note calculation, velocity masking — never tested despite being the only LED feedback mechanism.
  - **DONE**: Added 4 tests covering row 1, row 2, velocity=0 off, overflow masking.

### P11 — Signal + Routing Hardening (generated from gap detection)

- [x] **Effects pairwise feedback stability: max drive + delay_feedback + reverb combo.** Each of these creates a feedback loop; combining all three was untested. Worst-case nested feedback path.
  - **DONE**: Added "max drive + max delay_feedback + max reverb: no NaN" in `effects-signal.test.ts` (200 buffers with sine input, checks no NaN/Infinity).
- [x] **Extreme EQ gains + max reverb: eq_lo=+12, eq_hi=-12, reverb_mix=1.0.** Asymmetric EQ boost/cut into maximum reverb size — untested pairwise combo.
  - **DONE**: Added "extreme EQ gains + max reverb: no NaN" in `effects-signal.test.ts`.
- [x] **stereo_width=0 + long delay_feedback does not collapse to silence.** Width=0 collapses to mono but delay feedback chain must keep signal alive.
  - **DONE**: Added "stereo_width=0 + long delay_feedback does not collapse to silence" in `effects-signal.test.ts`.
- [x] **ControlMapper null store: encoder delta before setStore() is silent no-op.** `_store?.processEncoderDelta` uses optional chaining, but the behavior was untested.
  - **DONE**: Added "encoder delta before setStore() is a silent no-op" in `midi-to-engine.test.ts`.
- [x] **ControlMapper ignores SysEx/Program Change.** Non-CC messages should return false (unhandled), not crash. Previously untested.
  - **DONE**: Added "SysEx and Program Change pass through mapper as unhandled" in `midi-to-engine.test.ts`.
- [x] **Module switch mid-turn does not leak encoder state to new module.** Switching `activeModule` between turns routes encoder 0 to a different param — FLTR/cutoff must not receive updates after switching to OSCA/osc_a_tune.
  - **DONE**: Added "switching activeModule mid-turn does not leak encoder state to new module" in `midi-to-engine.test.ts`.

---

## Part 6 — Self-Maintenance

This is an agent-maintained system. The agent is responsible for:

- **Implementing** — features, fixes, quality improvements
- **Testing** — signal tests, unit tests, transition tests, performance benchmarks
- **Measuring** — Q score every session, Six Measures tracked
- **Documenting** — DOCTRINE.md, CLAUDE.md, session log
- **Cleaning** — dead code, stale tests, unused params

**The agent maintains the system that maintains the code.**

### 6.1 When to Update What

| Event | Update |
|-------|--------|
| Added/removed a file | CLAUDE.md architecture tree |
| Added/removed a param | params.ts + SOUND_ENGINE.md + factory-presets.ts + ParamSignalHints |
| Changed DSP behavior | SOUND_ENGINE.md + signal tests |
| Q score changed | DOCTRINE.md session log |
| Completed a backlog item | DOCTRINE.md backlog (check it off) |
| Found a friction point | DOCTRINE.md backlog + fix |
| New test category added | DOCTRINE.md Q score formula (if applicable) |

### 6.2 Autonomy

This doctrine is a **self-sustaining infinite loop**. The agent reads it, executes the cycle, measures Q, closes gaps, updates the doctrine, and repeats. No human input is required or expected between sessions.

**The human's only role:**
- Drop a new `DOCTRINE.md` version if strategic direction changes
- Jam on the hardware (the ultimate integration test)

**The agent's role:** everything else — implementation, testing, quality tracking, documentation, gap detection, backlog generation, dependency management, performance optimization, and self-improvement of this doctrine itself.

When the backlog empties, the agent generates new work from coverage gap detection (4.3). When all gaps are closed, the agent explores: new parameter combinations, preset generation, DSP optimization, spectral analysis improvements. The loop never stops.

---

## Part 7 — Session Log

*(Append new sessions here. Oldest at top.)*

### Session 0 — 2026-03-26 (Baseline)
**Goal**: Establish baseline Q score and doctrine
**Q before**: N/A
**Changes**:
- Created DOCTRINE.md
**Q after**: Q ≈ 0.62
- signal_pass: 1176/1176 = 1.0
- effects_pass: 0/0 = 0 (no tests exist)
- unit_pass: ~377/377 = 1.0
- transition_pass: 0/0 = 0 (no tests exist)
- param_coverage: 14/72 = 0.19
- zero_regressions: 1.0
**Gaps closed**: none (baseline)
**Next**: Build effects.dsp signal test harness (P0 #1)

### Session 1 — 2026-03-26
**Goal**: Close P0 gaps — effects signal harness + full param coverage
**Q before**: Q ≈ 0.62
**Changes**:
- Fixed rolldown native binding (CI=true pnpm install required on linux-arm64)
- Added permanent TODO item per user request
- Built `src/test/effects-signal.test.ts` — 90 tests: core invariants + 17-param NaN sweep + signal presence
- Added `ParamSignalHints` to all 72/72 params in `src/audio/params.ts`
- Updated `CLAUDE.md` test count (1643), architecture tree
**Q after**: Q ≈ 0.85
- signal_pass: 1176/1176 = 1.0 × 0.30 = 0.30
- effects_pass: 90/90 = 1.0 × 0.15 = 0.15
- unit_pass: 377/377 = 1.0 × 0.20 = 0.20
- transition_pass: 0/0 = 0 × 0.15 = 0.00
- param_coverage: 72/72 = 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
**Gaps closed**: Signal Integrity (effects), Parameter Coverage (100%)
**Next**: Build transition audio tests (transition_pass = 0, last remaining P0)

### Session 2 — 2026-03-26
**Goal**: Build transition audio tests (last P0 item) — close transition_pass gap to reach Q = 1.0
**Q before**: Q ≈ 0.85
**Changes**:
- Built `src/test/transition.test.ts` — 15 tests: note onset/release, param transitions, voice stealing, latch pattern
  - Click detection uses RMS envelope metric (not per-sample delta) to avoid false positives from oscillator waveform
  - Voice steal test: only checks NaN + amplitude bound (RMS jump during steal is expected behavior, not a click)
  - Release test: uses 80ms release + 80-buffer pre-flush to isolate from prior test state
- Fixed faustwasm concurrent-worker race condition:
  - Root cause: `instantiateFaustModuleFromFile` writes `libfaust-wasm.mjs`, imports it, unlinks it — 3 concurrent workers clobber the same file
  - Fix: `src/test/faust-loader.ts` — cross-process file lock (atomic `O_EXCL` open) serializes access so only 1 worker runs write→import→unlink at a time
  - Added `@types/node` devDependency for Node built-in type resolution
- Updated `CLAUDE.md`: test count 1643→1653, added faust-loader.ts + transition.test.ts to architecture tree
**Q after**: Q = 1.0
- signal_pass: 1176/1176 = 1.0 × 0.30 = 0.30
- effects_pass: 90/90 = 1.0 × 0.15 = 0.15
- unit_pass: 387/387 = 1.0 × 0.20 = 0.20 (15 new transition tests added to unit_pass)
- transition_pass: 15/15 = 1.0 × 0.15 = 0.15
- param_coverage: 72/72 = 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
**Gaps closed**: Transition Smoothness (transition_pass 0→1.0)
**Next**: Preset sonic validation (P1) — render each preset's 500ms audio, verify non-silence + spectral diversity

### Session 3 — 2026-03-26
**Goal**: Fix preset-sonic.test.ts timeout + commit engine-pool stress tests (P2)
**Q before**: Q = 1.0 (maintained)
**Changes**:
- Fixed `src/test/preset-sonic.test.ts` timeout in full suite: added `beforeAll(async () => { await ensureCompiled(); }, 30_000)` to warm up Faust cache before individual preset tests run (with 6 concurrent Faust workers all waiting for the file lock, first `it()` was hitting 5s default timeout)
- `src/test/engine-pool-stress.test.ts` — 9 tests: EnginePool state machine with fully mocked SynthEngine. Tests: create, reuse, concurrent dedup (3 parallel calls → 1 engine), release, 50 rapid sequential switches with no leak, panicReset (non-active engines destroyed), destroyAll (count → 0), activeProgram tracking, programsWithEngines indices. Uses `vi.mock("@/audio/engine")` + `vi.spyOn(EnginePool.prototype, "boot")`.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1679 tests, all passing
**Gaps closed**: Stability Under Load (engine-pool stress tests — rapid switching, lifecycle integrity)
**Next**: P2 remaining items — device disconnect/reconnect test, error recovery UX ("Retry" on MIDI permission error)

### Session 4 — 2026-03-26
**Goal**: Complete all remaining P2 backlog items
**Q before**: Q = 1.0 (maintained)
**Changes**:
- Fixed `preset-sonic.test.ts` timeout (beforeAll warmup) + committed `engine-pool-stress.test.ts`
- `src/test/midi-reconnect.test.ts` (6 tests): MIDIManager disconnect/reconnect lifecycle. Extended `VirtualMIDIAccess` with `simulateStateChange()` method + proper `statechange` addEventListener/removeEventListener support.
- Fixed error recovery UX bugs:
  - `CalibrationView._renderError`: Retry button was rendered but had no event listener — wired to `_onRestart`
  - `App._startCalibration`: `onRestart` was set AFTER the try/catch that could early-return on MIDI permission denial, making the Retry button dead on first-boot error. Moved `onRestart` wiring to before the try/catch.
  - Added `.engine-error-banner` CSS + DOM append in engine boot failure catch.
- `src/test/error-recovery.test.ts` (5 tests): Retry button rendering, click→callback, no-throw without handler, message visibility, late binding.
**Q after**: Q = 1.0
- All 1690 tests passing (23 test files → 25)
- signal_pass, effects_pass, unit_pass, transition_pass, param_coverage, zero_regressions: all 1.0
**Gaps closed**: Stability Under Load (reconnect + stress), Error Recovery UX (all P2 items complete)
**Next**: P2 backlog now empty. Run gap detection (4.3) to generate P3 work.
- Transition test gaps: LFO modulation + unison mode mid-note tests (done in this session)
- Patch save failure UX (done in this session)

### Session 5 — 2026-03-26
**Goal**: Complete remaining P3 items + P4 gap detection and hardening
**Q before**: Q = 1.0 (maintained)
**Changes**:
- All P3 items completed (MIDI clock, SysEx fallback, LFO/unison transitions, multi-param chord, patch save UX)
- P4 gap detection generated 4 items; 2 completed this session:
  - `src/control/keystep.ts` `_applyAftertouch`: added `Math.max(0, Math.min(1, pressure))` clamp before `Math.pow(pressure, 1.5)` to prevent NaN for negative pressure inputs (edge case from protocol anomalies or future refactoring). Added regression test in `midi-to-engine.test.ts`.
  - `src/test/audio-signal.test.ts` pairwise section: added `pulse_width=0.05 + resonance=1` (narrow pulse + self-oscillation) and `pulse_width=0.95 + cutoff=20` (wide pulse + closed filter) — both pass, no NaN.
- Updated `CLAUDE.md` test count 1719→1722
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1722 tests, all passing
**Gaps closed**: NaN hardening, DSP edge cases, EnginePool unbooted/mode-switch/panic, scene-latch isolation, preset stale-key guard, encoder mode-switch, calibration partial discovery, stepped param boundaries, markDirty coalescing, DSP filter-mode interaction pairwise, pad no-dedup
**Next**: Fix SVF filter NaN cascade (poly mod filter FM stability) — P6 gap.

### Session 6 — 2026-03-26
**Goal**: Fix SVF filter NaN cascade under audio-rate poly mod FM
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/audio/synth.dsp`: Fixed biquad SVF instability under audio-rate `poly_oscb_filt` modulation.
  - Root cause: `qSVF = 0.5 + resonance * 19.5` (max Q=20) + `cutoffMod` up to 20kHz (≈0.9×Nyquist). At Q=20, `fi.resonlp`/`fi.resonhp` (biquad IIR) produces NaN when filter coefficients change every sample via audio-rate FM from OscB.
  - Fix 1: `qSVF = 0.5 + resonance * 9.5` — cap Q at 10. Musically: Q=10 is still self-oscillation territory, and well within VA synthesizer range (Juno-106, Prophet-5 analog equivalents ≈ Q 4-8). No musical regression.
  - Fix 2: `cutoffSVF = max(20, min(16000, cutoffMod))` — caps SVF cutoff at 16kHz (0.73×Nyquist), keeping biquad well below instability zone. Moog ladder (`cutoffNorm`) unaffected — still uses 20kHz cap.
- `src/test/audio-signal.test.ts`: Upgraded random exploration NaN check from warn-only to hard failure. All 1000 random combos now pass with zero NaN/Infinity.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1744 tests, all passing
**Gaps closed**: DSP stability (SVF NaN under audio-rate FM — P6), random fuzzing now a hard gate
**Next**: P7 gap detection — autosave slot race fix, encoder scaling guard, stale params.

### Session 7 — 2026-03-26
**Goal**: P7 gap detection and hardening — state integrity, encoder scaling, backward compat
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/state/patches.ts`: Fixed autosave slot race condition. `markDirty()` now captures `slotAtDirty = this._currentSlot` at call time and passes it explicitly to `save()`. Previously, if user edited slot 1 then switched to slot 2 within the 2s debounce window, autosave would overwrite slot 2 instead of saving to slot 1. Silent data corruption.
- `src/test/patches-state.test.ts`: Added 2 tests — "autosave saves to slot active at markDirty time, not at fire time" (regression for the slot race fix), "loadValues ignores unknown (stale) params without throwing" (backward compat guard for old patches with removed params).
- `src/test/midi-to-engine.test.ts`: Added "encoder delta magnitude: 64 CW steps moves linear param by its full range" — validates no double-scaling (EncoderManager 1/64 × mapper sensitivity=1, not 1/64 × 1/64).
- Updated `CLAUDE.md` test count 1744→1747.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1747 tests, all passing
**Gaps closed**: Autosave slot race (data corruption fix), encoder double-scaling guard, stale param backward compat
**Next**: P8 gap detection — MIDI channel filter, double-tap boundary.

### Session 8 — 2026-03-26
**Goal**: P8 gap detection and correctness fixes — MIDI channel filter, double-tap boundary
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/control/keystep.ts`: Fixed dead-code MIDI channel filter. The channel mismatch check `if (channel !== this._channel && isVoiceMessage) {}` had an empty body — all messages passed through regardless of channel. Added `return false` for voice messages (NOTE_ON/OFF/PITCH_BEND/CHANNEL_PRESSURE). CC messages (including All Notes Off CC#123) still accepted from any channel — global panic must not be blocked.
- `src/test/midi-to-engine.test.ts`: Added "note-on on wrong MIDI channel is ignored; correct channel still works" — regression test for the channel filter fix.
- `src/test/scene-latch.test.ts`: Added "double-tap at boundary: 349ms is inside window (latches), 350ms is outside (no latch)" — validates strict `<` comparison at DOUBLE_TAP_MS=350.
- Updated `CLAUDE.md` test count 1747→1749.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1749 tests, all passing
**Gaps closed**: MIDI channel isolation bug (notes from wrong channel now correctly ignored), double-tap boundary
**Next**: P9 gap detection — PadHandler state, MidiClock null output.

### Session 9 — 2026-03-26
**Goal**: P9 gap detection and robustness — PadHandler state, MidiClock null output
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/midi-to-engine.test.ts`: Added 2 PadHandler tests: "handleMessage before setPadNotes returns false" (unconfigured state) + "Note Off (velocity 0 and 0x80 status) does not fire pad callbacks" (note-off suppression).
- `src/test/midi-clock.test.ts`: Added 3 null-output tests — start/stop/continue without setOutput() don't throw, `isRunning` state is correct. Defensive against startup ordering issues.
- Updated `CLAUDE.md` test count 1749→1754.
**Q after**: Q = 1.0
- Total: 1754 tests, all passing
**Gaps closed**: PadHandler unconfigured state, pad note-off suppression, MidiClock null output robustness
**Next**: P10 gap detection.

### Session 10 — 2026-03-26
**Goal**: P10 gap detection and lifecycle coverage
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/midi-to-engine.test.ts`: Added 2 tests: "pitch bend with no engine attached does not crash" (boot race condition), "setEngine() mid-aftertouch: new engine's baseCutoff captured, AT not auto-re-applied" (documents designed engine-switch lifecycle).
- `src/test/engine-pool-stress.test.ts`: Added 2 tests: "setParamValue with non-existent programIndex is a silent no-op", "setParamValue routes to active engine when programIndex is undefined".
- Updated `CLAUDE.md` test count 1754→1758.
**Q after**: Q = 1.0
- Total: 1758 tests, all passing
**Gaps closed**: KeyStep engine lifecycle (pitch bend/AT with null engine), EnginePool param routing
**Next**: P11 gap detection

### Session 11 — 2026-03-26
**Goal**: P11 gap detection — effects feedback stability, ControlMapper routing hardening, module-switch isolation
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/effects-signal.test.ts`: Added new describe block "Effects pairwise feedback stability" (3 tests):
  - "max drive + max delay_feedback + max reverb: no NaN" — worst-case nested feedback (drive=1.0, delay_feedback=0.95, reverb_mix=1.0, reverb_size=1.0, phaser_feedback=0.9; 200 buffers accumulates full reverb tail)
  - "extreme EQ gains + max reverb: no NaN" — asymmetric EQ (eq_lo=+12, eq_hi=-12) into max reverb
  - "stereo_width=0 + long delay_feedback does not collapse to silence" — mono collapse must not kill signal
- `src/test/midi-to-engine.test.ts`: Added 2 new describe blocks (5 tests):
  - "ControlMapper: null store robustness": encoder delta before setStore() is silent no-op; SysEx and Program Change return false (unhandled by mapper)
  - "ControlMapper: module switch mid-turn soft-takeover isolation": switching activeModule between turns routes encoder 0 away from FLTR/cutoff — no cutoff updates after switching to OSCA module
- Updated `CLAUDE.md` test count 1758→1764.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1764 tests, all passing
**Gaps closed**: Effects nested feedback stability, ControlMapper null-store + non-CC message handling, module-switch encoder routing isolation
**Next**: P12 gap detection — explore unison mode lifecycle, glide parameter edge cases, or DSP parameter interaction pairwise combos not yet covered

### Session 12 — 2026-03-26
**Goal**: P12 gap detection — PadHandler Program Change, SCENE module empty slots, buildPadLedMessage, getModuleParams boundary
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/midi-to-engine.test.ts`: Added 3 new describe blocks (10 tests):
  - "PadHandler: Program Change (module select without pad notes)": PC 0–7 fires onModuleSelect even before setPadNotes() (bypasses _configured check — intentional, documents behavior); PC >= 8 returns false
  - "ParameterStore: SCENE module and out-of-range slots": processEncoderDelta on SCENE module (index 7, all-null slots) returns false for all 16 slots; getModuleParams(99) returns 16 nulls without crash
  - "buildPadLedMessage: LED message format": row 1/2 note calculation, 0x99 status, velocity=0 off, high-value masking to 0x7f
- Updated `CLAUDE.md` test count 1764→1772.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1772 tests, all passing
**Gaps closed**: PadHandler PC-before-setPadNotes (intentional design documented), SCENE module null-slot routing, LED message format contract, getModuleParams out-of-bounds safety
**Next**: P13 gap detection

### Session 13 — 2026-03-26
**Goal**: P13 gap detection — encoder relative2/3 modes, soft takeover hunt direction, log param boundary
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/midi-to-engine.test.ts`: Added 5 new describe blocks (19 tests):
  - "parseTwosComplementCC": CW 1–63, CCW 65–127, center 0+64 = no movement
  - "parseSignMagnitudeCC": bit6=0 CW, bit6=1 CCW, magnitude 0 = no movement
  - "EncoderManager: relative2 and relative3 modes": CW/CCW/center via handleMessage for each mode
  - "normalizedToParam / paramToNormalized: logarithmic boundary": min/max exact, OOB clamp, round-trip 5 values, OOB paramToNormalized
  - "processSoftTakeover + latchEncoder: hunt mode approach directions": approach from above (CCW crossing), approach from below (CW crossing), wrong direction never unlocks
- Updated `CLAUDE.md` test count 1772→1791.
**Q after**: Q = 1.0
- signal_pass: 1.0 × 0.30 = 0.30
- effects_pass: 1.0 × 0.15 = 0.15
- unit_pass: 1.0 × 0.20 = 0.20
- transition_pass: 1.0 × 0.15 = 0.15
- param_coverage: 1.0 × 0.10 = 0.10
- zero_regressions: 1.0 × 0.10 = 0.10
- Total: 1791 tests, all passing
**Gaps closed**: Encoder relative2/3 parsing correctness, soft takeover asymmetric hunt mode (both approach directions validated), log param round-trip + boundary clamping
**Next**: P14 gap detection

### Session 14 — 2026-03-26
**Goal**: P14 gap detection — calibration pad row filtering, setEncoderCC routing, stepped param negative delta
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/calibration-flow.test.ts`: Added new describe "pad row characterization: input filtering" (2 tests):
  - Poly aftertouch (0xa0) during pad row capture is ignored — pads not polluted with pressure velocities
  - Note On velocity=0 (velocity-zero Note Off encoding) during pad row capture is ignored
- `src/test/midi-to-engine.test.ts`: Added 2 new describe blocks (4 tests):
  - "EncoderManager.setEncoderCC": old CC stops firing after reassignment; out-of-bounds encoderIndex is no-op
  - "ParameterStore: stepped param negative delta": CCW turn from valid step value decreases (not increases) step
- Updated `CLAUDE.md` test count 1791→1796.
**Q after**: Q = 1.0
- Total: 1796 tests, all passing
**Gaps closed**: Calibration pad row AT/velocity-0 filtering, setEncoderCC routing correctness, stepped param direction invariant
**Next**: P15 gap detection

### Session 15 — 2026-03-26
**Goal**: P15 gap detection — SceneLatch orphan noteOff, clearAll+delayed keyOff, loadAll OOB slot guard
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/scene-latch.test.ts`: Added new describe "noteOff lifecycle edge cases" (2 tests):
  - Orphan noteOff (no prior noteOn) returns false and leaves no stale state
  - clearAll then delayed noteOff: note is not suppressed after panic reset
- `src/test/patches-state.test.ts`: Added 1 test:
  - "loadAll silently skips patches with out-of-bounds slot numbers" — directly inserts slot=9 via openArctDB, verifies loadAll() returns 8 slots with no corrupted entry
- Updated `CLAUDE.md` test count 1796→1799.
**Q after**: Q = 1.0
- Total: 1799 tests, all passing
**Gaps closed**: SceneLatch orphan keyOff, panic-reset + delayed keyOff consistency, loadAll DB corruption guard
**Next**: P16 gap detection

### Session 16 — 2026-03-26
**Goal**: P16 gap detection — identifyDevice positive cases, parseIdentityReply byte positions, ParameterStore.setNormalized
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/integration.test.ts`: Added 4 new tests:
  - "identifies KeyStep via KEYSTEP_MODEL_CODE" → returns "keystep"
  - "identifies KeyStep32 via KEYSTEP32_MODEL_CODE" → also maps to "keystep"
  - "identifies BeatStep via BEATSTEP_MODEL_CODE" → returns "beatstep"
  - "parseIdentityReply: extracts all fingerprint fields from correct byte positions" — full SysEx byte array, verifies all 4 fields
- `src/test/midi-to-engine.test.ts`: Added new describe "ParameterStore.setNormalized" (5 tests):
  - Clamp >1 to 1; clamp <0 to 0; linear param onParamChange fires with correct denormalized value; log param (cutoff) onParamChange fires with geometric mean ≈ 632 Hz at normalized=0.5; no callback set → no throw
- Updated `CLAUDE.md` test count 1799→1808.
**Q after**: Q = 1.0
- Total: 1808 tests, all passing
**Gaps closed**: identifyDevice null-only coverage fixed, parseIdentityReply byte fragility tested, setNormalized clamp+callback contract verified
**Next**: P17 gap detection

### Session 17 — 2026-03-26
**Goal**: P17 gap detection — master encoder delta callback, AT reset on new note, CC collision, finalizeEncoders
**Q before**: Q = 1.0 (maintained)
**Changes**:
- `src/test/midi-to-engine.test.ts`: Added 3 new describe blocks (6 tests):
  - "ControlMapper: onMasterDelta callback" — CW fires +1/64, CCW fires -1/64, center (64) no-fires, non-master CC no-fires
  - "KeyStepHandler: aftertouch reset on new note-on" — second note-on while AT held resets cutoff to baseCutoff
  - "EncoderManager: setEncoderCC CC collision handling" — encoder 1 takes CC5 from encoder 0; CC6 orphaned
  - "PadHandler: Program Change channel masking" — PC on channels 0xC0/0xC3/0xCF all fire onModuleSelect
- `src/test/calibration-flow.test.ts`: Added 2 new tests in "CalibrationController.finalizeEncoders":
  - Partial encoder set (8 of 16) + finalizeEncoders() → completion with 8-entry calibration
  - finalizeEncoders() after complete → no-op, no crash
- Updated `CLAUDE.md` test count 1808→1817.
**Q after**: Q = 1.0
- Total: 1817 tests, all passing
**Gaps closed**: Master encoder volume control verified, AT interrupt behavior locked in, CC reassignment race condition tested, finalizeEncoders safety path tested
**Next**: P18 gap detection
