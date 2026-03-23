# Tier 3 — Character Features Implementation

Tracking doc for the 6 Tier 3 sound design expansions.

## Features

| # | Feature | Status | Files |
|---|---------|--------|-------|
| 1 | Velocity sensitivity (vel→amp, vel→cutoff) | ✅ complete | synth.dsp, params.ts |
| 2 | ADS envelope mode (Oberheim SEM) | ✅ complete | synth.dsp, params.ts |
| 3 | Wavefolder / Timbre (Buchla) | ✅ complete | synth.dsp, params.ts |
| 4 | Pink noise (Oberheim SEM) | ✅ complete | synth.dsp, params.ts |
| 5 | Passive HPF (Juno-106) | ✅ complete | synth.dsp, params.ts |
| 6 | BBD Chorus modes (Juno-60) | ✅ complete | effects.dsp, params.ts |

## New Parameters (8 total)

| Param | Path | Module | Slot | Range | Default |
|-------|------|--------|------|-------|---------|
| `vel_to_amp` | vel_to_amp | AENV | E5 | 0…1 | 0 |
| `vel_to_cutoff` | vel_to_cutoff | FLTR | E5 | 0…1 | 0 |
| `fenv_mode` | fenv_mode | FENV | E5 | 0=ADSR / 1=ADS | 0 |
| `aenv_mode` | aenv_mode | AENV | E6 | 0=ADSR / 1=ADS | 0 |
| `timbre` | timbre | OSC | E16 | 0…1 | 0 |
| `noise_color` | noise_color | OSC | E10 | 0=White / 1=Pink | 0 |
| `hpf_cutoff` | hpf_cutoff | FLTR | E9 | 0=off/1=18Hz/2=59Hz/3=185Hz | 0 |
| `chorus_mode` | chorus_mode | FX | E9 | 0=Custom/1=I/2=II/3=I+II | 0 |

## DSP Signal Flow Changes

### synth.dsp
- `noiseOut` = white or pink noise selected by `noise_color`
- `wavefolded` = `oscMix` through sine wavefolder scaled by `timbre`
- `mixed` uses `wavefolded` as input (before noise blend)
- `hpfOut` = 1st-order Butterworth HPF at stepped frequency before main filter
- `f_release_eff` = `f_release` or `f_decay` depending on `fenv_mode`
- `release_eff` = `release` or `decay` depending on `aenv_mode`
- `gainMod` = `(1 - vel_to_amp) + vel_to_amp * gain`
- `velCutoffMod` = `gain * vel_to_cutoff * 2.0` (in octaves, added to cutoff exponent)

### effects.dsp
- `stereoChorus`: mono in → stereo out with anti-phase LFOs
- Juno modes: I=0.5Hz/15ms, II=0.83Hz/12ms, I+II=blend of both
- Full chain stereo from chorus: `par(i, 2, delayLine)` + `par(i, 2, reverbSection)`
- Removed 7-sample stereo offset hack; replaced with true anti-phase stereo

## Test Results

- **315 tests passing** (up from 272) — 43 new tests in `src/audio/tier3-features.test.ts`
- `pnpm typecheck` — clean
- `pnpm lint` — clean (0 errors, 0 warnings)

## Progress Log

- [x] synth.dsp — 7 new params + DSP changes
- [x] effects.dsp — BBD stereo chorus + chorus_mode param
- [x] params.ts — 8 new params + module slot assignments
- [x] SOUND_ENGINE.md — update all module tables + roadmap
- [x] src/audio/tier3-features.test.ts — 43 new tests
- [x] CLAUDE.md — updated test count (272 → 315)
- [x] pnpm test → 315/315 passing
- [x] pnpm typecheck + lint → clean
