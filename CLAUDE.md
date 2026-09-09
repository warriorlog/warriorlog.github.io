# Warriorlog — working notes

A two-person gamified workout log. Static PWA on GitHub Pages, no build step, no
framework, no dependencies. `README.md` covers running and deploying; this file
is the set of invariants that must survive every future change.

## Invariants

1. **Event-sourced.** Everything persisted is an append-only event. Ladder
   positions, XP, level, flame, badges and duel scores are ALWAYS derived by
   pure functions. Never store a total. A rules change must be a recompute.
2. **One writer per file.** A device writes only `log/<its user>/<its dev>/*`.
   On pull, a line whose `user`, `dev` or month disagrees with its own path is
   dropped — that is the last defence against one partner's sets folding into
   the other's ladders.
3. **Never touch the `data` branch from a laptop.** It is an orphan branch owned
   by the phones. Code goes on `main`.
4. **XP is load-independent.** A set pays the same whatever the load, implement
   or rung. This is what makes the duel fair between two different bodies, and
   `test/gamify.test.js` pins it. Any change that makes a heavier set pay more
   breaks the whole two-player design.
5. **The day boundary is 04:00 local**, via `util.dayKey`. Streaks, weeks, month
   files and the duel all key on it.
6. **The calendar decides the week**, not a session counter, so both partners
   share boss weeks. Program week 1 is the Monday of `program_start`; the partial
   setup week is week 0.
7. **Step ids are immutable.** Insert rungs freely; never rename or delete one.
   Retire with `"retired": true`. `test/fixtures/step-ids.json` may only grow.
8. **Every rule name lives in the `RULES` registry** in `src/engine.js`, and the
   linter rejects anything else. Adding a rule means adding a case and a test.
9. **Field-level privacy.** `REDACT` in `src/events.js` is the real boundary,
   because the repository is public. New fields default to private until
   reviewed. A test asserts no redacted name reaches a payload.
10. **Anything shipped must be in the service worker's `SHELL`**, or it will not
    work offline. A test compares the list to the files on disk.
11. **Copy lives in `data/copy.json`**, and never uses the words lost, failed,
    missed, behind or lazy.
12. **Bump `rulesVersion`** when XP or ladder rules change. XP, levels, regions,
    badges and the flame re-derive; locked weeks and resolved bosses stay frozen.

## The safety chain, and why it is shaped this way

The 53 lb bell is the only genuinely dangerous object in the house. Every 53 lb
rung sits behind `hinge_deadlift.kb53_floor`, reached only through 12 → 20 → 35 lb
Romanian deadlifts. The first 53 lb swing additionally needs the 35 lb dumbbell
swing rung and a full hollow hold.

The hinge is trained **twice a week** for a reason: a review of the first draft
proved that once a week made the bell mathematically unreachable inside twelve
weeks, which made every phase-2 and phase-3 promise false.
`test/program.test.js` replays a perfect beginner through the real templates and
fails the build if the bell is not earned by week 9. Do not weaken that test.

Benchmarks carry gated **variants** because week 4 arrives before the run and
bell gates open: the mile is walked until the run gate, and the swing test is
locked below continuous swings.

## Adding to the program

- New exercise: add it to `data/program.json` with `region_weights` summing to 1,
  a `stop_if`, full ladder, and a fixture in `test/program.test.js` if it gates
  anything. Add it to the gamification region table if it should fill the body map.
- New rung: append it, give it a new stable id, keep ordinals contiguous.
- Always run `npm test` before pushing. The linter is the gate; nothing else runs.

## Layout

```
data/       program, gamification, copy — the app's behaviour lives here
data/frag/  provenance: the per-group fragments program.json was assembled from
design/     the full design outputs and the reviews that shaped them
src/        engine, reducer, gamification, duo, sync, store, views
test/       node:test, zero dependencies
scripts/    assemble.mjs — an authoring aid, NOT a build step
```
