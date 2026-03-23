# Arcturus — Sound Engine Reference

> This is the living specification for Arcturus's synthesis architecture.
> Every module, every encoder slot, every parameter is defined here.
> Think of it as our Prophet-10 front panel, translated into software.
>
> For authoritative source research (parameter tables, hardware specs, source URLs),
> see `docs/SYNTH_RESEARCH.md`.

---

## Layout

```
┌──────────────────────── WAVEFORM ────────────────────────┐
│                                                           │
├───────────────────────────────────────────────────────────┤
│  E1   E2   E3   E4   E5   E6   E7   E8                   │
│  E9  E10  E11  E12  E13  E14  E15  E16  ← 16 encoders   │
├───────────────────────────────────────────────────────────┤
│ OSC  FLTR FENV AENV  LFO  MOD   FX  GLOB ← module pads  │
│  P1   P2   P3   P4   P5   P6   P7   P8  ← program pads  │
└───────────────────────────────────────────────────────────┘
```

- **Top row of pads** — module selectors: press to switch which module the 16 encoders control.
- **Bottom row of pads** — program selectors P1–P8: press to save/recall a full program (all modules).
- **16 encoders** — always display and control the active module's parameters.
- **Waveform** — live oscilloscope, always visible.

A **program** stores every parameter from every module. Switching programs jumps all encoders to the saved values.

---

## Synthesis Inspirations

Arcturus borrows with pride from five canonical synthesizers. Each contributed something irreplaceable.

| Synth | What We Took |
|-------|-------------|
| **Sequential Prophet-5 Rev4** | Core architecture: 2 ADSR envelopes (filter + amp), Poly Mod (FEnv/OscB → pitch/PW/filter), Vintage drift knob, dual filter character (SSM vs CEM) |
| **Roland Juno-106/60** | LFO Delay (vibrato fade-in), passive HPF before resonant LPF, BBD chorus anti-phase stereo topology, single shared ADSR as a constraint to explore |
| **Roland JP-8000** | Supersaw oscillator: 7 sawtooth waves with asymmetric detuning multipliers, free-running phase, Mix + Detune controls |
| **Oberheim SEM** | Continuous LP→Notch→HP filter sweep on a single encoder, 12dB filter slope option, ADS envelope mode (Decay = Release), pink noise |
| **Buchla Music Easel (208)** | Lopass Gate mode (filter + amp share one envelope with Vactrol-like decay), cross-FM wavefolder (Timbre), per-voice modulation oscillator concept |

---

## Module 1 — OSC (Oscillator)

The voice oscillator. Prophet-5 inspired: one primary oscillator per voice, 8-voice polyphonic.
All oscillators run at free-running phase (no phase reset on note trigger) — organic variation between keystrokes.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Wave | `waveform` | SAW / SQR / TRI / SIN | SAW | Stepped — 4 positions |
| E2 | Oct | `octave` | −2 / −1 / 0 / +1 / +2 | 0 | Stepped — octave shift |
| E3 | Tune | `detune` | −100¢ … +100¢ | 0¢ | Fine detune in cents |
| E4 | PW | `pulse_width` | 5% … 95% | 50% | Pulse width (SQR only) |
| E5 | Noise | `noise_level` | 0 … 100% | 0% | White noise blend (pink noise option planned) |
| E6–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E6: OSC B Level (0–100% blend)
- E7: OSC B Pitch (semitone offset from OSC A, ±24st)
- E8: OSC B Fine (±50¢)
- E9: OSC B Wave (SAW/SQR/TRI/SIN)
- E10: OSC B Lo-Freq (switch: converts OSC B to LFO range for per-voice Poly Mod)
- E11: Hard Sync (A→B)
- E12: Sub Oscillator Level (one octave below OSC A, square wave)
- E13: Supersaw Detune (0–100% spread across 7 saws, asymmetric JP-8000 multipliers)
- E14: Supersaw Mix (center saw vs. slave saw level ratio)
- E15: Wavefolder/Timbre (cross-FM harmonic enrichment, Buchla 208 style)
- E16: Noise Color (White / Pink — pink is −3dB/oct, softer, more musical)

**Supersaw implementation note:** Use asymmetric frequency multipliers from JP-8000 reverse engineering:
`[1.1077, 1.0633, 1.0204, 1.0000, 0.9811, 0.9382, 0.8908]`. Symmetric implementations sound wrong.
Free-running phase (no reset on trigger) is essential for the organic trance-pad quality.

---

## Module 2 — FLTR (Filter)

Moog Ladder filter (4-pole, −24 dB/octave). Self-oscillates at resonance = 100%.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Cut | `cutoff` | 20 Hz … 20 kHz | 8 kHz | Logarithmic |
| E2 | Res | `resonance` | 0 … 100% | 50% | Resonance; self-oscillates near max |
| E3 | FEnv | `fenv_amount` | −100% … +100% | +50% | Filter envelope depth, bipolar |
| E4–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E4: Key Track (0 / Half / Full — filter tracks keyboard pitch, Juno-106/Prophet-5 feature)
- E5: Vel→Cut (velocity sensitivity: higher velocity → more cutoff)
- E6: LFO→Cut (independent from global LFO routing, for dedicated filter wobble)
- E7: Filter Mode (LP→Notch→HP continuous sweep, **Oberheim SEM's signature feature** — single encoder sweeps through the full multimode spectrum)
- E8: Filter Slope (24dB / 12dB — 4-pole Moog vs 2-pole state-variable; 12dB is softer, allows more harmonic content through at resonance)
- E9: HPF Cut (passive stepped high-pass: Off / Low / Mid / High — Juno-106 topology, in series before the resonant LPF)
- E10: Audio Mod (OSC A → filter at audio rate, Prophet-5 feature — exponential FM through the 4-pole)

**Filter Mode detail (E7):** Oberheim SEM's defining feature. Not a stepped switch — a continuous encoder sweep:
- Full CCW = pure Lowpass
- Center = Notch (band-reject)
- Full CW = pure Highpass
- Intermediate positions = LP/Notch/HP blend with varying character

---

## Module 3 — FENV (Filter Envelope)

Dedicated ADSR envelope that drives the filter cutoff. Independent from the amp envelope.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Atk | `f_attack` | 1ms … 5s | 10ms | Log |
| E2 | Dec | `f_decay` | 1ms … 5s | 300ms | Log |
| E3 | Sus | `f_sustain` | 0 … 100% | 50% | |
| E4 | Rel | `f_release` | 1ms … 5s | 500ms | Log |
| E5–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E5: Vel→Depth (velocity controls envelope depth, Prophet-5 Rev4 feature)
- E6: Attack Curve (Linear / Exponential — exponential feels more natural)
- E7: Decay Curve
- E8: Mode (ADSR / ADS — **Oberheim SEM ADS mode**: the Decay knob also controls release time. Creates a distinctive plucky character where note release matches decay speed)
- E9: LPG Coupling (Buchla Lopass Gate mode: FENV linked to AENV with Vactrol-like response — filter and amp decay together as a single natural envelope, like an acoustic instrument)

---

## Module 4 — AENV (Amplifier Envelope)

ADSR envelope that shapes the amplitude of each voice. This determines the note's loudness contour.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Atk | `attack` | 1ms … 5s | 10ms | Log |
| E2 | Dec | `decay` | 1ms … 5s | 300ms | Log |
| E3 | Sus | `sustain` | 0 … 100% | 70% | |
| E4 | Rel | `release` | 1ms … 5s | 500ms | Log |
| E5–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E5: Vel→Amp (velocity sensitivity for amplitude, Prophet-5 Rev4 feature)
- E6: Attack Curve (Linear / Exponential)
- E7: Release Curve
- E8: Mode (ADSR / ADS — Decay = Release, Oberheim SEM ADS mode)

---

## Module 5 — LFO (Low Frequency Oscillator)

A single global LFO that routes to pitch and/or filter cutoff simultaneously.
Currently implemented as sine wave only. Juno-106 inspired routing.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Rate | `lfo_rate` | 0.01 Hz … 20 Hz | 1 Hz | Log |
| E2 | Depth | `lfo_depth` | 0 … 100% | 0% | Master depth scale |
| E3 | →Ptch | `lfo_to_pitch` | 0 … 100% | 0% | Vibrato: 100% = ±1 octave at depth=100% |
| E4 | →Fltr | `lfo_to_filter` | 0 … 100% | 0% | Filter wah: 100% = ±4 octaves at depth=100% |
| E5–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E5: Shape (SIN / TRI / SAW / SQR / S&H — Sample & Hold is the most distinctive: random stepped values, classic arpeggio character)
- E6: →PWM (LFO modulates pulse width — Juno-106 PWM mode)
- E7: →Amp (tremolo — LFO modulates amplitude)
- E8: Delay (fade-in time 0–3s — **Juno-106 feature**: LFO starts silent, then fades in. Essential for auto-vibrato without wobble on attack)
- E9: BPM Sync (OFF / tempo-locked divisions: 1/1, 1/2, 1/4, 1/8, 1/16, 1/32, 1/4T, 1/8T)

**LFO Delay note (Juno-106):** Rate 0.1–30Hz, Delay 0–3s. The delay is not just a fade — it specifies the onset time before the LFO even begins modulating. Fundamental for "vibrato only after the note has been held".

---

## Module 6 — MOD (Modulation)

Performance and modulation utilities. Inspired by the Prophet's Poly Mod, Pitch Wheel, and Glide sections.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Xpos | `transpose` | −24 … +24 semitones | 0 | Stepped — semitone steps |
| E2–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E2: Glide (0 = off, 1–100% = portamento speed — exponential pitch slide between notes)
- E3: Glide Mode (Legato-only / Always)
- E4: Bend Range (±1 … ±12 semitones)
- E5: Vel Curve (Linear / Soft / Hard / 7 options — Prophet-5 Rev4)
- E6: AT Dest (Aftertouch → LFO / Filter / Off — Prophet-5 Rev4)
- E9: PolyMod FEnv→Freq A (amount of filter envelope modulating OSC A pitch per-voice)
- E10: PolyMod FEnv→PW (filter envelope → OSC A pulse width per-voice)
- E11: PolyMod OscB→Freq A (OSC B audio rate → OSC A pitch: exponential FM per-voice)
- E12: PolyMod OscB→Filter (OSC B audio rate → filter cutoff: FM through 4-pole ladder)

**Poly Mod is the Prophet-5's most distinctive feature:** With OSC B in Lo-Freq mode + Poly Mod → Freq A, each voice gets an independent LFO with its own phase — true per-voice vibrato. At audio rates, OSC B → Filter creates inharmonic metallic tones fundamentally different from linear FM.

---

## Module 7 — FX (Effects Chain)

Post-voice signal processing: Overdrive → Chorus → Delay → Reverb → Master.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Driv | `drive` | 0 … 100% | 0% | Cubic soft-clip overdrive |
| E2 | ChRt | `chorus_rate` | 0.1 … 10 Hz | 1.5 Hz | Chorus LFO rate |
| E3 | ChDp | `chorus_depth` | 0 … 100% | 50% | Chorus modulation depth |
| E4 | DTim | `delay_time` | 10ms … 2s | 250ms | Log |
| E5 | DFbk | `delay_feedback` | 0 … 95% | 30% | |
| E6 | RvMx | `reverb_mix` | 0 … 100% | 30% | Wet/dry |
| E7 | RvDk | `reverb_damp` | 0 … 100% | 50% | High-frequency absorption |
| E8 | Vol | `master` | 0 … 100% | 80% | Master output volume |
| E9–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E9: Delay Sync (BPM-sync on/off + note division)
- E10: Reverb Size (room size / pre-delay)
- E11: Chorus Mode (I / II / I+II — Juno-60 BBD topology: Mode I = 0.5Hz, Mode II = 0.8Hz, I+II = ~1Hz lower depth. Anti-phase stereo LFO; left and right channels modulated 180° out of phase for width without mono comb-filtering)
- E12: Chorus Voices (2 / 3 / 4 tap BBD emulation)
- E13: Stereo Width
- E14: EQ Hi (high-shelf boost/cut)
- E15: EQ Lo (low-shelf boost/cut)

**BBD Chorus note (Juno-106/60):** The Juno uses 2× MN3009 256-stage BBD chips. Delay range ~0.64ms–12.8ms. Stereo anti-phase is the key: left and right channels use LFOs 180° out of phase. This creates width on the stereo bus but cancels out in mono — no comb filtering. Mode I+II (Juno-60 exclusive) is subtler: higher speed, far lower depth, different character.

---

## Module 8 — GLOB (Global)

Per-program global settings that affect the whole voice engine.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Voic | `voices` | 1 … 8 | 8 | Stepped — polyphony limit. Voice stealing: oldest note. |
| E2–E16 | — | — | — | — | *Reserved — see M2 plan below* |

**M2 additions:**
- E2: Unison (1 = off, 2–8 = voice stacking count)
- E3: Vintage (0 = perfect digital; 1–8 = analog instability scaling. **Prophet-5 Rev4 Vintage knob**: simultaneously scales oscillator pitch drift, envelope timing drift, and amp drift. Models the full analog circuit aging of each hardware revision — not just detuning, but timing and amplitude instability together.)
- E4: Unison Detune (spread between stacked voices)
- E5: Key Priority (Last / Low / High)
- E6: MIDI Channel (1–16 / ALL)
- E7: Master Tune (±50¢ — global reference pitch offset)

**Vintage knob detail:** Prophet-5 Rev4 positions: 4 = stable (modern spec), 3 = Rev3 instability level, 2 = Rev2, 1 = most temperamental vintage character. This is not a randomization knob — it models specific hardware generations. Arcturus should implement a continuous version (0–8) where the instability profile captures drift in all three domains simultaneously.

---

## Signal Flow

```
[MIDI / Keyboard / Pads]
        │
        ▼
  [Voice Engine — 8× polyphonic]
        │
  ┌─────┴──────────────────────────────────┐
  │  OSC A (wave + octave + detune + PW)   │
  │    + OSC B (detunable, lo-freq mode)   │
  │    + Sub Oscillator                    │
  │    + Noise (White / Pink)              │
  │         │                              │
  │  [Poly Mod: OscB → A pitch/PW]        │
  │         │                              │
  │       LFO → pitch mod (+ delay)        │
  │         │                              │
  │  FILTER (Moog Ladder 24dB or SV 12dB) │
  │    ← Filter Env (FENV)                │
  │    ← LFO → filter mod                 │
  │    ← Poly Mod: OscB/FEnv → filter     │
  │    ← Audio Mod (OSC A → filter FM)    │
  │         │                              │
  │  AMP × Amp Env (AENV)                 │
  │    [or LPG mode: FENV+AENV tied]      │
  └─────────┤                              │
            ▼                              │
  [Polyphonic mix → Overdrive]            │
            │                              │
  ┌─────────┴──────────────────────────── ┐│
  │  FX Chain (mono → stereo)            ││
  │  Chorus (BBD-style anti-phase)       ││
  │  → Delay (BPM-syncable)              ││
  │  → Reverb → Master Vol               ││
  └─────────────────────────────────────── ┘│
            │
        [OUTPUT]
```

---

## Programs

8 program slots, P1–P8. Each program stores the current value of every parameter across all 8 modules.

- **Selecting a program**: saves current state to active program, then loads the target.
- **Auto-save**: 2 seconds after any knob change, the current program is saved automatically.
- **Last-used program** persists across reloads (stored in localStorage).
- **Empty slot**: switching to an empty slot keeps current sound; the slot is populated on next save.

---

## Feature Roadmap (Priority Order)

From `SYNTH_RESEARCH.md` — ordered by musical impact and implementation feasibility.

### Tier 1 — M2 core (high impact, moderate DSP complexity)

1. **Supersaw** — JP-8000 asymmetric 7-saw detune, free-running phase, Mix + Detune → OSC E13/E14
2. **OSC B** — Prophet-5: second oscillator per voice, detunable, lo-freq mode → OSC E6–E10
3. **LFO shapes** — S&H is most distinctive; SIN/TRI/SAW/SQR/S&H → LFO E5
4. **Filter type: LP→Notch→HP sweep** — Oberheim SEM: continuous single-encoder multimode → FLTR E7
5. **Glide/Portamento** — all synths; legato mode → MOD E2/E3

### Tier 2 — M2 extended (high impact, higher DSP complexity)

6. **Poly Mod** — Prophet-5: FEnv → pitch/PW, OSC B → pitch/PW/filter → MOD E9–E12
7. **Vintage drift** — Prophet-5 Rev4: per-voice pitch/envelope/amp randomization → GLOB E3
8. **LFO Delay/Fade-in** — Juno-106: vibrato onset time → LFO E8
9. **LPG mode** — Buchla: filter + amp tied to single Vactrol-like envelope → FENV E9

### Tier 3 — Character features (M3)

10. **Wavefolder/Timbre** — Buchla cross-FM harmonic enrichment → OSC E15
11. **Pink noise** — Oberheim SEM: softer −3dB/oct noise → OSC E16
12. **Passive HPF** — Juno-106: 4-position stepped shelf before main filter → FLTR E9
13. **ADS envelope mode** — Oberheim SEM: Decay = Release → FENV E8 / AENV E8
14. **BBD chorus modes** — Juno-60: I / II / I+II anti-phase stereo → FX E11
15. **Dual filter character** — Prophet-5 Rev4: SSM vs CEM behavior per patch → FLTR

### Tier 4 — Future (M4+)

16. Hard Sync (Prophet-5, Oberheim SEM)
17. Ring Modulator (Buchla Mod Osc in AM/ring mode)
18. Velocity curves (7 options, Prophet-5 Rev4)
19. Aftertouch routing (Prophet-5 Rev4)
20. Unison with chord memory (Prophet-5)
21. Arpeggiator / step sequencer
22. Wavetable oscillator mode
23. MIDI CC learn
24. Browser-based patch sharing
