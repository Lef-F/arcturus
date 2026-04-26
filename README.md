# Arcturus

**A browser-based virtual analog synthesizer designed around Arturia hardware.**

The hardware *is* the preferred interface — but the synth is fully playable with computer keyboard + mouse alone.

- **Arturia BeatStep / BeatStep Black Edition** — 16 relative encoders (synthesis parameters) + 16 pads (module / program select). The only device that needs identification + calibration.
- **Arturia KeyStep Standard, KeyStep 32, or any other MIDI keyboard** — notes, pitch bend, aftertouch, mod wheel, transport. Treated as a generic note source; no calibration required.
- **Computer keyboard** — `A`–`K` play notes (`W`/`E`/`T`/`Y`/`U` are sharps), `Z`/`X` shift octaves, `1`–`8` switch programs (double-tap to latch a chord), `Shift+1`–`8` switch modules.
- **Mouse** — vertical drag or scroll on a knob to turn it, click a pad to switch.

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

- Any modern Chromium-based browser (Chrome, Edge, Brave, Arc) — Web MIDI works out of the box.
- For the full experience: an Arturia BeatStep + a MIDI keyboard. The BeatStep is the only device that needs first-run calibration; any MIDI keyboard works as a notes source.
- Computer keyboard + mouse work as a complete fallback if no hardware is around.
- Node 22+ and `pnpm` for local development.

## Browser support

Chrome, Edge, Brave, and Arc support hardware MIDI natively. **Firefox needs one extra step** (an extension or an `about:config` flag) and **Safari doesn't ship Web MIDI at all** — but the keyboard + mouse fallback works everywhere. Full compatibility matrix and Firefox setup steps in [`docs/BROWSER_SUPPORT.md`](./docs/BROWSER_SUPPORT.md).

## Quickstart

```bash
pnpm install
pnpm dev          # localhost:5173 — synth always boots, no hardware required
pnpm build        # production bundle
pnpm test         # full test suite (unit + integration + offline DSP signal tests)
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
```

If a BeatStep is connected on first boot, calibration walks you through it (turn the master knob, turn each encoder once, tap each pad) and stores the profile in IndexedDB so subsequent sessions skip straight to playing. Without a BeatStep, the synth boots straight to the keyboard + mouse experience.

## Project structure

See [CLAUDE.md](./CLAUDE.md) for the architecture map, core principles, signal flow, tooling, and common pitfalls. That document is the primary reference for anyone (or anything) contributing code.

For the agent-operating-system side of the project — how autonomous agents maintain and improve this codebase — see [DOCTRINE.md](./DOCTRINE.md) and [AGENTS.md](./AGENTS.md).

Reference docs live in `docs/`:

- `docs/SOUND_ENGINE.md` — living parameter reference, module layout, DSP design decisions
- `docs/SYNTH_RESEARCH.md` — primary-source citations for every hardware design choice
- `docs/SIGNAL_TESTING.md` — offline Faust signal-test framework

## License

MIT — see [LICENSE](./LICENSE).
