import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from '../src/duo.js';
import { indexSpec, prescribe } from '../src/engine.js';
import { reduce } from '../src/reduce.js';
import { progress } from '../src/gamify.js';
import { makeEvent, TYPES } from '../src/events.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);

const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10, vest_max_lb: 40,
  vest_increment_lb: 5, chair_height_in: 18, couch_edge: true, kb: [53],
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};
const WEEK = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
const CAT = { push_up: 'push_up.wall', goblet_squat: 'goblet_squat.chair', hinge_deadlift: 'hinge_deadlift.wall_drill' };
const SEAN = { push_up: 'push_up.full_high', goblet_squat: 'goblet_squat.db35', hinge_deadlift: 'hinge_deadlift.rdl_35', db_row: 'db_row.db35' };

let n = 0;
/** Build a user who trained the given days, hitting `quality` of each target. */
function build(user, floor, days, { quality = 1, bodyweight = 150 } = {}) {
  const ev = (type, data, ts) => makeEvent(type, data, { user, dev: user.slice(0, 3), ts: ts ?? new Date(Date.UTC(2026, 8, 1, 12, n++)).toISOString() });
  const events = [
    ev(TYPES.PROFILE, { name: user, program_start: '2026-09-14', rest_dow: 0, session_minutes: 50, bodyweight_lb: bodyweight }, '2026-09-13T18:00:00Z'),
    ev(TYPES.EQUIPMENT, EQ, '2026-09-13T18:00:01Z'),
    ev(TYPES.ASSESSMENT, { start_steps: floor }, '2026-09-13T18:00:02Z'),
  ];
  let state = reduce(events, spec, { equipment: EQ }).users[user];
  for (const day of days) {
    const plan = prescribe(spec, state, day, { equipment: EQ });
    if (plan.rest) continue;
    const id = `${user}_${day}`;
    const rows = plan.rows.filter(r => r.prescribed !== false);
    events.push(ev(TYPES.SESSION_START, { session_id: id, template_id: plan.template_id, type: 'full', date: day, plan: { rows } }, `${day}T13:00:00Z`));
    const take = Math.round(rows.length * quality);
    rows.slice(0, take).forEach((r, i) => events.push(ev(TYPES.SET, {
      session_id: id, exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
      side: r.side, part: r.part, unit: r.unit, value: r.unit === 'min' ? r.minutes : r.B,
      checklist_ok: true, talk_test_ok: true, done: true,
    }, `${day}T13:${String(5 + (i % 50)).padStart(2, '0')}:00Z`)));
    events.push(ev(TYPES.SESSION_END, { session_id: id, duration_min: 46 }, `${day}T14:00:00Z`));
    state = reduce(events, spec, { equipment: EQ }).users[user];
  }
  state.id = user;
  return { state, prog: progress(state, spec, gam, '2026-09-21'), events };
}

test('the weaker partner wins the week by executing their own plan better', () => {
  // Cat is at wall push-ups and a 12 lb goblet; Sean is at full push-ups and 35 lb.
  // Cat does every set she was asked for; Sean does two thirds of his.
  const cat = build('cat', CAT, WEEK, { quality: 1, bodyweight: 128 });
  const sean = build('sean', SEAN, WEEK, { quality: 0.65, bodyweight: 200 });
  const a = D.duelScore(cat.state, cat.prog, spec, gam, '2026-W38');
  const b = D.duelScore(sean.state, sean.prog, spec, gam, '2026-W38');
  assert.ok(a.S > b.S, `Cat scored ${a.S}, Sean ${b.S} — the lighter lifter must be able to win on execution`);
});

test('lifting heavier never scores a single point', () => {
  // Identical execution, wildly different loads: the scores must be identical.
  const cat = build('cat', CAT, WEEK, { bodyweight: 128 });
  const sean = build('sean', SEAN, WEEK, { bodyweight: 200 });
  const a = D.duelScore(cat.state, cat.prog, spec, gam, '2026-W38');
  const b = D.duelScore(sean.state, sean.prog, spec, gam, '2026-W38');
  assert.deepEqual(a.parts, b.parts, 'the five categories must be blind to load');
  assert.equal(a.S, b.S);
});

test('the score is the published weighted sum', () => {
  const cat = build('cat', CAT, WEEK);
  const s = D.duelScore(cat.state, cat.prog, spec, gam, '2026-W38');
  const w = gam.duel.weights;
  const expected = Math.round(w.sessions * s.parts.sessions + w.fidelity * s.parts.fidelity
    + w.zone2 * s.parts.zone2 + w.progress * s.parts.progress + w.xp * s.parts.xp);
  assert.equal(s.S, expected);
  for (const v of Object.values(s.parts)) assert.ok(v >= 0 && v <= 100, 'every category is a capped percentage');
});

test('a week nobody really contested is not scored as a defeat', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, ['2026-09-14']);       // one session all week
  const r = D.resolveWeek(cat.state, sean.state, spec, gam, '2026-W38', cat.prog, sean.prog);
  assert.equal(r.status, 'no_contest');
  assert.equal(r.winner, null);
});

test('two close weeks are a dead heat, not a win', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  const r = D.resolveWeek(cat.state, sean.state, spec, gam, '2026-W38', cat.prog, sean.prog);
  assert.equal(r.status, 'dead_heat', `margin was ${r.margin}`);
  assert.equal(r.winner, null);
});

test('illness makes the week a no-contest rather than a loss', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, []);
  sean.state.modes = [{ kind: 'recovery', from: '2026-09-14', to: '2026-09-20' }];
  const r = D.resolveWeek(cat.state, sean.state, spec, gam, '2026-W38', cat.prog, sean.prog);
  assert.equal(r.status, 'no_contest', 'being ill is never a defeat');
});

test('the belt and the crowns replay from locked weeks, never stored', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  cat.state.weekLocks = {
    '2026-W38': { week_id: '2026-W38', status: 'contested', winner: 'cat', S_me: 80, S_partner: 70 },
    '2026-W39': { week_id: '2026-W39', status: 'contested', winner: 'sean', S_me: 60, S_partner: 75 },
    '2026-W40': { week_id: '2026-W40', status: 'dead_heat', S_me: 70, S_partner: 70 },
  };
  const belt = D.beltState(cat.state, sean.state, gam);
  assert.equal(belt.holder, 'sean');
  assert.equal(belt.crowns.cat, 1);
  assert.equal(belt.crowns.sean, 1);
  assert.equal(belt.dead_heats, 1);
  assert.equal(belt.title_changes, 1);
});

test('three losses in a row turns the next week co-operative', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  cat.state.weekLocks = Object.fromEntries(['W38', 'W39', 'W40'].map((w, i) =>
    [`2026-${w}`, { week_id: `2026-${w}`, status: 'contested', winner: 'sean', S_me: 60, S_partner: 80 }]));
  const belt = D.beltState(cat.state, sean.state, gam);
  assert.equal(belt.loss_run.cat, 3);
  assert.equal(belt.alliance_next, true, 'a losing run must convert to a shared goal');

  const state = D.duoState(cat.state, sean.state, spec, gam, '2026-09-21', cat.prog, sean.prog);
  assert.equal(state.alliance, true);
  assert.equal(state.status, 'alliance');
});

test('the duo flame counts days both of them trained', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  const s = D.duoState(cat.state, sean.state, spec, gam, '2026-09-21', cat.prog, sean.prog);
  assert.ok(s.duoFlame >= 6, `duo flame was ${s.duoFlame} after a week they both trained`);
});

test('one partner missing a day stops the duo flame without touching solo flames', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, ['2026-09-14', '2026-09-15']);
  const s = D.duoState(cat.state, sean.state, spec, gam, '2026-09-21', cat.prog, sean.prog);
  assert.ok(s.duoFlame < 6);
  assert.ok(cat.prog.flame.count >= 6, "Cat's own flame is untouched by Sean's week");
});

test('a solo user sees no duel at all rather than a walkover', () => {
  const cat = build('cat', CAT, WEEK);
  const r = D.resolveWeek(cat.state, null, spec, gam, '2026-W38', cat.prog, null);
  assert.equal(r.status, 'solo');
  assert.equal(r.winner, null);
});

test('a week is only locked once both phones have had time to sync the weekend', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  // Sunday: the week just ended, nothing is final yet.
  const sunday = D.weeksDueForLock(cat.state, sean.state, spec, gam, '2026-09-20', cat.prog, sean.prog);
  assert.equal(sunday.length, 0, 'the result is still provisional on Sunday');
  // The following Tuesday: it becomes a permanent fact.
  const tuesday = D.weeksDueForLock(cat.state, sean.state, spec, gam, '2026-09-22', cat.prog, sean.prog);
  assert.ok(tuesday.length >= 1, 'by Tuesday the week can be locked');
  assert.equal(tuesday[0].week_id, '2026-W38');
});

test('a week already locked is never locked twice', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  cat.state.weekLocks = { '2026-W38': { week_id: '2026-W38', status: 'dead_heat' } };
  const due = D.weeksDueForLock(cat.state, sean.state, spec, gam, '2026-09-22', cat.prog, sean.prog);
  assert.ok(!due.some(d => d.week_id === '2026-W38'));
});

test('the locked record carries the result and nothing private', () => {
  const cat = build('cat', CAT, WEEK);
  const sean = build('sean', SEAN, WEEK);
  const result = D.resolveWeek(cat.state, sean.state, spec, gam, '2026-W38', cat.prog, sean.prog);
  const rec = D.lockRecord(result, cat.state, sean.state);
  assert.equal(rec.week_id, '2026-W38');
  assert.ok(['contested', 'dead_heat', 'no_contest', 'unexplained'].includes(rec.status));
  const text = JSON.stringify(rec);
  for (const field of ['bodyweight', 'rir', 'pain', 'note', 'rpe']) {
    assert.ok(!text.includes(field), `${field} must not ride along in a public week record`);
  }
});
