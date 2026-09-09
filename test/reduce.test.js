import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, perfFor, setKey } from '../src/reduce.js';
import { indexSpec } from '../src/engine.js';
import { makeEvent, TYPES, SCHEMA_VERSION } from '../src/events.js';
import { miniProgram, equipment } from './fixtures/mini-program.js';

const spec = indexSpec(miniProgram);
let seq = 0;
const at = (mins) => new Date(Date.UTC(2026, 8, 14, 15, mins)).toISOString();
const ev = (type, data, user = 'sean', ts = at(seq++), extra = {}) =>
  makeEvent(type, data, { user, dev: user === 'sean' ? 'aaa111' : 'bbb222', ts, ...extra });

function session({ user = 'sean', id = `s_${user}_${seq}`, day = '2026-09-14', type = 'full', deload = false, sets = [] }) {
  const rows = sets.map(s => ({ exercise_id: s.exercise_id, set_index: s.set_index, counts_for_progression: true }));
  const out = [ev(TYPES.SESSION_START, { session_id: id, template_id: 'day_a', type, deload, date: day, plan: { rows } }, user)];
  for (const s of sets) out.push(ev(TYPES.SET, { session_id: id, unit: 'reps', done: true, ...s }, user));
  out.push(ev(TYPES.SESSION_END, { session_id: id, duration_min: 45 }, user));
  return out;
}

const perfectPushups = (n, step = 'push_up.wall', value = 15) =>
  Array.from({ length: n }, (_, i) => ({ exercise_id: 'push_up', step_id: step, set_index: i + 1, value }));

test('a set edit is a newer event for the same row, and the latest wins', () => {
  const id = 's1';
  const events = [
    ev(TYPES.SESSION_START, { session_id: id, template_id: 'day_a', type: 'full', date: '2026-09-14', plan: { rows: [{ exercise_id: 'push_up', set_index: 1 }] } }),
    ev(TYPES.SET, { session_id: id, exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, value: 10, unit: 'reps', done: true }, 'sean', at(10)),
    ev(TYPES.SET, { session_id: id, exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, value: 14, unit: 'reps', done: true }, 'sean', at(11)),
    ev(TYPES.SESSION_END, { session_id: id, duration_min: 40 }, 'sean', at(12)),
  ];
  const { users } = reduce(events, spec, { equipment });
  const s = users.sean.sessions[0];
  assert.equal(s.sets.length, 1);
  assert.equal(s.sets[0].value, 14);
});

test('an undo removes the set instead of leaving a ghost', () => {
  const id = 's2';
  const events = [
    ev(TYPES.SESSION_START, { session_id: id, template_id: 'day_a', type: 'full', date: '2026-09-14', plan: { rows: [] } }),
    ev(TYPES.SET, { session_id: id, exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, value: 12, unit: 'reps', done: true }, 'sean', at(20)),
    ev(TYPES.SET, { session_id: id, exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, done: false }, 'sean', at(21)),
    ev(TYPES.SESSION_END, { session_id: id, duration_min: 40 }, 'sean', at(22)),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.sessions[0].sets.length, 0);
});

test("one partner's sets can never fold into the other's ladders", () => {
  const shared = 'sean_session';
  const events = [
    ...session({ user: 'sean', id: shared, sets: perfectPushups(3) }),
    // Cat's phone, buggy or hand-edited, claims a set inside Sean's session.
    ev(TYPES.SET, { session_id: shared, exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 9, value: 99, unit: 'reps', done: true }, 'cat', at(50)),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.sessions[0].sets.length, 3, "Cat's row must not appear in Sean's session");
  assert.equal(users.cat.sessions.length, 0);
});

test('the same events in any order derive identical state', () => {
  const events = [
    ...session({ user: 'sean', id: 'a', day: '2026-09-14', sets: perfectPushups(3) }),
    ...session({ user: 'sean', id: 'b', day: '2026-09-21', sets: perfectPushups(3) }),
    ...session({ user: 'cat', id: 'c', day: '2026-09-14', sets: perfectPushups(3, 'push_up.wall', 11) }),
  ];
  const forward = reduce(events, spec, { equipment });
  const shuffled = [...events].reverse();
  const backward = reduce(shuffled, spec, { equipment });
  const strip = (r) => JSON.stringify(Object.fromEntries(Object.entries(r.users).map(([k, u]) => [k, { ladders: u.ladders, sessions: u.sessions.map(s => s.session_id) }])));
  assert.equal(strip(forward), strip(backward));
});

test('two perfect sessions advance a ladder, and one does not', () => {
  const one = reduce(session({ id: 'x1', day: '2026-09-14', sets: perfectPushups(3) }), spec, { equipment });
  assert.equal(one.users.sean.ladders.push_up.step_id, 'push_up.wall');
  assert.equal(one.users.sean.ladders.push_up.qualifying, 1);

  const two = reduce([
    ...session({ id: 'x1', day: '2026-09-14', sets: perfectPushups(3) }),
    ...session({ id: 'x2', day: '2026-09-16', sets: perfectPushups(3) }),
  ], spec, { equipment });
  assert.equal(two.users.sean.ladders.push_up.step_id, 'push_up.knee');
  assert.equal(two.users.sean.climbs.length, 1);
});

test('a short session keeps the flame but never moves a ladder', () => {
  const events = [
    ...session({ id: 'k1', day: '2026-09-14', type: 'skirmish', sets: perfectPushups(3) }),
    ...session({ id: 'k2', day: '2026-09-16', type: 'skirmish', sets: perfectPushups(3) }),
    ...session({ id: 'k3', day: '2026-09-18', type: 'ember', sets: perfectPushups(1) }),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.ladders.push_up.step_id, 'push_up.wall');
  assert.equal(users.sean.sessions.length, 3, 'the sessions still count for the streak');
});

test('a deload week keeps the counter running but holds the step until a real session', () => {
  const both = reduce([
    ...session({ id: 'd1', day: '2026-09-14', deload: true, sets: perfectPushups(3) }),
    ...session({ id: 'd2', day: '2026-09-16', deload: true, sets: perfectPushups(3) }),
  ], spec, { equipment });
  assert.equal(both.users.sean.ladders.push_up.step_id, 'push_up.wall', 'no advance inside the deload');
  assert.equal(both.users.sean.ladders.push_up.qualifying, 2, 'the work still counted');

  const then = reduce([
    ...session({ id: 'd1', day: '2026-09-14', deload: true, sets: perfectPushups(3) }),
    ...session({ id: 'd2', day: '2026-09-16', deload: true, sets: perfectPushups(3) }),
    ...session({ id: 'd3', day: '2026-09-18', sets: perfectPushups(3) }),
  ], spec, { equipment });
  assert.equal(then.users.sean.ladders.push_up.step_id, 'push_up.knee', 'and pays off on the next real session');
});

test('two bad sessions step back, and never below the placement floor', () => {
  const bad = (id, day) => session({ id, day, sets: [{ exercise_id: 'push_up', step_id: 'push_up.knee', set_index: 1, value: 2 }] });
  const events = [
    ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.knee' } }, 'sean', at(0)),
    ...bad('f1', '2026-09-14'), ...bad('f2', '2026-09-16'), ...bad('f3', '2026-09-18'),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.ladders.push_up.step_id, 'push_up.knee', 'the placement floor holds');
});

test('the placement quiz sets the starting step', () => {
  const { users } = reduce([ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.full' } })], spec, { equipment });
  assert.equal(users.sean.ladders.push_up.step_id, 'push_up.full');
  assert.equal(users.sean.quizDone, true);
});

test('a gated step is not entered until its gate opens', () => {
  const perfectSwings = (n) => Array.from({ length: n }, (_, i) => ({ exercise_id: 'swing', step_id: 'swing.db20', set_index: i + 1, value: 10, checklist_ok: true }));
  const events = [
    ...session({ id: 'g1', day: '2026-09-14', sets: perfectSwings(3) }),
    ...session({ id: 'g2', day: '2026-09-16', sets: perfectSwings(3) }),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.ladders.swing.step_id, 'swing.db20', 'the bell stays locked while push_up is at wall');

  const withGate = reduce([
    ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.knee' } }),
    ...events,
  ], spec, { equipment });
  assert.equal(withGate.users.sean.ladders.swing.step_id, 'swing.kb53', 'and opens once the hinge-equivalent gate is met');
});

test('a checklist step does not advance on reps alone', () => {
  const noCheck = (n) => Array.from({ length: n }, (_, i) => ({ exercise_id: 'swing', step_id: 'swing.db20', set_index: i + 1, value: 10, checklist_ok: false }));
  const { users } = reduce([
    ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.knee' } }),
    ...session({ id: 'c1', day: '2026-09-14', sets: noCheck(3) }),
    ...session({ id: 'c2', day: '2026-09-16', sets: noCheck(3) }),
  ], spec, { equipment });
  assert.equal(users.sean.ladders.swing.step_id, 'swing.db20', 'form must be ticked before the bell');
});

test('two pain flags in a week step the ladder back', () => {
  const events = [
    ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.full' } }),
    ev(TYPES.PAIN, { exercise_id: 'push_up', region: 'shoulder', level: 4 }, 'sean', at(30), { day: '2026-09-14' }),
    ev(TYPES.PAIN, { exercise_id: 'push_up', region: 'shoulder', level: 4 }, 'sean', at(31), { day: '2026-09-15' }),
    ...session({ id: 'p1', day: '2026-09-16', sets: perfectPushups(3, 'push_up.full', 12) }),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.ladders.push_up.step_id, 'push_up.knee',
    'pain steps back even on a good day, and even below the placement floor — safety outranks the quiz');
  assert.ok(users.sean.slips.some(s => s.reason === 'pain'));
});

test('one pain flag is not enough to regress', () => {
  const { users } = reduce([
    ev(TYPES.ASSESSMENT, { start_steps: { push_up: 'push_up.full' } }),
    ev(TYPES.PAIN, { exercise_id: 'push_up', region: 'shoulder', level: 4 }, 'sean', at(30), { day: '2026-09-14' }),
    ...session({ id: 'p2', day: '2026-09-16', sets: perfectPushups(3, 'push_up.full', 12) }),
  ], spec, { equipment });
  assert.equal(users.sean.ladders.push_up.step_id, 'push_up.full');
});

test('an event from a newer shell is counted, not silently dropped', () => {
  const future = { ...makeEvent(TYPES.SET, { session_id: 'z', exercise_id: 'push_up', set_index: 1, value: 9 }, { user: 'sean', dev: 'aaa111' }), v: SCHEMA_VERSION + 1 };
  const { users } = reduce([future], spec, { equipment });
  assert.equal(users.sean.unknownEvents, 1);
});

test('setKey separates sides and parts of the same set number', () => {
  const base = { session_id: 's', exercise_id: 'x', set_index: 1 };
  assert.notEqual(setKey({ ...base, side: 'L' }), setKey({ ...base, side: 'R' }));
  assert.notEqual(setKey({ ...base, part: 'y' }), setKey({ ...base, part: 't' }));
});

test('a pain flag carries its region, so the rules that watch for it can see it', () => {
  const events = [
    ev(TYPES.PAIN, { exercise_id: 'treadmill_intervals', region: 'shin', level: 5 }, 'sean', at(40), { day: '2026-09-14' }),
    ev(TYPES.PAIN, { exercise_id: 'push_up', level: 2 }, 'sean', at(41), { day: '2026-09-15' }),
  ];
  const { users } = reduce(events, spec, { equipment });
  assert.equal(users.sean.painFlags[0].region, 'shin');
  assert.equal(users.sean.painFlags[1].region, 'other', 'an unspecified region still records something the rules can read');
});

test('a live shin flag holds the running ladder shut', async () => {
  const { evalRule } = await import('../src/engine.js');
  const rule = { rule: 'no_pain_flag_days', region: 'shin', days: 14 };
  assert.equal(evalRule(rule, { sets: [] }, { painFlags: [{ region: 'shin', daysAgo: 3 }] }), false);
  assert.equal(evalRule(rule, { sets: [] }, { painFlags: [{ region: 'shin', daysAgo: 20 }] }), true);
});
