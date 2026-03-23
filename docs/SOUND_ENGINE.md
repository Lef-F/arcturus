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
| E1 | Wave | `waveform` | SAW / SQR / TRI / SIN / SUPER | SAW | Stepped — 5 positions |
| E2 | Oct | `octave` | −2 / −1 / 0 / +1 / +2 | 0 | Stepped — octave shift |
| E3 | Tune | `detune` | −100¢ … +100¢ | 0¢ | Fine detune in cents |
| E4 | PW | `pulse_width` | 5% … 95% | 50% | Pulse width (SQR waveform + poly mod target) |
| E5 | Noise | `noise_level` | 0 … 100% | 0% | Noise blend level |
| E6 | BLvl | `oscb_level` | 0 … 100% | 0% | OSC B blend level |
| E7 | BPch | `oscb_pitch` | ±24 semitones | 0 | Semitone offset from OSC A |
| E8 | BFne | `oscb_fine` | ±50¢ | 0¢ | Fine detune OSC B |
| E9 | BWav | `oscb_wave` | SAW / SQR / TRI / SIN | SAW | OSC B waveform |
| E10 | NCol | `noise_color` | White / Pink | White | Noise spectrum: White=flat, Pink=−3dB/oct (Oberheim SEM) |
| E11–E12 | — | — | — | — | Reserved |
| E13 | SDtn | `supersaw_detune` | 0 … 100% | 0% | JP-8000 asymmetric 7-saw spread |
| E14 | SMix | `supersaw_mix` | 0 … 100% | 50% | Center vs. slave saw balance |
| E15 | Sync | `osc_sync` | OFF / ON | OFF | Hard sync: OscB resets OscA phase on each cycle |
| E16 | Timb | `timbre` | 0 … 100% | 0% | Buchla wavefolder: 0=dry, 100=fully folded harmonics |

**Hard Sync (E15):** OscB acts as the sync source. OscA's phasor is reset to 0 on every OscB cycle wrap (detected by rising edge). With `osc_sync=ON` and OscB detuned above OscA, turning OscA frequency up sweeps through classic sync harmonics. OscB is baseFreq-relative (independent of LFO vibrato) to enable FM/sync without circular dependencies.

**Wavefolder / Timbre (E16):** Buchla 208-inspired sine wavefolder. At `timbre=0`: dry signal. At `timbre=1`: the oscillator output is mapped through `sin(π × x × 4)`, wrapping the waveform through a sine function and generating rich odd and even harmonics. Blends from identity (0) to fully folded (1). Applied pre-filter so the filter shapes the folded spectrum.

**Supersaw implementation note:** Use asymmetric frequency multipliers from JP-8000 reverse engineering:
`[1.1077, 1.0633, 1.0204, 1.0000, 0.9811, 0.9382, 0.8908]`. Symmetric implementations sound wrong.
Free-running phase (no reset on trigger) is essential for the organic trance-pad quality.

---

## Module 2 — FLTR (Filter)

Moog Ladder filter (4-pole, −24 dB/octave). Self-oscillates at resonance = 100%.
Crossfades to an Oberheim SEM-inspired multimode SVF as `filter_mode` increases above 0.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Cut | `cutoff` | 20 Hz … 20 kHz | 8 kHz | Logarithmic |
| E2 | Res | `resonance` | 0 … 100% | 50% | Resonance; self-oscillates near max (Moog) |
| E3 | FEnv | `fenv_amount` | −100% … +100% | +50% | Filter envelope depth, bipolar |
| E4 | KTrk | `key_track` | OFF / HALF / FULL | OFF | Keyboard tracking: cutoff follows note pitch (C3=neutral) |
| E5 | V→F | `vel_to_cutoff` | 0 … 100% | 0% | Velocity → filter cutoff: 100% = +2 octaves at max velocity |
| E6 | — | — | — | — | Reserved |
| E7 | FMod | `filter_mode` | 0 … 1 | 0 (LP) | LP → Notch → HP continuous sweep (Oberheim SEM) |
| E8 | — | — | — | — | Reserved |
| E9 | HPF | `hpf_cutoff` | OFF / 18Hz / 59Hz / 185Hz | OFF | Passive HPF before main filter (Juno-106 stepped shelf) |
| E10–E16 | — | — | — | — | Reserved |

**Key Track (E4):** `cutoff × pow(freq/261.63, key_track)` — C3 (261.63 Hz) is the neutral point (no cutoff change there). At HALF=0.5, cutoff opens one octave per two octaves of keyboard range. At FULL=1.0, perfect keyboard tracking (identical to Prophet-5/Juno-106 behavior).

**Velocity → Filter (E5):** `velCutoffMod = gain × vel_to_cutoff × 2.0` octaves added to the cutoff exponent. At `vel_to_cutoff=1` and full velocity (gain=1), the filter opens +2 octaves beyond the base cutoff. At minimum velocity the cutoff is unaffected. Works multiplicatively with FENV, LFO, and key tracking.

**Passive HPF (E9):** Juno-106 style high-pass filter applied before the main resonant LPF. Strips sub-bass content to tighten the low end and prevent low-frequency buildup at high resonance. Four stepped positions: OFF (1Hz, effectively bypass), 18Hz (removes deep rumble), 59Hz (bass tightening), 185Hz (aggressive thinning — classic Juno-106 "tight" sound). Uses a 1st-order Butterworth HPF so the transition is gentle.

**Filter Mode detail (E7):** Oberheim SEM's defining feature. Not a stepped switch — a continuous encoder sweep:
- Full CCW = pure Moog Ladder LP (24dB, warm, self-oscillating)
- Just above 0 = crossfade begins into SVF LP
- Center = Notch (band-reject)
- Full CW = pure Highpass

---

## Module 3 — FENV (Filter Envelope)

Dedicated ADSR envelope that drives the filter cutoff. Independent from the amp envelope.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Atk | `f_attack` | 1ms … 5s | 10ms | Log |
| E2 | Dec | `f_decay` | 1ms … 5s | 300ms | Log |
| E3 | Sus | `f_sustain` | 0 … 100% | 50% | |
| E4 | Rel | `f_release` | 1ms … 5s | 500ms | Log |
| E5 | Mode | `fenv_mode` | ADSR / ADS | ADSR | ADS mode: Decay knob also sets release time (Oberheim SEM) |
| E6–E16 | — | — | — | — | Reserved |

**ADS mode (E5):** When `fenv_mode=1`, the filter envelope switches to **ADS** (Attack / Decay / Sustain). The Release stage uses the Decay value — turning the decay knob controls both the decay and release simultaneously. This creates a distinctive plucky character: fast decay = snappy release, slow decay = long tail. Oberheim SEM's defining envelope character. The `f_release` encoder has no effect in ADS mode.

*Reserved for future:*
- E6: Attack Curve (Linear / Exponential)
- E7: Decay Curve
- E9: LPG Coupling (Buchla Lopass Gate mode)

---

## Module 4 — AENV (Amplifier Envelope)

ADSR envelope that shapes the amplitude of each voice. This determines the note's loudness contour.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Atk | `attack` | 1ms … 5s | 10ms | Log |
| E2 | Dec | `decay` | 1ms … 5s | 300ms | Log |
| E3 | Sus | `sustain` | 0 … 100% | 70% | |
| E4 | Rel | `release` | 1ms … 5s | 500ms | Log |
| E5 | V→A | `vel_to_amp` | 0 … 100% | 0% | Velocity → amplitude sensitivity (Prophet-5 Rev4) |
| E6 | Mode | `aenv_mode` | ADSR / ADS | ADSR | ADS mode: Decay = Release (Oberheim SEM) |
| E7–E16 | — | — | — | — | Reserved |

**Velocity → Amp (E5):** `gainMod = (1 − vel_to_amp) + vel_to_amp × velocity`. At `vel_to_amp=0`, all notes play at full volume regardless of how hard you hit. At `vel_to_amp=1`, soft notes (velocity near 0) are near-silent and hard notes play full. Values in between give expressive but not extreme sensitivity — useful around 0.5–0.7 for natural feel.

**ADS mode (E6):** Same as FENV ADS mode — amp envelope release follows the decay setting. The `release` encoder has no effect in ADS mode. Combining FENV and AENV in ADS simultaneously creates classic Oberheim SEM "one-envelope" sounds where filter sweep and amplitude fade at identical rates.

---

## Module 5 — LFO (Low Frequency Oscillator)

A single global LFO that routes to pitch, filter cutoff, pulse width, and amplitude simultaneously.
Juno-106 inspired routing + Delay feature.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Rate | `lfo_rate` | 0.01 Hz … 20 Hz | 1 Hz | Log |
| E2 | Depth | `lfo_depth` | 0 … 100% | 0% | Master depth scale for all LFO destinations |
| E3 | →Pch | `lfo_to_pitch` | 0 … 100% | 0% | Vibrato: 100% = ±1 octave at depth=100% |
| E4 | →Flt | `lfo_to_filter` | 0 … 100% | 0% | Filter wah: 100% = ±4 octaves at depth=100% |
| E5 | Shpe | `lfo_shape` | SIN / TRI / SAW / SQR / S&H | SIN | S&H = random stepped, classic arpeggio character |
| E6 | →PW | `lfo_to_pw` | 0 … 100% | 0% | PWM depth: 100% = ±45% pulse width variation at depth=100% |
| E7 | →Amp | `lfo_to_amp` | 0 … 100% | 0% | Tremolo: 100% = full amplitude modulation at depth=100% |
| E8 | Dlay | `lfo_delay` | 0s … 3s | 0s | Fade-in onset: LFO starts silent, ramps to full depth |
| E9–E16 | — | — | — | — | Reserved |

**LFO→PW (E6):** LFO modulates pulse width over the base `pulse_width` value. At `lfo_to_pw=1` + `lfo_depth=1`, pulse width sweeps ±45% from the base setting. Apply to SQR wave for classic Juno-106/Prophet-5 PWM chorus effect.

**LFO→Amp (E7):** Tremolo. Maps LFO signal from [−1,+1] to [0,1] range for amplitude modulation. At depth=100%, amplitude oscillates from `1.0` down to `(1 - lfo_to_amp)`.

**LFO Delay note (Juno-106):** The delay is not just a fade — it specifies the onset time before the LFO even begins modulating. Fundamental for "vibrato only after the note has been held".

---

## Module 6 — MOD (Modulation)

Performance and modulation utilities. Poly Mod section is the Prophet-5's signature feature.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Xpos | `transpose` | −24 … +24 semitones | 0 | Stepped — semitone steps |
| E2 | Glid | `glide` | 1ms … 3s | off (1ms) | Portamento time; bypassed below 5ms |
| E3 | — | — | — | — | Reserved |
| E4 | FE→P | `poly_fenv_freq` | 0 … 100% | 0% | Filter Env → OscA pitch FM (±2 octaves at depth=100%) |
| E5 | FE→W | `poly_fenv_pw` | 0 … 100% | 0% | Filter Env → OscA pulse width (±40% at depth=100%) |
| E6 | B→Pt | `poly_oscb_freq` | −100% … +100% | 0% | OscB → OscA pitch FM (bipolar, ±0.5 oct at depth=100%) |
| E7 | B→PW | `poly_oscb_pw` | 0 … 100% | 0% | OscB → OscA pulse width (±20% at depth=100%) |
| E8 | B→Ft | `poly_oscb_filt` | −100% … +100% | 0% | OscB → filter cutoff FM (bipolar, ±3 oct at depth=100%) |
| E9–E16 | — | — | — | — | Reserved |

### Glide / Portamento (E2)

`si.smooth(ba.tau2pole(glide))` applied to `baseFreq`. Default = 1ms (bypassed) so it feels like "off". Increase to hear smooth portamento slides between notes. Works polyphonically — each voice glides from its own previous pitch.

### Poly Mod (E4–E8)

Prophet-5 signature. Routes the filter envelope (FEnv) and OSC B audio output to modulate OSC A pitch, OSC A pulse width, and the filter cutoff. These are per-voice modulations — each of the 8 voices has its own independent envelope and oscillator B signal.

**Key behaviors:**
- **FE→P** (E4): Filter Env → OSC A pitch. Creates "pitch blip" on note attack when FEnv has a short attack. Classic Prophet FM sound.
- **FE→W** (E5): Filter Env → pulse width. PWM character varies with envelope.
- **B→Pt** (E6, bipolar): OSC B audio-rate FM on OSC A pitch. At low OscB frequencies, acts as an independent per-voice LFO (no shared phase). At audio rates, creates hard FM tones.
- **B→PW** (E7): OSC B → OSC A pulse width. Audio-rate PWM for complex timbres.
- **B→Ft** (E8, bipolar): OSC B → filter cutoff. Audio-rate filter FM: at low depths, a subtle wobble; at high depths, dramatic metallic timbre, fundamentally different from LFO filter sweeps.

**OscB is baseFreq-relative** (not pitchModFreq-relative): its frequency tracks the keyboard note independently of LFO vibrato. This avoids circular dependencies in the signal graph and is accurate to the Prophet-5 hardware behavior (each oscillator tracks its own CV independently).

---

## Module 7 — FX (Effects Chain)

Post-voice signal processing: Overdrive → Chorus → Delay → Reverb → Master.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Driv | `drive` | 0 … 100% | 0% | Cubic soft-clip overdrive |
| E2 | ChRt | `chorus_rate` | 0.1 … 10 Hz | 1.5 Hz | Chorus LFO rate (Custom mode) |
| E3 | ChDp | `chorus_depth` | 0 … 100% | 50% | Chorus modulation depth (Custom mode) |
| E4 | DTim | `delay_time` | 10ms … 2s | 250ms | Log |
| E5 | DFbk | `delay_feedback` | 0 … 95% | 30% | |
| E6 | RvMx | `reverb_mix` | 0 … 100% | 30% | Wet/dry |
| E7 | RvDk | `reverb_damp` | 0 … 100% | 50% | High-frequency absorption |
| E8 | Vol | `master` | 0 … 100% | 80% | Master output volume |
| E9 | ChMd | `chorus_mode` | Custom / Juno-I / Juno-II / Juno-I+II | Custom | BBD chorus mode (Juno-60) |
| E10–E16 | — | — | — | — | Reserved |

**BBD Chorus modes (E9):** Juno-60 BBD topology. The chorus output is always stereo with anti-phase LFOs (L and R modulated 180° out of phase). This creates stereo width without mono comb filtering.
- **Custom (0)**: uses `chorus_rate` and `chorus_depth` encoders freely.
- **Juno-I (1)**: 0.5 Hz LFO, 15ms depth, 50% wet. Classic Juno-106 lush chorus.
- **Juno-II (2)**: 0.83 Hz LFO, 12ms depth, 50% wet. Slightly faster, tighter.
- **Juno-I+II (3)**: Blends Mode I and Mode II LFOs together. Juno-60 exclusive mode — subtler depth, more complex movement.

The original Juno uses 2× MN3009 256-stage BBD chips with delay range ~0.64ms–12.8ms. Anti-phase stereo is the defining character: in mono the two channels cancel, removing the comb filtering artifact entirely. `chorus_rate` and `chorus_depth` encoders are ignored in Juno modes (preset values used instead).

---

## Module 8 — GLOB (Global)

Per-program global settings that affect the whole voice engine.

| Slot | Label | Param | Range | Default | Notes |
|------|-------|-------|-------|---------|-------|
| E1 | Voic | `voices` | 1 … 8 | 8 | Stepped — polyphony limit. Voice stealing: oldest note. |
| E2 | Vntg | `vintage` | 0 … 1 | 0 | Per-voice analog drift intensity (5 steps: 0=stable … 1=maximum) |
| E3–E16 | — | — | — | — | Reserved |

### Vintage Drift (E2)

Each polyphonic Faust DSP instance is a separate unit — `no.noise` produces independent uncorrelated sequences per voice. A slow smoothing filter (τ ≈ 2s) creates glacially slow random wander:

- **Pitch drift:** `± vintage × 0.4%` of base frequency (≈ ±7 cents at vintage=1) — subtle enough to remain in tune, wide enough to add organic warmth.
- **Filter drift:** `± vintage × 12%` of cutoff frequency — slight tonal variation voice to voice.

At `vintage=0`, all voices are identical (pure digital). At `vintage=1`, each voice has its own slow drift pattern, creating a natural ensemble effect. Inspired by the Prophet-5 Rev4 Vintage knob, which modeled four levels of analog circuit aging across three domains (pitch, envelope timing, amp level).

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

### ✅ Implemented

- **Supersaw** — JP-8000 asymmetric 7-saw detune, free-running phase, Mix + Detune → OSC E13/E14
- **OSC B** — second oscillator per voice, detunable → OSC E6–E9
- **LFO shapes** — SIN/TRI/SAW/SQR/S&H → LFO E5
- **LFO→PWM** — Juno-106 pulse width modulation → LFO E6
- **LFO→Amp** — tremolo → LFO E7
- **LFO Delay/Fade-in** — Juno-106: vibrato onset time → LFO E8
- **Filter type: LP→Notch→HP sweep** — Oberheim SEM: continuous multimode → FLTR E7
- **Key Track** — keyboard filter tracking, C3 neutral → FLTR E4
- **Glide/Portamento** — per-voice portamento → MOD E2
- **Poly Mod** — Prophet-5: FEnv/OscB → pitch/PW/filter → MOD E4–E8
- **Hard Sync** — OscB resets OscA phase → OSC E15
- **Vintage drift** — Prophet-5 Rev4: per-voice pitch + filter noise → GLOB E2
- **All Notes Off (CC#123)** — KeyStep triple-stop → engine.allNotesOff()
- **BeatStep port-name identification** — fallback for devices that can't respond to SysEx
- **Wavefolder/Timbre** — Buchla sine wavefolder, harmonic enrichment → OSC E16
- **Pink noise** — Oberheim SEM: −3dB/oct noise color option → OSC E10
- **Passive HPF** — Juno-106: 4-position stepped shelf before main filter → FLTR E9
- **ADS envelope mode** — Oberheim SEM: Decay = Release → FENV E5 / AENV E6
- **BBD chorus modes** — Juno-60: I / II / I+II anti-phase stereo → FX E9
- **Velocity sensitivity** — Prophet-5 Rev4: vel→amp (AENV E5), vel→cutoff (FLTR E5)

### Tier 4 — Character features (next)

1. **LPG coupling** — Buchla Lopass Gate: FENV + AENV linked with Vactrol-like decay → FENV E9
2. **Envelope curves** — Linear / Exponential attack and decay curves → FENV E6/E7, AENV E7/E8
3. **Reverb size** — room size / pre-delay control → FX E10
4. **Stereo width** — post-reverb stereo spread → FX E13
5. **EQ** — hi/lo shelf → FX E14/E15

### Tier 5 — Future

1. Ring Modulator (Buchla Mod Osc in AM/ring mode)
2. Unison with chord memory (Prophet-5)
3. Aftertouch routing (Prophet-5 Rev4)
4. Arpeggiator / step sequencer
5. Wavetable oscillator mode
6. MIDI CC learn
7. Browser-based patch sharing
