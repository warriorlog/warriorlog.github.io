// Benchmark tests and the boss battles they feed.
//
// Two things make this more than a scoreboard. First, the test you take depends
// on the rungs you have actually earned: week 4 arrives before the run gate and
// the bell gate open, so the mile is walked and the swing test may be locked
// entirely. Second, an improvement is only counted when it is like-for-like —
// swinging a 53 lb bell fewer times than you swung a 20 lb dumbbell is progress,
// not a regression, so a changed variant scores its tier and no improvement.
import { evalRule, atOrPast } from './engine.js';
import { isoWeekKey, addDays, daysBetween, clamp } from './util.js';

export const TIERS = ['recruit', 'soldier', 'warrior', 'champion'];

/** Which version of a test this user takes today, and why. */
export function variantFor(bench, user, spec) {
  const ctx = { ladders: user.ladders, spec, benchmarks: user.benchmarks ?? {} };
  for (const v of bench.variants ?? []) {
    const when = v.when ?? [];
    if (!when.length) return v;                       // the always-applies fallback
    if (when.every(rule => evalRule(rule, { sets: [] }, ctx))) return v;
  }
  return bench.variants?.[bench.variants.length - 1] ?? null;
}

/** Is this test available at all? A flagged health screen locks two of them. */
export function isLocked(bench, user) {
  if (user.lockedBenchmarks?.has?.(bench.id)) return true;
  if (bench.health_screen_required && user.screens && Object.values(user.screens).some(v => v === true && bench.health_screen_required)) {
    // Only the PAR-Q answer locks; other screens are ability checks.
    return user.screens.q_parq === true;
  }
  return false;
}

/** Tier index 0-3 for a result, honouring the variant's own table and its cap. */
export function tierFor(bench, variant, value) {
  if (value == null || !variant?.tiers?.length) return 0;
  const scaled = value * (variant.multiplier ?? 1);
  let tier = 0;
  variant.tiers.forEach((threshold, i) => {
    const reached = bench.higher_is_better ? scaled >= threshold : scaled <= threshold;
    if (reached) tier = i;
  });
  return Math.min(tier, variant.tier_cap ?? 3);
}

/** The load a goblet test uses: heaviest bell you own, can lift, and have earned. */
export function resolveTestLoad(bench, user, spec) {
  const rule = bench.load_rule;
  if (!rule) return null;
  const bw = user.profile?.bodyweight_lb ?? null;
  const ceiling = bw ? bw * ((rule.max_pct_bodyweight ?? 35) / 100) : Infinity;
  let chosen = null, capped = false;
  for (const c of rule.candidates ?? []) {
    const earned = !c.step_id || atOrPast(user.ladders, c.exercise ?? bench.parent_exercise, c.step_id, spec);
    if (!earned) continue;
    if (c.lb > ceiling) { capped = true; continue; }
    if (!chosen || c.lb > chosen.lb) chosen = c;
  }
  return { ...(chosen ?? rule.candidates?.[0] ?? {}), tier_capped: capped && !chosen };
}

/** Everything the arena needs to render one test card for one user. */
export function testCard(bench, user, spec) {
  const variant = variantFor(bench, user, spec);
  const locked = isLocked(bench, user) || variant?.id === 'locked';
  const previous = lastResult(user, bench.id);
  return {
    id: bench.id, name: bench.name, order: bench.order, unit: bench.unit,
    higher_is_better: bench.higher_is_better, protocol: bench.protocol,
    variant, locked,
    locked_note: locked ? (bench.locked_note ?? variant?.lock_note ?? 'Not unlocked yet.') : null,
    load: resolveTestLoad(bench, user, spec),
    previous,
    tier: previous ? previous.tier : null,
  };
}

const lastResult = (user, id) => user.benchmarks?.[id] ?? null;

/**
 * Score one logged result. `imp_pct` is only meaningful against the SAME variant,
 * so a switch from dumbbell swings to the bell scores its tier climb and zero
 * improvement rather than a fake collapse.
 */
export function scoreResult(bench, user, spec, value, { variant = null } = {}) {
  const v = variant ?? variantFor(bench, user, spec);
  const prev = lastResult(user, bench.id);
  const tier = tierFor(bench, v, value);
  const sameVariant = prev && prev.variant === v?.id;
  let imp_pct = 0;
  if (sameVariant && prev.value > 0) {
    imp_pct = bench.higher_is_better
      ? ((value - prev.value) / prev.value) * 100
      : ((prev.value - value) / prev.value) * 100;
  }
  return {
    benchmark_id: bench.id, value, variant: v?.id ?? null,
    implement_id: v?.implement_id ?? null,
    step_at_test: user.ladders?.[bench.parent_exercise]?.step_id ?? null,
    tier, tier_prev: prev?.tier ?? null,
    imp_pct: Math.round(imp_pct * 10) / 10,
    variant_changed: !!prev && !sameVariant,
  };
}

// ---------------------------------------------------------------- the battle
/** Which battle number a day belongs to, and the window it can be logged in. */
export function battleFor(spec, day, programStart) {
  const week = Math.floor(daysBetween(programStart, day) / 7) + 1;
  if (week < 4) return null;
  const n = Math.floor(week / 4);
  if (week % 4 !== 0) return null;
  return { n, week, window_start: addDays(programStart, (week - 1) * 7), window_end: addDays(programStart, (week + 1) * 7 - 1) };
}

/** One warrior's damage: how much they improved, plus the tiers they climbed. */
export function strikeFor(results, gam, battleN) {
  const d = gam.boss_damage ?? {};
  const strikes = {};
  for (const r of results) {
    if (battleN === 1 || r.tier_prev == null) {
      strikes[r.benchmark_id] = (d.first_battle_logged ?? 10) + (d.first_battle_per_tier ?? 15) * r.tier;
    } else {
      const imp = clamp(Math.round(r.imp_pct), 0, d.imp_cap ?? 25);
      const climbs = Math.max(0, r.tier - r.tier_prev);
      const tierPts = Math.min(d.tier_pts_cap ?? 30, (d.tier_pts_per_climb ?? 15) * climbs);
      strikes[r.benchmark_id] = imp + tierPts;
    }
  }
  const ids = gam.boss_benchmarks ?? Object.keys(strikes);
  const total = ids.reduce((n, id) => n + (strikes[id] ?? 0), 0);
  return { strikes, damage: Math.round(total / Math.max(1, ids.length)), logged: Object.keys(strikes).length };
}

/**
 * Combined damage counts the smaller contribution twice, so the partner who can
 * do less is never the weak link — their number is the one that decides whether
 * the pair gets the bonus.
 */
export function coopDamage(a, b) {
  if (a == null) return b ?? 0;
  if (b == null) return a;
  return a + b + Math.min(a, b);
}

export function bossFor(gam, n) {
  const list = gam.bosses ?? [];
  return list.find(b => b.n === n) ?? list[list.length - 1] ?? { n, name: 'Season Titan', hp: 50 };
}

export function hpFor(boss, gam, { bothBellGate = false, bothVest = false } = {}) {
  let hp = boss.hp ?? 50;
  const bonus = boss.hp_bonus;
  if (bonus) {
    const m = bonus.when?.metric;
    if ((m === 'both_gate_passed' && bothBellGate) || (m === 'both_vest_sessions' && bothVest)) hp += bonus.amount ?? 0;
  }
  return hp;
}

/** FLAWLESS / DEFEATED / WOUNDED / ESCAPED, and what each is worth. */
export function outcomeFor(damage, hp, gam) {
  const o = gam.boss_damage?.outcomes ?? { flawless: 1.5, defeated: 1.0, wounded: 0.75 };
  if (damage >= hp * o.flawless) return 'flawless';
  if (damage >= hp * o.defeated) return 'defeated';
  if (damage >= hp * o.wounded) return 'wounded';
  return 'escaped';
}

/** The whole battle, for both warriors, ready to render. */
export function battleState(mine, theirs, spec, gam, day) {
  const programStart = mine.profile?.program_start;
  if (!programStart) return null;
  const week = Math.floor(daysBetween(programStart, day) / 7) + 1;
  const n = Math.max(1, Math.floor((week + 3) / 4));
  const battleWeek = n * 4;
  const windowStart = addDays(programStart, (battleWeek - 1) * 7);
  const windowEnd = addDays(windowStart, 13);
  const boss = bossFor(gam, n);

  const inWindow = daysBetween(windowStart, day) >= 0 && daysBetween(day, windowEnd) >= 0;
  const daysAway = daysBetween(day, addDays(windowStart, 5));   // the Saturday of boss week

  const resultsOf = (u) => (u?.benchmarkHistory ?? []).filter(r => r.battle_n === n);
  const mineResults = resultsOf(mine), theirResults = resultsOf(theirs);
  const a = strikeFor(mineResults, gam, n);
  const b = theirs ? strikeFor(theirResults, gam, n) : null;

  const bothBell = !!(atOrPast(mine.ladders, 'swing', 'swing.deadstop_53', spec)
    && theirs && atOrPast(theirs.ladders, 'swing', 'swing.deadstop_53', spec));
  // Solo means there is genuinely nobody else, not that the partner has yet to
  // take the tests. A partner who is set up keeps the boss at full strength and
  // contributes zero until they test; halving it here would quietly rewrite the
  // battle the moment they logged their first result.
  const solo = !theirs || (!theirs.quizDone && !theirs.sessions?.length);
  const hp = Math.round(hpFor(boss, gam, { bothBellGate: bothBell }) * (solo ? (gam.boss_damage?.solo_hp_multiplier ?? 0.5) : 1));
  const damage = solo ? a.damage : coopDamage(a.damage, b?.damage ?? 0);

  return {
    n, boss, week: battleWeek, window_start: windowStart, window_end: windowEnd,
    in_window: inWindow, days_away: daysAway, solo, hp, damage,
    outcome: outcomeFor(damage, hp, gam),
    mine: { ...a, results: mineResults },
    theirs: theirs ? { ...b, results: theirResults } : null,
    cards: (gam.boss_benchmarks ?? []).map(id => testCard(spec.byBenchmark[id], mine, spec)).filter(Boolean),
    training_camp: daysAway > 0 && daysAway <= 3,
  };
}
