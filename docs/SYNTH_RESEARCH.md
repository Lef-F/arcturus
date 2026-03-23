# Synthesizer Research — Authoritative Sources & Parameter Reference

> Raw research notes from official manuals and technical analyses.
> Used to inform Arcturus's sound engine design.
> See SOUND_ENGINE.md for the applied design decisions.

---

## Sources

| Synth | Document | URL / File |
|-------|----------|-----|
| Arturia BeatStep | User Manual v1.0.1 | `docs/BeatStep_Manual_1_0_1_EN.pdf` |
| Arturia KeyStep | User Manual v1.0.0 | `docs/KeyStep_Manual_1_0_0_EN.pdf` |
| Sequential Prophet-10 | User's Guide | `docs/Sequential-Prophet-10_Users_Guide.pdf` |
| Roland Juno-106 | Owner's Manual | https://archive.org/stream/synthmanual-roland-juno-106-owners-manual/rolandjuno-106ownersmanual_djvu.txt |
| Roland Juno-106 | Service Notes | https://archive.org/details/synthmanual-roland-juno-106-service-notes |
| Roland Juno-106 | Parameter Correspondence Table (PDF) | https://static.roland.com/assets/media/pdf/JUNO106_SYS8_Param_corr_table_ej01_W.pdf |
| Roland Juno-60 | Owner's Manual | http://cdn.roland.com/assets/media/pdf/JUNO-60_OM.pdf |
| Roland Juno-60 | Service Notes (hi-res) | https://manuals.fdiskc.com/flat/Roland%20Juno-60%20Service%20Notes%20(%20HI-RES%20).pdf |
| Roland Juno-60 | Service Notes | https://archive.org/details/synthmanual-roland-juno-60-service-notes |
| Roland Juno | Chorus Technical Analysis | https://www.florian-anwander.de/roland_string_choruses/ |
| Roland JP-8000 | Owner's Manual | https://archive.org/details/synthmanual-roland-jp-8000-owners-manual |
| Roland JP-8000 | Supersaw KVR thread | https://www.kvraudio.com/forum/viewtopic.php?t=258924&start=120 |
| Roland JP-8000 | Shore — Analysis of the Super Saw Oscillator (PDF) | https://static1.squarespace.com/static/519a384ee4b0079d49c8a1f2/t/592c9030a5790abc03d9df21/1496092742864/An+Analysis+of+Roland's+Super+Saw+Oscillator+and+its+Relation+to+Pads+within+Trance+Music+-+Research+Project+-+A.+Shore.pdf |
| Oberheim SEM | Original Manual | https://synthfool.com/docs/Oberheim/Oberheim_SEM1A/SEM_Manual_LowRes.pdf |
| Oberheim SEM | Patch Panel Reference Manual | https://ia803405.us.archive.org/19/items/OberheimSEMPatchpanelUserManual/Oberheim%20SEM%20Patchpanel%20User%20Manual.pdf |
| Oberheim SEM | Cherry Audio SEM docs | https://docs.cherryaudio.com/cherry-audio/sem |
| Oberheim SEM | Arturia SEM-V Manual | https://downloads.arturia.com/products/oberheim-sem-v/manual/OberheimSEMV_Manual_1_3_0_EN.pdf |
| Buchla Music Easel | Official Manual (PDF) | https://buchla.com/guides/Buchla_Music_Easel_Manual.pdf |
| Buchla Music Easel | Owner's Manual text | https://archive.org/stream/synthmanual-buchla-music-easel-owners-manual/buchlamusiceaselownersmanual_djvu.txt |
| Buchla 208 | Technical details | https://modularsynthesis.com/buchla/208/buchla_208.htm |
| Buchla 208C | MIDI Implementation | https://buchla.com/guides/208C_208MIDI_Implementation.pdf |
| Sequential Prophet-5 Rev4 | User's Guide v1.3 | https://sequential.com/wp-content/uploads/2021/02/Prophet-5-Users-Guide-1.3.pdf |
| Sequential Prophet-5 Rev4 | OS 2.1.0 Addendum | https://sequential.com/wp-content/uploads/2025/05/Prophet-OS-2.1.0-Addendum_b.pdf |
| Sequential Prophet-5 Rev4 | MIDI Implementation 1.4 | https://sequential.com/wp-content/uploads/2021/03/Prophet-5-MIDI-Implementation-1.4.pdf |

---

## Arturia BeatStep (Black Edition)

Source: `docs/BeatStep_Manual_1_0_1_EN.pdf`

### Architecture

16 rotary encoders + 16 velocity-sensitive pads + transport buttons. USB/DIN MIDI. No SysEx identity reply capability (BeatStep cannot respond to Universal Identity Request — fingerprinting must use port-name matching).

### Encoders

| Feature | Detail |
|---------|--------|
| Count | 16 rotary encoders |
| Modes | Absolute (0–127) or **Relative** (Binary Offset / 2's Complement / Sign Magnitude) |
| Default mode | Absolute |
| Relative Binary Offset | Value > 64 = CW, Value < 64 = CCW, 64 = no movement. Amount = |value - 64|. |
| CC numbers | Configurable per encoder via MIDI Control Center software |
| Default CC assignments | Encoders 1–16: CC 1, 10, 74, 71, 76, 77, 93, 73, 75, 72, 91, 7, 64, 65, 67, 51 |

**Relative mode is essential** for Arcturus: allows continuous parameter change without "jumping" when hardware position differs from software state (enables soft takeover). Configure BeatStep via MIDI Control Center → set all encoders to Relative (Binary Offset) mode.

### Pads

| Feature | Detail |
|---------|--------|
| Count | 16 velocity-sensitive pads, arranged 2 rows × 8 |
| Default: top row | Notes 44–51 (MIDI channel 10) |
| Default: bottom row | Notes 36–43 (MIDI channel 10) |
| Velocity | 0–127, full response |
| Additional modes | Program Change (requires MIDI Control Center config) |

**In Arcturus:** Top row pads = program select (configured to send Program Change via MIDI Control Center). Bottom row pads = trigger notes on channel 10, routed to `engine.keyOn` for note triggers.

### Transport Buttons

Play, Stop, Record buttons. Send MMC (MIDI Machine Control) by default. Can be configured to send regular MIDI transport (0xFA/0xFC/0xFB).

### SysEx Limitation

**BeatStep cannot respond to Universal SysEx Identity Requests (F0 7E 7F 06 01 F7).** This is a hardware limitation documented in the manual. `manager.ts` implements a port-name fallback: after the SysEx timeout, any port with "beatstep" or "beat step" in its name (case-insensitive) is assigned as the BeatStep device.

### Key Takeaways for Arcturus
- Must use port-name identification (not SysEx) — `identifyByPortName()` in `fingerprint.ts`
- Set encoders to Relative Binary Offset mode in MIDI Control Center for soft takeover
- Default top-row pad notes (44–51) require reconfiguration to Program Change for patch select
- No built-in clock output — Arcturus clock must send MIDI clock to BeatStep for LED sync

---

## Arturia KeyStep (Standard)

Source: `docs/KeyStep_Manual_1_0_0_EN.pdf`

### Architecture

32-key keyboard with aftertouch, pitch bend, mod strip, arpeggiator, sequencer. USB/DIN MIDI output. Responds correctly to Universal SysEx Identity Requests (model code 0x04 0x00).

### Key Features Relevant to Arcturus

| Feature | Detail |
|---------|--------|
| Aftertouch | Channel pressure (0xD0), full 0–127 range |
| Pitch Bend | 14-bit (0–16383), center = 8192 |
| Pitch Bend Range | 1–24 semitones, configurable in Global settings |
| Velocity | Full 0–127 |
| Transport | Play/Pause/Stop buttons send MIDI transport (0xFA/0xFB/0xFC) or MMC |
| **All Notes Off** | **Triple-press Stop sends CC#123 (All Notes Off) on all channels** |
| MIDI Channel | 1–16 or ALL, configurable |

### All Notes Off (CC#123)

Triple-pressing the Stop button on the KeyStep sends **CC#123 (All Notes Off)** on all channels (or configured channel). This is a standard MIDI message (MIDI spec §6.12). Arcturus's `keystep.ts` handles this via `engine.allNotesOff()`, which calls `keyOff` for all active notes and clears the active note map.

### Pitch Bend Implementation

The default pitch bend range is ±2 semitones. Arcturus converts the 14-bit bend value to semitones and routes it to the `detune` parameter (in cents). The range is configurable on the KeyStep hardware via Global settings; Arcturus's `pitchBendToSemitones()` function accepts a `rangeSemitones` parameter.

### Key Takeaways for Arcturus
- SysEx identity response works correctly — identified via `identifyDevice()` with model code 0x04 0x00
- CC#123 triple-stop is important for live use — always handle it
- Aftertouch adds expressiveness; current implementation routes to filter cutoff
- Pitch bend range should ideally match the KeyStep's configured range

---

## Roland Juno-106 / Juno-60

### Architecture
6-voice polyphonic. Single DCO per voice (digitally controlled oscillator — superior tuning stability vs VCO). One LFO shared across all voices. 128 patch memory.

**Signal flow:** DCO → HPF (passive, 4-position) → VCF (24dB LP, resonant) → VCA → BBD Chorus (stereo)

### DCO Parameters
| Parameter | Range |
|-----------|-------|
| Range | 16', 8', 4' |
| Waveform: Sawtooth | ON/OFF |
| Waveform: Square/Pulse | ON/OFF |
| PWM Mode | MANUAL or LFO |
| Pulse Width | 0–10 |
| Sub Oscillator Level | 0–10 |
| Noise Level | 0–10 (white) |
| LFO Mod Depth | 0–10 (vibrato) |
| DCO Bend Sensitivity | knob |

### HPF (Passive — NOT resonant)
| Parameter | Range |
|-----------|-------|
| Cutoff | 4-position stepped: 0 / 1 / 2 / 3 |

**Note:** Position 0 = flat. This is a simple shelving HPF — not voltage-controlled, not resonant. Architecturally important: it's in series *before* the resonant lowpass. Unique to the Juno topology.

### VCF
| Parameter | Range |
|-----------|-------|
| Cutoff Frequency | 0–10 |
| Resonance | 0–10 (self-oscillates at max) |
| ENV Amount | Bipolar (positive/negative) |
| LFO Mod Depth | 0–10 |
| Key Follow | 0–100% |

### VCA
| Parameter | Range |
|-----------|-------|
| Mode | ENV or GATE |
| Level | 0–10 |

### Envelope (shared VCF + VCA)
| Parameter | Range |
|-----------|-------|
| Attack | 1.5ms – 3s |
| Decay | 1.5ms – 12s |
| Sustain | 0–100% |
| Release | 1.5ms – 12s |

**Note:** Single ADSR shared between filter and amp, not independent. The Juno's timbral character is partly defined by this constraint.

### LFO
| Parameter | Range |
|-----------|-------|
| Rate | 0.1Hz – 30Hz |
| Delay | 0 – 3s (fade-in time) |
| Waveform | Triangle only (fixed) |

### Chorus
| Mode | Details |
|------|---------|
| OFF | Dry |
| I | 0.5Hz LFO, 100% depth, triangle, stereo anti-phase |
| II | 0.8Hz LFO, 100% depth, triangle, stereo anti-phase |
| I+II | ~1Hz LFO, ~8% depth, sine-like, no inversion |

**Hardware:** 2× MN3009 256-stage BBD chips, MN3101 clock driver. Delay range ~0.64ms–12.8ms. Left and right channels modulated 180° out of phase — creates stereo width without mono comb-filtering.

**Juno-60 distinction:** Has the combined I+II mode (Juno-106 dropped it). I+II behaves differently: higher speed, dramatically lower depth, inversion bypass.

### MIDI SysEx Parameter Map (Juno-106)
| # | Parameter |
|---|-----------|
| 0 | DCO LFO depth |
| 1 | Noise Level |
| 2 | DCO PWM |
| 3 | Waveform selection |
| 4 | HPF Cutoff |
| 5 | VCF Cutoff |
| 6 | VCF Resonance |
| 7 | VCF ENV amount |
| 8 | VCF LFO depth |
| 9 | VCF Key follow |
| 10 | VCA Level |
| 11 | Attack |
| 12 | Decay |
| 13 | Sustain |
| 14 | Release |
| 15 | Portamento Time |
| 16 | Chorus mode |
| 17 | Range/Mode/Waveform (packed byte) |

### Key Takeaways for Arcturus
- The stepped passive HPF (4 positions) before the resonant LPF is a distinct tonal tool — worth adding as a separate module feature
- Single shared LFO with a dedicated **Delay** (fade-in) parameter defines the auto-vibrato character
- Chorus is architecturally essential — anti-phase stereo LFO, 256-stage BBD sweet spot
- Single ADSR shared between filter and amp is a design constraint that creates characteristic sounds

---

## Roland JP-8000 — Supersaw

### Architecture
8-voice polyphonic virtual analog. 2 oscillators per voice. Released 1996.

**Signal flow:** OSC1 + OSC2 → Mixer → Filter (24dB LP) → Amp → FX (Chorus, Delay, Tone)

### Supersaw Oscillator — Technical Specification

7 sawtooth oscillators running simultaneously:
- 1 center/master saw — fixed frequency, fixed amplitude, free-running phase (does NOT reset on note trigger)
- 6 slave saws — detunable and level-adjustable, also free-running phase

**Detuning multipliers at maximum detune (reverse-engineered, asymmetric):**
| Oscillator | Frequency Multiplier |
|------------|---------------------|
| Saw 1 (highest) | 1.1077 |
| Saw 2 | 1.0633 |
| Saw 3 | 1.0204 |
| Saw 4 (center) | 1.0000 |
| Saw 5 | 0.9811 |
| Saw 6 | 0.9382 |
| Saw 7 (lowest) | 0.8908 |

**Critical:** The detuning is asymmetric — upper and lower saws are NOT mirror images of each other in either linear or log scale. Symmetric implementations sound noticeably different.

**CTRL 1 — Detune:** Scales all detuning coefficients proportionally. At 0, all 7 saws are unison. At max, full spread.

**CTRL 2 — Mix:** Level of the 6 slave saws relative to the center saw. Controls thickness vs. clarity.

**Free-running phase:** Oscillators do NOT reset phase on note trigger. Each keypress has a different inter-oscillator phase relationship → organic variation, never exactly the same.

**Internal HPF:** Applied to supersaw output to remove muddiness from aliasing artifacts. Load-bearing for the characteristic sound.

### OSC Parameters
| Parameter | Range |
|-----------|-------|
| Waveform | Square, Sawtooth, Triangle, Supersaw, Noise, Triangle Mod |
| CTRL 1 | Context-dependent (Supersaw: Detune) |
| CTRL 2 | Context-dependent (Supersaw: Mix) |
| LFO 1 Depth | 0–127 (pitch mod) |

### Key Takeaways for Arcturus
- Supersaw requires asymmetric detuning curve to sound authentic
- Free-running (non-resetting) oscillator phase is essential for the organic quality
- Two separate controls: Detune spread AND center/slave Mix ratio
- Apply internal HPF post-supersaw to clean up aliasing
- "Triangle Mod" waveform (FM-like) is underused but interesting

---

## Oberheim SEM (Synthesizer Expander Module, 1974)

### Architecture
Monophonic module designed for stacking. 2 VCOs, 1 12dB state-variable filter, 2 ADS envelopes, 1 LFO, 1 VCA.

**Signal flow:** VCO1 + VCO2 → VCF Mixer → VCF (12dB SV multimode) → VCA → Output

### VCO 1 & VCO 2 (identical)
| Parameter | Range |
|-----------|-------|
| Range | 32', 16', 8', 4' |
| Frequency | ±5th detuning |
| Waveform | Sawtooth, Pulse (level controlled in mixer, not oscillator) |
| Pulse Width | 50% → near-zero |
| Sync | VCO1 resets VCO2 cycle (hard sync) |
| Mod Amount | Bidirectional: left = pitch mod, right = PW mod, center = off |
| Mod Source | ENV1, ENV2, EXT, LFO (switch) |

### VCF — 12dB/oct State-Variable (THE defining feature)
| Parameter | Range |
|-----------|-------|
| Cutoff Frequency | 0–10 |
| Resonance | 0–10 (does NOT self-oscillate — by design) |
| LP→HP Knob | **Continuous sweep: full CCW = LP, center = Notch, full CW = HP** |
| BP Switch | Engages bandpass; disables LP→HP knob |
| ENV/Mod Amount | Bipolar (left = negative, right = positive, center = off) |
| Mod Source | ENV1, ENV2, EXT, LFO (switch) |
| VCO1 Saw Level | Bidirectional |
| VCO1 Pulse Level | Bidirectional |
| VCO2 Saw Level | Bidirectional |
| VCO2 Pulse Level | Bidirectional |
| Ext/Noise | Left = external audio, right = **pink noise** |

**All 4 filter outputs (LP, BP, HP, Notch) available simultaneously** as separate patch panel jacks.

**The LP→HP knob** is the SEM's signature feature: a single continuous parameter that sweeps through lowpass → notch → highpass in one motion. Not a switched selection — a smooth interpolation.

**12dB slope** (2-pole) vs. Prophet's 24dB (4-pole). Softer, less dramatic filter sweep. Allows more frequency through at resonance.

**No self-oscillation** — a genuine technical limitation that is also a character-defining feature.

### Envelopes — ADS (NOT ADSR — no separate Release)
| Parameter | Notes |
|-----------|-------|
| Attack | Rise time |
| Decay | Fall to sustain level; **also serves as Release** |
| Sustain | Level held while gate open |

**Critical architecture:** The Decay knob controls both the decay-to-sustain time AND the release time. One knob does both jobs. This creates a distinctive plucky character when Decay is short — the note releases at the same speed it decays. Full ADSR control is impossible; the design constraint is musically consequential.

- ENV1 → hard-wired to VCA
- ENV2 → typically routes to VCF cutoff; can modulate VCO2 pitch

### LFO
| Parameter | Range |
|-----------|-------|
| Rate | 0.08Hz – 15Hz (free-running) |
| Waveform | Sine or Square (switch) |

### Key Takeaways for Arcturus
- The **continuous LP→Notch→HP sweep on a single encoder** is the most powerful single feature to borrow — no other classic synth has this
- **ADS envelopes** (Decay = Release) deserve an implementation option — gives a distinct plucky, percussive character
- **Pink noise** (−3dB/octave) is softer and more musical than white noise — worth offering as a choice
- **12dB filter slope** option alongside 24dB would give dramatically different filter character
- The modulation routing to pitch OR PW but not both (one source, one attenuator, one destination) is a useful constraint to consider

---

## Buchla Music Easel (Model 208)

### Architecture
West Coast synthesis paradigm. Not East Coast (VCO→VCF→VCA). Instead: Complex Oscillator with integrated wavefolder → Lopass Gate (combined amplitude + frequency controller). Monophonic, with sequencer.

**Signal flow:** Complex Oscillator → [Balanced Modulator] → Lopass Gate 1 → Lopass Gate 2 → Spring Reverb → Output

### Complex Oscillator
| Parameter | Range |
|-----------|-------|
| Frequency | 38Hz – 3500Hz |
| Fine Tune | ±½ octave |
| Waveshape Selector | Spike / Square / Triangle |
| Waveshape Control | 0–10 (blends sine with selected shape) |
| **Timbre** | **0–10 (wavefolder — introduces harmonics into sine output)** |
| Timbre CV Amount | voltage-controllable |
| Outputs | Sine, Triangle, Square, Pulse (separate) |

**Timbre (wavefolder) — how it actually works:**
The Buchla 208 does NOT use a diode-folding circuit. It uses **cross-FM between two triangle oscillators** running at the same frequency. As Timbre increases, one triangle VCO modulates the other — the interaction between them creates progressively richer harmonics in the sine output. The harmonic character is fundamentally different from a Serge-style diode wavefolder. Affects the sine output only (not triangle, square, or spike).

### Modulation Oscillator
| Parameter | Range |
|-----------|-------|
| Frequency | 0.13Hz – 70Hz (free-running) |
| Waveforms | Triangle, Sawtooth, Square |
| Mode | FM (into complex oscillator pitch) / AM / Ring Mod |
| Index / Depth | 0–1.0 |

### Lopass Gate (two instances)
| Parameter | Notes |
|-----------|-------|
| Mode | VCA only / LPF only / Combination |
| Level Offset | 0–10 |
| Processing (CV attenuation) | 0–10 |

**Vactrol-based (LED + photoresistor):** The Lopass Gate controls both amplitude AND filter cutoff simultaneously from the same control voltage. The Vactrol's inherent response curve creates a natural, bouncy decay that cannot be replicated by a simple RC circuit.

**Combination mode** is the canonical Buchla sound: as a note decays, BOTH amplitude AND high frequencies fall together — exactly like an acoustic instrument. This is the defining characteristic of West Coast synthesis vs. the East Coast model where filter and amplifier are separately enveloped.

### Key Takeaways for Arcturus
- **Lopass Gate concept** (Combination mode): a single envelope controls both filter cutoff AND amplitude simultaneously. Could be an AENV mode: "LPG" that ties filter and amp envelopes together with Vactrol-like exponential decay
- **Timbre / Wavefolder**: cross-FM harmonic enrichment. Different character from diode folding. Worth implementing as an OSC parameter
- **Modulation Oscillator as ring modulator**: the same LFO used for FM can also be used for amplitude modulation or ring modulation — one oscillator, three modes
- The **spike waveform** (narrow pulse, near-impulse) is sonically distinctive and underrepresented in VA synths
- West Coast approach: skip the filter entirely and use Lopass Gate — could be a FLTR module mode

---

## Sequential Prophet-5 Rev4

### Architecture
5-voice polyphonic analog. 2 VCOs per voice, 4-pole 24dB resonant LP filter, 2 ADSR envelopes per voice, 1 global LFO. Two filter circuits selectable per patch (SSM 2140 "Rev1/2" vs CEM 3320 "Rev3").

**Signal flow:** OSC A + OSC B → Mixer → Filter (24dB LP) → VCA → Output

### OSC A
| Parameter | Range |
|-----------|-------|
| Frequency Range | Low / Low Mid / Mid / High |
| Waveshape | Sawtooth, Triangle, Pulse (simultaneously selectable — multiple at once) |
| Pulse Width | 0–10 |
| Sync | Hard sync to OSC B |
| Keyboard Tracking | ON/OFF |

**Note:** Multiple waveforms can be active simultaneously — saw + pulse together is the classic Prophet sound.

### OSC B
| Parameter | Range |
|-----------|-------|
| Frequency | Interval relative to OSC A |
| Waveshape | Sawtooth, Triangle, Pulse (simultaneous) |
| Pulse Width | 0–10 |
| Low Frequency Mode | Converts OSC B to LFO range for per-voice modulation |

### Mixer
| Parameter | Range |
|-----------|-------|
| OSC A Level | 0–10 |
| OSC B Level | 0–10 |
| Noise Level | 0–10 (white) |

### Filter
| Parameter | Range |
|-----------|-------|
| Cutoff Frequency | 0–10 |
| Resonance | 0–10 (self-oscillates at max) |
| Filter ENV Amount | 0–10 |
| Keyboard Tracking | 0–10 |
| Audio Mod | ON/OFF (OSC A into filter cutoff at audio rate) |
| **Filter Select** | **"1/2" = SSM 2140 (warmer/darker), "3" = CEM 3320 (brighter/more aggressive)** |

### Filter Envelope (ENV 1) and Amp Envelope (ENV 2)
Both are full ADSR, 0–10, with velocity sensitivity.

### LFO (Global — shared across all voices)
| Parameter | Options |
|-----------|---------|
| Rate | knob |
| Waveform | Sawtooth, Triangle, Square |
| Destinations (via Mod Wheel) | OSC A freq / OSC B freq / OSC A+B PW / Filter cutoff |
| Aftertouch destinations | LFO amount / Filter cutoff |
| Source Mix | LFO / Noise blend |

### Poly Mod
| Parameter | Notes |
|-----------|-------|
| Filter ENV Amount | Amount of ENV1 modulating destinations |
| OSC B Amount | Amount of audio-rate OSC B signal modulating destinations |
| Destination: Freq A | OSC A pitch (exponential FM per voice) |
| Destination: PW A | OSC A pulse width per voice |
| Destination: Filter | Filter cutoff (audio-rate FM through 4-pole filter) |

**Poly Mod is the Prophet's most distinctive feature.** With OSC B in Lo-Freq mode + Poly Mod → Freq A: true per-voice LFO vibrato (each voice has independent modulation phase). At audio rates, OSC B → Filter creates exponential FM through the 4-pole filter — dramatically different from linear FM, produces inharmonic metallic tones. OSC B → Freq A at audio rates = FM synthesis through the oscillator.

### Performance Controls
| Parameter | Notes |
|-----------|-------|
| Glide | 0 = off; increasing = longer portamento |
| Unison | Stack all 5 voices onto one note; variable detune; chord memory |
| Master Tune | ±50¢ |
| Bend Range | Selectable semitone range |
| **Vintage Knob** | **4 = stable (Rev4 spec), 3 = Rev3 instability, 2 = Rev2, 1 = most temperamental. Affects oscillator pitch drift, envelope timing drift, amp drift — models the full analog circuit aging of each revision** |

### Velocity & Aftertouch (Rev4 additions — originals had neither)
- Velocity → Filter ENV amount
- Velocity → Amp ENV amount
- Aftertouch → LFO amount
- Aftertouch → Filter cutoff
- 7 velocity curves, 8 aftertouch curves

### Prophet-5 vs Prophet-10
Prophet-10 = two Prophet-5 boards in parallel. Identical synthesis per voice. Prophet-10 adds:
- 10-voice polyphony (vs 5)
- Split and Layer modes (each board = independent 5-voice synth in split/layer)
- All 10 voices in Unison mode

No new synthesis parameters. Same VCOs, filter, envelopes, LFO, Poly Mod.

### Key Takeaways for Arcturus
- **Vintage knob**: not just detuning — scales oscillator pitch drift, envelope timing drift, AND amp drift together. Models the full analog circuit character of each revision
- **Dual filter character** (SSM vs CEM) — two genuinely different circuit behaviors, not a "warmth" knob. Worth implementing as filter type selection
- **Poly Mod**: audio-rate OSC B → filter cutoff = exponential FM through 4-pole ladder. Produces inharmonic content that's distinctly different from linear FM synths
- **Simultaneously selectable waveforms** on both oscillators (saw + pulse + triangle all at once) is important for the Prophet's characteristic timbre richness
- **OSC B in Low Freq mode** = true per-voice LFO (each voice has independent phase). Different from a global shared LFO
- **Velocity curves** (7 options) and **aftertouch curves** (8 options) are musically important and underimplemented in software

---

## Synthesis Feature Comparison Table

| Feature | Prophet-10 | Juno-106 | JP-8000 | Oberheim SEM | Buchla 208 | **Arcturus** |
|---------|-----------|----------|---------|--------------|------------|-------------|
| Oscillators per voice | 2 (A+B) | 1 DCO | 2 | 2 VCO | Complex Osc | **2 (A+B)** ✅ |
| Filter type | 4-pole LP (24dB) | 4-pole LP (24dB) | 4-pole LP (24dB) | 2-pole SV (12dB) multimode | Lopass Gate (Vactrol) | **Moog 24dB + SEM multimode** ✅ |
| Filter modes | LP only | LP only | LP only | LP/Notch/HP/BP | LP+VCA combined | **LP/Notch/HP sweep** ✅ |
| Filter self-oscillates | Yes | Yes | Yes | No (by design) | N/A | **Yes** ✅ |
| Keyboard filter tracking | Yes | Yes | No | No | No | **Yes** ✅ |
| Envelopes | 2× ADSR (filter + amp) | 1× ADSR (shared) | 2× ADSR | 2× ADS (no sep. release) | ENV (attack/duration/decay) | **2× ADSR** ✅ |
| LFO count | 1 global | 1 global + delay | 2 | 1 | Mod Osc | **1 global** ✅ |
| LFO shapes | SAW/TRI/SQR | TRI only | multiple | SIN/SQR | TRI/SAW/SQR | **SIN/TRI/SAW/SQR/S&H** ✅ |
| LFO→PWM | No | Yes | No | No | No | **Yes** ✅ |
| LFO→Amp (tremolo) | No | No | No | No | No | **Yes** ✅ |
| LFO fade-in | No | Yes (Delay knob) | No | No | No | **Yes** ✅ |
| Poly Mod | Yes (ENV1+OSCB→A/PW/filter) | No | No | No | Yes (Mod Osc→FM/AM/ring) | **Yes (FEnv/OscB→pitch/PW/filter)** ✅ |
| Supersaw | No | No | Yes (7 saws) | No | No | **Yes (7-saw asymmetric)** ✅ |
| Hard Sync | Yes | No | No | Yes | No | **Yes** ✅ |
| Glide | Yes | Yes | Yes | No | Yes (touch plate) | **Yes (per-voice)** ✅ |
| Vintage/drift | Yes (4 levels) | No | No | No | Inherent | **Yes (pitch+filter noise)** ✅ |
| Wavefolder | No | No | No | No | Yes (Timbre/cross-FM) | No (planned) |
| Noise | White | White | White | Pink | No | White (pink planned) |
| Unison | Yes (all voices, detune) | Solo mode | Dual/Split | N/A | N/A | No (planned) |
| Velocity | Yes (Rev4) | No | Yes | No | Pressure | No (planned) |
| Aftertouch | Yes (Rev4, multiple dest.) | No | No | No | Yes (pressure) | Cutoff only (partial) |
| Chorus type | None (effects) | BBD (3 modes) | Digital | None | Spring reverb | Digital (BBD-style planned) |
| HPF | No | Passive 4-step | No | No | No | No (planned) |
| Filter dual character | Yes (SSM/CEM switch) | No | No | No | No | No (planned) |

---

## Most Valuable Features to Implement (Priority Order)

Based on musical impact, distinctiveness, and implementation feasibility.

### ✅ Implemented
- **Supersaw** (JP-8000) — asymmetric 7-saw detune, free-running phase, Mix + Detune → OSC E13/E14
- **OSC B** (Prophet-5) — second oscillator per voice, detunable → OSC E6–E9
- **LFO shapes** (all synths) — SIN/TRI/SAW/SQR/S&H → LFO E5
- **LFO→PWM** (Juno-106) — pulse width modulation → LFO E6
- **LFO→Amp** — tremolo → LFO E7
- **LFO Delay/Fade-in** (Juno-106) — vibrato onset time → LFO E8
- **Filter type: LP/Notch/HP** (Oberheim SEM) — continuous multimode sweep → FLTR E7
- **Key Track** (Prophet-5/Juno-106) — keyboard filter tracking → FLTR E4
- **Glide/Portamento** — per-voice, bypassed below 5ms → MOD E2
- **Poly Mod** (Prophet-5) — FEnv/OscB → pitch/PW/filter → MOD E4–E8
- **Hard Sync** (Prophet-5, Oberheim SEM) — OscB resets OscA → OSC E15
- **Vintage drift** (Prophet-5 Rev4) — per-voice pitch + filter noise → GLOB E2
- **All Notes Off CC#123** (KeyStep) — handled in `keystep.ts`
- **BeatStep port-name identification** — fallback in `manager.ts`

### Tier 3 — Character features (next)
1. **Wavefolder** (Buchla 208) — cross-FM timbre enrichment → OSC E16
2. **Pink noise** (Oberheim SEM) — softer −3dB/oct noise → OSC E5 option
3. **Passive HPF** (Juno-106) — 4-position stepped HP shelf before main filter → FLTR E9
4. **ADS envelope mode** (Oberheim SEM) — Decay serves as Release → FENV/AENV option
5. **BBD chorus character** (Juno-60) — anti-phase stereo, triangle LFO → FX
6. **Velocity sensitivity** (Prophet-5 Rev4) — vel→filter, vel→amp

### Tier 4 — Future features
7. Ring Modulator (Buchla Mod Osc)
8. Unison with chord memory (Prophet-5)
9. Velocity curves (7 options, Prophet-5 Rev4)
10. Aftertouch routing (Prophet-5 Rev4)
11. Lopass Gate mode (Buchla) — combined filter+amp envelope
