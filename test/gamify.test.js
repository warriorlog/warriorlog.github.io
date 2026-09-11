import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/gamify.js';
import { indexSpec, prescribe } from '../src/engine.js';
import { reduce } from '../src/reduce.js';
import { makeEvent, TYPES } from '../src/events.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);

const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10,
  vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5, chair_height_in: 18, couch_edge: true, kb: [53],
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};
const CAT = { push_up: 'push_up.wall', goblet_squat: 'goblet_squat.chair', hinge_deadlift: 'hinge_deadlift.wall_drill' };
const SEAN = { push_up: 'push_up.full', goblet_squat: 'goblet_squat.db35', hinge_deadlift: 'hinge_deadlift.rdl_35' };

let n = 0;
const ev = (type, data, user, ts, extra = {}) => makeEvent(type, data, { user, dev: user.slice(0, 3) + '1', ts: ts ?? new Date(Date.UTC(2026, 8, 14, 13, n++)).toISOString(), ...extra });

/** Build a user who trained `days` with a perfect session each time. */
function trained(floor, days, { user = 'cat', bodyweight = 128, type = 'full' } = {}) {
  const events = [
    ev(TYPES.PROFILE, { name: user, program_start: '2026-09-14', rest_dow: 0, session_minutes: 50, bodyweight_lb: bodyweight }, user, '2026-09-13T18:00:00Z'),
    ev(TYPES.EQUIPMENT, EQ, user, '2026-09-13T18:01:00Z'),
    ev(TYPES.ASSESSMENT, { start_steps: floor }, user, '2026-09-13T18:02:00Z'),
  ];
  let state = reduce(events, spec, { equipment: EQ }).users[user];
  for (const day of days) {
    const plan = prescribe(spec, state, day, { equipment: EQ });
    if (plan.rest) continue;
    const id = `s_${user}_${day}`;
    events.push(ev(TYPES.SESSION_START, { session_id: id, template_id: plan.template_id, type, date: day, deload: plan.deload, plan: { rows: plan.rows } }, user, `${day}T13:00:00Z`));
    for (const r of plan.rows) {
      if (r.prescribed === false) continue;
      events.push(ev(TYPES.SET, {
        session_id: id, exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
        side: r.side, part: r.part, unit: r.unit, value: r.unit === 'min' ? r.minutes : r.B,
        implement_id: r.implement_id, vest_lb: r.vest_lb, checklist_ok: true, talk_test_ok: true, done: true,
      }, user, `${day}T13:${String(30 + (n++ % 25)).padStart(2, '0')}:00Z`));
    }
    events.push(ev(TYPES.SESSION_END, { session_id: id, duration_min: 47 }, user, `${day}T14:00:00Z`));
    state = reduce(events, spec, { equipment: EQ }).users[user];
  }
  return { state, events };
}

const WEEK = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];

// ---------------------------------------------------------------- levels
test('the level curve matches the published table', () => {
  for (const [level, xp] of [[2, 120], [3, 339], [4, 624], [5, 960], [10, 3240], [20, 9938], [50, 41160]]) {
    assert.equal(G.xpForLevel(level, gam), xp, `level ${level}`);
  }
  assert.equal(G.levelFor(0, gam).level, 1);
  assert.equal(G.levelFor(119, gam).level, 1);
  assert.equal(G.levelFor(120, gam).level, 2);
  assert.equal(G.levelFor(41160, gam).level, 50);
});

test('rank titles are ascending and every level has one', () => {
  const ranks = gam.ranks;
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i].level > ranks[i - 1].level);
  for (const lvl of [1, 2, 5, 17, 33, 60, 99]) assert.ok(G.levelFor(G.xpForLevel(lvl, gam), gam).title);
});

// ---------------------------------------------------------------- the fairness rule
test('XP never depends on load: Cat at the wall and Sean under the bell are paid the same', () => {
  const cat = trained(CAT, WEEK, { user: 'cat', bodyweight: 128 });
  const sean = trained(SEAN, WEEK, { user: 'sean', bodyweight: 200 });
  const rate = (r) => {
    const p = G.progress(r.state, spec, gam, '2026-09-21');
    // Only strength rows earn set XP; cardio rows pay by the minute instead.
    const rows = r.state.sessions.reduce((n, s) =>
      n + s.sets.filter(x => x.unit !== 'min' && x.unit !== 'rounds' && !spec.byExercise[x.exercise_id]?.no_xp).length, 0);
    return p.by_source.sets / rows;
  };
  assert.equal(rate(cat), rate(sean),
    'a set must pay the same whoever lifts it, or the duel rewards being stronger');
  const catP = G.progress(cat.state, spec, gam, '2026-09-21');
  const seanP = G.progress(sean.state, spec, gam, '2026-09-21');
  assert.equal(catP.by_source.quest, seanP.by_source.quest, 'finishing a quest pays the same');
  assert.equal(catP.by_source.zone2, seanP.by_source.zone2, 'a Zone-2 minute pays the same');
});

test('the same set pays the same at the bottom and the top of a ladder', () => {
  const mk = (stepId, value, B) => ({
    type: 'full', sets: [{ exercise_id: 'push_up', step_id: stepId, set_index: 1, unit: 'reps', value }],
    plan: { rows: [{ exercise_id: 'push_up', step_id: stepId, set_index: 1, A: value, B }] },
  });
  const low = G.xpForSession(mk('push_up.wall', 15, 15), spec, gam);
  const high = G.xpForSession(mk('push_up.vest_decline15', 15, 15), spec, gam);
  assert.equal(low.by_source.sets, high.by_source.sets);
});

// ---------------------------------------------------------------- session XP
test('a set pays for being logged and again for hitting the target', () => {
  const row = { exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, A: 10, B: 15 };
  const session = (value) => ({ type: 'full', plan: { rows: [row] }, sets: [{ ...row, unit: 'reps', value }] });
  assert.equal(G.xpForSession(session(15), spec, gam).by_source.sets, gam.xp.set_logged + gam.xp.set_met);
  assert.equal(G.xpForSession(session(11), spec, gam).by_source.sets, gam.xp.set_logged);
  assert.equal(G.xpForSession(session(3), spec, gam).by_source.sets, undefined, 'a set far under target pays nothing');
});

test('Zone-2 minutes are capped per day and the talk test decides the rate', () => {
  const row = { exercise_id: 'treadmill_zone2', step_id: 'treadmill_zone2.w30_2', set_index: 1, A: 30, B: 30 };
  const walk = (minutes, talk) => G.xpForSession({ type: 'full', plan: { rows: [row] }, sets: [{ ...row, unit: 'min', value: minutes, talk_test_ok: talk }] }, spec, gam);
  assert.equal(walk(30, true).by_source.zone2, 30 * gam.xp.zone2_per_min);
  assert.equal(walk(30, false).by_source.cardio, 30 * gam.xp.zone2_talk_fail_per_min);
  assert.equal(walk(30, false).zone2_min, 30);
  assert.equal(walk(90, true).by_source.zone2, gam.xp.zone2_daily_cap_min * gam.xp.zone2_per_min, 'capped at 45 minutes');
});

test('a personal record needs history, so day one is not a shower of records', () => {
  const row = { exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, A: 10, B: 15 };
  const s = { type: 'full', plan: { rows: [row] }, sets: [{ ...row, unit: 'reps', value: 20 }] };
  assert.equal(G.xpForSession(s, spec, gam, { best: {}, sessionsAtStep: {} }).prs.length, 0);
  const withHistory = G.xpForSession(s, spec, gam, { best: { 'push_up:push_up.wall': 15 }, sessionsAtStep: { 'push_up:push_up.wall': 1 } });
  assert.equal(withHistory.prs.length, 1);
  assert.equal(withHistory.by_source.records, gam.xp.rep_pr);
});

test('records are capped per session', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ exercise_id: 'push_up', step_id: 'push_up.wall', set_index: i + 1, A: 10, B: 15 }));
  const s = { type: 'full', plan: { rows }, sets: rows.map(r => ({ ...r, unit: 'reps', value: 30 })) };
  const out = G.xpForSession(s, spec, gam, { best: { 'push_up:push_up.wall': 15 }, sessionsAtStep: { 'push_up:push_up.wall': 3 } });
  assert.equal(out.prs.length, gam.xp.pr_max_per_session);
});

test('a finished quest pays its completion bonus; a short one pays less; an abandoned one still pays something', () => {
  const rows = [{ exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, A: 10, B: 15 }];
  const sets = [{ ...rows[0], unit: 'reps', value: 15 }];
  assert.equal(G.xpForSession({ type: 'full', plan: { rows }, sets }, spec, gam).by_source.quest, gam.xp.quest_full);
  assert.equal(G.xpForSession({ type: 'skirmish', plan: { rows }, sets }, spec, gam).by_source.quest, gam.xp.quest_skirmish);
  const partial = { type: 'full', plan: { rows: [...rows, { ...rows[0], set_index: 2 }] }, sets };
  assert.equal(G.xpForSession(partial, spec, gam).by_source.quest, gam.xp.ember);
});

test('a set the time guard dropped pays nothing and is not counted as missed', () => {
  const rows = [
    { exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, A: 10, B: 15, prescribed: true },
    { exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 2, A: 10, B: 15, prescribed: false },
  ];
  const s = { type: 'full', plan: { rows }, sets: [{ ...rows[0], unit: 'reps', value: 15 }] };
  assert.equal(G.isComplete(s), true, 'a trimmed set does not make the quest incomplete');
  assert.equal(G.fidelity(s).prescribed, 1);
});

// ---------------------------------------------------------------- the flame
test('the planned rest day keeps the flame, and rest rolls rather than being fixed', () => {
  const { state } = trained(CAT, WEEK);
  const f = G.flame(state, gam, '2026-09-21');
  assert.equal(f.count, 7, 'six training days plus the rest day');
  assert.equal(f.state, 'lit');
});

test('a missed day spends a shield silently before it ever breaks the flame', () => {
  const { state } = trained(CAT, ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19']);
  const f = G.flame(state, gam, '2026-09-20');
  assert.equal(f.state, 'lit', 'Wednesday was covered');
  assert.ok(f.shields < gam.flame.shields_start + 1);
  assert.equal([...f.statuses.values()].filter(s => s === 'shield' || s === 'rest').length >= 1, true);
});

test('illness freezes the flame instead of breaking it', () => {
  const base = trained(CAT, ['2026-09-14', '2026-09-15']);
  const events = [...base.events,
    makeEvent(TYPES.MODE_START, { kind: 'recovery', start: '2026-09-16', end: '2026-09-19' }, { user: 'cat', dev: 'cat1', ts: '2026-09-16T09:00:00Z' })];
  const state = reduce(events, spec, { equipment: EQ }).users.cat;
  const f = G.flame(state, gam, '2026-09-19');
  assert.notEqual(f.state, 'cold');
  assert.ok(f.count >= 2, 'the days already earned are not taken away');
});

test('today is pending and can never break the flame while it is still today', () => {
  const { state } = trained(CAT, ['2026-09-14', '2026-09-15']);
  const f = G.flame(state, gam, '2026-09-18');
  assert.equal(f.statuses.get('2026-09-18'), 'pending');
});

// ---------------------------------------------------------------- armour and regions
test('armour comes from benchmarks and named rungs, never from XP alone', () => {
  const { state } = trained(CAT, WEEK);
  // A pile of XP with no rung climbed and no test taken buys nothing.
  const xpOnly = { ...state, ladders: Object.fromEntries(program.exercises.map(e => [e.id, { step_id: e.ladder[0].id }])), benchmarks: {} };
  assert.equal(Math.max(...Object.values(G.gearTiers(xpOnly, spec, gam)).map(g => g.tier)), 0,
    'XP alone must never put armour on anyone');

  const withBenchmark = { ...state, benchmarks: { bb_pushups_2min: { tier: 2, value: 31 } } };
  const after = G.gearTiers(withBenchmark, spec, gam);
  const chest = Object.values(after).find(s => s.region === 'chest');
  assert.equal(chest.tier, 2, 'the benchmark tier sets the breastplate');
});

test('training fills the regions it actually trains', () => {
  const { state } = trained(CAT, ['2026-09-14']);   // Lower A
  const p = G.progress(state, spec, gam, '2026-09-15');
  assert.ok(p.regions.thighs.xp > 0, 'a lower day fills the thighs');
  assert.equal(p.regions.chest.xp, 0, 'and not the chest — the flows pay no XP, so they fill nothing');
  const total = Object.values(p.regions).reduce((n, r) => n + r.xp, 0);
  assert.ok(total > 0);
});

test('region levels use the published curve', () => {
  assert.equal(G.regionLevel(0, gam), 0);
  assert.equal(G.regionLevel(40, gam), 1);
  assert.equal(G.regionLevel(160, gam), 2);
});

// ---------------------------------------------------------------- badges
test('every badge criterion uses a metric the evaluator implements', () => {
  const { state } = trained(CAT, WEEK);
  const p = G.progress(state, spec, gam, '2026-09-20');
  assert.equal(p.badges.length, gam.badges.length);
  for (const b of gam.badges) {
    assert.doesNotThrow(() => G.evalCriterion(b.criterion, p.metrics), `${b.id}: criterion threw`);
  }
});

test('a first week earns the early badges and none of the late ones', () => {
  const { state } = trained(CAT, WEEK);
  const p = G.progress(state, spec, gam, '2026-09-20');
  const earned = new Set(p.badges.filter(b => b.earned).map(b => b.id));
  assert.ok(earned.has('first_blood'), 'finishing a quest is a badge');
  assert.ok(earned.has('mirror_faced'), 'the placement quiz is a badge');
  assert.ok(!earned.has('eternal_flame'), 'a 100-day flame is not earned in week one');
  assert.ok(!earned.has('bell_earned'), 'the bell is not earned in week one');
});

test('badges that need a partner stay unearned for a solo user', () => {
  const { state } = trained(CAT, WEEK);
  const p = G.progress(state, spec, gam, '2026-09-20');
  for (const b of p.badges.filter(b => b.duo)) assert.equal(b.earned, false, `${b.id} needs a partner`);
});

// ---------------------------------------------------------------- roll-up
test('a full first week produces a believable amount of progress', () => {
  const { state } = trained(CAT, WEEK);
  const p = G.progress(state, spec, gam, '2026-09-20');
  assert.ok(p.xp_total > 1000, `only ${p.xp_total} XP for a perfect week`);
  assert.ok(p.level.level >= 4 && p.level.level <= 12, `week one ended at level ${p.level.level}`);
  assert.ok(p.by_source.sets > 0 && p.by_source.quest > 0 && p.by_source.zone2 > 0);
  assert.ok(p.sessions.every(s => s.fidelity.pct === 1), 'a perfect week hits every target');
});

test('the same history always derives the same numbers', () => {
  const { state } = trained(CAT, WEEK);
  const a = G.progress(state, spec, gam, '2026-09-20');
  const b = G.progress(state, spec, gam, '2026-09-20');
  assert.equal(a.xp_total, b.xp_total);
  assert.deepEqual(a.by_source, b.by_source);
});

test('a genuinely perfect week is counted, and lights its badge', () => {
  // The count was hardcoded to zero, so the Perfect Week badge could never light
  // however well anyone trained.
  const { state } = trained(CAT, WEEK);
  const p = G.progress(state, spec, gam, '2026-09-21');
  assert.equal(p.perfect_weeks.count, 1, 'six prescribed quests, all done, none skipped');
  assert.equal(p.metrics.perfectWeeks, 1);
  assert.ok(p.badges.find(b => b.id === 'perfect_week')?.earned, 'the badge must actually light');
  assert.ok(p.by_source.perfect_weeks > 0, 'and it pays what the table says');
});

test('a week with a quest still to come is not perfect', () => {
  const { state } = trained(CAT, WEEK.slice(0, 4));
  const p = G.progress(state, spec, gam, '2026-09-21');
  assert.equal(p.perfect_weeks.count, 0);
  assert.equal(p.badges.find(b => b.id === 'perfect_week')?.earned, false);
});

test('one quest on the day you join is not a perfect week', () => {
  // Days still to come were skipped and the full-quest bar shrank to fit, so a
  // single Thursday in the setup week was paid 300 XP as a "perfect" week.
  const { state } = trained(CAT, ['2026-09-10']);
  const p = G.progress(state, spec, gam, '2026-09-10');
  assert.equal(p.perfect_weeks.count, 0, 'Friday and Saturday have not happened yet');
  assert.equal(p.by_source.perfect_weeks, undefined);
});

test('the setup week is perfect once every quest from arrival to Saturday is done', () => {
  const { state } = trained(CAT, ['2026-09-10', '2026-09-11', '2026-09-12']);
  const p = G.progress(state, spec, gam, '2026-09-12');
  assert.equal(p.perfect_weeks.count, 1, 'three quests, three full');
});

test('the setup week still needs three full quests', () => {
  const { state } = trained(CAT, ['2026-09-11', '2026-09-12']);
  const p = G.progress(state, spec, gam, '2026-09-13');
  assert.equal(p.perfect_weeks.count, 0, 'two full quests is short of the setup-week bar');
});

test('a week carried by a shield is not perfect, but is not a defeat either', () => {
  // Missing Wednesday spends the starting shield: the flame survives, the
  // perfect week does not.
  const { state } = trained(CAT, ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19']);
  const p = G.progress(state, spec, gam, '2026-09-21');
  assert.equal(p.perfect_weeks.count, 0, 'a shield was spent');
  assert.equal(p.flame.state, 'lit', 'but nothing was taken away');
});

test('short days keep the flame without buying a perfect week', () => {
  const { state } = trained(CAT, WEEK, { type: 'skirmish' });
  const p = G.progress(state, spec, gam, '2026-09-21');
  assert.equal(p.perfect_weeks.count, 0, 'a week of short sessions is not a perfect week');
});

test('every armour slot is reachable, whatever kind of source it has', () => {
  // The thigh slot reads the better of two tests, a shape nothing implemented,
  // so that piece could never be earned however well anyone performed.
  const { state } = trained(CAT, WEEK);
  for (const slot of gam.gear_slots) {
    const kind = slot.source?.kind;
    assert.ok(['benchmark', 'benchmark_max', 'ladder'].includes(kind), `${slot.id}: unknown source kind ${kind}`);
    const champion = { ...state, benchmarks: {}, ladders: { ...state.ladders } };
    if (kind === 'benchmark') champion.benchmarks[slot.source.id] = { tier: 3 };
    if (kind === 'benchmark_max') for (const id of slot.source.ids) champion.benchmarks[id] = { tier: 3 };
    if (kind === 'ladder') {
      const top = slot.source.steps[slot.source.steps.length - 1];
      champion.ladders[slot.source.exercise] = { step_id: top };
    }
    assert.equal(G.gearTiers(champion, spec, gam)[slot.id].tier, 3, `${slot.id} cannot reach gold`);
  }
});
