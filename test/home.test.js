import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coldRegionLine, climbLines, stakeLines, finishedToday } from '../src/stakes.js';
import { indexSpec, prescribe } from '../src/engine.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);

const regions = (over) => Object.fromEntries(
  ['heart','neck_traps','shoulders','chest','arms','back','core','glutes','thighs','calves']
    .map(r => [r, { xp: over[r] ?? 500, level: 2 }]));

const userWith = (sessions) => ({ sessions, ladders: {}, equipment: {}, profile: {} });

const days = (n) => Array.from({ length: n }, (_, i) => ({
  day: `2026-09-${String(14 + i).padStart(2, '0')}`, sets: [{ exercise_id: 'push_up' }],
}));

test('says nothing at all until there is enough history to mean something', () => {
  // Every region sits at zero on day one, so the lowest is whichever sorts
  // first. Naming it presents an arbitrary tie as a finding.
  const p = { regions: regions({}) };
  assert.equal(coldRegionLine(spec, userWith([]), null, p.regions), null);
  assert.equal(coldRegionLine(spec, userWith(days(3)), null, p.regions), null, 'three days is not a trend');
  assert.equal(coldRegionLine(spec, userWith(days(6)), null, p.regions), null);
});

test('says nothing when everything is level', () => {
  const p = { regions: regions({}) };
  assert.equal(coldRegionLine(spec, userWith(days(10)), null, p.regions), null,
    'a dead-even spread has no laggard to report');
});

test('says nothing when the lowest is only slightly lower', () => {
  const p = { regions: regions({ calves: 400 }) };   // 500 elsewhere
  assert.equal(coldRegionLine(spec, userWith(days(10)), null, p.regions), null);
});

test('names a region that is genuinely behind, and when it is next trained', () => {
  const p = { regions: regions({ calves: 40 }) };
  const line = coldRegionLine(spec, userWith(days(10)), { day: '2026-09-15', blocks: [] }, p.regions);
  assert.match(line, /calves/);
  assert.match(line, /least attention/);
  assert.match(line, /trains it next|tomorrow/, 'a bare observation is not worth a line on the home screen');
});

test('never names a region the session in front of you already trains', () => {
  // "heart is your coldest region" on the morning of a 33-minute Zone-2 walk is
  // worse than saying nothing.
  const p = { regions: regions({ heart: 40 }) };
  const wed = prescribe(spec, {
    sessions: [], ladders: Object.fromEntries(program.exercises.map(e => [e.id, { step_id: e.ladder[0].id }])),
    equipment: {}, profile: { program_start: '2026-09-14' }, floor: {}, caps: {}, climbs: [], benchmarks: {},
  }, '2026-09-16', {});
  const line = coldRegionLine(spec, userWith(days(10)), wed, p.regions);
  assert.match(line, /today's session works heart/, `got: ${line}`);
  assert.ok(!/next/.test(line), 'it should point at today, not a future day');
});

test('the line explains itself without a glossary', () => {
  const p = { regions: regions({ calves: 40 }) };
  const line = coldRegionLine(spec, userWith(days(10)), { day: '2026-09-15', blocks: [] }, p.regions);
  assert.ok(!/cold/i.test(line), '"coldest region" is jargon nobody was taught');
  for (const w of ['lost', 'failed', 'missed', 'behind', 'lazy']) {
    assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(line), `"${w}" scolds`);
  }
});

test('a quest finished today takes the place of the start button', () => {
  // The home card only knew about an open session, so after finishing it went
  // straight back to offering the same quest.
  const s = { session_id: 'a', day: '2026-09-10', type: 'full', sets: [{ exercise_id: 'push_up' }] };
  assert.equal(finishedToday({ sessions: [s] }, '2026-09-10'), s);
  assert.equal(finishedToday({ sessions: [s] }, '2026-09-11'), null, 'the next day brings a new quest');
  assert.equal(finishedToday({ sessions: [{ ...s, sets: [] }] }, '2026-09-10'), null, 'a session with no sets is not a finished quest');
  const later = { ...s, session_id: 'b', type: 'skirmish' };
  assert.equal(finishedToday({ sessions: [s, later] }, '2026-09-10'), later, 'the latest session of the day is the one shown');
});

test('a rest day has nothing at stake', () => {
  const p = { regions: regions({ calves: 40 }) };
  assert.deepEqual(stakeLines(spec, userWith(days(10)), { rest: true }, p.regions), []);
  assert.deepEqual(stakeLines(spec, userWith(days(10)), null, p.regions), []);
});

test('a rung one session away is named; one that is not is left alone', () => {
  const plan = {
    day: '2026-09-15', blocks: [{ kind: 'strength_a', items: [
      { exercise_id: 'push_up', name: 'Push-up', step_id: 'push_up.wall', next_unlock: 'Every set at 15 reps, 2 sessions in a row', counts_for_progression: true },
      { exercise_id: 'db_row', name: 'Row', step_id: 'db_row.db12', next_unlock: 'Every set at 15 reps, 2 sessions in a row', counts_for_progression: true },
    ] }],
  };
  const user = { ...userWith(days(3)), ladders: { push_up: { qualifying: 1 }, db_row: { qualifying: 0 } } };
  const lines = climbLines(spec, user, plan);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Push-up climbs a rung today/);
});

test('a movement that cannot progress never promises a rung', () => {
  const plan = {
    day: '2026-09-15', blocks: [{ kind: 'finisher', items: [
      { exercise_id: 'zone2_finisher', name: 'Zone-2 finisher walk', step_id: 'zone2_finisher.finisher', next_unlock: 'Practise it 99999 times', counts_for_progression: false },
    ] }],
  };
  const user = { ...userWith(days(3)), ladders: { zone2_finisher: { qualifying: 5 } } };
  assert.deepEqual(climbLines(spec, user, plan), []);
});
