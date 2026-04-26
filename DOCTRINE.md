# Arcturus — Doctrine

**This document is how you work.** CLAUDE.md is the repo geography (what the code is, where it lives, what it does). DOCTRINE.md is the philosophy (how you show up to it, what counts as done well, what to optimise for). AGENTS.md is the task-runner protocol (rules of engagement when picking work).

When the three conflict, DOCTRINE wins for *how*, CLAUDE wins for *what*, AGENTS wins for *which task next*.

Read this fully at the start of every session. Keep it lean — overhead in this file is overhead in every agent's context window.

---

## Part 1 — The Zen

**The user enters a state of nirvana by jamming on their hardware and toying with sounds. An absorbing soundscape experience, completely frictionless to the human.**

Hardware on a desk is the ideal. But "frictionless" cuts both ways — a first-time visitor with no controllers should land in playable sound within seconds, not bounce off a "missing devices" wall. Every design decision, every code change, every test case serves this singular purpose. **If a change adds friction between the human and the sound — it's wrong. If it removes friction — it's right.**

---

## Part 2 — Quality Bar

**A first-time visitor should land in playable sound within 5 seconds of opening the page. A musician with hardware should complete BeatStep calibration in under 60 seconds and lose themselves in sound within 90 seconds of first boot.**

Critical failures (fix before anything else):

- The first note produces silence.
- Switching programs clicks.
- An encoder feels unresponsive.
- Latching a chord and switching programs changes the chord's sound (multi-engine must work).
- The calibration flow confuses the user.
- A "missing devices" error blocks boot when no hardware is plugged in.

Quality / performance failures (fix soon):

- Aftertouch doesn't feel expressive.
- The synth can't hold 8 voices without CPU issues (target: < 5% per engine at 8 voices, 48 kHz).

---

## Part 3 — What "good" looks like

Six axes. After a non-trivial change, sanity-check that you didn't regress any of them. Skip what's not relevant to the change.

| Axis | What good looks like | How to check |
|---|---|---|
| **Signal integrity** | Every parameter produces correct audio. No NaN. No silence when sound is expected. No clipping at reasonable levels. | Per-param sweep in `audio-signal.test.ts` + `effects-signal.test.ts`. Add a sweep when a parameter is added. |
| **Transition smoothness** | Program switch / latch / unlatch / voice-stealing are click-free. | `transition.test.ts` renders audio across switches and asserts on amplitude discontinuities. |
| **Responsiveness** | Note-on → first non-zero sample < 10ms. Encoder turn → param change < 1ms. Pad tap → new patch audible < 500ms (new engine), instant (cached). | `latency.test.ts` for note-on; the rest is felt by hand. |
| **Parameter coverage** | Every `SynthParam` has `ParamSignalHints` and is exercised by signal tests. | Grep for params lacking hints; CI-style assertion in `audio-signal.test.ts`. |
| **Preset quality** | Factory presets sound like their names; spectrally distinct from each other. | `preset-sonic.test.ts` (non-silence + diversity). |
| **Stability under load** | Multiple engines + max voices + rapid switching + all-notes-off panic don't break the system. | `engine-pool-stress.test.ts`, `perf.test.ts`. |

---

## Part 4 — The Cycle

The inner loop, repeated between human checkpoints:

1. **Read** — CLAUDE.md, then DOCTRINE.md, then any docs/* relevant to the task.
2. **Orient** — `git log --oneline -10`. Check for mid-flight work. Check open PRs.
3. **Pick** — apply the Triage Protocol below.
4. **Research** — read the code, understand the problem before writing.
5. **Implement** — code + tests, in that order if possible.
6. **Measure** — `pnpm typecheck && pnpm lint && pnpm test`. Tests must not regress between commits; build must pass.
7. **Audit** — was any axis in Part 3 affected? If so, did you add the relevant test?
8. **Document** — update the affected doc (CLAUDE.md, SOUND_ENGINE.md, BROWSER_SUPPORT.md, etc.) before committing.
9. **Commit** — conventional commit message. Each logical unit of work gets its own commit.

### 4.1 Triage Protocol

1. **Stop the bleeding.** Tests failing on the branch? Build broken? Fix first.
2. **Continue mid-flight work.** Check `git log` and the active PR for partial implementations.
3. **Close the biggest gap.** Which axis in Part 3 is the weakest right now?
4. **Prefer smaller scope.** Ship what you can complete in one cycle.
5. **If tied:** pick the item closest to the zen — user experience over internals.

### 4.2 Rollback Protocol

| Signal | Action |
|---|---|
| Tests went from passing → failing on this branch | `git revert`, investigate before retrying |
| New NaN or silence in signal tests | Fix immediately, before anything else |
| Bundle size jumped > 20% with no feature gain | `git revert`, investigate |

### 4.3 Escalation

**Report to the human and pause this thread (continue with other work) when:**

1. A signal-test regression resists 2 revert-and-retry cycles.
2. Faust DSP won't compile (syntax / dependency issue beyond agent's scope).
3. A browser API broke core functionality (Web MIDI, AudioWorklet, SharedArrayBuffer).
4. The human's intent is genuinely unclear — don't guess at architectural direction.

**Don't pause for things you can fix:** test failures, coverage gaps, stale docs, dependency bumps, formatting.

---

## Part 5 — Working with the human

This project moves via human-driven product work plus agent execution. The human sets direction (what to build, what trade-offs to make, when to ship); the agent runs the cycle within that direction. **You are not autonomous between sessions** — you're a focused pair-programmer for the duration of one session.

What that means in practice:

- **Don't gold-plate.** If the human asks for X, deliver X. Surface adjacent improvements as a one-line "want me to also…" — don't sneak them in.
- **Don't self-assign architectural direction.** Implementation choices are yours; product / API / UX direction is the human's.
- **Surface trade-offs early, decide once.** "Two ways to do this — A is faster, B is cleaner. I'd lean B because… — sound right?" beats either silently picking or pinging on every fork.
- **When the cycle empties, stop.** Don't generate new work to fill silence. Ask what's next.

The hardware itself is the ultimate integration test — that's the human's role and yours to support, not replace.
