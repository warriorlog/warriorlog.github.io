// The Boss Arena's pure helpers. The view itself imports src/app.js, which wants
// a DOM, so the handful of globals app.js touches at boot are stubbed before the
// import; boot() then falls over on its own fetch and is caught by app.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexSpec } from '../src/engine.js';
import { testCard } from '../src/boss.js';

const el = { innerHTML: '', textContent: '', addEventListener() {}, appendChild() {}, removeChild() {}, querySelector: () => null, setAttribute() {}, removeAttribute() {} };
globalThis.window ??= {};
globalThis.document ??= { getElementById: () => el, addEventListener() {}, createElement: () => el, querySelector: () => null };
globalThis.location ??= { hash: '#/boss' };
globalThis.navigator ??= {};
const realError = console.error;
console.error = () => {};                       // app.js boot() cannot fetch under node
const V = await import('../src/views/boss.js');
console.error = realError;

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);
const bench = (id) => spec.byBenchmark[id];
const userAt = (ladders, extra = {}) => ({
  ladders: Object.fromEntries(Object.entries(ladders).map(([k, v]) => [k, { step_id: v }])),
  benchmarks: {}, benchmarkHistory: [], sessions: [], screens: {}, lockedBenchmarks: new Set(),
  profile: { bodyweight_lb: 128, program_start: '2026-09-14' }, ...extra,
});

test('a time is spoken as minutes and seconds, a rep count as a number', () => {
  assert.equal(V.fmtValue('sec', 582), '9:42');
  assert.equal(V.fmtValue('sec', 65), '1:05');
  assert.equal(V.fmtValue('reps', 26), '26');
  assert.equal(V.fmtValue('reps', null), '—');
});

test('the tier table shows the raw number THIS variant needs, not the scaled one', () => {
  const knee = testCard(bench('bb_pushups_2min'), userAt({ push_up: 'push_up.incline_counter' }), spec);
  assert.equal(knee.variant.id, 'knee');
  const rows = V.tierRows(knee);
  // 15 points at half a point per rep is 30 actual push-ups, and that is the
  // number a person has to see.
  assert.equal(rows[1].raw, 30);
  assert.equal(rows[1].open, true);
  assert.equal(rows[2].open, false, 'a capped variant shows the tiers it cannot reach as closed');

  const full = testCard(bench('bb_pushups_2min'), userAt({ push_up: 'push_up.full' }), spec);
  assert.equal(V.tierRows(full)[1].raw, 15);
  assert.ok(V.tierRows(full).every(r => r.open));
});

test('the gap to the next tier counts the right way for a test where lower is better', () => {
  const slow = testCard(bench('bb_mile_time'), userAt(
    { treadmill_intervals: 'treadmill_intervals.walk_6' },
    { benchmarks: { bb_mile_time: { value: 1140, tier: 1, variant: 'walk' } } },
  ), spec);
  const g = V.nextTierGap(slow);
  assert.equal(g.tier_name, 'Warrior');
  assert.equal(g.need, 900);
  assert.equal(g.gap, 240, 'four minutes to take off, expressed as a positive distance');
});

test('a topped-out test stops asking, and a fresh warrior is still shown two tiers', () => {
  const capped = testCard(bench('bb_hollow_hold'), userAt(
    { hollow_hold: 'hollow_hold.tuck_hold' },
    { benchmarks: { bb_hollow_hold: { value: 40, tier: 1, variant: 'tuck' } } },
  ), spec);
  assert.equal(V.nextTierGap(capped), null, 'the tuck hollow caps at soldier and says nothing more');

  const fresh = ['bb_pushups_2min', 'bb_hollow_hold', 'bb_goblet_bw']
    .map(id => testCard(bench(id), userAt({}), spec));
  const picks = V.closestTiers(fresh, 2);
  assert.equal(picks.length, 2);
  assert.ok(picks.every(p => p.have == null && p.need > 0));
});

test('the closest tier is the one needing the smallest relative jump', () => {
  const near = testCard(bench('bb_pushups_2min'), userAt(
    { push_up: 'push_up.full' }, { benchmarks: { bb_pushups_2min: { value: 14, tier: 0, variant: 'full' } } }), spec);
  const far = testCard(bench('bb_hollow_hold'), userAt(
    { hollow_hold: 'hollow_hold.full_hollow' }, { benchmarks: { bb_hollow_hold: { value: 8, tier: 0, variant: 'full' } } }), spec);
  assert.equal(V.closestTiers([far, near], 1)[0].id, 'bb_pushups_2min');
});

test('a shut test says the thing that would actually open it', () => {
  const early = testCard(bench('bb_swings_5min'), userAt({ swing: 'swing.hike_park_20' }), spec);
  assert.equal(early.locked, true);
  // testCard hands back the benchmark's health-screen note; the reason THIS
  // warrior cannot swing yet is the rung, and that is what the card must say.
  assert.match(V.lockNote(early), /cont_20|continuous swings/i);
  assert.notEqual(V.lockNote(early), early.locked_note);
});

test('the co-op bar shows three slices and the synergy is the smaller hit, counted twice', () => {
  const s = V.segments(30, 18, 55);
  assert.equal(s.synergy, 18);
  assert.equal(s.total, 66);
  assert.equal(s.remaining, 0);
  assert.equal(Math.round(s.pct.mine + s.pct.theirs + s.pct.synergy), 100, 'the slices fill the bar they are scaled to');

  const solo = V.segments(30, null, 27);
  assert.equal(solo.synergy, 0, 'nobody is handed a synergy bonus for fighting alone');
  assert.equal(solo.theirs, null);
  assert.equal(solo.total, 30);
});

test('a partner who has not logged yet contributes nothing and costs nothing', () => {
  const s = V.segments(24, 0, 55);
  assert.equal(s.synergy, 0);
  assert.equal(s.total, 24);
  assert.equal(s.remaining, 31);
});

test('deltas pair each result with the same test at the previous battle', () => {
  const user = {
    benchmarkHistory: [
      { benchmark_id: 'bb_pushups_2min', battle_n: 1, value: 18, tier: 1 },
      { benchmark_id: 'bb_pushups_2min', battle_n: 2, value: 24, tier: 1 },
    ],
  };
  const b = { n: 2, mine: { strikes: { bb_pushups_2min: 21 }, results: [{ benchmark_id: 'bb_pushups_2min', value: 24, tier: 1, tier_prev: 1, imp_pct: 33.3 }] } };
  const [d] = V.battleDeltas(user, b);
  assert.equal(d.before.value, 18);
  assert.equal(d.strike, 21);
});

test('the screen wears the right face for the day', () => {
  const cards = [{ locked: false }, { locked: true }];
  const base = { n: 1, cards, in_window: false, days_away: 12, mine: { logged: 0 } };
  assert.equal(V.phaseOf(base, {}), 'before');
  assert.equal(V.phaseOf({ ...base, in_window: true, days_away: 2 }, {}), 'open');
  assert.equal(V.phaseOf({ ...base, in_window: true, days_away: 0, mine: { logged: 1 } }, {}), 'result');
  assert.equal(V.phaseOf({ ...base, in_window: true, days_away: -1, mine: { logged: 1 } }, { bossResolved: { 1: {} } }), 'sealed');
});

test('the arena never uses a word that takes something away from you', () => {
  const src = readFileSync(new URL('../src/views/boss.js', import.meta.url), 'utf8');
  for (const word of ['lost', 'failed', 'fail', 'missed', 'behind', 'lazy']) {
    assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(src), `boss arena copy must not say "${word}"`);
  }
});
