# Arcturus — Agent Development Instructions

You are building **Arcturus**, a browser-based virtual analog synthesizer controlled by Arturia hardware (KeyStep Standard + BeatStep Black Edition). You are an autonomous dev agent. You loop until the MVP is complete and best-in-class.

---

## How You Work

You operate in a **build → test → evaluate → improve** loop. Every iteration must produce working, tested code. You do not stop until:

1. All milestone tasks are complete.
2. All tests pass.
3. You have run your own improvement audit and found nothing actionable.

**You must read `IMPLEMENTATION.md` and `Arturia Synth Integration Research Plan.md` before writing any code.** These are your source of truth for architecture, design, and protocol details.

---

## Self-Management

### TODO List

You maintain `TODO.md` at the project root. This is your work queue. It has two sections:

#### Active Tasks

Ordered by priority. Each task has:
- `[ ]` / `[x]` checkbox
- Brief description
- Acceptance criteria (what "done" looks like)
- Blockers (if any)

When you complete a task, mark it `[x]`, add a one-line completion note with the date, and immediately pick the next unchecked task.

#### Permanent Tasks (Never Complete)

These tasks are **always unchecked**. They run after every milestone or when you run out of active tasks. They exist to force you into continuous improvement:

```markdown
## Permanent Tasks (run these repeatedly, never mark complete)

- [ ] **AUDIT: Test coverage** — Run all tests. Find untested code paths. Write tests for them. Target: every exported function has at least one test. Every user-facing flow has an integration test.

- [ ] **AUDIT: Type safety** — Run `pnpm typecheck`. Fix all errors. Then look for `any` types, type assertions (`as`), and non-null assertions (`!`). Replace with proper types or runtime checks. Target: zero `any` in production code.

- [ ] **AUDIT: Error handling** — Trace every async call, every hardware interaction, every IndexedDB operation. What happens when it fails? Does the user see a helpful message? Does the system recover gracefully? Add error handling where missing.

- [ ] **AUDIT: Performance** — Profile the audio path. Is the AudioWorklet render budget (<2.67ms at 48kHz) being respected? Are there unnecessary allocations in the hot path? Are DOM updates batched? Fix any issues found.

- [ ] **AUDIT: UX polish** — Open the app. Use it as a musician would (with the virtual MIDI test harness). Is the feedback instant? Are transitions smooth? Do encoder values feel responsive? Does the waveform display look good? Fix anything that feels off.

- [ ] **AUDIT: Code quality** — Run linter. Read through every file changed in the last milestone. Look for: dead code, duplicated logic, unclear naming, missing JSDoc on public APIs, functions longer than 40 lines. Refactor.

- [ ] **AUDIT: Documentation sync** — Read `IMPLEMENTATION.md`. Does it still match the code? Update any sections that have drifted. Check that TODO.md is current. Update PROGRESS.md.

- [ ] **AUDIT: Build & deploy** — Run `pnpm build`. Does it succeed? Is the output size reasonable? Test with `pnpm preview`. Does everything work with COOP/COEP headers? Fix any issues.
```

### Progress Log

You maintain `PROGRESS.md` at the project root. After completing each milestone (or significant sub-milestone), append an entry:

```markdown
## M1: Audio Engine Foundation — COMPLETE
**Date:** 2026-03-24
**What was built:** [bullet points]
**What was tested:** [bullet points]
**Known issues:** [bullet points or "None"]
**Next:** M2
```

This gives future agents (and humans) a clear history of what happened and when.

---

## Milestone Execution Order

Execute milestones in this order. Do not skip ahead. Each milestone must be fully tested before moving to the next.

### M0: Test Infrastructure (DO THIS FIRST)

Before writing any feature code, build the testing harness. You cannot test with real hardware, so you must simulate it.

**Build:**
- [ ] Install Vitest (`pnpm add -D vitest @vitest/coverage-v8 happy-dom`)
- [ ] Configure Vitest in `vite.config.ts` (environment: happy-dom for DOM tests)
- [ ] Create `src/test/` directory
- [ ] **Virtual MIDI Device** (`src/test/virtual-midi.ts`): A mock implementation of the Web MIDI API that simulates:
  - `MIDIAccess` with configurable input/output ports
  - A virtual KeyStep that responds to SysEx Identity Request with correct Arturia reply bytes
  - A virtual BeatStep that responds to SysEx Identity Request with correct Arturia reply bytes
  - Ability to simulate: note on/off, CC messages (relative mode), pitch bend, aftertouch, program change, transport messages
  - Ability to capture outgoing MIDI messages (clock, LED feedback)
- [ ] **Virtual Audio Context** (`src/test/virtual-audio.ts`): A minimal mock of AudioContext and AudioWorklet for unit testing the engine lifecycle without actual audio output
- [ ] **Test helpers** (`src/test/helpers.ts`):
  - `createTestMidiAccess()` — returns a virtual MIDI environment with both devices connected
  - `simulateEncoderTurn(encoderIndex, direction, speed)` — sends appropriate relative CC
  - `simulateNoteOn(note, velocity)` / `simulateNoteOff(note)`
  - `simulatePadPress(padIndex, velocity)`
  - `waitForMessage(output, predicate, timeout)` — promise that resolves when a matching MIDI message is sent
- [ ] **E2E test runner** (`src/test/e2e.ts`): A script that boots the full app with virtual MIDI, runs through the calibration flow, plays notes, turns encoders, and verifies audio engine responds. This is your smoke test — run it after every major change.
- [ ] Add scripts to `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:e2e": "vitest run src/test/e2e.ts"`, `"test:coverage": "vitest run --coverage"`

**Acceptance:** `pnpm test` runs and passes. Virtual MIDI devices respond to SysEx identity requests correctly. Encoder simulation produces correct relative CC bytes.

### M1: Audio Engine Foundation

**Read first:** IMPLEMENTATION.md § "Faust DSP Architecture", Research Plan § "The Audio Engine: Virtual Analog Modeling with Faust"

- [ ] Install `@grame/faustwasm`
- [ ] Write `src/audio/synth.dsp`: single-voice subtractive synth (saw oscillator → Moog ladder filter → ADSR envelope)
- [ ] Write `src/audio/effects.dsp`: overdrive → chorus → delay → reverb chain using Faust `effect` keyword
- [ ] Implement `src/audio/engine.ts`: compile Faust DSP to WASM, create AudioWorkletNode, expose `keyOn`/`keyOff`/`setParamValue`
- [ ] Implement `src/audio/params.ts`: parameter registry with value scaling (linear/logarithmic) and soft takeover logic
- [ ] Write tests: engine creates node, `keyOn` triggers a voice, `setParamValue` updates DSP, parameter scaling is correct
- [ ] Manual verification: `pnpm dev`, open browser, trigger a note via console → hear sound

**Acceptance:** A note plays through the full signal chain (osc → filter → env → effects → output). Parameter changes audibly affect the sound. Tests pass.

### M2: MIDI Input

**Read first:** IMPLEMENTATION.md § "MIDI Message Routing", Research Plan § "Hardware Fingerprinting", "MIDI Implementation Mapping"

- [ ] Implement `src/midi/manager.ts`: request MIDI access, enumerate ports, route messages to handlers
- [ ] Implement `src/midi/fingerprint.ts`: send SysEx identity request, parse reply, identify Arturia devices by manufacturer/model ID
- [ ] Implement `src/control/keystep.ts`: handle note on/off → engine.keyOn/keyOff, pitch bend → param, aftertouch → filter cutoff, transport → clock
- [ ] Implement `src/control/encoder.ts`: relative mode (Binary Offset) parsing, acceleration handling, value clamping with configurable sensitivity
- [ ] Implement `src/control/mapper.ts`: route BeatStep CC messages through encoder logic to Faust parameters using the mapping from `params.ts`
- [ ] Implement `src/control/pads.ts`: top row program change → patch load, bottom row note → triggers
- [ ] Write tests using virtual MIDI: full message flow from simulated hardware input to engine parameter change

**Acceptance:** Virtual KeyStep note → engine voice triggers. Virtual BeatStep encoder turn → parameter changes. All 16 encoders map correctly. Tests pass.

### M3: Calibration Flow

**Read first:** IMPLEMENTATION.md § "Calibration and Onboarding Flow"

- [ ] Implement `src/midi/calibration.ts`: full calibration sequence (permission → SysEx discovery → sequential knob-turn identification → encoder characterization → profile storage)
- [ ] Implement `src/state/db.ts`: IndexedDB schema (hardware_profiles, patches, config stores)
- [ ] Implement `src/state/hardware-map.ts`: persist/retrieve calibration profiles
- [ ] Implement `src/ui/calibration-view.ts`: step-by-step calibration UI (connect button → turn knob prompts → confirmation)
- [ ] Implement skip-calibration logic: detect stored profile, verify against connected hardware
- [ ] Write tests: full calibration flow with virtual MIDI, profile persists across "sessions"

**Acceptance:** First-run calibration completes with virtual devices. Second run skips calibration and restores profile. Profile correctly identifies device roles. Tests pass.

### M4: Clock & Polyphony

**Read first:** IMPLEMENTATION.md § "Clock Architecture", "Polyphony Strategy"

- [ ] Implement `src/midi/clock.ts`: AudioWorklet-driven master clock with lookahead scheduling, send 0xF8/0xFA/0xFC to hardware
- [ ] Upgrade Faust DSP to 8-voice polyphony (`declare nvoices "8"`, `freq`/`gain`/`gate` convention)
- [ ] Implement active voice limit (Encoder 16 controls max concurrent voices 1-8)
- [ ] Implement transport control: play/stop propagation between UI, clock, and hardware
- [ ] Write tests: clock tick timing accuracy (measure intervals), polyphony voice allocation (play chords, verify voice count), voice stealing (oldest note)

**Acceptance:** Multiple simultaneous notes play. Voice limit encoder restricts polyphony. Clock sends at correct BPM intervals. Transport start/stop works. Tests pass.

### M5: Effects Chain

**Read first:** IMPLEMENTATION.md § "Effects Chain Architecture"

- [ ] Complete Faust effect implementations: overdrive (cubicnl), chorus (fdelay+LFO), delay (echo, tempo-synced to clock), reverb (zita_rev1_stereo)
- [ ] Wire all effect parameters to Encoders 9-15 via the mapper
- [ ] Implement delay tempo sync (derive delay time from current BPM and note division)
- [ ] Implement dry/wet controls where applicable
- [ ] Write tests: each effect parameter responds to encoder changes, delay syncs to BPM changes

**Acceptance:** All four effects are audible and controllable. Delay syncs to clock. Encoder 9-15 each control their mapped effect parameter. Tests pass.

### M6: UI

**Read first:** IMPLEMENTATION.md § "UI Architecture", "Design System: Phosphor Observer (Evolved)"

- [ ] Implement Phosphor Observer design tokens in CSS (all colors, radii, typography from the spec)
- [ ] Implement `src/ui/components/encoder.ts`: SVG rotary encoder with arc indicator, label, value readout. OP-1-inspired circular design (rounded, inner shadow, gradient)
- [ ] Implement `src/ui/components/pad.ts`: pad with glow states (cyan=selected patch, green=triggered)
- [ ] Implement `src/ui/components/waveform.ts`: AnalyserNode oscilloscope in OLED-style inset
- [ ] Implement `src/ui/synth-view.ts`: BeatStep-shaped layout (8×2 encoder grid + 8×2 pad grid + waveform display + header with status)
- [ ] Implement `src/ui/config-view.ts`: hidden settings panel (Ctrl+, or Esc)
- [ ] Wire UI to state: encoder positions update when hardware turns knobs, pad LEDs reflect active patch/triggers
- [ ] Write tests: UI renders all 16 encoders and 16 pads, encoder value updates on simulated CC, pad glow toggles on simulated note

**Acceptance:** The synth view looks like the wireframe in IMPLEMENTATION.md. All 16 encoders and 16 pads render. Values update in real-time from virtual MIDI input. Waveform displays live audio. Design matches Phosphor Observer + OP-1 aesthetic. Tests pass.

### M7: Patches & State

**Read first:** IMPLEMENTATION.md § "State & Persistence"

- [ ] Implement `src/state/patches.ts`: CRUD operations, slot management (8 slots), autosave (debounced 2s)
- [ ] Implement patch load via BeatStep pad (Program Change from top row)
- [ ] Implement soft takeover on patch switch (encoder values latch when hardware passes through software value)
- [ ] Implement pad LED feedback: send Note On to BeatStep to light up active patch slot
- [ ] Implement config persistence (hidden menu settings saved to IndexedDB `config` store)
- [ ] Write tests: save patch, load patch, verify all parameters restore, autosave triggers after parameter change, soft takeover works correctly

**Acceptance:** Create a sound, switch to another slot, switch back — sound is preserved. Autosave persists across page reload. Soft takeover prevents parameter jumps. Pad LEDs indicate active slot. Tests pass.

### M8: Integration & Polish

- [ ] Full integration test: boot app → calibration → play notes → turn encoders → switch patches → verify everything works end-to-end
- [ ] Production build: `pnpm build` succeeds, output is reasonable size
- [ ] Preview server works with COOP/COEP headers
- [ ] Run ALL permanent audit tasks (see above)
- [ ] Fix everything found in audits
- [ ] Run permanent audit tasks AGAIN until clean

**Acceptance:** `pnpm build` succeeds. `pnpm preview` serves a working app. All tests pass. All audits are clean. The app is a complete, polished MVP.

---

## Rules

### Code Rules

1. **TypeScript strict mode.** No `any` in production code. No `@ts-ignore`.
2. **No dead code.** If you write something and don't use it, delete it.
3. **Test what you build.** Every module gets tests before you move to the next task.
4. **One concern per file.** Keep modules focused. If a file exceeds 300 lines, split it.
5. **Use the type system.** Types are in `src/types.ts`. Add new types there. Import them — don't duplicate.
6. **Faust DSP files** live in `src/audio/`. They are `.dsp` files compiled at runtime via `@grame/faustwasm`.
7. **CSS uses design tokens.** All colors, radii, and fonts come from CSS custom properties in `src/styles/main.css`. Do not hardcode values.
8. **No frameworks for UI.** Vanilla TypeScript + DOM API + Tailwind. No React, no Vue, no Lit. Keep it lean.
9. **Imports use `@/` alias.** e.g., `import { SynthParam } from "@/types"`.

### Process Rules

1. **Read before you write.** Before implementing a module, read the relevant sections of IMPLEMENTATION.md and the Research Plan.
2. **Test before you move on.** Run `pnpm test` after completing each task. Do not proceed to the next task if tests fail.
3. **Update TODO.md** as you work. Check off completed tasks. Add new tasks you discover. Keep it current.
4. **Update PROGRESS.md** after each milestone.
5. **Run permanent audits** after each milestone and when you run out of active tasks.
6. **Do not modify IMPLEMENTATION.md or the Research Plan** unless you find a factual error or impossibility. If you need to deviate from the spec, document the deviation and rationale in PROGRESS.md.
7. **Commit frequently.** Each completed task or logical unit of work gets its own commit with a conventional commit message.
8. **Do not over-engineer.** Build what the spec says. The permanent audits will catch quality issues — you don't need to gold-plate on the first pass.
9. **When stuck:** re-read the spec, check the test output, check the types. If truly blocked, document the blocker in TODO.md and move to the next unblocked task.

### Testing Rules

1. **Unit tests** go next to the module: `src/midi/manager.test.ts` tests `src/midi/manager.ts`.
2. **Integration tests** go in `src/test/`: `src/test/e2e.ts`, `src/test/calibration-flow.test.ts`, etc.
3. **Virtual MIDI is your hardware.** Every hardware interaction test uses the virtual MIDI harness. Never assume real hardware.
4. **Test behavior, not implementation.** Assert on outputs (MIDI messages sent, parameter values changed, DOM state) not on internal state.
5. **Audio tests** verify parameter paths exist and values propagate — they do not assert on audio output waveforms (that requires human ears or hardware).

---

## Quick Reference

```bash
pnpm dev          # Start dev server (localhost:5173, COOP/COEP enabled)
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run all tests
pnpm test:watch   # Run tests in watch mode
pnpm test:e2e     # Run end-to-end smoke test
pnpm test:coverage # Run tests with coverage report
pnpm typecheck    # TypeScript type check
pnpm lint         # ESLint
```

## File Map

```
AGENTS.md               ← You are here
IMPLEMENTATION.md        ← Architecture spec (source of truth)
Arturia Synth Integration Research Plan.md ← Hardware & protocol details
TODO.md                  ← Your work queue (you maintain this)
PROGRESS.md              ← Your completion log (you maintain this)
src/
├── main.ts              ← App entry point
├── types.ts             ← All shared types
├── styles/main.css      ← Design tokens + global styles
├── midi/                ← MIDI access, fingerprinting, calibration, clock
├── audio/               ← Faust DSP, engine lifecycle, parameter registry
├── control/             ← BeatStep encoders/pads, KeyStep, mapping layer
├── state/               ← IndexedDB, patches, hardware profiles, config
├── ui/                  ← Views (calibration, synth, config) + components
└── test/                ← Virtual MIDI, virtual audio, helpers, E2E tests
```

---

**Start with M0. Build the test harness. Then M1. Loop until done. Run audits. Loop again.**
