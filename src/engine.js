// The progression engine: pure functions from (program spec, derived user state,
// today) to today's prescription. No DOM, no clock of its own — `today` is always
// passed in, so every rule is unit-testable and both phones compute identically.
import { clamp, weekIndex, daysBetween, dow } from './util.js';

// ---------------------------------------------------------------- RULES
// A CLOSED registry. Data may only name a rule that lives here; program.test.js
// rejects anything else, so a typo in the program JSON fails the build instead of
// silently never advancing a ladder.
//
// Every rule is (perf, args, ctx) -> boolean where `perf` is one exercise's
// record for one session:
//   { sets:[{value, unit, side, part, checklist_ok, pain}], prescribed, allDone,
//     minValue, rounds, clockSec, rpeBlock, cardioMinutes, cardioDone }
// and ctx is { ladders, benchmarks, painFlags, weekIndex, sessionsAtStep, step }.
export const RULES = {
  all_sets_reps_gte: (p, a) => p.allDone && p.sets.length > 0 && p.sets.every(s => (s.value ?? 0) >= a.value),
  all_sets_time_gte: (p, a) => p.allDone && p.sets.length > 0 && p.sets.every(s => (s.value ?? 0) >= a.value),
  rounds_gte: (p, a) => (p.rounds ?? 0) >= a.value,
  clock_lte: (p, a) => p.clockSec != null && p.clockSec <= a.value,
  cardio_done: (p, a) => !!p.cardioDone && (a.rpe_max == null || (p.rpeBlock ?? 99) <= a.rpe_max),
  checklist_all_ok: (p) => p.sets.length > 0 && p.sets.every(s => s.checklist_ok !== false),
  drops_lte: (p, a) => (p.drops ?? 0) <= a.value,
  rpe_min: (p, a) => (p.rpeBlock ?? 0) >= a.value,
  sessions_gte: (p, a, c) => (c.sessionsAtStep ?? 0) >= a.value,
  weeks_elapsed_gte: (p, a, c) => (c.weekIndex ?? 0) >= a.value,
  no_pain_flag_days: (p, a, c) => !(c.painFlags ?? []).some(f =>
    (a.region == null || f.region === a.region) && f.daysAgo <= a.days),
  ladder_at_or_past: (p, a, c) => atOrPast(c.ladders, a.exercise, a.step_id, c.spec),
  benchmark_gte: (p, a, c) => (c.benchmarks?.[a.id]?.value ?? -Infinity) >= a.value,
  benchmark_lte: (p, a, c) => (c.benchmarks?.[a.id]?.value ?? Infinity) <= a.value,
  all_of: (p, a, c) => (a.rules || []).every(r => evalRule(r, p, c)),
};

export const RULE_NAMES = Object.freeze(Object.keys(RULES));

export function evalRule(rule, perf, ctx) {
  const fn = RULES[rule?.rule];
  if (!fn) throw new Error(`unknown rule: ${rule?.rule}`);
  return !!fn(perf, rule, ctx);
}

/** Is `exercise`'s current step at or past `stepId`? Compares ordinals, not ids. */
export function atOrPast(ladders, exercise, stepId, spec) {
  const cur = ladders?.[exercise]?.step_id;
  if (!cur) return false;
  const steps = spec?.byExercise?.[exercise]?.ladder;
  if (!steps) return false;
  const i = steps.findIndex(s => s.id === cur);
  const j = steps.findIndex(s => s.id === stepId);
  if (i < 0 || j < 0) return false;
  return i >= j;
}

// ---------------------------------------------------------------- spec index
/** Index program.json once so lookups elsewhere are O(1) and always by id. */
export function indexSpec(program) {
  const byExercise = Object.create(null);
  const byStep = Object.create(null);
  for (const ex of program.exercises || []) {
    byExercise[ex.id] = ex;
    for (const st of ex.ladder || []) byStep[st.id] = { ...st, exercise_id: ex.id };
  }
  const byTemplate = Object.create(null);
  for (const t of program.templates || []) byTemplate[t.id] = t;
  const byBenchmark = Object.create(null);
  for (const b of program.benchmarks || []) byBenchmark[b.id] = b;
  return { ...program, byExercise, byStep, byTemplate, byBenchmark };
}

// ---------------------------------------------------------------- equipment
/**
 * Drop the ladder steps this household cannot perform, and swap a pair-requiring
 * step for its single-dumbbell variant. Progression must never stall waiting for
 * a weight that does not exist.
 */
export function resolveSteps(exercise, equipment = {}) {
  const has = (token) => {
    const [kind, a, b] = String(token).split(':');
    if (kind === 'bw') return true;
    if (kind === 'treadmill') return !!equipment.treadmill;
    if (kind === 'chair') return !!equipment.chair_height_in;
    if (kind === 'couch') return equipment.couch_edge !== false;
    if (kind === 'vest') return (equipment.vest_max_lb ?? 0) > 0;
    if (kind === 'kb') return (equipment.kb || [53]).includes(Number(a));
    if (kind === 'db') {
      const owned = equipment.dumbbells?.[a];
      if (owned === 'none' || owned == null) return (equipment.dbLb || [8, 10, 12, 20, 35]).includes(Number(a));
      return b === 'pair' ? owned === 'pair' : owned === 'pair' || owned === 'single';
    }
    return true;
  };
  const out = [];
  for (const step of exercise.ladder || []) {
    if (step.retired) continue;
    const reqs = step.requires || ['bw'];
    if (reqs.every(has)) { out.push(step); continue; }
    // A pair we do not own: fall back to the declared single-dumbbell variant.
    const pairOnly = reqs.filter(r => !has(r));
    if (step.single_alt && pairOnly.every(r => r.endsWith(':pair'))) {
      out.push({ ...step, ...step.single_alt, id: step.id, ord: step.ord, single: true });
    }
    // Otherwise the step is genuinely impossible here and is skipped.
  }
  return out;
}

// ---------------------------------------------------------------- ladders
export const FAIL_FRACTION = 0.6;

/** Did this session's record for one exercise meet the step's advance rule? */
export function qualifies(step, perf, ctx) {
  if (!perf || perf.sessionType !== 'full') return false;
  const adv = step.advance;
  if (!adv || step.terminal) return false;
  if (!evalRule(adv, perf, ctx)) return false;
  if (step.checklist_required && !RULES.checklist_all_ok(perf)) return false;
  return (adv.requires || []).every(r => evalRule(r, perf, ctx));
}

/** A session that went badly enough to hold or step back. */
export function failed(step, perf) {
  if (!perf || !perf.sets?.length) return false;
  if (perf.sets.some(s => (s.pain ?? 0) >= 3)) return true;
  const low = step.A ?? step.B ?? 0;
  if (!low) return false;
  return perf.sets.some(s => (s.value ?? 0) < FAIL_FRACTION * low);
}

/** Can this step be USED today? (entry gates are checked every session, not only on advance) */
export function entryOpen(step, ctx) {
  return (step.entry_requires || []).every(r => evalRule(r, {}, ctx));
}

/** The exact condition still standing between the user and a locked step. */
export function blockedBy(step, ctx) {
  return (step.entry_requires || []).find(r => !evalRule(r, {}, ctx)) ?? null;
}

/**
 * Advance every ladder by ONE session. This is the only place a ladder moves, so
 * the reducer (replaying real events) and the reachability simulation in
 * program.test.js can never drift apart.
 *
 * `state` maps exercise_id -> { step_id, qualifying, fails, sessionsAtStep, lastDay }.
 * `perfs` maps exercise_id -> perf record for this session. Returns a NEW state
 * plus the climbs and slips that happened, which the gamification layer pays for.
 */
export function stepLadders(spec, state, perfs, ctx) {
  const next = { ...state };
  const climbs = [], slips = [];
  const ladders = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { step_id: v.step_id }]));

  for (const [exId, perf] of Object.entries(perfs)) {
    const ex = spec.byExercise?.[exId];
    if (!ex || perf?.counts_for_progression === false) continue;
    const steps = ctx.steps?.[exId] ?? resolveSteps(ex, ctx.equipment);
    if (!steps.length) continue;

    const cur = next[exId] ?? { step_id: steps[0].id, qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: null };
    let i = Math.max(0, steps.findIndex(s => s.id === cur.step_id));
    if (i < 0) i = 0;
    const floorIdx = Math.max(0, steps.findIndex(s => s.id === (ctx.floor?.[exId] ?? steps[0].id)));

    // A long absence regresses rather than pretending nothing happened.
    const gap = cur.lastDay ? daysBetween(cur.lastDay, ctx.day) : 0;
    let { qualifying, fails, sessionsAtStep } = cur;
    if (gap > 14) { i = Math.max(floorIdx, i - 2); qualifying = 0; fails = 0; sessionsAtStep = 0; }
    else if (gap > 7) { i = Math.max(floorIdx, i - 1); qualifying = 0; fails = 0; sessionsAtStep = 0; }

    const stepCtx = { ...ctx, ladders, sessionsAtStep, step: steps[i] };

    if (perf.deload) {
      // Deload sessions keep the counter running (the advance lands on the first
      // non-deload session) but never move the step.
      if (qualifies(steps[i], { ...perf, sessionType: 'full' }, stepCtx)) qualifying++;
      sessionsAtStep++;
    } else if (perf.sessionType !== 'full') {
      // Skirmish and Ember keep the flame, never a ladder.
    } else {
      sessionsAtStep++;
      if (failed(steps[i], perf)) { fails++; qualifying = 0; }
      else if (qualifies(steps[i], perf, stepCtx)) { qualifying++; fails = 0; }
      else { qualifying = 0; }

      const need = steps[i].advance?.consecutive ?? 2;
      if (qualifying >= need && gap <= 7 && i < steps.length - 1 && entryOpen(steps[i + 1], stepCtx)) {
        i++; qualifying = 0; fails = 0; sessionsAtStep = 0;
        climbs.push({ exercise_id: exId, step_id: steps[i].id, name: steps[i].name, day: ctx.day });
      } else if (fails >= 2 && i > floorIdx) {
        i--; fails = 0; qualifying = 0; sessionsAtStep = 0;
        slips.push({ exercise_id: exId, step_id: steps[i].id, day: ctx.day });
      }
    }
    next[exId] = { step_id: steps[i].id, qualifying, fails, sessionsAtStep, lastDay: ctx.day };
  }
  return { ladders: next, climbs, slips };
}

/**
 * Pain flags regress a ladder on their own: two in seven days steps it back.
 * This deliberately ignores the placement floor. The floor stops one bad session
 * from undoing the quiz, but pain is a safety signal — if it hurts twice, the
 * user goes down a rung whatever the quiz said.
 */
export function applyPainRegressions(spec, state, painFlags, ctx) {
  const next = { ...state };
  const slips = [];
  const byEx = {};
  for (const f of painFlags) if (f.daysAgo <= 7 && f.exercise_id) (byEx[f.exercise_id] ??= []).push(f);
  for (const [exId, flags] of Object.entries(byEx)) {
    if (flags.length < 2 || !next[exId]) continue;
    const steps = ctx.steps?.[exId] ?? resolveSteps(spec.byExercise?.[exId] ?? {}, ctx.equipment);
    const i = steps.findIndex(s => s.id === next[exId].step_id);
    if (i > 0) {
      next[exId] = { ...next[exId], step_id: steps[i - 1].id, qualifying: 0, fails: 0, sessionsAtStep: 0 };
      slips.push({ exercise_id: exId, step_id: steps[i - 1].id, reason: 'pain', day: ctx.day });
    }
  }
  return { ladders: next, slips };
}

// ---------------------------------------------------------------- loads
/**
 * Vest pounds from a percentage of bodyweight, snapped DOWN to the vest's
 * increments. Rounding up would push a light user past the percentage the
 * program gated on; under-loading is safe, over-loading is not. Hard ceilings:
 * the step's cap, 20% of bodyweight, and 30 lb.
 */
export function resolveVest(pct, bodyweightLb, eq = {}, capLb = 30) {
  if (!pct || !bodyweightLb) return 0;
  const inc = eq.vest_increment_lb || 5;
  const min = eq.vest_min_lb || inc;
  const ceiling = Math.min(eq.vest_max_lb ?? 30, capLb, 30, 0.2 * bodyweightLb);
  const target = Math.min((pct / 100) * bodyweightLb, ceiling);
  const snapped = Math.floor(target / inc) * inc;
  return snapped < min ? (min <= ceiling ? min : 0) : snapped;
}

/** Treadmill settings clamped to the machine the user actually owns. */
export function resolveCardio(cardio, eq = {}) {
  if (!cardio) return null;
  const maxIncline = eq.treadmill_max_incline ?? 15;
  const maxMph = eq.treadmill_max_mph ?? 12;
  const out = { ...cardio };
  if (out.incline != null && out.incline > maxIncline) {
    out.incline = maxIncline;
    out.mph = Math.min(maxMph, (out.mph ?? 3) + 0.3);   // trade the missing hill for a little speed
    out.substituted = true;
  }
  if (out.mph != null && out.mph > maxMph) { out.mph = maxMph; out.substituted = true; }
  return out;
}

// ---------------------------------------------------------------- schedule
export function phaseFor(spec, week) {
  const phases = spec.phases || [];
  return phases.find(p => week >= p.weeks[0] && week <= p.weeks[1]) ?? phases[0] ?? null;
}

export const isBossWeek = (spec, week) => week > 0 && week % (spec.deload?.every_n_weeks ?? 4) === 0;

/** Which template runs today: the weekday's, chosen by the calendar, not a rotation. */
export function templateFor(spec, day) {
  const d = dow(day);
  return (spec.templates || []).find(t => t.dow === d) ?? null;
}

export function scheduleFor(spec, day, programStart) {
  const week = weekIndex(day, programStart);
  return {
    week,
    phase: phaseFor(spec, Math.max(1, week)),
    deload: isBossWeek(spec, week) || week === 0 || (spec.on_ramp?.weeks || []).includes(week),
    boss: isBossWeek(spec, week),
    onRamp: (spec.on_ramp?.weeks || []).includes(week),
    template: templateFor(spec, day),
  };
}

/** Sets after the on-ramp / deload multiplier, never below the floor. */
export function scaledSets(sets, { deload, onRamp }, spec) {
  const m = onRamp ? (spec.on_ramp?.set_multiplier ?? 0.6)
    : deload ? (spec.deload?.set_multiplier ?? 0.6) : 1;
  if (m === 1) return sets;
  return Math.max(spec.deload?.min_sets ?? 2, Math.floor(sets * m));
}
