# Warriorlog data schema (v1) — the contract

`data/program.json`, `data/exercises.json`, `data/gamification.json` and `data/copy.json` are the only
sources of truth for behaviour. Code reads them; it never hard-codes a rep, a load or a rule.
`test/program.test.js` lints every rule below and fails the build on any violation.

## 0. Conventions

- ids are `snake_case`. Step ids are `<exercise_id>.<slug>` (e.g. `push_up.wall`, `swing.deadstop_53`).
- **Step ids are immutable.** Insert new rungs freely, never rename or delete one; retire with `"retired": true`.
  `ord` (1-based) is display order only; gates never reference `ord`.
- Loads only ever come from: bodyweight, vest, dumbbells 8/10/12/20/35, one 53 lb kettlebell, treadmill.
- All durations in seconds unless the field name ends in `_min`.

## 1. `data/program.json`

```jsonc
{
  "id": "warrior_forge_12",
  "title": "Warrior Forge 12: Duo Edition",
  "rulesVersion": 1,
  "schemaVersion": 1,
  "defaults": { "program_start_dow": 1, "rest_dow": 0, "session_minutes": 45 },
  "phases": [ { "id": "recruit", "name": "Recruit", "weeks": [1,4], "rir": 3,
                "eccentric_s": 3, "note": "..." } ],
  "on_ramp": { "weeks": [0,1,2], "set_multiplier": 0.6, "rir": 4 },
  "deload": { "set_multiplier": 0.6, "rounding": "down", "min_sets": 2, "rir": 4,
              "swing_sets": 3, "zone2_pct": 70, "zone2_incline_delta": -1,
              "every_n_weeks": 4, "ladders_frozen": true, "counters_keep_counting": true },
  "week_overrides": { "12": { "set_multiplier": 0.5, "days": { "4": "walk_25", "5": "off" } } },
  "auto_deload": { "fail_exercises": 2, "over_sessions": 3, "pain_flags": 2, "pain_days": 7,
                   "cooked_button": { "days": 3, "per_weeks": 4 } },
  "time_guard": ["zone2_finisher_min>=4", "cooldown_min>=2", "drop_last_strength_b_set",
                 "never:turkish_get_up", "never:swing", "never:warmup_flow"],
  "templates": [ /* §2 */ ],
  "exercises": [ /* §3 */ ],
  "benchmarks": [ /* §4 */ ],
  "placement": { /* §5 */ }
}
```

## 2. Template (one per weekday)

```jsonc
{
  "id": "mon_lower_a", "dow": 1, "name": "Lower A", "focus": "...", "minutes": 48,
  "blocks": [
    { "kind": "warmup|strength_a|strength_b|conditioning|finisher|cooldown", "minutes": 6,
      "items": [
        { "exercise_id": "goblet_squat", "sets": 4, "rest_sec": 90,
          "note": "Phase 1: 3 s eccentric",
          "counts_for_progression": true,       // false => logging never moves that ladder
          "time_override_min": null,            // minutes for cardio items that are not the main block
          "phase_sets": { "1": 3, "2": 4, "3": 4 },   // optional per-phase override
          "fallback_when_locked": [ { "exercise_id": "hinge_deadlift", "sets": 3 } ] } ] }
  ],
  "skirmish": { "warmup_min": 2, "rounds": 3, "rest_sec": 45,
                "exercise_ids": ["goblet_squat","hinge_deadlift","calf_raise"],
                "cardio": { "exercise_id": "zone2_finisher", "minutes": 6 } }   // Wed/Sat only
}
```
Rules the linter enforces: every `exercise_id` exists; block minutes sum to `minutes`; `minutes` in 40–50
(0 for the rest day); a `sat_warrior` template exists and is replaced by the boss script on boss weeks.

## 3. Exercise + ladder

```jsonc
{
  "id": "push_up", "name": "Push-up", "region": "chest", "pattern": "push",
  "equipment": "wall, chair, floor, vest",
  "cues": ["…", "…"], "stop_if": "Sharp pain, or hips sagging you cannot fix",
  "region_weights": { "chest": 0.5, "arms": 0.25, "shoulders": 0.15, "core": 0.1 },  // sums to 1.0
  "checklist": { "n": 5, "cues": ["hinge not squat", "…"] },   // omit when the exercise has no checklist
  "ladder": [ /* steps */ ]
}
```

### Step

```jsonc
{
  "id": "push_up.wall", "ord": 1, "name": "Wall push-up", "how": "Hands on wall …",
  "unit": "reps",                 // reps | sec | rounds | clock_sec | min
  "sides": "both",                // both | each   (each => one row per side)
  "A": 10, "B": 15,               // per-set target low / advance threshold (A==B for fixed targets)
  "parts": [ { "key": "y", "name": "Y", "A": 8, "B": 10 } ],   // optional; replaces A/B, one row per part
  "load": { "kind": "bw", "lb": 0, "n": 1, "vest_pct": null, "cap_lb": 30 },
                                  // kind: bw | db | kb | vest | bw_vest | db_vest
  "implement_id": "bw",           // bw | db8 | db10 | db12 | db20 | db35 | kb53 | vest
  "requires": ["bw"],             // equipment tokens: bw | db:12 | db:12:pair | kb:53 | vest | treadmill | chair | couch
  "single_alt": { "how": "…", "A": 8, "B": 12 },   // used when the household has no pair
  "cardio": { "mph": 3.0, "incline": 2, "minutes": 30, "rpe_max": 4,
              "rounds": 6, "work_sec": 60, "rest_sec": 90, "mph_work": 5.5, "hard_min": 6 },
  "checklist_required": true,     // this step needs the exercise's checklist ticked to count as "met"
  "entry_requires": [ { "rule": "ladder_at_or_past", "exercise": "hinge_deadlift",
                        "step_id": "hinge_deadlift.rdl_35" } ],   // blocks USE, evaluated every session
  "advance": { "rule": "all_sets_reps_gte", "value": 15, "consecutive": 2,
               "requires": [ /* extra rule objects, all must hold */ ],
               "unlocks": ["vest:push_up"] },
  "terminal": false,
  "retired": false
}
```

### RULES registry (closed; `src/engine.js` owns it, the linter rejects anything else)

| rule | args | meaning |
| --- | --- | --- |
| `all_sets_reps_gte` | `value` | every prescribed set logged with reps ≥ value |
| `all_sets_time_gte` | `value` | same for seconds |
| `rounds_gte` | `value` | EMOM/interval rounds completed |
| `clock_lte` | `value` | density clock seconds ≤ value |
| `cardio_done` | `rpe_max` | steady block completed at ≥ prescribed minutes, RPE ≤ rpe_max |
| `checklist_all_ok` | — | every set's checklist full |
| `drops_lte` | `value` | get-up drops ≤ value |
| `rpe_min` | `value` | block RPE ≥ value (interval hard efforts) |
| `sessions_gte` | `value` | this step performed ≥ value times (time-gated skill steps) |
| `weeks_elapsed_gte` | `value` | program weeks since start ≥ value |
| `no_pain_flag_days` | `region`, `days` | no pain ≥ 3 flagged for that region in the window |
| `ladder_at_or_past` | `exercise`, `step_id` | another ladder is at or past that step |
| `benchmark_gte` / `benchmark_lte` | `id`, `value` | latest benchmark value comparison |
| `all_of` | `rules[]` | conjunction |

Fixed engine behaviour (not data): advance needs the rule on `consecutive` **full** sessions
(Skirmish/Ember never count; deload sessions keep counting but the advance applies on the first
non-deload session); one advance per exercise per session; FAIL = any set < 0.6·A or pain ≥ 3;
two consecutive FAILs or two pain flags in 7 days regress one step, never below the placement floor;
a session gap > 7 days suppresses advancement, 8–14 days regresses every ladder one step and repeats
the week, > 14 days regresses two and restarts the phase.

## 4. Benchmark

```jsonc
{
  "id": "bb_pushups_2min", "name": "Two-minute push-ups", "unit": "reps",
  "higher_is_better": true, "order": 2, "region": "chest", "parent_exercise": "push_up",
  "protocol": "…", "every_weeks": 4,
  "variants": [
    { "id": "full", "when": [ { "rule": "ladder_at_or_past", "exercise": "push_up",
                                "step_id": "push_up.full" } ],
      "how": "Full push-ups", "multiplier": 1,
      "tiers": [0, 15, 30, 45], "tier_cap": 3 },
    { "id": "knee", "when": [], "how": "Knee push-ups count 0.5",
      "multiplier": 0.5, "tiers": [0, 15, 30, 45], "tier_cap": 3 }
  ]
}
```
`tiers` is a 4-element array of lower bounds (recruit, soldier, warrior, champion) for
`higher_is_better`, or upper bounds when false (mile time). The first variant whose `when` rules all
hold is used; the last variant must have `"when": []` so a variant always resolves. `tier_cap`
limits the tier a variant can award.

## 5. Placement

```jsonc
{
  "questions": [ { "id": "q1", "prompt": "Max clean full push-ups?",
                   "type": "int|choice|bool", "choices": [ { "value": "wall", "label": "…" } ] } ],
  "rules": [ { "when": { "q": "q1", "op": "between", "value": [10,14] },
               "set": { "push_up": "push_up.full" } } ],
  "default_step": "first",                    // every ladder not named by a rule starts at ord 1
  "locked": [ { "when": { "q": "q5_slides", "op": "eq", "value": false },
                "cap": { "db_overhead_press": "db_overhead_press.half_kneel_8",
                         "pike_push_up": "pike_push_up.incline" }, "note": "see a clinician" } ]
}
```

## 6. `data/gamification.json`

Holds the XP table, level curve, rank titles, region list, gear slots (referencing **step ids** and
benchmark ids), badge definitions (each with a machine-checkable `criterion` object), streak/shield/
mode parameters, the duel weights and statuses, boss table and HP, the progressive-unlock schedule,
and `rulesVersion`. Every user-facing string lives in `data/copy.json`, keyed by id.

## 7. Hard invariants (linted)

1. Every `exercise_id` in a template, skirmish list, placement rule, gear slot or badge exists.
2. Every step id is unique, matches `^<exercise_id>\.[a-z0-9_]+$`, and appears in `test/fixtures/step-ids.json` (that file may only grow).
3. Every rule name is in the RULES registry; every `step_id` / `exercise` reference resolves.
4. Every step reachable: no `entry_requires` cycle; a perfect all-first-step user reaches `swing.cont_53` by week 9 (simulation).
5. Block minutes sum to the template's minutes; every training template is 40–50 min.
6. Every step whose `implement_id` is `kb53` has an `entry_requires` naming `hinge_deadlift`.
7. `region_weights` sum to 1.0 (±0.001) and use only the ten canonical regions.
8. No XP value anywhere depends on load, implement or step ordinal.
9. Every benchmark's last variant has an empty `when`.
10. Every vest step declares `vest_pct` and a `cap_lb` ≤ 30.
