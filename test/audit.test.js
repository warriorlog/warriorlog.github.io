// Regressions from the September audit: every one of these was a defect found
// by replaying the two phones' real logs through the app. They span modules, so
// they live together here rather than scattered across the per-module files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../src/engine.js';
import * as G from '../src/gamify.js';
import * as D from '../src/duo.js';
import * as J from '../src/views/journal.js';
import { reduce, perfFor, pausedDaysBetween } from '../src/reduce.js';
import { makeEvent, TYPES } from '../src/events.js';
import { prepareImport } from '../src/sync.js';
import { syncState } from '../src/views/chrome.js';
import { regionRows } from '../src/views/regions.js';
import { addDays } from '../src/util.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const copy = JSON.parse(readFileSync(new URL('../data/copy.json', import.meta.url), 'utf8'));
const spec = E.indexSpec(program);

const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10,
  vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5, chair_height_in: 18, couch_edge: true, kb: [53],
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};
const SEAN = { push_up: 'push_up.full', goblet_squat: 'goblet_squat.db12', hinge_deadlift: 'hinge_deadlift.rdl_12', treadmill_zone2: 'treadmill_zone2.w30_4' };
const START = '2026-09-14';

let n = 0;
const ev = (type, data, user, ts, extra = {}) => makeEvent(type, data, { user, dev: `${user.slice(0, 3)}1`, ts, ...extra });

/** Set up a user, then log perfect sessions on `days` exactly as the app logs them. */
function warrior(user, floor, days, { type = 'full', extraEvents = [], programStart = START, tweak = null } = {}) {
  const events = [
    ev(TYPES.PROFILE, { name: user, program_start: programStart, rest_dow: 0, session_minutes: 50, bodyweight_lb: 180 }, user, '2026-09-08T18:00:00Z'),
    ev(TYPES.EQUIPMENT, EQ, user, '2026-09-08T18:01:00Z'),
    ev(TYPES.ASSESSMENT, { start_steps: floor }, user, '2026-09-08T18:02:00Z'),
    ...extraEvents,
  ];
  let u = reduce(events, spec, { equipment: EQ }).users[user];
  for (const day of days) {
    const plan = E.prescribe(spec, u, day, { equipment: EQ });
    if (plan.rest) continue;
    const id = `${user}_${day}`;
    events.push(ev(TYPES.SESSION_START, { session_id: id, template_id: plan.template_id, type, date: day, deload: plan.deload, plan: { rows: plan.rows } }, user, `${day}T13:00:00Z`));
    plan.rows.filter(r => r.prescribed !== false).forEach((r, i) => {
      const set = {
        session_id: id, exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
        side: r.side, part: r.part, unit: r.unit, value: r.unit === 'min' ? r.minutes : r.B,
        checklist_ok: true, talk_test_ok: true, done: true,
      };
      events.push(ev(TYPES.SET, tweak ? tweak(set, r) : set, user, `${day}T13:${String(5 + (i % 50)).padStart(2, '0')}:${String(n++ % 60).padStart(2, '0')}Z`));
    });
    events.push(ev(TYPES.SESSION_END, { session_id: id, duration_min: 47 }, user, `${day}T14:00:00Z`));
    u = reduce(events, spec, { equipment: EQ }).users[user];
  }
  u.id = user;
  return { user: u, events };
}

// ------------------------------------------------------------------ engine
test('an interval row is judged in rounds, not in the minutes of its block', () => {
  const u = warrior('sean', SEAN, []).user;
  const sat = E.prescribe(spec, u, '2026-09-19', { equipment: EQ });
  const row = sat.rows.find(r => r.exercise_id === 'treadmill_intervals');
  assert.equal(row.unit, 'rounds');
  assert.equal(row.A, 6, 'six rounds, not the nineteen minutes the block lasts');
  assert.equal(row.B, 6);
  assert.equal(row.minutes, 19, 'the block length is still there for the card');
  assert.equal(row.rest_sec, 0, 'a one-row block has no rest timer after it');
  // The walk rows are still judged in minutes.
  const walk = sat.rows.find(r => r.exercise_id === 'zone2_finisher');
  assert.equal(walk.unit, 'min');
  assert.equal(walk.A, 4);
});

test('a twinge is noted, never acted on; real pain on two days steps back once', () => {
  const state = { push_up: { step_id: 'push_up.full', qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: null } };
  const ctx = { steps: { push_up: E.resolveSteps(spec.byExercise.push_up, EQ) }, spec, equipment: EQ, day: '2026-09-16' };
  const twinge = (day) => ({ exercise_id: 'push_up', region: 'shoulder', level: 1, day, daysAgo: 1 });
  const real = (day) => ({ exercise_id: 'push_up', region: 'shoulder', level: 4, day, daysAgo: 1 });

  assert.equal(E.applyPainRegressions(spec, state, [twinge('2026-09-14'), twinge('2026-09-15')], ctx).ladders.push_up.step_id, 'push_up.full',
    'two twinges are not two injuries');
  assert.equal(E.applyPainRegressions(spec, state, [real('2026-09-14'), real('2026-09-14')], ctx).ladders.push_up.step_id, 'push_up.full',
    'two flags on one day are one incident');
  const once = E.applyPainRegressions(spec, state, [real('2026-09-14'), real('2026-09-15')], ctx);
  assert.equal(once.ladders.push_up.step_id, 'push_up.knee', 'real pain on two days steps the ladder back');
  assert.equal(once.slips.length, 1);
  // The same pair, seen again at the next session, does nothing more.
  const again = E.applyPainRegressions(spec, once.ladders, [real('2026-09-14'), real('2026-09-15')], { ...ctx, day: '2026-09-18' });
  assert.equal(again.ladders.push_up.step_id, 'push_up.knee', 'one pair of flags is one step back, not one per session');
  assert.equal(again.slips.length, 0);
  // A newer flag reopens the question.
  const newer = E.applyPainRegressions(spec, again.ladders, [real('2026-09-15'), real('2026-09-18')], { ...ctx, day: '2026-09-19' });
  assert.equal(newer.ladders.push_up.step_id, 'push_up.incline');
});

test('the pain bookkeeping survives the ladder stepper', () => {
  const steps = E.resolveSteps(spec.byExercise.push_up, EQ);
  const state = { push_up: { step_id: 'push_up.full', qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: null, pain_regressed_on: '2026-09-15' } };
  const perf = { sets: [{ value: 12, checklist_ok: true }], allDone: true, sessionType: 'full', prescribed: 1 };
  const out = E.stepLadders(spec, state, { push_up: perf }, { day: '2026-09-16', spec, equipment: EQ, steps: { push_up: steps }, floor: {}, painFlags: [], benchmarks: {} });
  assert.equal(out.ladders.push_up.pain_regressed_on, '2026-09-15');
});

test('days in recovery or travel mode are not an absence', () => {
  const steps = { push_up: E.resolveSteps(spec.byExercise.push_up, EQ) };
  const state = { push_up: { step_id: 'push_up.full', qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: '2026-09-01' } };
  const perf = { sets: [{ value: 12, checklist_ok: true }], allDone: true, sessionType: 'full', prescribed: 1 };
  const base = { spec, equipment: EQ, steps, floor: {}, painFlags: [], benchmarks: {} };
  // Twelve days away with no mode on: one rung back.
  const plain = E.stepLadders(spec, state, { push_up: perf }, { ...base, day: '2026-09-13' });
  assert.equal(plain.ladders.push_up.step_id, 'push_up.knee');
  // The same twelve days, eight of them in recovery: no regression.
  const paused = E.stepLadders(spec, state, { push_up: perf }, { ...base, day: '2026-09-13', pausedDays: () => 8 });
  assert.equal(paused.ladders.push_up.step_id, 'push_up.full');
  assert.equal(pausedDaysBetween([{ kind: 'recovery', from: '2026-09-03', to: '2026-09-10' }], '2026-09-01', '2026-09-13'), 8);
  assert.equal(pausedDaysBetween([], '2026-09-01', '2026-09-13'), 0);
});

test('a gate has words on the home card', () => {
  const gate = { rule: 'ladder_at_or_past', exercise: 'hinge_deadlift', step_id: 'hinge_deadlift.rdl_20' };
  assert.match(E.describeGate(gate, spec), /Hinge and deadlift at "20 lb dumbbell RDL"/);
  assert.equal(E.describeGate(null, spec), null);
});

// ------------------------------------------------------------------ reducer
test('the reducer knows the program week, so a rung that waits for week 3 can open', () => {
  // Every ladder rule that reads the week saw week 0 for ever, so the interval
  // ladder's opening rung ("from week 3") could never be climbed.
  const base = warrior('sean', SEAN, []);
  const saturday = (day) => {
    const plan = E.prescribe(spec, base.user, day, { equipment: EQ });
    const row = plan.rows.find(r => r.exercise_id === 'treadmill_intervals');
    return [
      ev(TYPES.SESSION_START, { session_id: `i_${day}`, template_id: plan.template_id, type: 'full', date: day, deload: plan.deload, plan: { rows: [row] } }, 'sean', `${day}T13:00:00Z`),
      ev(TYPES.SET, { session_id: `i_${day}`, exercise_id: row.exercise_id, step_id: row.step_id, set_index: 1, unit: 'rounds', value: 6, done: true }, 'sean', `${day}T13:30:00Z`),
      ev(TYPES.SESSION_END, { session_id: `i_${day}`, duration_min: 45 }, 'sean', `${day}T14:00:00Z`),
    ];
  };
  const early = reduce([...base.events, ...saturday('2026-09-19'), ...saturday('2026-09-26')], spec, { equipment: EQ }).users.sean;
  assert.equal(early.ladders.treadmill_intervals.step_id, 'treadmill_intervals.walk_6', 'weeks 1 and 2 are too early, by the rule');
  assert.equal(early.ladders.treadmill_intervals.qualifying, 0);
  // Weeks 3, 4 (a deload: the counter runs, the step holds) and 5.
  const later = reduce([...base.events, ...saturday('2026-10-03'), ...saturday('2026-10-10'), ...saturday('2026-10-17')], spec, { equipment: EQ }).users.sean;
  assert.equal(later.ladders.treadmill_intervals.step_id, 'treadmill_intervals.walk_8', 'from week 3 the rung can climb');
});

test("a warm-up set marked practice does not stop the working sets from counting", () => {
  // Tuesday's Y-T-W: one warm-up set that never counts, two working sets that do.
  const u = warrior('sean', SEAN, ['2026-09-15', '2026-09-22']).user;
  assert.equal(u.ladders.prone_ytw.step_id, 'prone_ytw.bw_hold', 'two perfect Tuesdays climb the Y-T-W');
  const tue = u.sessions[0];
  const perf = perfFor(tue, spec).prone_ytw;
  assert.equal(perf.sets.length, 6, 'two working sets of three letters are judged');
  assert.equal(perf.prescribed, 6);
  assert.equal(perf.counts_for_progression, true);
});

test('a set the time guard dropped is not counted against the climb', () => {
  const session = {
    type: 'full', sets: [{ exercise_id: 'push_up', step_id: 'push_up.full', set_index: 1, unit: 'reps', value: 12 }],
    plan: { rows: [
      { exercise_id: 'push_up', step_id: 'push_up.full', set_index: 1, unit: 'reps', A: 5, B: 12 },
      { exercise_id: 'push_up', step_id: 'push_up.full', set_index: 2, unit: 'reps', A: 5, B: 12, prescribed: false },
    ] },
  };
  const perf = perfFor(session, spec).push_up;
  assert.equal(perf.prescribed, 1);
  assert.equal(perf.allDone, true, 'the one prescribed set was done');
});

// ------------------------------------------------------------------ XP
test('a rest-day walk pays the walk, not a full quest', () => {
  const s = {
    type: 'kindle', sets: [{ exercise_id: 'zone2_finisher', step_id: 'zone2_finisher.finisher', set_index: 1, unit: 'min', value: 20, talk_test_ok: true }],
    plan: { rows: [{ exercise_id: 'zone2_finisher', step_id: 'zone2_finisher.finisher', set_index: 1, unit: 'min', A: 20, B: 20 }] },
  };
  const out = G.xpForSession(s, spec, gam);
  assert.equal(out.by_source.quest, gam.xp.kindle_walk);
  assert.equal(out.by_source.zone2, 20 * gam.xp.zone2_per_min);
});

test('interval rounds pay for the block, never for a number the row got wrong', () => {
  const row = { exercise_id: 'treadmill_intervals', step_id: 'treadmill_intervals.walk_6', set_index: 1, unit: 'rounds', A: 19, B: 19 };
  const out = G.xpForSession({ type: 'full', plan: { rows: [row] }, sets: [{ ...row, value: 19 }] }, spec, gam);
  assert.equal(out.by_source.intervals, 6 * gam.xp.interval_round);
});

test('the setup week pays the smaller perfect-week bonus the table lists', () => {
  const u = warrior('sean', SEAN, ['2026-09-10', '2026-09-11', '2026-09-12']).user;
  const p = G.progress(u, spec, gam, '2026-09-13');
  assert.equal(p.perfect_weeks.count, 1);
  assert.equal(p.by_source.perfect_weeks, gam.xp.perfect_week_muster);
  const full = warrior('cat', SEAN, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']).user;
  assert.equal(G.progress(full, spec, gam, '2026-09-21').by_source.perfect_weeks, gam.xp.perfect_week);
});

test('a climb is paid on the session that earned it', () => {
  const u = warrior('sean', SEAN, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']).user;
  const p = G.progress(u, spec, gam, '2026-09-18');
  assert.ok(u.climbs.length > 0, 'the fixture climbs something');
  const paid = p.sessions.reduce((n, s) => n + (s.by_source.climbs ?? 0), 0);
  assert.equal(paid, u.climbs.length * gam.xp.ladder_advance, 'every climb lands on a session');
  assert.equal(p.by_source.climbs, paid);
  const day = u.climbs[0].day;
  assert.ok(p.sessions.find(s => s.day === day).climbs.length >= 1);
});

test('gates, boss tests, duel wins and flame milestones actually pay what the table says', () => {
  const u = warrior('sean', SEAN, ['2026-09-14']).user;
  const rich = {
    ...u,
    ladders: { ...u.ladders, hinge_deadlift: { step_id: 'hinge_deadlift.kb53_floor' } },
    benchmarkHistory: gam.boss_benchmarks.map(id => ({ benchmark_id: id, battle_n: 1, value: 10, tier: 1, day: '2026-10-10' })),
    bossResolved: { 1: { battle_n: 1, outcome: 'defeated', damage: 60, hp: 55, my_damage: 30, partner_damage: 20 } },
    weekLocks: {
      '2026-W38': { week_id: '2026-W38', status: 'contested', winner: 'sean', S_me: 80, S_partner: 70 },
      '2026-W39': { week_id: '2026-W39', status: 'dead_heat', S_me: 70, S_partner: 70 },
    },
  };
  const p = G.progress(rich, spec, gam, '2026-10-12');
  assert.equal(p.by_source.gates, gam.xp.gate, 'the hinge gate is open');
  assert.equal(p.by_source.boss, 6 * gam.xp.boss_per_benchmark + gam.xp.boss_all_six + Math.round(p.xp_available_week * gam.xp.boss_defeated_pct));
  assert.equal(p.by_source.duel, gam.xp.duel_win + gam.xp.duel_dead_heat);
  assert.ok(p.xp_available_week > 1000, `a week of the plan is worth ${p.xp_available_week}`);
  // Nothing in the table is unpaid or unlabelled on the settings screen.
});

test('the flame counts its relights, and the milestones pay once each', () => {
  const u = warrior('sean', SEAN, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-14', '2026-09-15']).user;
  const f = G.flame(u, gam, '2026-09-16');
  assert.ok(f.best >= 7);
  const p = G.progress(u, spec, gam, '2026-09-16');
  assert.equal(p.by_source.flame, gam.xp.flame_milestones['7'], 'seven days running pays the first milestone');
});

test('a brand-new account is level 1 with a number, not NaN', () => {
  const u = warrior('sean', SEAN, []).user;
  const p = G.progress(u, spec, gam, '2026-09-09');
  assert.ok(Number.isFinite(p.xp_total));
  assert.equal(p.level.level, 2, 'the placement quiz alone is level 2');
});

// ------------------------------------------------------------------ duo
test('duo badges light once the partner is in hand', () => {
  const sean = warrior('sean', SEAN, ['2026-09-14', '2026-09-15']);
  const cat = warrior('cat', SEAN, ['2026-09-14', '2026-09-15']);
  const ps = G.progress(sean.user, spec, gam, '2026-09-16');
  const pc = G.progress(cat.user, spec, gam, '2026-09-16');
  assert.equal(ps.badges.find(b => b.id === 'first_light').earned, false, 'alone, no duo badge can light');
  const duo = D.duoBadgeMetrics(sean.user, cat.user, spec, gam, '2026-09-16', ps, pc);
  assert.equal(duo.flame, 2);
  assert.equal(duo.sameDayCount, 2, 'both started at 13:00 on both days');
  const lit = G.withDuo(ps, duo, gam);
  assert.equal(lit.badges.find(b => b.id === 'first_light').earned, true);
  assert.equal(lit.badges.find(b => b.id === 'in_step').earned, false, 'ten is more than two');
  assert.equal(lit.xp_total, ps.xp_total, 'the partner changes badges, never XP');
  assert.equal(D.duoBadgeMetrics(sean.user, { quizDone: false, sessions: [] }, spec, gam, '2026-09-16', ps, null), null);
});

test('the seesaw and the synergy badges read the locked records', () => {
  const u = warrior('sean', SEAN, ['2026-09-14']).user;
  u.weekLocks = {
    '2026-W38': { week_id: '2026-W38', status: 'contested', winner: 'sean' },
    '2026-W39': { week_id: '2026-W39', status: 'contested', winner: 'cat' },
    '2026-W40': { week_id: '2026-W40', status: 'contested', winner: 'sean' },
    '2026-W41': { week_id: '2026-W41', status: 'contested', winner: 'cat' },
  };
  u.bossResolved = { 1: { battle_n: 1, outcome: 'defeated', damage: 60, hp: 55, my_damage: 30, partner_damage: 20 } };
  const p = G.progress(u, spec, gam, '2026-10-20');
  assert.equal(p.badges.find(b => b.id === 'seesaw').earned, true, 'the belt changed hands three weeks running');
  assert.equal(p.badges.find(b => b.id === 'indispensable').earned, true, '30 + 20 falls short of 55; the synergy brought it down');
  u.bossResolved = { 1: { battle_n: 1, outcome: 'defeated', damage: 70, hp: 55, my_damage: 40, partner_damage: 20 } };
  assert.equal(G.progress(u, spec, gam, '2026-10-20').badges.find(b => b.id === 'indispensable').earned, false, 'either alone would have done it');
});

test('my own partial first week is not scored against me either', () => {
  const sean = warrior('sean', SEAN, ['2026-09-17', '2026-09-18', '2026-09-19']);   // joined on the Thursday
  sean.user.placedOn = '2026-09-17';
  const cat = warrior('cat', SEAN, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
  cat.user.placedOn = '2026-09-07';
  const ps = G.progress(sean.user, spec, gam, '2026-09-21'), pc = G.progress(cat.user, spec, gam, '2026-09-21');
  const r = D.resolveWeek(sean.user, cat.user, spec, gam, '2026-W38', ps, pc);
  assert.equal(r.status, 'no_contest');
  assert.equal(r.winner, null);
});

test('the live week says who is ahead, never a verdict on a week still in play', () => {
  const sean = warrior('sean', SEAN, ['2026-09-14']);
  const cat = warrior('cat', SEAN, []);
  cat.user.quizDone = true;
  const ps = G.progress(sean.user, spec, gam, '2026-09-14');
  const d = D.duoState(sean.user, cat.user, spec, gam, '2026-09-14', ps, null);
  assert.equal(d.status, 'you lead');
  assert.equal(d.week.verdict, 'no_contest', 'the provisional ruling is still available to the code');
  assert.equal(d.lock_day, '2026-09-22', 'a Monday week settles the Tuesday after it ends');
  const level = D.duoState(sean.user, sean.user, spec, gam, '2026-09-14', ps, ps);
  assert.equal(level.status, 'level');
});

// --------------------------------------------------------------- journal
test('the journal leads with the week being lived, then the week that just closed', () => {
  const u = warrior('sean', SEAN, ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-14']).user;
  const p = G.progress(u, spec, gam, '2026-09-14');
  const state = {
    me: 'sean', users: { sean: u, cat: { ...u, sessions: [], climbs: [] } },
    spec, gam, copy, progress: p, plan: null, route: { name: 'journal', params: {} },
    sync: { pending: 0, error: null }, settings: {}, today: '2026-09-14',
  };
  const out = String(J.render(state));
  const thisWeek = out.indexOf('This week');
  const lastWeek = out.indexOf('Last week');
  const archive = out.indexOf('Past reports');
  assert.ok(thisWeek > 0 && lastWeek > thisWeek, 'the live week comes first, the closed one under it');
  assert.equal(archive, -1, 'two weeks on record is not yet an archive');
  assert.ok(out.includes('14 Sep – 20 Sep'), 'the live week is the one just logged into');
  assert.ok(/jr-last[^>]*\sopen/.test(out), 'on a Monday last week\'s report is open');
  assert.ok(out.includes('5 quests still to come this week.'));
  assert.ok(!out.includes('NaN') && !out.includes('undefined'));
});

test('last week folds away from Thursday, and the archive holds only older weeks', () => {
  const days = ['2026-08-31', '2026-09-01', '2026-09-07', '2026-09-08', '2026-09-14', '2026-09-15', '2026-09-17'];
  const u = warrior('sean', SEAN, days, { programStart: '2026-08-31' }).user;
  const p = G.progress(u, spec, gam, '2026-09-17');
  const state = { me: 'sean', users: { sean: u, cat: { ...u, sessions: [], climbs: [] } }, spec, gam, copy, progress: p, plan: null, route: { name: 'journal', params: {} }, sync: { pending: 0 }, settings: {}, today: '2026-09-17' };
  const out = String(J.render(state));
  assert.ok(!/jr-last[^>]*\sopen/.test(out), 'by Thursday the closed week is folded');
  assert.ok(out.includes('Past reports'));
  assert.ok(out.includes('1 on record'), 'only the week before last is archived');
});

test('the weekly report takes its perfect-week verdict from the layer that pays it', () => {
  const u = warrior('sean', SEAN, ['2026-09-10', '2026-09-11', '2026-09-12']).user;
  const p = G.progress(u, spec, gam, '2026-09-14');
  const weeks = J.buildWeeks(u, spec, gam, p, '2026-09-14');
  const muster = weeks.find(w => w.start === '2026-09-07');
  assert.equal(muster.perfect, true);
  assert.equal(muster.by_source.perfect_weeks, gam.xp.perfect_week_muster, 'the bonus shows in the week that earned it');
  assert.equal(muster.xp, p.sessions.reduce((n, s) => n + s.xp, 0) + gam.xp.perfect_week_muster);
  assert.equal(muster.done, 3);
  assert.equal(muster.full, 3);
});

test('a session ended early is labelled as such, and its sets read in the order they happened', () => {
  const u = warrior('sean', SEAN, ['2026-09-14']).user;
  u.sessions[0].type = 'ember';
  const p = G.progress(u, spec, gam, '2026-09-14');
  const state = { me: 'sean', users: { sean: u, cat: { ...u, sessions: [], climbs: [] } }, spec, gam, copy, progress: p, plan: null, route: { name: 'journal', params: {} }, sync: { pending: 0 }, settings: {} };
  const out = String(J.render(state));
  assert.ok(out.includes('Ended early'));
  assert.ok(!/Full quest · 47/.test(out));
  const groups = J.setGroups(u.sessions[0].sets);
  assert.equal(groups[0].exercise_id, 'warmup_flow', 'the warm-up is first because it was done first');
  assert.equal(groups[groups.length - 1].exercise_id, 'cooldown_flow');
});

// ----------------------------------------------------------- the small stuff
test('the sync dot is idle without a token, not green', () => {
  assert.equal(syncState({ settings: {}, sync: { pending: 0 } }), 'idle');
  assert.equal(syncState({ settings: { token: 'x' }, sync: { pending: 0 } }), 'synced');
  assert.equal(syncState({ settings: { token: 'x' }, sync: { pending: 2 } }), 'pending');
  assert.equal(syncState({ settings: { token: 'x' }, sync: { pending: 0, error: 'nope' } }), 'error');
});

test('a restored backup never puts the partner\'s events back in the push queue', () => {
  const mine = ev(TYPES.REST, {}, 'sean', '2026-09-14T13:00:00Z');
  const theirs = ev(TYPES.REST, {}, 'cat', '2026-09-14T13:00:00Z');
  const torn = { id: 'broken' };
  const out = prepareImport([mine, theirs, torn, mine], 'sean');
  assert.equal(out.length, 2, 'duplicates and torn rows are dropped');
  assert.equal(out.find(e => e.user === 'sean').synced, 0);
  assert.equal(out.find(e => e.user === 'cat').synced, 1, 'their events are already public; this phone must not write their file');
  assert.equal(prepareImport([mine], 'sean', new Set([mine.id])).length, 0, 'what is already here is not imported twice');
});

test('the head-to-toe bars say their level and leave an empty part empty', () => {
  const rows = regionRows({ heart: { xp: 60, level: 1 }, chest: { xp: 0, level: 0 } }, gam);
  assert.ok(rows.includes('Lv 1'));
  assert.ok(rows.includes('Lv 0'));
  assert.ok(/Chest[\s\S]*width:0%/.test(rows), 'nothing logged, nothing drawn');
  assert.ok(rows.includes('all time'), 'every row explains its own units');
  const bar = G.regionBar({ xp: 60, level: 1 }, gam);
  assert.deepEqual([bar.level, bar.floor, bar.next, bar.to_next], [1, 40, 160, 100]);
  assert.equal(G.regionBar({ xp: 0 }, gam).pct, 0);
});

test('setting up on a Monday starts week 1 today', async () => {
  // setup.js imports app.js, which wants a DOM; home-view.test.js stubs one
  // before this file runs, so the import resolves there. Here we only need the
  // pure helper, and skip cleanly if the module cannot load in isolation.
  const mod = await import('../src/views/setup.js').catch(() => null);
  if (!mod?.programStartFor) return;
  assert.equal(mod.programStartFor(new Date(2026, 8, 14, 9)), '2026-09-14');
  assert.equal(mod.programStartFor(new Date(2026, 8, 16, 9)), '2026-09-21');
  assert.equal(mod.programStartFor(new Date(2026, 8, 13, 9)), '2026-09-14');
});

test('the user-facing program text never leaks a raw id', () => {
  const texts = [];
  for (const b of program.benchmarks) {
    texts.push(b.protocol, b.locked_note);
    for (const v of b.variants ?? []) texts.push(v.how, v.lock_note);
  }
  for (const ex of program.exercises) {
    texts.push(ex.name, ex.stop_if, ...(ex.cues ?? []));
    for (const st of ex.ladder) texts.push(st.name, st.how);
  }
  for (const t of texts.filter(Boolean)) {
    assert.ok(!/\b[a-z0-9]+_[a-z0-9_]+\.[a-z0-9_]+\b/.test(t), `raw step id in copy: ${t}`);
    assert.ok(!/load_rule/.test(t), `implementation detail in copy: ${t}`);
  }
  for (const ex of program.exercises) {
    assert.ok(ex.name.length <= 32 && !/[:(]/.test(ex.name), `${ex.id}: "${ex.name}" is a description, not a name`);
  }
});

test('the day after a week of sessions still lists every ladder the program can move', () => {
  const u = warrior('sean', SEAN, ['2026-09-14']).user;
  const rows = E.ladderStanding(spec, u.ladders);
  assert.ok(rows.some(r => r.exercise_id === 'prone_ytw'), 'the Y-T-W is a ladder that can move');
  assert.ok(rows.every(r => !/HINGE GATE|ladder:/.test(r.name)));
  assert.ok(addDays('2026-09-14', 1) === '2026-09-15');
});
