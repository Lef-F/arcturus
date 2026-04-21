# Arcturus

**A browser-based virtual analog synthesizer controlled entirely by Arturia hardware.**

No mouse. No on-screen dials. The hardware *is* the interface.

- **Arturia KeyStep Standard** — notes, pitch bend, aftertouch, transport
- **Arturia BeatStep Black Edition** — 16 relative encoders (synthesis parameters) + 16 pads (module / program select)

Architecturally inspired by the Prophet-5, Juno-106, JP-8000, Oberheim SEM, and Buchla 208.

## Why

Real instruments feel alive because every gesture lands immediately. Software synths usually don't: mouse, menus, context-switching. Arcturus aims for the flow of hands-on analog gear with the depth of modern DSP — every knob turn has musical effect, every program switch is smooth (soft takeover), and the sound engine is deep enough to get lost in.

## How it works

- **Faust DSP** compiled to WebAssembly and driven from an AudioWorklet — zero-latency signal path, 8-voice polyphony
- **Web MIDI** for hardware I/O, with first-run calibration to map any KeyStep/BeatStep configuration to internal parameters
- **IndexedDB** for patches (8 slots with 2s debounced autosave), hardware profiles, and app config
- **Multi-engine voice pool** — latch a program, switch to another, and both keep sounding independently
- **Vanilla TypeScript + DOM** — no React, no Vue, no framework overhead

## Requirements

- Arturia KeyStep Standard + Arturia BeatStep (Black Edition) connected via USB
- A modern Chromium-based browser (Web MIDI + AudioWorklet + `SharedArrayBuffer` with COOP/COEP)
- Node 22+ and `pnpm` for local development

## Quickstart

```bash
pnpm install
pnpm dev          # localhost:5173 — fake MIDI + seeded profiles in dev mode
pnpm build        # production bundle
pnpm test         # full test suite (unit + integration + offline DSP signal tests)
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
```

First boot walks through calibration (pick the master encoder, turn each BeatStep knob once, tap each pad) and stores a hardware profile in IndexedDB so subsequent sessions skip straight to playing.

## Project structure

See [CLAUDE.md](./CLAUDE.md) for the architecture map, core principles, signal flow, tooling, and common pitfalls. That document is the primary reference for anyone (or anything) contributing code.

For the agent-operating-system side of the project — how autonomous agents maintain and improve this codebase — see [DOCTRINE.md](./DOCTRINE.md) and [AGENTS.md](./AGENTS.md).

Reference docs live in `docs/`:

- `docs/SOUND_ENGINE.md` — living parameter reference, module layout, DSP design decisions
- `docs/SYNTH_RESEARCH.md` — primary-source citations for every hardware design choice
- `docs/SIGNAL_TESTING.md` — offline Faust signal-test framework

## License

MIT — see [LICENSE](./LICENSE).
