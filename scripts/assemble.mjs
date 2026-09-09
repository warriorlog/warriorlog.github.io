#!/usr/bin/env node
// Authoring aid, NOT a build step: merges data/frag/*.json into data/program.json.
// data/program.json is committed and is the only file the app reads; the
// fragments are provenance. After the first assembly, edit program.json directly
// (or re-run this if you regenerate a whole group).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fragDir = join(root, 'data', 'frag');
const read = (f) => JSON.parse(readFileSync(join(fragDir, f), 'utf8'));

const GROUPS = ['push', 'pull', 'legs', 'hinge', 'core', 'cardio'];
const exercises = [];
for (const g of GROUPS) exercises.push(...read(`${g}.json`).exercises);

const { templates } = read('templates.json');
const { benchmarks, placement } = read('benchmarks.json');

const program = {
  id: 'warrior_forge_12',
  title: 'Warrior Forge 12: Duo Edition',
  schemaVersion: 1,
  rulesVersion: 1,
  defaults: { program_start_dow: 1, rest_dow: 0, session_minutes: 45 },
  phases: [
    { id: 'recruit', name: 'Recruit', weeks: [1, 4], rir: 3, eccentric_s: 3,
      note: 'Own every pattern, pass the hinge gate, build the Zone-2 base. Vest locked, dumbbell swings only.' },
    { id: 'soldier', name: 'Soldier', weeks: [5, 8], rir: 2, eccentric_s: 2,
      note: 'The bell enters as gates pass; vest unlocks per exercise; dumbbells bridge 12-20-35 with tempo and 1.5-reps.' },
    { id: 'warrior', name: 'Warrior', weeks: [9, 12], rir: 1, eccentric_s: 2,
      note: 'Density clock toward 100 swings in 5:00, one-hand swings if earned, vest walks, run intervals.' },
  ],
  on_ramp: { weeks: [0, 1, 2], set_multiplier: 0.6, rir: 4,
    note: 'Two people with no training in six months do not start at full volume; week 3 is the first full week.' },
  deload: { set_multiplier: 0.6, rounding: 'down', min_sets: 2, rir: 4, swing_sets: 3,
    zone2_pct: 70, zone2_incline_delta: -1, every_n_weeks: 4,
    ladders_frozen: true, counters_keep_counting: true },
  week_overrides: {
    12: { set_multiplier: 0.5, days: { 4: 'walk_25', 5: 'off' },
          note: 'Taper into the final boss battle.' },
  },
  auto_deload: { fail_exercises: 2, over_sessions: 3, pain_flags: 2, pain_days: 7,
    cooked_button: { days: 3, per_weeks: 4 } },
  time_guard: [
    { action: 'trim', target: 'zone2_finisher', floor_min: 4 },
    { action: 'trim', target: 'cooldown_flow', floor_min: 2 },
    { action: 'drop_last_set', block: 'strength_b' },
    { action: 'never', exercise_ids: ['turkish_get_up', 'swing', 'swing_density', 'warmup_flow'] },
  ],
  templates,
  exercises,
  benchmarks,
  placement,
};

const out = join(root, 'data', 'program.json');
writeFileSync(out, JSON.stringify(program, null, 2) + '\n');
const steps = exercises.reduce((n, e) => n + e.ladder.length, 0);
console.log(`data/program.json: ${exercises.length} exercises, ${steps} steps, ${templates.length} templates, ${benchmarks.length} benchmarks`);
