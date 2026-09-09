import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../src/boss.js';
import { indexSpec } from '../src/engine.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);

const bench = (id) => spec.byBenchmark[id];
const userAt = (ladders, extra = {}) => ({
  ladders: Object.fromEntries(Object.entries(ladders).map(([k, v]) => [k, { step_id: v }])),
  benchmarks: {}, benchmarkHistory: [], sessions: [], profile: { bodyweight_lb: 128, program_start: '2026-09-14' },
  screens: {}, lockedBenchmarks: new Set(), ...extra,
});

test('a beginner walks the mile; only the run gate unlocks running it', () => {
  const beginner = userAt({ treadmill_intervals: 'treadmill_intervals.walk_6' });
  assert.equal(B.variantFor(bench('bb_mile_time'), beginner, spec).id, 'walk');
  const runner = userAt({ treadmill_intervals: 'treadmill_intervals.jog_8' });
  assert.equal(B.variantFor(bench('bb_mile_time'), runner, spec).id, 'run');
});

test('the swing test stays locked until continuous swings are earned', () => {
  const early = userAt({ swing: 'swing.hike_park_20' });
  const v = B.variantFor(bench('bb_swings_5min'), early, spec);
  assert.equal(v.id, 'locked', 'a beginner is not handed a five-minute swing test');
  assert.ok(B.testCard(bench('bb_swings_5min'), early, spec).locked_note, 'and is told what would open it');

  const withDb = userAt({ swing: 'swing.cont_20' });
  assert.equal(B.variantFor(bench('bb_swings_5min'), withDb, spec).id, 'db');
  const withBell = userAt({ swing: 'swing.cont_53' });
  assert.equal(B.variantFor(bench('bb_swings_5min'), withBell, spec).id, 'kb53');
});

test('an easier variant cannot reach the top tiers', () => {
  const knee = bench('bb_pushups_2min').variants.find(v => v.id === 'knee');
  const full = bench('bb_pushups_2min').variants.find(v => v.id === 'full');
  assert.ok(knee.tier_cap < 3, 'knee push-ups must not score champion');
  assert.equal(B.tierFor(bench('bb_pushups_2min'), knee, 200), knee.tier_cap);
  assert.ok(B.tierFor(bench('bb_pushups_2min'), full, 46) === 3);
});

test('a faster mile is a better tier, because lower is better there', () => {
  const b = bench('bb_mile_time');
  const run = b.variants.find(v => v.id === 'run');
  assert.ok(B.tierFor(b, run, 470) > B.tierFor(b, run, 700), 'a 7:50 mile beats an 11:40');
});

test('switching to a heavier implement scores the tier and no false collapse', () => {
  // 60 swings with the bell after 90 with a dumbbell is progress, not a 33% drop.
  const user = userAt({ swing: 'swing.cont_53' }, {
    benchmarks: { bb_swings_5min: { value: 90, tier: 1, variant: 'db' } },
  });
  const scored = B.scoreResult(bench('bb_swings_5min'), user, spec, 60);
  assert.equal(scored.variant, 'kb53');
  assert.equal(scored.variant_changed, true);
  assert.equal(scored.imp_pct, 0, 'no improvement is claimed, and none is subtracted');
});

test('a like-for-like improvement is measured', () => {
  const user = userAt({ push_up: 'push_up.full' }, {
    benchmarks: { bb_pushups_2min: { value: 20, tier: 1, variant: 'full' } },
  });
  const scored = B.scoreResult(bench('bb_pushups_2min'), user, spec, 30);
  assert.equal(scored.variant_changed, false);
  assert.equal(scored.imp_pct, 50);
  assert.ok(scored.tier > scored.tier_prev);
});

test('the goblet test load is the heaviest you own, can lift, and have earned', () => {
  const light = userAt({ goblet_squat: 'goblet_squat.db12' }, { profile: { bodyweight_lb: 120 } });
  const heavy = userAt({ goblet_squat: 'goblet_squat.kb53' }, { profile: { bodyweight_lb: 200 } });
  const a = B.resolveTestLoad(bench('bb_goblet_bw'), light, spec);
  const b = B.resolveTestLoad(bench('bb_goblet_bw'), heavy, spec);
  assert.ok(a.lb <= 120 * 0.35, `${a.lb} lb is over 35% of a 120 lb bodyweight`);
  assert.ok(b.lb > a.lb, 'a heavier, stronger user tests heavier');
});

test('the first battle pays for showing up and for the tier reached', () => {
  const results = [{ benchmark_id: 'bb_pushups_2min', tier: 2, tier_prev: null, imp_pct: 0 }];
  const { strikes } = B.strikeFor(results, gam, 1);
  assert.equal(strikes.bb_pushups_2min, gam.boss_damage.first_battle_logged + gam.boss_damage.first_battle_per_tier * 2);
});

test('later battles pay for improvement and tier climbs, both capped', () => {
  const huge = [{ benchmark_id: 'bb_pushups_2min', tier: 3, tier_prev: 0, imp_pct: 500 }];
  const { strikes } = B.strikeFor(huge, gam, 2);
  assert.equal(strikes.bb_pushups_2min, gam.boss_damage.imp_cap + gam.boss_damage.tier_pts_cap, 'both halves cap');
  const worse = [{ benchmark_id: 'bb_pushups_2min', tier: 1, tier_prev: 2, imp_pct: -40 }];
  assert.equal(B.strikeFor(worse, gam, 2).strikes.bb_pushups_2min, 0, 'a bad day never does negative damage');
});

test('the smaller contribution counts twice, so nobody is the weak link', () => {
  assert.equal(B.coopDamage(40, 10), 60, '40 + 10 + the smaller 10');
  assert.equal(B.coopDamage(10, 40), 60, 'and it does not matter who is who');
  // Ten more points from the weaker partner is worth double.
  assert.equal(B.coopDamage(40, 20) - B.coopDamage(40, 10), 20);
  // Ten more from the stronger one is worth single.
  assert.equal(B.coopDamage(50, 10) - B.coopDamage(40, 10), 10);
});

test('outcomes land on the published thresholds', () => {
  assert.equal(B.outcomeFor(90, 55, gam), 'flawless');
  assert.equal(B.outcomeFor(55, 55, gam), 'defeated');
  assert.equal(B.outcomeFor(45, 55, gam), 'wounded');
  assert.equal(B.outcomeFor(10, 55, gam), 'escaped');
});

test('training alone halves the boss rather than making it unwinnable', () => {
  const solo = B.battleState(userAt({}), null, spec, gam, '2026-10-10');
  const boss = B.bossFor(gam, 1);
  assert.equal(solo.solo, true);
  assert.equal(solo.hp, Math.round(boss.hp * gam.boss_damage.solo_hp_multiplier));
});

test('the battle lands on the right week, with a two-week window', () => {
  const u = userAt({});
  const s = B.battleState(u, null, spec, gam, '2026-10-10');
  assert.equal(s.n, 1);
  assert.equal(s.week, 4);
  assert.equal(s.in_window, true);
  assert.equal(B.battleState(u, null, spec, gam, '2026-09-20').in_window, false, 'week 1 is not battle week');
  assert.equal(B.battleState(u, null, spec, gam, '2026-11-07').n, 2);
  assert.equal(B.battleState(u, null, spec, gam, '2026-12-05').n, 3);
});

test('every test card resolves for a brand-new user', () => {
  const fresh = userAt(Object.fromEntries(program.exercises.map(e => [e.id, e.ladder[0].id])));
  for (const id of gam.boss_benchmarks) {
    const card = B.testCard(bench(id), fresh, spec);
    assert.ok(card.variant, `${id}: no variant resolved`);
    if (card.locked) assert.ok(card.locked_note, `${id}: locked with no explanation`);
  }
});
