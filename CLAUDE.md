# Arcturus — Developer Reference

**Browser-based virtual analog synthesizer** controlled entirely by Arturia hardware:
- **KeyStep Standard** — notes, pitch bend, aftertouch, transport
- **BeatStep Black Edition** — 16 relative encoders (synthesis parameters) + 16 pads (module/program select)

No mouse required. The hardware IS the interface.

---

## Purpose

A hardware-first, software-rendered synthesizer. The goal is to feel like a real instrument:
every knob turn has immediate, musical effect; every program switch is smooth (soft takeover);
the sound is deep enough to get lost in.

Architecturally inspired by the Prophet-5, Juno-106, JP-8000, Oberheim SEM, and Buchla 208.
See `docs/SOUND_ENGINE.md` for the full synthesis reference and design decisions.
See `docs/SYNTH_RESEARCH.md` for primary-source hardware citations.

---

## Core Principles

### 1. Hardware-first, no frameworks
Vanilla TypeScript + DOM API. No React, Vue, or Lit. One concern per module.
CSS uses design tokens only — never hardcode colors, radii, or font sizes.
`@/` import alias maps to `src/`.

### 2. The store is the single source of truth
`ParameterStore` in `src/audio/params.ts` owns all parameter values and soft-takeover state.
Nothing else tracks parameter values independently.
- `onParamChange` is the app's concern — wire it in `app.ts`, never in `mapper.ts`
- Snapshots capture **all** params, including `voices`
- Patches round-trip through IndexedDB as `Record<string, number>` keyed by Faust path

### 3. The mapper is a routing layer only
`ControlMapper` translates MIDI CC → store delta. It holds no state.
It does not know about the engine, callbacks, or voice counting.
Encoder delta from `EncoderManager` is already scaled by `1/64`.
When calling `processParamDelta` directly from the mapper, use `sensitivity=1` (no double-scaling).

### 4. Additive mixing, not fake normalization
Hardware synthesizers sum signals additively and let the user manage levels.
OSC B blends as `oscA + oscB * oscb_level` — not divided by a normalization factor.

### 5. No dead code, no double-bookkeeping
If two code paths both update the same thing, one is wrong. Find it and delete it.
`buildEncoderMappings()` is the canonical example — removed because the module system superseded it.

### 6. No backwards compatibility, no legacy code
This is a dev-phase project. Never keep old fields, migration paths, compatibility shims,
or deprecated wrappers. When a pattern is superseded, delete the old code completely.
If IndexedDB schema changes, users recalibrate — don't write migration logic.

### 7. TypeScript strict mode, always
Zero `any` in production code. Zero `@ts-ignore`. Use the type system.
All shared types live in `src/types.ts`.

### 7. Test before you move on
`pnpm test` must pass before committing. `pnpm typecheck` and `pnpm lint` too.
Virtual MIDI is the hardware in tests — never assume a real device.
1758 tests total. Do not reduce this count without a good reason.

**Audio signal tests** compile real Faust WASM offline — no browser needed.
- `src/test/audio-signal.test.ts` — synth.dsp MIDI → DSP → audio (1176 tests)
- `src/test/effects-signal.test.ts` — effects.dsp mono processor sweep (90 tests)
- `src/test/transition.test.ts` — click-free transition validation (15 tests)
- `src/test/preset-sonic.test.ts` — factory preset audio + spectral diversity (9 tests)
- `src/test/faust-loader.ts` — shared loader with cross-process lock (used by all 4 above)
Uses `ParamSignalHints` metadata on `SynthParam` to drive test behavior.
All 72 params have `ParamSignalHints`. See `docs/SIGNAL_TESTING.md` for the framework reference.

---

## Architecture

```
src/
├── main.ts              — Entry point. Dev: installs fake controllers + seeds profiles.
├── types.ts             — All shared TypeScript types (SynthParam, SynthModule, …)
├── styles/main.css      — Design tokens + global styles (Phosphor Observer palette)
│
├── audio/
│   ├── synth.dsp        — Faust voice DSP (osc → filter → amp env). 8-voice polyphonic.
│   ├── effects.dsp      — Faust effects chain (overdrive → chorus → delay → reverb → master)
│   ├── engine.ts        — SynthEngine: Faust WASM compilation, AudioWorklet nodes, keyOn/keyOff
│   ├── engine-pool.ts   — EnginePool: manages multiple engines for independent sound layers
│   └── params.ts        — ★ Parameter registry. ALL params defined here. Soft takeover. ParameterStore.
│
├── midi/
│   ├── manager.ts       — Web MIDI access, port discovery, message routing
│   ├── fingerprint.ts   — SysEx identity request/reply, Arturia device identification
│   ├── calibration.ts   — First-run encoder-to-CC mapping discovery flow
│   └── clock.ts         — MIDI clock (BPM, tick, transport), delay tempo sync
│
├── control/
│   ├── encoder.ts       — Relative CC parsing, acceleration, EncoderManager
│   ├── mapper.ts        — Routes BeatStep CC → ParameterStore deltas. Routing only, no state.
│   ├── keystep.ts       — KeyStep note/bend/aftertouch/transport → engine
│   ├── pads.ts          — BeatStep pad → program change / note trigger
│   └── scene-latch.ts   — Per-program note latching (double-tap to latch/unlatch)
│
├── state/
│   ├── db.ts            — IndexedDB schema (hardware_profiles, patches, config stores)
│   ├── patches.ts       — PatchManager: CRUD, 8 slots, 2s debounced autosave
│   ├── factory-presets.ts — Default program patches (loaded on first run / empty slots)
│   ├── hardware-map.ts  — Persist/retrieve calibration profiles
│   └── config.ts        — App config (sampleRate, bufferSize, maxVoices) → IndexedDB
│
├── ui/
│   ├── app.ts           — Root component. Boot sequence. Wires all subsystems together.
│   ├── synth-view.ts    — Main synth layout (encoders + pads + waveform + header)
│   ├── calibration-view.ts — First-run calibration UI
│   ├── config-view.ts   — Hidden settings panel (Ctrl+,)
│   └── components/      — encoder.ts, pad.ts, waveform.ts, meter.ts (UI primitives)
│
├── dev/
│   └── fake-controllers.ts — Dev-mode keyboard→MIDI bridge + profile seeding
│
└── test/
    ├── virtual-midi.ts  — Mock Web MIDI API (virtual KeyStep + BeatStep with SysEx replies)
    ├── helpers.ts        — simulateEncoderTurn, simulateNoteOn/Off, waitForMessage, …
    ├── faust-loader.ts    — cross-process lock wrapper for LibFaust WASM loading
    ├── audio-signal.test.ts  — synth.dsp offline signal tests (1176 tests, param sweep)
    ├── effects-signal.test.ts — effects.dsp offline signal tests (90 tests, FX sweep)
    ├── transition.test.ts — click-free audio transition tests (15 tests)
    ├── preset-sonic.test.ts — factory preset non-silence + spectral diversity (9 tests)
    ├── latency.test.ts    — note-on onset latency < 10ms validation (4 tests)
    ├── perf.test.ts       — DSP CPU benchmark at 8 voices/48kHz (2 tests)
    ├── engine-pool-stress.test.ts — EnginePool lifecycle under rapid switching (9 tests)
    ├── midi-reconnect.test.ts — MIDIManager device disconnect/reconnect (6 tests)
    ├── error-recovery.test.ts — CalibrationView Retry button + error UX (5 tests)
    ├── midi-clock.test.ts     — MidiClock pulse accuracy + BPM drift (18 tests)
    ├── midi-to-engine.test.ts
    ├── patches-state.test.ts
    ├── integration.test.ts
    └── e2e.test.ts

docs/
├── SOUND_ENGINE.md      — ★ Living parameter reference. Module layout. Synth design decisions.
├── SYNTH_RESEARCH.md    — Primary-source hardware citations (Prophet-5, JP-8000, SEM, Juno, Buchla)
├── KeyStep_Manual_1_0_0_EN.pdf     — Arturia KeyStep Standard full manual
├── BeatStep_Manual_1_0_1_EN.pdf    — Arturia BeatStep Black Edition full manual
├── Sequential-Prophet-10_Users_Guide.pdf  — Prophet-10 reference for synthesis inspiration
└── [add more hardware/synth manuals here as found]
    ↳ Naming convention: <Manufacturer>_<Model>_<Version>_<Lang>.pdf
    ↳ Always cite in SYNTH_RESEARCH.md when a specific page or section is used
```

### Module system

8 modules × 16 encoder slots. Defined in `MODULES` array in `src/audio/params.ts`.
`getModuleParams(moduleIndex)` resolves slots to `SynthParam | null`.
Module layout: OSCA, OSCB, FLTR, ENV, MOD, FX, GLOB, SCENE.
The GLOB module (index 6) owns `voices`, `vintage`, `unison`, `unison_detune`.
The `unison` param also sets `engine.unison` in `app.ts` (engine-level voice stacking).

### Hardware mapping

All MIDI CC/note assignments come from a `HardwareMapping` object (defined in `src/types.ts`),
produced by calibration and stored in the `hardware_profiles` IndexedDB store.
Zero hardcoded MIDI values in production code. `ControlMapper`, `EncoderManager`, and
`PadHandler` all require explicit configuration — no factory defaults.

Tests use `TEST_HARDWARE_MAPPING` from `src/test/helpers.ts` (sequential CCs 1-16, notes 44-51/36-43).
Dev mode uses `DEV_MAPPING` in `src/dev/fake-controllers.ts` (same values).

### Signal flow

```
KeyStep → KeyStepHandler → EnginePool.getActiveEngine().keyOn/keyOff
BeatStep encoders → EncoderManager → ControlMapper → ParameterStore → store.onParamChange → active engine
BeatStep pads → PadHandler → PatchManager / SceneLatch / EnginePool
HardwareMapping → ControlMapper(encoders, masterCC) + PadHandler.setPadNotes(row1, row2)
```

### Multi-engine architecture

EnginePool manages one engine per latched program. WASM is compiled once at boot via
`SynthEngine.compileGenerators()`, then reused via `startFromGenerators()` for each new engine.

```
Engine 0 (P1 frozen): synthNode → fxNode ─┐
Engine 1 (P3 active): synthNode → fxNode ─┤→ masterGain → analyser → destination
Engine 2 (P5 frozen): synthNode → fxNode ─┘
```

- Active engine receives param changes + new notes
- Frozen engines keep their sound + latched notes independently
- Focusing a frozen engine makes it active (encoders control it)
- Unlatching destroys the frozen engine
- Master volume is global via `masterGain`

---

## Key Tooling

| Tool | Version | Purpose |
|------|---------|---------|
| **pnpm** | 10.18.0 | Package manager. Always use `pnpm`. Never `npm`. |
| **Vite** | 8.x | Dev server + bundler. COOP/COEP headers enabled (required for AudioWorklet). |
| **TypeScript** | 6.x | Strict mode. No `baseUrl` — use `paths` with `"./src/*"` directly. |
| **Faust** (`@grame/faustwasm`) | 0.15.x | DSP compilation. `.dsp` files imported as `?raw` strings. |
| **Vitest** | 4.x | Test runner. `happy-dom` for DOM tests, `fake-indexeddb` for IndexedDB. |
| **ESLint** | 10.x | `@typescript-eslint` plugin. Run after typecheck. |
| **Tailwind** | 4.x | Utility classes in HTML/templates. Design tokens in `main.css`. |
| **idb** | 8.x | Typed IndexedDB wrapper for patches/config/profiles. |

---

## Commands

```bash
pnpm dev            # Dev server at localhost:5173 (fake MIDI + seeded profiles)
pnpm build          # tsc + vite build
pnpm preview        # Preview production build (needs COOP/COEP headers)
pnpm typecheck      # tsc --noEmit (zero errors expected)
pnpm lint           # ESLint (zero warnings expected)
pnpm test           # Run all tests (1758 expected passing)
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage report
```

---

## Visual Design

**Aesthetic:** OP-1 × Serum hybrid. Warm, playful, rounded. Professional but not clinical.

**Palette:** Phosphor Observer — dark backgrounds, cyan primary (`#26fedc`), warm amber accents.
All design tokens in `src/styles/main.css`. Never hardcode a color outside this file.

---

## Things to Always Keep Up To Date

When you make changes, keep these files in sync:

| File | Update when… |
|------|-------------|
| **`CLAUDE.md`** (this file) | Architecture changes, new conventions, major refactors, new tooling |
| **`AGENTS.md`** | Milestones complete, process changes, file map changes, new rules emerge |
| **`docs/SOUND_ENGINE.md`** | Any parameter added/removed/renamed, module layout changes, DSP behavior changes |
| **`src/audio/params.ts`** | Any time `synth.dsp` or `effects.dsp` hslider paths change |
| **`src/types.ts`** | New shared types are introduced |
| **`src/styles/main.css`** | New design tokens needed |

| **`src/state/factory-presets.ts`** | Any parameter added/removed/renamed — presets must include all params |

`src/audio/params.ts` and `docs/SOUND_ENGINE.md` must always agree on parameter names,
ranges, defaults, and module slot assignments. They are two views of the same truth.
When adding a param, also add `ParamSignalHints` if applicable (see `docs/SIGNAL_TESTING.md`).

---

## Common Pitfalls

- **Never hardcode MIDI note/CC numbers.** All values come from `HardwareMapping`.
  BeatStep pad notes and encoder CCs vary by user configuration (MIDI Control Center).
  Tests use `TEST_HARDWARE_MAPPING`, dev mode uses `DEV_MAPPING`. Production code
  receives mapping from calibration — no fallbacks to "factory defaults".

- **Double-scaling encoder sensitivity.** `EncoderManager` already scales delta by `1/64`.
  If you call `processParamDelta(path, delta, sensitivity)` with the encoder's output as `delta`,
  pass `sensitivity=1`. Passing `1/64` again gives `1/4096` total — effectively broken for stepped params.

- **Snapshot excluding voices.** `voices` path is `"voices"` (not `"__voices"`). It IS saved with patches.
  Do not add exclusion filters back to `snapshot()`.

- **Wiring `store.onParamChange` in the wrong place.** This belongs in `app.ts` only.
  `ControlMapper.setStore()` must not touch `store.onParamChange`.

- **Faust keyword conflicts.** `waveform` is a reserved Faust word — use `wave_sel` as the
  variable name internally, but keep `hslider("waveform", ...)` for the param path.

- **BeatStep cannot respond to SysEx Identity Requests.** This is a hardware limitation.
  `manager.ts` runs a second pass after the SysEx timeout, identifying unassigned ports by name
  via `identifyByPortName()` in `fingerprint.ts`. Never rely on SysEx alone for BeatStep detection.

- **OscB is baseFreq-relative, not pitchModFreq-relative.** Changed from the original to avoid a
  circular dependency in the Faust signal graph (poly mod routes oscB → pitchModFreq, so oscB
  cannot depend on pitchModFreq). OscB tracks keyboard pitch independently; LFO vibrato does not
  modulate OscB's frequency.

- **`os.hs_phasor` creates phantom inputs.** Do NOT use `os.hs_phasor` from stdfaust.lib —
  it creates 3+ phantom signal inputs that break Faust polyphonic voice allocation (voices
  produce silence). Use the inline feedback phasor instead:
  `(+(f/ma.SR) : ma.frac) ~ (*(1.0 - syncTrig))`.

- **`fi.resonlp`/`fi.resonhp` require 3 args.** `fi.resonlp(fc, Q, gain)` — the `gain`
  parameter is required. Missing it causes a "number of inputs" compilation error. Use `gain=1`
  for unity gain.

- **Filter graph duplication causes OOM.** Using `hpfOut` in multiple filter paths (Moog + SVF LP
  + SVF HP) without `<:` split causes Faust to duplicate the entire upstream graph per path,
  creating 42+ phantom inputs and crashing `createNode`. Always use `hpfOut <: filter1, filter2,
  filter3 : combiner` to split the signal once.

- **Factory presets must stay in sync with params.** When adding/removing/renaming parameters,
  update `src/state/factory-presets.ts` to include the new params in preset patches. Missing
  params will fall back to defaults, which may not be musically appropriate for the preset.

- **Unison mode is engine + DSP.** `unison` toggles voice stacking in `engine.ts` (multiple
  keyOn events for one note) AND per-voice random detune in `synth.dsp` (via `ba.sAndH` on
  noise at gate trigger). Both sides must be wired for the feature to work.

- **COOP/COEP headers required.** `SharedArrayBuffer` (used by Faust WASM) needs cross-origin
  isolation. The Vite config sets these headers. Do not remove them.
