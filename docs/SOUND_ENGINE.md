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
│ OSCA OSCB FLTR  ENV  MOD   FX  GLOB AUX  ← module pads  │
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
| **Sequential Prophet-5 Rev4** | Core architecture: 2 ADSR envelopes (filter + amp), Poly Mod (FEnv/OscB → pitch/PW/filter), Vintage drift knob, exponential envelope curves, mixer saturation (gain staging), velocity sensitivity, unison mode |
| **Roland Juno-106/60** | LFO Delay (vibrato fade-in), passive HPF before resonant LPF, BBD chorus anti-phase stereo topology |
| **Roland JP-8000** | Supersaw oscillator: 7 sawtooth waves with asymmetric detuning multipliers, free-running phase, Mix + Detune controls |
| **Oberheim SEM** | Continuous LP→Notch→HP filter sweep on a single encoder, ADS envelope mode (Decay = Release), pink noise |
| **Buchla Music Easel (208)** | Lopass Gate mode (filter + amp share one envelope with Vactrol-like decay), cross-FM wavefolder (Timbre) |

---

## Module 1 — OSCA (Oscillator A)

Primary oscillator per voice, 8-voice polyphonic.
All oscillators run at free-running phase (no phase reset on note trigger) — organic variation between keystrokes.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Wave | `waveform` | SAW / SQR / TRI / SIN / SUPER | SAW | Stepped — 5 positions |
| E2 | Oct | `octave` | −2 / −1 / 0 / +1 / +2 | 0 | Stepped — octave shift |
| E3 | Tune | `detune` | −100¢ … +100¢ | 0¢ | Fine detune in cents |
| E4 | PW | `pulse_width` | 5% … 95% | 50% | Pulse width (SQR waveform + poly mod target) |
| E5 | SDtn | `supersaw_detune` | 0 … 100% | 0% | JP-8000 asymmetric 7-saw spread |
| E6 | SMix | `supersaw_mix` | 0 … 100% | 50% | Center vs. slave saw balance |
| E7 | Sync | `osc_sync` | OFF / ON | OFF | Hard sync: OscB resets OscA phase on each cycle |
| E8 | Timb | `timbre` | 0 … 100% | 0% | Buchla wavefolder: 0=dry, 100=fully folded harmonics |
| E9–E16 | — | — | — | — | Reserved |

**Hard Sync (E7):** OscB acts as the sync source. OscA's phasor is reset to 0 on every OscB cycle wrap (detected by rising edge). With `osc_sync=ON` and OscB detuned above OscA, turning OscA frequency up sweeps through classic sync harmonics. OscB is baseFreq-relative (independent of LFO vibrato) to enable FM/sync without circular dependencies.

**Wavefolder / Timbre (E8):** Buchla 208-inspired sine wavefolder. At `timbre=0`: dry signal. At `timbre=1`: the oscillator output is mapped through `sin(π × x × 4)`, creating rich odd and even harmonics. Applied pre-filter so the filter shapes the folded spectrum.

**Supersaw implementation note:** Use asymmetric frequency multipliers from JP-8000 reverse engineering:
`[1.1077, 1.0633, 1.0204, 1.0000, 0.9811, 0.9382, 0.8908]`. Free-running phase (no reset on trigger) is essential for the organic trance-pad quality.

---

## Module 2 — OSCB (Oscillator B + Noise + Mixer)

Second oscillator, noise source, and pre-filter mixer saturation. Layering sources.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | BLvl | `oscb_level` | 0 … 100% | 0% | OSC B blend level |
| E2 | BWav | `oscb_wave` | SAW / SQR / TRI / SIN | SAW | OSC B waveform |
| E3 | BPch | `oscb_pitch` | ±24 semitones | 0 | Semitone offset from OSC A |
| E4 | BFne | `oscb_fine` | ±50¢ | 0¢ | Fine detune OSC B |
| E5 | Noise | `noise_level` | 0 … 100% | 0% | Noise blend level |
| E6 | NCol | `noise_color` | White / Pink | White | Noise spectrum: White=flat, Pink=−3dB/oct |
| E7 | MDrv | `mixer_drive` | 0 … 100% | 0% | Pre-filter saturation (Prophet-5 gain staging) |
| E8–E16 | — | — | — | — | Reserved |

**Mixer Drive (E7):** Prophet-5 style gain staging. At `mixer_drive=0`: clean pass-through. At `mixer_drive=1`: tanh soft-clip on the combined oscillator+noise output. Calibrated so at 50% levels the signal is clean; at 100% it overdrives the filter input, adding warmth and compression. This is distinct from the post-FX overdrive in the FX module.

---

## Module 3 — FLTR (Filter)

Moog Ladder filter (4-pole, −24 dB/octave). Self-oscillates at resonance = 100%.
Crossfades to an Oberheim SEM-inspired multimode SVF as `filter_mode` increases above 0.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Cut | `cutoff` | 20 Hz … 20 kHz | 8 kHz | Logarithmic |
| E2 | Res | `resonance` | 0 … 100% | 50% | Resonance; self-oscillates near max (Moog) |
| E3 | FEnv | `fenv_amount` | −100% … +100% | +50% | Filter envelope depth, bipolar |
| E4 | FMod | `filter_mode` | 0 … 1 | 0 (LP) | LP → Notch → HP continuous sweep (Oberheim SEM) |
| E5 | KTrk | `key_track` | OFF / HALF / FULL | OFF | Keyboard tracking: cutoff follows note pitch (C3=neutral) |
| E6 | V→F | `vel_to_cutoff` | 0 … 100% | 0% | Velocity → filter cutoff: 100% = +2 octaves at max velocity |
| E7 | HPF | `hpf_cutoff` | OFF / 18Hz / 59Hz / 185Hz | OFF | Passive HPF before main filter (Juno-106) |
| E8–E16 | — | — | — | — | Reserved |

**Key Track (E5):** `cutoff × pow(freq/261.63, key_track)` — C3 (261.63 Hz) is the neutral point. At FULL=1.0, perfect keyboard tracking (Prophet-5/Juno-106 behavior).

**Velocity → Filter (E6):** Up to +2 octaves of cutoff modulation at full velocity. Works multiplicatively with FENV, LFO, and key tracking.

**Passive HPF (E7):** Juno-106 style high-pass filter applied before the main resonant LPF. Strips sub-bass to tighten low end. Four stepped positions: OFF (1Hz bypass), 18Hz, 59Hz, 185Hz. Uses `fi.dcblockerat` for a lightweight 1-pole implementation.

**Filter Mode (E4):** Oberheim SEM-style continuous sweep:
- Full CCW = pure Moog Ladder LP (24dB, warm, self-oscillating)
- Center = Notch (band-reject)
- Full CW = pure Highpass

---

## Module 4 — ENV (Envelopes)

Both envelopes side-by-side: Filter ADSR (E1–E6), Amp ADSR (E9–E15).
Reduces module switching — tweak both envelopes without changing pages.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| **Filter Envelope** | | | | | |
| E1 | Atk | `f_attack` | 1ms … 5s | 10ms | Log |
| E2 | Dec | `f_decay` | 1ms … 5s | 300ms | Log |
| E3 | Sus | `f_sustain` | 0 … 100% | 50% | |
| E4 | Rel | `f_release` | 1ms … 5s | 500ms | Log |
| E5 | Mode | `fenv_mode` | ADSR / ADS | ADSR | ADS: Decay = Release (Oberheim SEM) |
| E6 | Curv | `fenv_curve` | 0 … 100% | 50% | Envelope curve: 0=linear, 100=steep exponential |
| E7–E8 | — | — | — | — | Reserved (visual row break) |
| **Amp Envelope** | | | | | |
| E9 | Atk | `attack` | 1ms … 5s | 10ms | Log |
| E10 | Dec | `decay` | 1ms … 5s | 300ms | Log |
| E11 | Sus | `sustain` | 0 … 100% | 70% | |
| E12 | Rel | `release` | 1ms … 5s | 500ms | Log |
| E13 | Mode | `aenv_mode` | ADSR / ADS | ADSR | ADS: Decay = Release (Oberheim SEM) |
| E14 | Curv | `aenv_curve` | 0 … 100% | 50% | Envelope curve: 0=linear, 100=steep exponential |
| E15 | V→A | `vel_to_amp` | 0 … 100% | 0% | Velocity → amplitude sensitivity |
| E16 | LPG | `lpg_amount` | 0 … 100% | 0% | Buchla Vactrol coupling: amp follows filter env |

**Envelope Curves (E6, E14):** Prophet-5 inspired. At `curve=0`: linear ADSR (digital, predictable). At `curve=1`: steep exponential `pow(env, 3)` — fast attack that decelerates, snappy decay/release. The Prophet-5's signature "snap" comes from this exponential shaping. Default 0.5 gives a moderate exponential character. Applied via `envShape(env, curve) = env*(1-curve) + pow(env, 1+curve*2)*curve`.

**ADS Mode (E5, E13):** Oberheim SEM envelope character. Release follows the Decay setting — one knob controls both. Creates distinctive plucky sounds. Combining FENV and AENV in ADS simultaneously creates classic "one-envelope" sounds.

**Velocity → Amp (E15):** `gainMod = (1 − vel_to_amp) + vel_to_amp × velocity`. At 0: fixed full volume. At 1: full velocity control. Useful around 0.5–0.7 for natural feel.

**LPG Coupling (E16):** Buchla Music Easel 208-inspired Lopass Gate mode. At `lpg_amount=0`: standard amp envelope operates independently. At `lpg_amount=1`: amplitude tracks the filter envelope — timbre and loudness gate together as one organic gesture (Vactrol-like behavior). Blend: `ampFinal = ampEnv*(1-lpg) + filterEnv*gainMod*lpg`. Works beautifully with the filter's percussive decay for plucked or struck timbres.

**Vintage Envelope Timing Drift:** When `vintage > 0`, attack time varies per voice by ±5ms (independent noise source per voice). This widens chords and makes pads feel more alive.

---

## Module 5 — MOD (Modulation)

All modulation in one place. LFO (E1–E8) + Poly Mod (E9–E13) + Performance (E14–E15).

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| **LFO** | | | | | |
| E1 | Rate | `lfo_rate` | 0.01 Hz … 20 Hz | 1 Hz | Log |
| E2 | Dpth | `lfo_depth` | 0 … 100% | 0% | Master depth scale |
| E3 | Shpe | `lfo_shape` | SIN / TRI / SAW / SQR / S&H | SIN | |
| E4 | Dlay | `lfo_delay` | 0s … 3s | 0s | Fade-in onset |
| E5 | →Pch | `lfo_to_pitch` | 0 … 100% | 0% | Vibrato |
| E6 | →Flt | `lfo_to_filter` | 0 … 100% | 0% | Filter wah |
| E7 | →PW | `lfo_to_pw` | 0 … 100% | 0% | PWM depth |
| E8 | →Amp | `lfo_to_amp` | 0 … 100% | 0% | Tremolo |
| **Poly Mod** | | | | | |
| E9 | FE→P | `poly_fenv_freq` | 0 … 100% | 0% | Filter Env → OscA pitch FM |
| E10 | FE→W | `poly_fenv_pw` | 0 … 100% | 0% | Filter Env → OscA pulse width |
| E11 | B→Pt | `poly_oscb_freq` | −100% … +100% | 0% | OscB → OscA pitch FM (bipolar) |
| E12 | B→PW | `poly_oscb_pw` | 0 … 100% | 0% | OscB → OscA pulse width |
| E13 | B→Ft | `poly_oscb_filt` | −100% … +100% | 0% | OscB → filter cutoff FM (bipolar) |
| **Performance** | | | | | |
| E14 | Xpos | `transpose` | −24 … +24 semitones | 0 | Stepped semitone |
| E15 | Glid | `glide` | 1ms … 3s | off (1ms) | Portamento; bypassed below 5ms |
| E16 | — | — | — | — | Reserved |

### Poly Mod (E9–E13)

Prophet-5 signature. Routes the filter envelope and OSC B audio to modulate OSC A pitch, pulse width, and filter cutoff. Per-voice modulations.

**OscB is baseFreq-relative** (not pitchModFreq-relative): its frequency tracks the keyboard note independently of LFO vibrato. Avoids circular dependencies and matches Prophet-5 hardware.

---

## Module 6 — FX (Effects Chain)

Post-voice signal processing: Overdrive → Phaser → Chorus (stereo) → Delay → Reverb → EQ → Stereo Width → Master.

All 16 encoder slots are filled across 4 quadrants. Master volume is controlled by the dedicated BeatStep large encoder (not in this module).

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| **Q1 — Overdrive + Phaser** |
| E1 | Driv | `drive` | 0 … 100% | 0% | Cubic soft-clip pre-chorus overdrive |
| E2 | PhRt | `phaser_rate` | 0.1 … 5 Hz | 0.5 Hz | Phaser LFO rate (log) |
| E3 | PhDp | `phaser_depth` | 0 … 100% | 0% | Phaser depth (0 = bypass) |
| E4 | PhFb | `phaser_feedback` | 0 … 90% | 0% | Phaser resonance / notch depth |
| **Q2 — Chorus + Stereo Width** |
| E5 | ChMd | `chorus_mode` | Custom / Juno-I / Juno-II / Juno-I+II | Custom | BBD chorus mode |
| E6 | ChRt | `chorus_rate` | 0.1 … 10 Hz | 1.5 Hz | Chorus LFO rate (Custom mode) |
| E7 | ChDp | `chorus_depth` | 0 … 100% | 50% | Chorus depth (Custom mode) |
| E8 | Wdth | `stereo_width` | 0 … 200% | 100% | M/S matrix: 0=mono, 100=original, 200=hyper-wide |
| **Q3 — Delay** |
| E9 | DTim | `delay_time` | 10ms … 2s | 250ms | Log |
| E10 | DFbk | `delay_feedback` | 0 … 95% | 30% | |
| E11 | DMod | `delay_mod` | 0 … 100% | 0% | Tape flutter depth (±10ms LFO modulation) |
| E12 | EQLo | `eq_lo` | −12 … +12 dB | 0 dB | Low shelf at 200 Hz |
| **Q4 — Reverb + High EQ** |
| E13 | RvMx | `reverb_mix` | 0 … 100% | 30% | Wet/dry |
| E14 | RvDk | `reverb_damp` | 0 … 100% | 50% | High-frequency absorption |
| E15 | RvSz | `reverb_size` | 0 … 100% | 50% | Comb delay scaling: 0=tight room, 100=cathedral |
| E16 | EQHi | `eq_hi` | −12 … +12 dB | 0 dB | High shelf at 5 kHz |

**Phaser (E2–E4):** 4-stage first-order allpass chain with LFO-swept coefficient. Feedback (E4) deepens notches by feeding the allpass output back to the input summing junction. At `phaser_depth=0` the phaser is fully bypassed.

**BBD Chorus modes (E5):** Juno-60 BBD topology with anti-phase stereo LFOs.
- **Custom (0)**: uses `chorus_rate` and `chorus_depth` freely.
- **Juno-I (1)**: 0.5 Hz, 15ms depth. Classic lush chorus.
- **Juno-II (2)**: 0.83 Hz, 12ms depth. Faster, tighter.
- **Juno-I+II (3)**: Blends both LFOs. Juno-60 exclusive mode.

**Stereo Width (E8):** M/S matrix processing. At 100% (default): original stereo. Below 100%: converges toward mono. Above 100%: doubles the side signal for hyper-wide headphone mixes. Formula: L′ = M + S×w, R′ = M − S×w.

**Delay Mod (E11):** Tape flutter simulation. A slow triangle LFO (~0.3 Hz) modulates the delay time by up to ±10ms, adding the subtle pitch drift character of vintage tape delay machines.

**Reverb Size (E15):** Scales all four Schroeder comb delay times together (0.3× to 2.0× of base values). Shorter = tight studio room. Longer = cathedral. Combined with `reverb_damp` and `reverb_mix` for full spatial control.

**EQ (E12, E16):** First-order Butterworth shelving filters. LP+HP sum to unity at 0 dB — transparent when flat. Low shelf at 200 Hz; high shelf at 5 kHz.

---

## Module 7 — GLOB (Global)

Per-program global settings that affect the whole voice engine.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Voic | `voices` | 1 … 8 | 8 | Stepped — polyphony limit. Voice stealing: oldest note. |
| E2 | Vntg | `vintage` | 0 … 1 | 0 | Per-voice analog drift intensity (5 steps) |
| E3 | Uni | `unison` | OFF / ON | OFF | Unison mode: stack all voices on one note |
| E4 | UDtn | `unison_detune` | 0 … 50¢ | 0¢ | Unison voice spread in cents |
| E5–E16 | — | — | — | — | Reserved |

### Vintage Drift (E2)

Each polyphonic Faust DSP instance has independent `no.noise` per voice. A slow smoothing filter (τ ≈ 2s) creates glacially slow random wander:

- **Pitch drift:** ±7 cents at vintage=1
- **Filter drift:** ±12% cutoff shift at vintage=1
- **Envelope timing drift:** ±5ms attack variation per voice (independent noise source)

Inspired by the Prophet-5 Rev4 Vintage knob.

### Unison Mode (E3–E4)

When `unison=ON`, every keypress stacks all `voices` voices on the same MIDI pitch. Each voice gets a unique random detune offset sampled at note-on via `ba.sAndH(gateTrig, no.noise)`, spread symmetrically within ±`unison_detune/2` cents. Combined with Vintage drift, this creates massive detuned leads and basses.

Engine-level implementation: `keyOn` triggers `maxVoices` keyOn events for the same pitch. `keyOff` releases all stacked voices. The DSP handles detuning per-voice automatically.

---

## Module 8 — AUX (Reserved)

Reserved for future expansion. All encoder slots empty.
Candidates: arpeggiator, aftertouch routing, wavetable mode, MIDI CC learn.

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
  │    + OSC B (detunable)                 │
  │    + Noise (White / Pink)              │
  │         │                              │
  │  [Wavefolder — Buchla Timbre]          │
  │         │                              │
  │  [Mixer Saturation — Prophet-5]        │
  │         │                              │
  │  [Poly Mod: OscB → A pitch/PW]        │
  │         │                              │
  │       LFO → pitch mod (+ delay)        │
  │         │                              │
  │  [Passive HPF — Juno-106]             │
  │         │                              │
  │  FILTER (Moog Ladder ↔ SEM SVF)       │
  │    ← Filter Env (curved + ADS mode)   │
  │    ← LFO → filter mod                 │
  │    ← Poly Mod: OscB/FEnv → filter     │
  │    ← Velocity → cutoff                │
  │    ← Key tracking                     │
  │         │                              │
  │  AMP × Amp Env (curved + ADS mode)    │
  │    × Velocity sensitivity              │
  │    × LFO tremolo                       │
  │    ← LPG coupling (E16 blends FEnv)   │
  └─────────┤                              │
            ▼                              │
  [Polyphonic mix]
            │
  ┌─────────┴────────────────────────────┐
  │  FX Chain (mono → stereo)           │
  │  → Overdrive (cubic soft-clip)      │
  │  → Phaser (4-stage allpass + LFO)   │
  │  → Chorus (BBD anti-phase stereo)   │
  │  → Delay (tape flutter)             │
  │  → Reverb (size + damp)             │
  │  → EQ (lo/hi shelves)               │
  │  → Stereo Width (M/S matrix)        │
  │  → Master Vol (dedicated encoder)   │
  └──────────────────────────────────────┘
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

### Implemented

- **Supersaw** — JP-8000 asymmetric 7-saw detune → OSCA E5/E6
- **OSC B** — second oscillator per voice → OSCB E1–E4
- **LFO shapes** — SIN/TRI/SAW/SQR/S&H → MOD E3
- **LFO routing** — pitch, filter, PW, amp → MOD E5–E8
- **LFO Delay** — vibrato onset time → MOD E4
- **Filter multimode** — LP→Notch→HP continuous sweep → FLTR E4
- **Key Track** — keyboard filter tracking → FLTR E5
- **Glide/Portamento** — per-voice portamento → MOD E15
- **Poly Mod** — FEnv/OscB → pitch/PW/filter → MOD E9–E13
- **Hard Sync** — OscB resets OscA phase → OSCA E7
- **Vintage drift** — per-voice pitch + filter + envelope timing → GLOB E2
- **Wavefolder/Timbre** — Buchla sine wavefolder → OSCA E8
- **Pink noise** — Oberheim SEM noise color → OSCB E6
- **Passive HPF** — Juno-106 stepped shelf → FLTR E7
- **ADS envelope mode** — Oberheim SEM Decay=Release → ENV E5/E13
- **BBD chorus modes** — Juno-60 I/II/I+II anti-phase stereo → FX E2
- **Velocity sensitivity** — vel→amp (ENV E15), vel→cutoff (FLTR E6)
- **Envelope curves** — Prophet-5 exponential shaping → ENV E6/E14
- **Mixer saturation** — Prophet-5 pre-filter tanh soft-clip → OSCB E7
- **Unison mode** — voice stacking with per-voice random detune → GLOB E3/E4
- **Factory presets** — Discovery patches for new users

### Tier 5 — Character features (next)

1. **LPG coupling** — Buchla Lopass Gate: FENV + AENV linked with Vactrol-like decay
2. **Reverb size** — room size / pre-delay control → FX E10
3. **Stereo width** — post-reverb stereo spread → FX E13
4. **EQ** — hi/lo shelf → FX E14/E15

### Tier 6 — Future

1. Ring Modulator (Buchla Mod Osc in AM/ring mode)
2. Aftertouch routing (Prophet-5 Rev4)
3. Arpeggiator / step sequencer
4. Wavetable oscillator mode
5. MIDI CC learn
6. Browser-based patch sharing
