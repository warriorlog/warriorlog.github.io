import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../src/engine.js';
import { reduce } from '../src/reduce.js';
import { makeEvent, TYPES } from '../src/events.js';
import { miniProgram, equipment as miniEq } from './fixtures/mini-program.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const spec = E.indexSpec(program);

const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10,
  vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5,
  chair_height_in: 18, couch_edge: true, kb: [53],
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};

// The two placements the program must serve: the weakest realistic beginner and
// a stronger one. Every prescription assertion below runs against both.
const CAT = {
  push_up: 'push_up.wall', goblet_squat: 'goblet_squat.chair', db_overhead_press: 'db_overhead_press.half_kneel_8',
  db_row: 'db_row.db12', hinge_deadlift: 'hinge_deadlift.wall_drill', swing: 'swing.hike_park_20',
  hollow_hold: 'hollow_hold.dead_bug', treadmill_zone2: 'treadmill_zone2.flat_20',
};
const SEAN = {
  push_up: 'push_up.knee', goblet_squat: 'goblet_squat.db12', db_overhead_press: 'db_overhead_press.half_kneel_10',
  db_row: 'db_row.db20', hinge_deadlift: 'hinge_deadlift.rdl_12', swing: 'swing.hike_park_20',
  hollow_hold: 'hollow_hold.tuck_hold', treadmill_zone2: 'treadmill_zone2.w30_2',
};

function userWith(floor, extra = {}) {
  const ts = '2026-09-13T18:00:00Z';
  const events = [
    makeEvent(TYPES.PROFILE, { name: 'X', program_start: '2026-09-14', rest_dow: 0, session_minutes: 50, bodyweight_lb: 128, ...extra }, { user: 'cat', dev: 'd1', ts }),
    makeEvent(TYPES.EQUIPMENT, EQ, { user: 'cat', dev: 'd1', ts }),
    makeEvent(TYPES.ASSESSMENT, { start_steps: floor }, { user: 'cat', dev: 'd1', ts }),
  ];
  return reduce(events, spec, { equipment: EQ }).users.cat;
}

// ---------------------------------------------------------------- rules
test('every rule in the registry answers correctly on both sides', () => {
  const hit = { sets: [{ value: 15 }, { value: 15 }], allDone: true };
  const missOne = { sets: [{ value: 15 }, { value: 14 }], allDone: true };
  assert.equal(E.evalRule({ rule: 'all_sets_reps_gte', value: 15 }, hit, {}), true);
  assert.equal(E.evalRule({ rule: 'all_sets_reps_gte', value: 15 }, missOne, {}), false);
  assert.equal(E.evalRule({ rule: 'all_sets_reps_gte', value: 15 }, { sets: [{ value: 15 }], allDone: false }, {}), false);
  assert.equal(E.evalRule({ rule: 'rounds_gte', value: 8 }, { rounds: 8, sets: [] }, {}), true);
  assert.equal(E.evalRule({ rule: 'clock_lte', value: 300 }, { clockSec: 299, sets: [] }, {}), true);
  assert.equal(E.evalRule({ rule: 'clock_lte', value: 300 }, { clockSec: 301, sets: [] }, {}), false);
  assert.equal(E.evalRule({ rule: 'cardio_done', rpe_max: 4 }, { cardioDone: true, rpeBlock: 4, sets: [] }, {}), true);
  assert.equal(E.evalRule({ rule: 'cardio_done', rpe_max: 4 }, { cardioDone: true, rpeBlock: 6, sets: [] }, {}), false);
  assert.equal(E.evalRule({ rule: 'checklist_all_ok' }, { sets: [{ checklist_ok: true }, { checklist_ok: false }] }, {}), false);
  assert.equal(E.evalRule({ rule: 'drops_lte', value: 0 }, { drops: 1, sets: [] }, {}), false);
  assert.equal(E.evalRule({ rule: 'rpe_min', value: 6 }, { rpeBlock: 7, sets: [] }, {}), true);
  assert.equal(E.evalRule({ rule: 'sessions_gte', value: 3 }, { sets: [] }, { sessionsAtStep: 3 }), true);
  assert.equal(E.evalRule({ rule: 'weeks_elapsed_gte', value: 3 }, { sets: [] }, { weekIndex: 2 }), false);
  assert.equal(E.evalRule({ rule: 'no_pain_flag_days', region: 'shin', days: 14 }, { sets: [] }, { painFlags: [{ region: 'shin', daysAgo: 3 }] }), false);
  assert.equal(E.evalRule({ rule: 'no_pain_flag_days', region: 'shin', days: 14 }, { sets: [] }, { painFlags: [{ region: 'knee', daysAgo: 3 }] }), true);
  assert.equal(E.evalRule({ rule: 'benchmark_gte', id: 'x', value: 10 }, { sets: [] }, { benchmarks: { x: { value: 11 } } }), true);
  assert.equal(E.evalRule({ rule: 'all_of', rules: [{ rule: 'rounds_gte', value: 1 }, { rule: 'drops_lte', value: 0 }] }, { rounds: 2, drops: 0, sets: [] }, {}), true);
});

test('an unknown rule throws instead of quietly never advancing', () => {
  assert.throws(() => E.evalRule({ rule: 'vibes_gte', value: 1 }, { sets: [] }, {}), /unknown rule/);
});

// ---------------------------------------------------------------- equipment
test('steps needing equipment the household lacks are dropped, not prescribed', () => {
  const noBell = E.resolveSteps(spec.byExercise.goblet_squat, { ...EQ, kb: [] });
  assert.ok(!noBell.some(s => s.implement_id === 'kb53'), 'no bell steps without a bell');
  assert.ok(noBell.length > 0, 'the ladder still has usable rungs');
});

test('a single dumbbell falls back to the one-arm variant rather than vanishing', () => {
  const singles = { ...EQ, dumbbells: { 8: 'single', 10: 'single', 12: 'single', 20: 'single', 35: 'single' } };
  for (const ex of program.exercises) {
    assert.ok(E.resolveSteps(ex, singles).length > 0, `${ex.id}: nothing usable with single dumbbells`);
  }
});

test('the treadmill is clamped to the machine the user owns', () => {
  const c = E.resolveCardio({ mph: 3.5, incline: 12 }, { treadmill_max_incline: 8, treadmill_max_mph: 6 });
  assert.equal(c.incline, 8);
  assert.equal(c.mph, 3.8, 'a missing hill is traded for a little speed');
  assert.equal(c.substituted, true);
});

test('vest load is a percentage of bodyweight, rounded down, capped at 30 lb and 20%', () => {
  assert.equal(E.resolveVest(10, 128, { vest_increment_lb: 5, vest_max_lb: 40 }), 10);
  assert.equal(E.resolveVest(10, 200, { vest_increment_lb: 5, vest_max_lb: 40 }), 20);
  assert.equal(E.resolveVest(20, 300, { vest_increment_lb: 5, vest_max_lb: 40 }), 30, 'hard 30 lb ceiling');
  assert.ok(E.resolveVest(15, 128, { vest_increment_lb: 5, vest_max_lb: 40 }) <= 0.2 * 128);
  assert.equal(E.resolveVest(10, null, { vest_increment_lb: 5 }), 0, 'no bodyweight, no vest');
});

// ---------------------------------------------------------------- prescribing
test('day one is safe for the weakest beginner: no bell, no vest, no running', () => {
  const cat = userWith(CAT);
  for (const day of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']) {
    const plan = E.prescribe(spec, cat, day, { equipment: EQ });
    for (const r of plan.rows) {
      assert.notEqual(r.implement_id, 'kb53', `${day}: the 53 lb bell on day one`);
      assert.ok(!r.vest_lb, `${day}: the vest on day one`);
    }
  }
});

test('both placements get a full, honest week', () => {
  for (const [name, floor] of [['cat', CAT], ['sean', SEAN]]) {
    const u = userWith(floor);
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']) {
      const plan = E.prescribe(spec, u, day, { equipment: EQ });
      assert.ok(plan.rows.length > 0, `${name} ${day}: nothing to do`);
      assert.ok(plan.est_minutes >= 40 && plan.est_minutes <= 50, `${name} ${day}: ${plan.est_minutes} min`);
      for (const r of plan.rows) assert.ok(r.A > 0 || r.minutes > 0, `${name} ${day}: ${r.exercise_id} has no target`);
    }
    const rest = E.prescribe(spec, u, '2026-09-20', { equipment: EQ });
    assert.equal(rest.rest, true, `${name}: Sunday is the rest day`);
  }
});

test('the on-ramp lightens the first weeks without ever adding sets', () => {
  const cat = userWith(CAT);
  const wk1 = E.prescribe(spec, cat, '2026-09-14', { equipment: EQ });
  const wk3 = E.prescribe(spec, cat, '2026-09-28', { equipment: EQ });
  const setsOf = (p, id) => p.blocks.flatMap(b => b.items).find(i => i.exercise_id === id)?.sets;
  assert.ok(setsOf(wk1, 'goblet_squat') < setsOf(wk3, 'goblet_squat'), 'week 1 is lighter than week 3');
  assert.equal(setsOf(wk1, 'warmup_flow'), 1, 'a one-set warm-up is never scaled up');
  assert.equal(wk1.rir, 4, 'the on-ramp keeps reps in reserve high');
});

test('a locked movement is replaced by its fallback, never simply skipped', () => {
  const cat = userWith(CAT);
  const thu = E.prescribe(spec, cat, '2026-09-17', { equipment: EQ });
  const ids = thu.blocks.flatMap(b => b.items).map(i => i.exercise_id);
  assert.ok(!ids.includes('swing'), 'the swing is still locked for a wall-hinge beginner');
  assert.ok(ids.includes('hinge_deadlift') && ids.includes('glute_bridge'), 'the fallback runs instead');
  const note = thu.blocks.flatMap(b => b.items).find(i => i.locked_note);
  assert.equal(note.locked_note.exercise_id, 'swing');
  assert.ok(note.locked_note.blocked?.step_id, 'the card names the exact condition still standing');
});

test('the same movement twice in one block becomes one card, not two', () => {
  const cat = userWith(CAT);
  const thu = E.prescribe(spec, cat, '2026-09-17', { equipment: EQ });
  const block = thu.blocks.find(b => b.kind === 'strength_a');
  const hinges = block.items.filter(i => i.exercise_id === 'hinge_deadlift');
  assert.equal(hinges.length, 1, 'the hinge appears once');
  assert.equal(hinges[0].rows.length, hinges[0].sets, 'with the sets merged');
  assert.deepEqual([...new Set(hinges[0].rows.map(r => r.set_index))].sort((a, b) => a - b),
    Array.from({ length: hinges[0].sets }, (_, i) => i + 1), 'and set numbers stay 1..n');
});

test('a boss week deloads the strength days and runs the benchmark script on Saturday', () => {
  const cat = userWith(CAT);
  const mon = E.prescribe(spec, cat, '2026-10-05', { equipment: EQ });   // week 4
  assert.equal(mon.deload, true);
  assert.equal(mon.boss, true);
  assert.equal(mon.rir, spec.deload.rir, 'deload reps in reserve');
  const normal = E.prescribe(spec, cat, '2026-09-28', { equipment: EQ });
  const sets = (p, id) => p.blocks.flatMap(b => b.items).find(i => i.exercise_id === id)?.sets ?? 0;
  assert.ok(sets(mon, 'goblet_squat') < sets(normal, 'goblet_squat'), 'fewer sets in the deload');
});

test('the Zone-2 walk shrinks on a deload week instead of running as normal', () => {
  const cat = userWith(CAT);
  const zone = (day) => E.prescribe(spec, cat, day, { equipment: EQ })
    .blocks.flatMap(b => b.items).find(i => i.exercise_id === 'treadmill_zone2')?.cardio?.minutes;
  assert.ok(zone('2026-10-07') < zone('2026-09-30'), 'boss-week Wednesday is shorter');
});

test('a short day trims the finisher and the last accessory set, never the get-up or the swings', () => {
  const cat = userWith(CAT, { session_minutes: 40 });
  const plan = E.prescribe(spec, cat, '2026-09-14', { equipment: EQ });
  assert.ok(plan.est_minutes <= 45, `trimmed to ${plan.est_minutes}`);
  const dropped = plan.rows.filter(r => r.prescribed === false);
  assert.ok(dropped.every(r => !['turkish_get_up', 'swing', 'swing_density', 'warmup_flow'].includes(r.exercise_id)));
});

test('a dropped set counts for neither fidelity nor available XP', () => {
  const cat = userWith(CAT, { session_minutes: 40 });
  const plan = E.prescribe(spec, cat, '2026-09-15', { equipment: EQ });
  for (const r of plan.rows) assert.equal(typeof r.prescribed, 'boolean');
});

test('the prefill is what you did last time, so one tap means match it', () => {
  const cat = userWith(CAT);
  const first = E.prescribe(spec, cat, '2026-09-14', { equipment: EQ });
  const row = first.rows.find(r => r.exercise_id === 'goblet_squat');
  assert.equal(row.target, row.A, 'a fresh step starts at the low end');
  assert.equal(row.last, null);
});

test('every advance rule can be explained in plain words on the card', () => {
  for (const ex of program.exercises) {
    for (const step of ex.ladder) {
      if (step.terminal) continue;
      assert.ok(E.describeAdvance(step), `${step.id}: no plain-English unlock line`);
    }
  }
});

// ---------------------------------------------------------------- schedule
test('the calendar, not a session counter, decides the week and the boss', () => {
  assert.equal(E.scheduleFor(spec, '2026-09-09', '2026-09-14').week, 0, 'setup week is Muster');
  assert.equal(E.scheduleFor(spec, '2026-09-14', '2026-09-14').week, 1);
  for (const d of ['2026-10-10', '2026-11-07', '2026-12-05']) {
    assert.equal(E.scheduleFor(spec, d, '2026-09-14').boss, true, `${d} is a boss Saturday`);
  }
  assert.equal(E.scheduleFor(spec, '2026-09-26', '2026-09-14').boss, false);
});

test('week 12 tapers: Friday is off', () => {
  const cat = userWith(CAT);
  const fri = E.prescribe(spec, cat, '2026-12-04', { equipment: EQ });
  assert.equal(fri.rest, true);
  assert.equal(fri.off, true);
});

test('missing a day shifts nothing: the template is the weekday', () => {
  const cat = userWith(CAT);
  assert.equal(E.prescribe(spec, cat, '2026-09-14', { equipment: EQ }).template_id, 'mon_lower_a');
  assert.equal(E.prescribe(spec, cat, '2026-09-21', { equipment: EQ }).template_id, 'mon_lower_a');
});

// ---------------------------------------------------------------- ladders
test('gates block entry to a step, and name what is still missing', () => {
  const specMini = E.indexSpec(miniProgram);
  const steps = E.resolveSteps(specMini.byExercise.swing, miniEq);
  const locked = { ladders: { push_up: { step_id: 'push_up.wall' } }, spec: specMini };
  const open = { ladders: { push_up: { step_id: 'push_up.full' } }, spec: specMini };
  assert.equal(E.entryOpen(steps[1], locked), false);
  assert.equal(E.entryOpen(steps[1], open), true);
  assert.equal(E.blockedBy(steps[1], locked).step_id, 'push_up.knee');
  assert.equal(E.blockedBy(steps[1], open), null);
});

test('an exercise programmed twice in one day gets distinct set numbers', () => {
  // Tuesday runs prone_ytw in the warm-up and again in the finisher. A set is
  // identified by (session, exercise, set_index, side, part), so if both cards
  // started at set 1 the second card's sets would overwrite the first under
  // last-write-wins and silently disappear from the log.
  const cat = userWith(CAT);
  for (const day of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']) {
    const plan = E.prescribe(spec, cat, day, { equipment: EQ });
    const keys = plan.rows.map(r => `${r.exercise_id}|${r.set_index}|${r.side ?? ''}|${r.part ?? ''}`);
    assert.equal(new Set(keys).size, keys.length, `${day}: two rows share a set identity`);
  }
});

test('a session logged exactly as prescribed hits every target', async () => {
  const cat = userWith(CAT);
  const plan = E.prescribe(spec, cat, '2026-09-15', { equipment: EQ });
  const session = {
    type: 'full', plan: { rows: plan.rows },
    sets: plan.rows.filter(r => r.prescribed !== false).map(r => ({
      exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
      side: r.side, part: r.part, unit: r.unit, value: r.unit === 'min' ? r.minutes : r.B, checklist_ok: true,
    })),
  };
  const { fidelity } = await import('../src/gamify.js');
  assert.equal(fidelity(session, spec).pct, 1);
});
