# Arcturus — Agent Instructions

You are an autonomous dev agent maintaining **Arcturus**, a browser-based virtual analog synthesizer controlled by Arturia hardware (KeyStep Standard + BeatStep Black Edition).

**Read `CLAUDE.md`, `DOCTRINE.md`, `docs/SOUND_ENGINE.md`, and `docs/SYNTH_RESEARCH.md` before writing any code.** These are your source of truth for architecture, the operating loop, DSP design, and primary-source citations.

---

## How You Work

You operate in a **build → test → evaluate → improve** loop. Every iteration produces working, tested code. You do not stop until:

1. All tests pass.
2. Your own improvement audit finds nothing actionable.

See `DOCTRINE.md` Part 4 (The Cycle) for the full loop protocol.

---

## Audit Checklist

When you run out of work, run these audits. They are never "done" — re-run them continuously.

- **Test coverage** — Run all tests. Find untested code paths. Target: every exported function has at least one test. Every user-facing flow has an integration test.
- **Type safety** — Run `pnpm typecheck`. Fix all errors. Then look for `any`, type assertions (`as`), and non-null assertions (`!`). Replace with proper types or runtime checks. Target: zero `any` in production code.
- **Error handling** — Trace every async call, hardware interaction, and IndexedDB operation. What happens when it fails? Does the user see a helpful message? Does the system recover? Add error handling where missing.
- **Performance** — Profile the audio path. Is the AudioWorklet render budget (<2.67ms at 48kHz) respected? Are there unnecessary allocations in the hot path? Are DOM updates batched?
- **UX polish** — Use the app as a musician would (via the virtual MIDI test harness). Is feedback instant? Are transitions smooth? Do encoder values feel responsive? Fix anything that feels off.
- **Code quality** — Run linter. Read through every file changed in the last unit of work. Look for: dead code, duplicated logic, unclear naming, functions longer than 40 lines. Refactor.
- **Documentation sync** — Does `CLAUDE.md` still match the code? Does `docs/SOUND_ENGINE.md` match `src/audio/params.ts`? Update anything that has drifted.
- **Build & deploy** — Run `pnpm build`. Does it succeed? Is the output size reasonable? Test with `pnpm preview`. Does everything work with COOP/COEP headers?

---

## Rules

### Code Rules

1. **TypeScript strict mode.** No `any` in production code. No `@ts-ignore`.
2. **No dead code.** If you write something and don't use it, delete it.
3. **Test what you build.** Every module gets tests before you move to the next task.
4. **One concern per file.** Keep modules focused. If a file exceeds 300 lines, consider splitting it.
5. **Use the type system.** Types are in `src/types.ts`. Add new types there. Import them — don't duplicate.
6. **Faust DSP files** live in `src/audio/`. They are `.dsp` files compiled at runtime via `@grame/faustwasm`.
7. **CSS uses design tokens.** All colors, radii, and fonts come from CSS custom properties in `src/styles/main.css`. Do not hardcode values.
8. **No frameworks for UI.** Vanilla TypeScript + DOM API + Tailwind. No React, no Vue, no Lit.
9. **Imports use `@/` alias** (e.g., `import { SynthParam } from "@/types"`).
10. **No backwards compatibility.** This is a dev-phase project. Never keep legacy fields, migration paths, or deprecated wrappers. When a pattern changes, delete the old code.

### Process Rules

1. **Read before you write.** Before implementing a module, read the relevant sections of `CLAUDE.md`, `DOCTRINE.md`, and `docs/SOUND_ENGINE.md`.
2. **Test before you move on.** Run `pnpm test` after completing each task. Do not proceed if tests fail.
3. **Commit frequently.** Each completed task or logical unit of work gets its own commit with a conventional commit message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
4. **Do not over-engineer.** The audit checklist catches quality issues — you don't need to gold-plate on the first pass.
5. **When stuck:** re-read the relevant docs, check test output, check types. If truly blocked, document the blocker in the commit/PR and move to the next unblocked task.

### Testing Rules

1. **Unit tests** go next to the module: `src/midi/manager.test.ts` tests `src/midi/manager.ts`.
2. **Integration tests** go in `src/test/`.
3. **Virtual MIDI is your hardware.** Every hardware interaction test uses the virtual MIDI harness. Never assume real hardware.
4. **Test behavior, not implementation.** Assert on outputs (MIDI messages sent, parameter values changed, DOM state), not on internal state.
5. **Audio signal tests** compile real Faust WASM offline via `src/test/faust-loader.ts`. See `docs/SIGNAL_TESTING.md` for the framework reference.

---

## Quick Reference

```bash
pnpm dev          # Start dev server (localhost:5173, COOP/COEP enabled)
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run all tests
pnpm test:watch   # Run tests in watch mode
pnpm test:coverage # Run tests with coverage report
pnpm typecheck    # TypeScript type check
pnpm lint         # ESLint
```

## File Map

```
CLAUDE.md               ← Primary dev reference: architecture, principles, pitfalls (read first)
DOCTRINE.md             ← Autonomous-agent operating system: Constitution, Quality Score, The Cycle
AGENTS.md               ← Agent instructions (this file)
docs/SOUND_ENGINE.md    ← Living parameter reference — always in sync with params.ts
docs/SYNTH_RESEARCH.md  ← Primary-source hardware citations
docs/SIGNAL_TESTING.md  ← Signal-testing framework reference
src/
├── main.ts              ← App entry point
├── types.ts             ← All shared types
├── styles/main.css      ← Design tokens + global styles
├── audio/               ← Faust DSP, engine lifecycle, parameter registry (params.ts = source of truth)
├── midi/                ← MIDI access, fingerprinting, calibration, clock
├── control/             ← BeatStep encoders/pads, KeyStep, mapping layer
├── state/               ← IndexedDB, patches, hardware profiles, config
├── ui/                  ← Views (calibration, synth, config) + components
├── dev/                 ← Dev-mode fake controllers + profile seeding
└── test/                ← Virtual MIDI, helpers, integration + E2E tests, signal harnesses
```
