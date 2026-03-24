# Signal Testing Framework

End-to-end audio verification for Arcturus. Compiles real Faust DSP to WASM,
sends MIDI events, computes audio buffers offline, and checks signal properties.

**No browser needed.** Runs on CI, Raspberry Pi, anywhere Node runs.

---

## How It Works

```
synthDspSource ──→ FaustCompiler ──→ WASM ──→ OfflineProcessor
                                                 │
                                           keyOn(pitch, vel)
                                                 │
                                           compute(buffers)
                                                 │
                                           ┌─────┴──────┐
                                           │  Assertions │
                                           │  peakAmp    │
                                           │  rmsAmp     │
                                           │  NaN check  │
                                           │  latency    │
                                           └─────────────┘
```

Uses `@grame/faustwasm`'s `FaustPolyDspGenerator.createOfflineProcessor()` which
wraps the compiled WASM in a compute-only interface — no AudioContext, no AudioWorklet.

**Important:** Call `proc.start()` before computing — the processor's `fProcessing` flag
defaults to `false`.

---

## Test Categories

### 1. Core Invariants
Basic sanity checks with default parameters:
- Note on → non-zero audio
- Note off → silence after release
- Attack latency < 2 buffers
- No NaN/Infinity
- Velocity sensitivity
- Polyphony (2 notes > 1 note)

### 2. Individual Param Sweep
Every DSP param tested at `min` and `max`:
- **Always:** no NaN/Infinity at boundary values
- **If no `canMuteOutput` or `maxLatency` hint:** also verifies sound is produced

This guarantees full single-parameter coverage — every param is exercised.

### 3. Pairwise Interactions
Hand-picked param pairs that commonly interact:
- `cutoff=20 + resonance=1` (extreme filter)
- `timbre=1 + mixer_drive=1` (wavefolder + saturation)
- `osc_sync=1 + oscb_pitch=24` (hard sync extreme)
- etc.

Verifies no NaN — doesn't assert sound (some combos legitimately silence).

### 4. Random Exploration
Seeded fuzzing: picks 3-6 "safe" params (no mute/latency hints),
randomizes values, plays a note, checks invariants.

`RANDOM_DEPTH` controls how many combos per run (default: 5).

---

## ParamSignalHints

Metadata on `SynthParam` that describes signal behavior. Lives in `src/types.ts`.

```typescript
interface ParamSignalHints {
  canMuteOutput?: boolean;    // at extreme values, can silence the output
  maxLatency?: number;        // seconds — tests compute extra buffers
  affectsSpectrum?: boolean;  // changes frequency content
  affectsAmplitude?: boolean; // changes loudness
  engineOnly?: boolean;       // not a Faust DSP param (e.g., voices, unison)
}
```

### Dual Use

These hints are not just for tests:

| Consumer | How It Uses Hints |
|----------|------------------|
| **Tests** | Skip "produces sound" for `canMuteOutput`; compute more buffers for `maxLatency`; exclude `engineOnly` from DSP tests |
| **UI** | Could show latency indicators, mute warnings, or group params by effect type |
| **Preset validation** | Flag presets where muting params are at extreme values |
| **Auto-documentation** | Generate param tables with behavior annotations |

### Adding Hints to a New Param

When you add a param to `SYNTH_PARAMS` in `params.ts`:

```typescript
my_param: {
  path: "my_param", label: "MyP",
  min: 0, max: 1, default: 0.5, scale: "linear",
  hints: { affectsSpectrum: true },  // ← add relevant hints
},
```

The signal tests will automatically pick it up:
- Individual sweep tests it at min/max
- If no `canMuteOutput`: also asserts it produces sound
- If `maxLatency`: computes extra buffers proportional to the value
- If `engineOnly`: skips DSP-level testing

---

## Running

```bash
pnpm test src/test/audio-signal.test.ts          # just signal tests
pnpm test                                         # all tests (includes signal)
```

Faust WASM compilation takes ~200ms on first run, then the compiler is cached.
Total signal test suite: ~1-2s for 150+ assertions.

---

## Environment

- **Vitest environment:** `node` (not happy-dom) — no DOM needed
- **Faust import:** Dynamic import of `@grame/faustwasm/dist/esm/index.js`
- **DSP source:** Imported via Vite's `?raw` transform
- **libfaust-wasm:** Loaded from `public/libfaust-wasm/` via filesystem (Node branch of `instantiateFaustModuleFromFile`)
