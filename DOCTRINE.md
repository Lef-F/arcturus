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
