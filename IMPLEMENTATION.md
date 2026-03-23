# Arcturus — Implementation Specification

## Overview

Arcturus is a browser-based virtual analog synthesizer controlled primarily through Arturia hardware (KeyStep Standard + BeatStep Black Edition). It is a static web application — all computation runs client-side. The server's only role is serving assets.

This document bridges the [Research Plan](./Arturia%20Synth%20Integration%20Research%20Plan.md) and actual code. It covers tech stack, project structure, build pipeline, UI architecture, and implementation milestones.

---

## Tech Stack

| Layer | Choice | Rationale |
| :---- | :---- | :---- |
| Language | TypeScript (strict) | Type safety for MIDI byte handling and DSP parameter paths |
| Bundler | Vite | Fast HMR, native ESM, trivial COOP/COEP header config via `vite.config.ts` |
| Package Manager | pnpm | Fast, disk-efficient, strict dependency resolution |
| DSP | Faust → WASM via `@grame/faustwasm` | Virtual analog modeling compiled to AudioWorklet |
| Audio Runtime | AudioWorklet (WASM) | Dedicated real-time thread, 128-sample render quantum |
| MIDI | Web MIDI API (`navigator.requestMIDIAccess`) | Direct hardware access with SysEx support |
| State Persistence | IndexedDB (via `idb` wrapper) | Patches, calibration profiles, hardware maps |
| CSS Framework | Tailwind CSS v4 | Matches draft v1 utility-class approach, rapid prototyping |
| Fonts | Space Grotesk + JetBrains Mono | Per Phosphor Observer design system |
| Deployment | Static hosting (AWS S3 + CloudFront) | COOP/COEP headers via CloudFront response headers policy |

### Dev Server Headers (vite.config.ts)

```typescript
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
```

These are required for `SharedArrayBuffer` support, which enables low-latency communication between the MIDI manager and AudioWorklet.

---

## Project Structure

```
arcturus-dev/
├── index.html                     # Entry point
├── vite.config.ts
├── tsconfig.json
├── package.json
├── tailwind.config.ts
│
├── src/
│   ├── main.ts                    # App bootstrap, calibration flow entry
│   ├── types.ts                   # Shared type definitions
│   │
│   ├── midi/
│   │   ├── manager.ts             # MIDI access, port enumeration, message routing
│   │   ├── fingerprint.ts         # SysEx identity request/reply, device recognition
│   │   ├── calibration.ts         # First-run calibration flow, encoder characterization
│   │   └── clock.ts               # Master clock generation (AudioWorklet → MIDI out)
│   │
│   ├── audio/
│   │   ├── engine.ts              # Faust WASM compilation, AudioWorklet node lifecycle
│   │   ├── synth.dsp              # Faust DSP source (oscillators, filter, envelopes)
│   │   ├── effects.dsp            # Faust effect chain (overdrive, chorus, delay, reverb)
│   │   └── params.ts              # Parameter path registry, value scaling, soft takeover
│   │
│   ├── control/
│   │   ├── mapper.ts              # BeatStep CC → parameter path translation
│   │   ├── encoder.ts             # Relative encoder logic, acceleration, clamping
│   │   ├── pads.ts                # Pad handling: patch select (top row), triggers (bottom row)
│   │   └── keystep.ts             # KeyStep: note routing, aftertouch, pitch bend, transport
│   │
│   ├── state/
│   │   ├── db.ts                  # IndexedDB schema, migrations, CRUD operations
│   │   ├── patches.ts             # Patch save/load, autosave logic
│   │   └── hardware-map.ts        # Calibration profile persistence
│   │
│   └── ui/
│       ├── app.ts                 # Root UI component, view routing
│       ├── calibration-view.ts    # Calibration flow screens
│       ├── synth-view.ts          # Main performance view (BeatStep-shaped)
│       ├── config-view.ts         # Hidden configuration menu
│       ├── components/
│       │   ├── encoder.ts         # SVG rotary encoder visualization
│       │   ├── pad.ts             # Pad with LED state
│       │   ├── waveform.ts        # Oscilloscope / waveform display
│       │   └── meter.ts           # Level meter, CPU load bar
│       └── phosphor.css           # Phosphor Observer design tokens + utilities
│
├── public/
│   └── fonts/                     # Space Grotesk, JetBrains Mono (self-hosted)
│
├── web_interface_draft_v1/        # Reference drafts (not deployed)
├── Arturia Synth Integration Research Plan.md
└── IMPLEMENTATION.md              # This file
```

---

## UI Architecture

### Design System: Phosphor Observer (Evolved)

Inspired by the **Teenage Engineering OP-1** (primary) and **Serum VST** (secondary). Think: if the OP-1 and Serum had a baby with strong OP-1 genes. The draft v1 Phosphor Observer palette and glow language are retained but the form factor shifts from clinical CRT monitor to warm, tactile hardware instrument.

#### OP-1 DNA (dominant)

The OP-1's visual identity comes from contrast: a clean aluminum body housing a dark OLED display with vivid, playful graphics. We translate this to a dark-on-dark scheme where the "body" is a warm dark surface and the "display" areas pop with color.

**Form & Shape:**
- **Rounded corners** everywhere — `8px` on small elements (buttons, pads), `12px` on panels and containers, `16px` on the main body frame
- **Circular encoder knobs** with subtle inner shadow and gradient, mimicking the OP-1's physical encoders (the CSS demo uses `border-radius: 50%` with `box-shadow` for depth)
- **Flush display regions** — the waveform display and parameter readouts sit in recessed dark panels (`#0E0E12`) that feel embedded in the device surface, like the OP-1's glass OLED
- **Generous spacing** — elements breathe; grid gaps of `8–12px` between controls, `16–24px` between sections

**Color & Texture:**
- **Body surface:** warm dark gray `#1E1E22` (not pure black — a hint of warmth like brushed dark aluminum)
- **Display/inset areas:** deep black `#0E0E12` (OP-1 OLED feel)
- **Accent colors** blend the OP-1 and Phosphor palettes:

| Role | Color | Hex | Origin |
| :---- | :---- | :---- | :---- |
| Primary / Active | Cyan | `#26FEDC` | Phosphor Observer |
| Timing / Rhythm | Green | `#A4FF00` | Phosphor (close to OP-1 `#70d28a`) |
| Intensity / Gain | Orange | `#FF9062` | Phosphor (close to OP-1 `#fe813b`) |
| Alert / Record | Red | `#FF395D` | OP-1 |
| Info / Modulation | Blue | `#8fc6f5` | OP-1 |

- **Solid color fills** on active elements — confident, bold blocks rather than thin outlines
- **Subtle glow** on active state (4–8px outer glow at 15–20% opacity), not on everything
- **No dot grid overlay** — departed from v1's CRT texture in favor of clean OP-1 surfaces

**Interaction Feel:**
- **Tactile, toy-like quality** — elements should look like you could reach in and touch them
- **Buttons/pads** respond with color fill + gentle glow on active state (like OP-1 backlit keys)
- **Encoder indicators** use a clean arc/stroke, not a photorealistic knob — halfway between OP-1's physical encoders and Serum's clean parameter arcs
- **No hover states that change layout** — state is driven by hardware input, mouse hover is secondary

**Typography:**
- **Space Grotesk** — headlines and labels; friendly and modern, not clinical
- **JetBrains Mono** — all numeric values, parameter readouts (prevents layout jitter on value changes)
- **Label style:** uppercase, `9–10px`, `tracking-widest`, 60% opacity — understated until needed
- **Value style:** `12–14px`, full opacity, accent-colored when active

#### Serum DNA (recessive)

- **Detailed waveform visualization** — the main display shows a high-resolution oscilloscope/wavetable view reminiscent of Serum's waveform editor, but rendered in the Phosphor glow aesthetic
- **Parameter density** — all 16 encoder values visible at once with precise readouts
- **Visual feedback loops** — when you turn an encoder, both the arc indicator and the numeric value update in real-time, like Serum's responsive parameter feedback

#### OP-1 Tape Reel Motif

The OP-1's iconic tape reel screen can inspire a visualization mode for Arcturus:
- **Waveform display** styled as a "tape" — audio signal flowing left to right through a centered playhead
- **Tape reel circles** could represent the two oscillators (or oscillator + filter), spinning proportionally to pitch
- This is a stretch goal / visual polish item, not MVP critical

#### Departed from Phosphor Observer v1

| v1 Rule | Arcturus Direction |
| :---- | :---- |
| No rounded corners | Rounded corners everywhere (8–16px) |
| No solid borders | Soft borders and solid fills welcome |
| Asymmetric voids | Balanced, centered layouts (OP-1 is symmetrical) |
| Read-only hardware monitor | Interactive, inviting instrument panel |
| Dot grid / scanline overlay | Clean surfaces (OP-1 smoothness) |
| Clinical / oscilloscope aesthetic | Warm, playful, toy-like quality |

### Main Performance View (synth-view)

The primary interface mirrors the BeatStep's physical layout so the user's eyes and hands align naturally:

```
┌──────────────────────────────────────────────────┐
│  ARCTURUS                          48kHz │ 8v │  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│  │ E1 │ │ E2 │ │ E3 │ │ E4 │ │ E5 │ │ E6 │ │ E7 │ │ E8 │  │
│  │Wave│ │Tune│ │Cut │ │Res │ │FEnv│ │Atk │ │D/S │ │Rel │  │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│  │ E9 │ │E10 │ │E11 │ │E12 │ │E13 │ │E14 │ │E15 │ │E16 │  │
│  │DTim│ │DFbk│ │RvDk│ │RvMx│ │ChRt│ │ChDp│ │Driv│ │Voic│  │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
│                                                  │
│  [P1] [P2] [P3] [P4] [P5] [P6] [P7] [P8]      │
│   Patch select (top row pads)                    │
│                                                  │
│  [P9] [P10][P11][P12][P13][P14][P15][P16]       │
│   Performance triggers (bottom row pads)         │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │         ~ waveform display ~         │        │
│  └──────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

- Each encoder widget shows: label, current value, SVG rotation indicator
- Encoders update in real-time as the BeatStep knobs are turned (and vice versa — screen reflects hardware state)
- Pads glow when active (cyan for selected patch, green for triggered notes)
- Waveform display shows live audio output (AnalyserNode)
- Header shows sample rate, active voice count, CPU load

### Calibration View

Full-screen overlay during first run:

1. **"Connect Controllers"** button (large, centered, cyan glow)
2. **"Turn any knob on Device 1"** — animated prompt with listening indicator
3. **"Turn any knob on Device 2"** — same
4. **"Devices identified"** — shows KeyStep → Performer, BeatStep → Control Plane
5. Auto-transitions to synth-view

### Hidden Configuration Menu

Accessed via keyboard shortcut (e.g., `Ctrl+,` or `Esc`). Styled as a slide-in panel from the right. Contains all settings from the Research Plan's Hidden Configuration Menu table.

---

## Faust DSP Architecture

### Voice DSP (synth.dsp)

Per-voice signal flow:

```
Oscillator(waveform, detune) → Filter(cutoff, resonance, env_amount) → Amp Envelope(ADSR) → Output
```

- **Oscillator:** Switchable waveform (saw via `os.sawNp`, square via `os.square`, pulse via `os.pulse`, triangle via `os.triangle`). Encoder 1 selects waveform (discrete 4-step), Encoder 2 controls detune (±1 semitone continuous).
- **Filter:** `ve.moogLadder` (4th-order TPT). Cutoff mapped logarithmically (20–20kHz). Filter envelope is a separate ADSR that modulates cutoff by `env_amount` (bipolar ±1.0).
- **Amp Envelope:** `en.adsr` with logarithmic time scaling for attack/decay/release (1–5000ms).

### Effect Chain (effects.dsp)

Post-mix signal flow (runs once regardless of voice count):

```
Overdrive(ef.cubicnl) → Chorus(fdelay + LFO) → Delay(ef.echo, clock-synced) → Reverb(re.zita_rev1_stereo) → Master Volume
```

### Polyphony Declaration

```faust
declare nvoices "8";
```

Active voice limit controlled at the application layer — the mapper intercepts `keyOn` calls and enforces the limit set by Encoder 16.

---

## MIDI Message Routing

### Incoming (Hardware → App)

| Source | Message Type | Handler |
| :---- | :---- | :---- |
| KeyStep | Note On/Off (9n/8n) | `keystep.ts` → `engine.keyOn()`/`engine.keyOff()` |
| KeyStep | Pitch Bend (En) | `keystep.ts` → Faust param `/synth/osc/pitch_bend` |
| KeyStep | Channel Pressure (Dn) | `keystep.ts` → Faust param `/synth/filter/cutoff` (additive) |
| KeyStep | Transport (FA/FB/FC) | `keystep.ts` → `clock.ts` start/continue/stop |
| BeatStep | CC (Bn, relative) | `encoder.ts` → `mapper.ts` → Faust param by encoder index |
| BeatStep | Program Change (Cn) | `pads.ts` → `patches.ts` load patch |
| BeatStep | Note On (9n, pads) | `pads.ts` → percussive triggers |

### Outgoing (App → Hardware)

| Target | Message Type | Purpose |
| :---- | :---- | :---- |
| KeyStep | Clock (F8) | Master clock pulses from AudioWorklet |
| KeyStep | Transport (FA/FC) | Start/stop commands |
| BeatStep | Note On (9n) | Pad LED feedback (active step, selected patch) |

---

## State & Persistence

### IndexedDB Schema

**Database name:** `arcturus`

**Object stores:**

1. `hardware_profiles` — keyed by `profile_id` (auto-increment)
   - `device_fingerprint`: SysEx identity bytes
   - `port_name`: OS-assigned MIDI port name
   - `role`: "performer" | "control_plane"
   - `encoder_calibration`: per-encoder acceleration curve data
   - `created_at`, `updated_at`

2. `patches` — keyed by `patch_id` (auto-increment)
   - `name`: user-assigned or auto-generated
   - `slot`: 1–8 (pad assignment)
   - `parameters`: `Record<string, number>` (Faust parameter paths → values)
   - `created_at`, `updated_at`

3. `config` — keyed by `key` (string)
   - Stores hidden menu settings: `sample_rate`, `buffer_size`, `max_voices`, etc.

### Autosave

The system autosaves the current patch state to the active slot on a debounced timer (2 seconds after last parameter change). The patch `updated_at` timestamp tracks the last modification. No explicit save action is needed.

---

## Implementation Milestones

### M1: Audio Engine Foundation
- [ ] Project scaffolding (Vite + TS + Tailwind + pnpm)
- [ ] Faust DSP: single-voice oscillator + filter + envelope
- [ ] WASM compilation pipeline (`@grame/faustwasm`)
- [ ] AudioWorklet node creation and audio output
- [ ] On-screen test: mouse-triggered note plays sound

### M2: MIDI Input
- [ ] Web MIDI access with permission flow
- [ ] SysEx device fingerprinting
- [ ] KeyStep note on/off → Faust voice trigger
- [ ] KeyStep pitch bend and aftertouch → Faust params
- [ ] BeatStep encoder CC → Faust params (relative mode, soft takeover)

### M3: Calibration Flow
- [ ] First-run calibration UI
- [ ] Sequential device identification (turn-a-knob prompt)
- [ ] Encoder characterization (acceleration curve recording)
- [ ] IndexedDB persistence of calibration profile
- [ ] Skip calibration on recognized hardware

### M4: Polyphony & Performance
- [ ] 8-voice polyphonic Faust DSP
- [ ] Voice limit control via Encoder 16
- [ ] Master clock generation (AudioWorklet → MIDI out)
- [ ] Transport control (play/stop/continue)
- [ ] CPU budget monitoring

### M5: Effects Chain
- [ ] Overdrive (`ef.cubicnl`)
- [ ] Chorus (modulated `de.fdelay`)
- [ ] Delay (`ef.echo`, tempo-synced)
- [ ] Reverb (`re.zita_rev1_stereo`)
- [ ] All effects mapped to Encoders 9–15

### M6: UI & Visual Feedback
- [ ] Phosphor Observer design system (CSS tokens, grid overlay, glow utilities)
- [ ] BeatStep-mirrored synth view (8×2 encoders + 8×2 pads)
- [ ] Real-time encoder position visualization
- [ ] Pad LED feedback (active patch, triggered notes)
- [ ] Waveform display (AnalyserNode)
- [ ] Hidden config menu

### M7: Patches & State
- [ ] IndexedDB schema and migrations
- [ ] Patch load via BeatStep pad (Program Change)
- [ ] Autosave on parameter change (debounced)
- [ ] Patch naming (via hidden menu or keyboard)
- [ ] Export/import patches (JSON)

### M8: Deployment
- [ ] Production build (`vite build`)
- [ ] AWS S3 bucket + CloudFront distribution
- [ ] COOP/COEP response headers policy
- [ ] Custom domain (TBD)

---

## Open Questions / TBD

| Item | Status | Notes |
| :---- | :---- | :---- |
| Mod strip assignment | TBD | Need hardware-driven way to assign function at runtime |
| KeyStep arpeggiator | TBD | Use hardware arp or reimplement in browser? |
| KeyStep sequencer | TBD | Use hardware sequencer or browser-side? |
| BeatStep sequencer mode | TBD | Currently pure control surface; may add sequencer later |
| Mono → stereo split point | TBD | MVP: go stereo at chorus stage |
| Multi-page encoder mapping | TBD | Switchable pages via pads for deeper parameter access |
| LFO | TBD | Need to define targets, rate/depth control, hardware mapping |
| Discrete encoder stepping | TBD | Waveform select + delay division use discrete values on continuous encoders — need calibration-informed step size |
| Pad bottom row function | TBD | Percussive triggers defined but sample source undefined |
| Testing without hardware | TBD | Virtual MIDI loopback or on-screen keyboard fallback |
| Custom domain | TBD | AWS CloudFront alternate domain |
