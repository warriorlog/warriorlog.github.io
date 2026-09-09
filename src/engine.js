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
      // An injury or a failed screen sets a ceiling that ability cannot argue with.
      const capId = ctx.caps?.[exId];
      const capIdx = capId ? steps.findIndex(s => s.id === capId) : -1;
      const cappedHere = capIdx >= 0 && i >= capIdx;
      if (qualifying >= need && gap <= 7 && i < steps.length - 1 && !cappedHere && entryOpen(steps[i + 1], stepCtx)) {
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

/**
 * Sets after the on-ramp / deload multiplier. The floor may never ADD sets: a
 * one-set warm-up flow stays one set, or a deload week would prescribe more work
 * than a normal one.
 */
export function scaledSets(sets, { deload, onRamp }, spec) {
  const m = onRamp ? (spec.on_ramp?.set_multiplier ?? 0.6)
    : deload ? (spec.deload?.set_multiplier ?? 0.6) : 1;
  if (m === 1 || sets <= 1) return sets;
  return Math.min(sets, Math.max(spec.deload?.min_sets ?? 2, Math.floor(sets * m)));
}

// ---------------------------------------------------------------- skirmish
/**
 * The 15-minute version of a day. Three priority movements at the current rung
 * for three rounds, plus a short walk on the cardio days. It keeps both flames
 * and counts as a session for the week, but it can never advance a ladder —
 * that rule lives in stepLadders, so there is no way to farm rungs from it.
 */
export function skirmishPlan(spec, user, day, opts = {}) {
  const full = prescribe(spec, user, day, opts);
  if (full.rest) return full;
  const table = spec.byTemplate?.[full.template_id]?.skirmish;
  if (!table) return full;

  const ctx = {
    day, spec, equipment: { ...(opts.equipment ?? {}), ...(user.equipment ?? {}) },
    weekIndex: full.week, ladders: user.ladders, floor: user.floor, caps: user.caps,
    painFlags: [], benchmarks: user.benchmarks ?? {},
  };

  // Fit the whole thing into a real short-session budget. Per-side movements
  // double the rows, so a fixed round count blows out to half an hour on the
  // days that need it least; drop rounds until the estimate fits.
  const BUDGET = 18;
  const warmMin = table.warmup_min ?? 2;
  const cardioMin = table.cardio?.minutes ?? 0;
  let blocks = [], rows = [];

  for (let rounds = table.rounds ?? 3; rounds >= 1; rounds--) {
    blocks = []; rows = [];
    const usedSets = {};
    const warm = full.blocks.find(b => b.kind === 'warmup')?.items?.[0];
    // On the cardio days the warm-up IS the same walk as the block below it;
    // showing it twice reads as a mistake.
    const sameWalk = warm && table.cardio?.exercise_id === warm.exercise_id;
    if (warm && !sameWalk) {
      const item = { ...warm, rows: warm.rows.slice(0, 1).map(r => ({ ...r, minutes: warmMin, A: warmMin, B: warmMin })) };
      blocks.push({ kind: 'warmup', minutes: warmMin, items: [item] });
      rows.push(...item.rows);
      usedSets[item.exercise_id] = item.rows.length;
    }

    const items = [];
    for (const exId of table.exercise_ids ?? []) {
      const built = buildSkirmishItem(exId, { ...table, rounds }, spec, user, ctx, usedSets);
      if (built) { items.push(built); rows.push(...built.rows); }
    }
    let strengthMin = 0;
    if (items.length) {
      const setCount = items.reduce((n, it) => n + it.rows.length, 0);
      strengthMin = Math.max(4, Math.round((setCount * (35 + (table.rest_sec ?? 45))) / 60));
      blocks.push({ kind: 'strength_a', minutes: strengthMin, items });
    }

    if (table.cardio) {
      const mins = cardioMin + (sameWalk ? warmMin : 0);
      const built = buildSkirmishItem(table.cardio.exercise_id, table, spec, user, ctx, usedSets, mins);
      if (built) { blocks.unshift({ kind: 'conditioning', minutes: mins, items: [built] }); rows.unshift(...built.rows); }
    }

    if ((sameWalk ? 0 : warmMin) + strengthMin + cardioMin <= BUDGET || rounds === 1) break;
  }

  return {
    ...full, type: 'skirmish', blocks, rows,
    est_minutes: blocks.reduce((n, b) => n + b.minutes, 0),
    name: `${full.name} · Skirmish`,
  };
}

function buildSkirmishItem(exId, table, spec, user, ctx, usedSets, minutes = null) {
  const ex = spec.byExercise?.[exId];
  if (!ex) return null;
  const steps = user.stepsByExercise?.[exId] ?? resolveSteps(ex, ctx.equipment);
  let cur = steps.find(s => s.id === user.ladders?.[exId]?.step_id) ?? steps[0];
  if (!cur) return null;
  // If the real rung is gated shut, drop to the last rung that is open rather
  // than offering nothing.
  if (!entryOpen(cur, ctx)) {
    const idx = steps.findIndex(s => s.id === cur.id);
    cur = steps.slice(0, Math.max(0, idx)).reverse().find(s => entryOpen(s, ctx));
    if (!cur) return null;          // nothing open here yet: leave it out entirely
  }
  const sets = minutes ? 1 : (table.rounds ?? 3);   // `rounds` is overridden by the fit loop
  const cardio = minutes ? { ...resolveCardio(cur.cardio, ctx.equipment), minutes } : resolveCardio(cur.cardio, ctx.equipment);
  const bodyweight = user.profile?.bodyweight_lb ?? null;
  const vestLb = cur.load?.vest_pct ? resolveVest(cur.load.vest_pct, bodyweight, ctx.equipment, cur.load.cap_lb ?? 30) : 0;
  const startIndex = (usedSets[exId] ?? 0) + 1;
  usedSets[exId] = (usedSets[exId] ?? 0) + sets;
  const rows = buildRows(ex, cur, sets, { rest_sec: table.rest_sec ?? 45, counts_for_progression: false },
    lastValues(user, exId, cur.id), { vestLb, cardio, startIndex });
  return {
    exercise_id: exId, name: ex.name, step_id: cur.id, step_name: cur.name,
    how: cur.how, cues: ex.cues, stop_if: ex.stop_if,
    checklist: cur.checklist_required ? ex.checklist : null,
    sets, rest_sec: table.rest_sec ?? 45, load: { ...cur.load, vest_lb: vestLb || undefined },
    implement_id: cur.implement_id, cardio, counts_for_progression: false,
    next_unlock: null, rows,
  };
}

// ---------------------------------------------------------------- prescribe
/**
 * Today's plan. Frozen into session.started at Start, so the targets cannot move
 * under the user mid-session and "% of targets hit" stays reproducible after any
 * later change to the program data.
 */
export function prescribe(spec, user, day, opts = {}) {
  const programStart = user.profile?.program_start ?? opts.programStart ?? day;
  const sched = scheduleFor(spec, day, programStart);
  const eq = { ...(opts.equipment ?? {}), ...(user.equipment ?? {}) };
  const restDow = user.profile?.rest_dow ?? spec.defaults?.rest_dow ?? 0;
  const template = sched.template;

  if (!template || !template.minutes) {
    return { day, week: sched.week, rest: true, template_id: template?.id ?? 'sun_rest',
             kindle: template?.kindle ?? null, blocks: [], rows: [], est_minutes: 0 };
  }

  const override = spec.week_overrides?.[String(sched.week)] ?? null;
  if (override?.days?.[String(dow(day))] === 'off') {
    return { day, week: sched.week, rest: true, off: true, template_id: template.id, blocks: [], rows: [], est_minutes: 0 };
  }

  const ctx = {
    day, spec, equipment: eq, weekIndex: sched.week,
    ladders: user.ladders, floor: user.floor,
    painFlags: opts.painFlags ?? [], benchmarks: user.benchmarks ?? {},
  };

  const blocks = [];
  const rows = [];
  const usedSets = {};                 // exercise_id -> sets already numbered today
  for (const b of template.blocks ?? []) {
    const items = [];
    for (const raw of b.items ?? []) {
      for (const item of expandItem(raw, spec, user, ctx, sched, override, usedSets)) {
        // A fallback can land on a movement the block already trains (the locked
        // swing falls back to the hinge, which Thursday also programs directly).
        // Add the sets to the existing card rather than showing it twice.
        const twin = items.find(x => x.step_id === item.step_id
          && x.counts_for_progression === item.counts_for_progression);
        if (twin) {
          twin.sets += item.sets;
          twin.rows.push(...item.rows);
          twin.locked_note ??= item.locked_note;
          rows.push(...item.rows);
        } else {
          items.push(item);
          rows.push(...item.rows);
        }
      }
    }
    blocks.push({ kind: b.kind, minutes: b.minutes, items });
  }

  const plan = {
    day, week: sched.week, template_id: template.id, name: template.name,
    phase_id: sched.phase?.id, rir: (sched.deload ? spec.deload?.rir : sched.phase?.rir) ?? 3,
    deload: sched.deload, boss: sched.boss, on_ramp: sched.onRamp,
    est_minutes: template.minutes, blocks, rows,
    rest_dow: restDow, rules_version: spec.rulesVersion,
  };
  return fitToTime(plan, user.profile?.session_minutes ?? spec.defaults?.session_minutes ?? 50, spec);
}

/** One template item becomes one or more real exercise cards (or its fallback). */
function expandItem(item, spec, user, ctx, sched, override, usedSets = {}) {
  const ex = spec.byExercise?.[item.exercise_id];
  if (!ex) return [];
  const steps = user.stepsByExercise?.[ex.id] ?? resolveSteps(ex, ctx.equipment);
  const cur = steps.find(s => s.id === user.ladders?.[ex.id]?.step_id) ?? steps[0];
  if (!cur) return [];

  // A locked step runs the template's declared fallback instead — the user always
  // has something legal to do, and it is never the gated movement.
  if (!entryOpen(cur, ctx)) {
    const blocked = blockedBy(cur, ctx);
    const out = [];
    for (const f of item.fallback_when_locked ?? []) {
      out.push(...expandItem({ ...f, fallback_when_locked: [] }, spec, user, ctx, sched, override, usedSets));
    }
    if (out.length) out[0].locked_note = { exercise_id: ex.id, step_id: cur.id, blocked };
    return out;
  }

  let sets = item.phase_sets?.[String(sched.phase?.weeks?.[0] ? phaseNumber(spec, sched.phase) : 1)] ?? item.sets ?? 1;
  if (sets === 0) return [];
  sets = scaledSets(sets, sched, spec);
  if (override?.set_multiplier) sets = Math.max(spec.deload?.min_sets ?? 2, Math.floor(sets * override.set_multiplier));
  if (ex.id === 'swing' && sched.deload && spec.deload?.swing_sets) sets = Math.min(sets, spec.deload.swing_sets);

  const bodyweight = user.profile?.bodyweight_lb ?? null;
  const vestLb = cur.load?.vest_pct ? resolveVest(cur.load.vest_pct, bodyweight, ctx.equipment, cur.load.cap_lb ?? 30) : 0;
  let cardio = resolveCardio(cur.cardio, ctx.equipment);
  if (cardio && item.time_override_min) cardio = { ...cardio, minutes: item.time_override_min };
  if (cardio && sched.deload && ex.id === 'treadmill_zone2') {
    cardio = { ...cardio, minutes: Math.round(cardio.minutes * (spec.deload.zone2_pct ?? 70) / 100),
               incline: Math.max(0, (cardio.incline ?? 0) + (spec.deload.zone2_incline_delta ?? 0)) };
  }

  const last = lastValues(user, ex.id, cur.id);
  const startIndex = (usedSets[ex.id] ?? 0) + 1;
  usedSets[ex.id] = (usedSets[ex.id] ?? 0) + sets;
  const rows = buildRows(ex, cur, sets, item, last, { vestLb, cardio, startIndex });

  return [{
    exercise_id: ex.id, name: ex.name, step_id: cur.id, step_name: cur.name,
    how: cur.how, cues: ex.cues, stop_if: ex.stop_if,
    checklist: cur.checklist_required ? ex.checklist : null,
    sets, rest_sec: item.rest_sec ?? 60, note: item.note ?? null,
    load: { ...cur.load, vest_lb: vestLb || undefined },
    implement_id: cur.implement_id, cardio,
    substitutes: item.substitutes ?? null,
    counts_for_progression: item.counts_for_progression !== false,
    next_unlock: cur.advance ? describeAdvance(cur, spec) : null,
    rows,
  }];
}

const phaseNumber = (spec, phase) => (spec.phases ?? []).findIndex(p => p.id === phase?.id) + 1;

/** Every loggable row of a plan. XP paid and XP available both count these. */
function buildRows(ex, step, sets, item, last, { vestLb, cardio, startIndex = 1 }) {
  const rows = [];
  const sides = step.sides === 'each' ? ['L', 'R'] : [null];
  const parts = step.parts?.length ? step.parts : [null];
  const unit = cardio && step.unit === 'min' ? 'min' : step.unit;

  for (let n = 0; n < sets; n++) {
    const i = startIndex + n;
    for (const part of parts) {
      for (const side of sides) {
        // A cardio row is judged against the minutes this block actually asks
        // for, not the ladder step's own duration.
        const A = cardio?.minutes ?? part?.A ?? step.A;
        const B = cardio?.minutes ?? part?.B ?? step.B;
        const key = `${i}|${side ?? ''}|${part?.key ?? ''}`;
        rows.push({
          exercise_id: ex.id, step_id: step.id, set_index: i,
          side, part: part?.key ?? null, part_name: part?.name ?? null,
          unit, A, B,
          target: prefillFor(last?.[key], A, B),
          last: last?.[key] ?? null,
          implement_id: step.implement_id, vest_lb: vestLb || undefined,
          minutes: cardio?.minutes ?? (unit === 'min' ? (part?.A ?? step.A) : undefined),
          mph: cardio?.mph, incline: cardio?.incline,
          rounds: cardio?.rounds, work_sec: cardio?.work_sec, rest_sec: cardio?.rest_sec ?? item.rest_sec,
          counts_for_progression: item.counts_for_progression !== false,
          prescribed: true,
        });
      }
    }
  }
  return rows;
}

/**
 * The prefill: what you did here last time, so one tap means "match it" and the
 * headline is "beat last time by one rep". A fresh step starts at the low end.
 */
function prefillFor(last, A, B) {
  if (last == null) return A;
  return clamp(last, A, B);
}

/** Last logged value per row key at this exact step. */
function lastValues(user, exId, stepId) {
  for (let i = user.sessions.length - 1; i >= 0; i--) {
    const s = user.sessions[i];
    const rows = s.sets.filter(x => x.exercise_id === exId && x.step_id === stepId);
    if (!rows.length) continue;
    const out = {};
    for (const r of rows) out[`${r.set_index}|${r.side ?? ''}|${r.part ?? ''}`] = r.value;
    return out;
  }
  return null;
}

/** Plain words for what the next rung costs — shown on the card, never a formula. */
export function describeAdvance(step, spec = null) {
  const a = step.advance;
  if (!a) return null;
  const n = a.consecutive ?? 2;
  const times = n === 1 ? 'once' : `${n} sessions in a row`;
  const extra = (a.requires ?? []).map(r => describeRule(r, '', spec)).filter(Boolean);
  const main = describeRule(a, times, spec);
  return [main, ...extra].filter(Boolean).join(', ');
}

function describeRule(a, times = '', spec = null) {
  const suffix = times ? `, ${times}` : '';
  switch (a.rule) {
    case 'all_sets_reps_gte': return `Every set at ${a.value} rep${a.value === 1 ? '' : 's'}${suffix}`;
    case 'all_sets_time_gte': return `Every set at ${a.value}s${suffix}`;
    case 'rounds_gte': return `All ${a.value} rounds${suffix}`;
    case 'clock_lte': return `Finish inside ${Math.floor(a.value / 60)}:${String(a.value % 60).padStart(2, '0')}${suffix}`;
    case 'cardio_done': return `Complete it at an easy effort${suffix}`;
    case 'checklist_all_ok': return times ? `Every form cue ticked${suffix}` : 'every form cue ticked';
    case 'drops_lte': return a.value === 0
      ? (times ? `No drops${suffix}` : 'no drops')
      : (times ? `At most ${a.value} drops${suffix}` : `at most ${a.value} drops`);
    case 'rpe_min': return times ? `Hard efforts at RPE ${a.value}+${suffix}` : `hard efforts at RPE ${a.value}+`;
    case 'sessions_gte': return `Practise it ${a.value} times`;
    case 'weeks_elapsed_gte': return `from week ${a.value}`;
    case 'no_pain_flag_days': return `no ${a.region ?? ''} pain flagged in ${a.days} days`.replace('  ', ' ');
    case 'ladder_at_or_past': {
      const named = spec?.byStep?.[a.step_id]?.name ?? a.step_id.split('.')[1].replace(/_/g, ' ');
      const ex = spec?.byExercise?.[a.exercise]?.name ?? a.exercise.replace(/_/g, ' ');
      return `${ex} at "${named}"`;
    }
    case 'benchmark_gte': return `${a.id} at ${a.value} or better`;
    case 'benchmark_lte': return `${a.id} at ${a.value} or faster`;
    case 'all_of': return a.rules.map(r => describeRule(r, '', spec)).filter(Boolean).join(' and ');
    default: return null;
  }
}

/**
 * Trim the plan to the minutes the user actually has, in a fixed order that never
 * touches the warm-up, the get-up or the swings. Dropped rows are marked
 * `prescribed: false` so they count for neither fidelity nor available XP.
 */
export function fitToTime(plan, targetMinutes, spec) {
  let est = plan.est_minutes;
  if (est <= targetMinutes) return plan;
  const guard = spec.time_guard ?? [];
  const never = new Set(guard.find(g => g.action === 'never')?.exercise_ids ?? []);

  for (const rule of guard) {
    if (est <= targetMinutes) break;
    if (rule.action === 'trim') {
      for (const b of plan.blocks) {
        for (const it of b.items) {
          if (it.exercise_id !== rule.target || !it.cardio?.minutes) continue;
          const cut = Math.min(est - targetMinutes, it.cardio.minutes - (rule.floor_min ?? 0));
          if (cut > 0) {
            it.cardio = { ...it.cardio, minutes: it.cardio.minutes - cut, trimmed: true };
            for (const r of it.rows) r.minutes = it.cardio.minutes;
            est -= cut;
          }
        }
      }
    } else if (rule.action === 'drop_last_set') {
      const block = plan.blocks.find(b => b.kind === rule.block);
      for (let i = (block?.items.length ?? 0) - 1; i >= 0 && est > targetMinutes; i--) {
        const it = block.items[i];
        if (never.has(it.exercise_id) || it.sets <= 1) continue;
        const last = it.rows.filter(r => r.set_index === it.sets);
        for (const r of last) r.prescribed = false;
        it.dropped_sets = (it.dropped_sets ?? 0) + 1;
        est -= Math.max(1, Math.round(((it.rest_sec ?? 60) + 45) / 60));
      }
    }
  }
  plan.est_minutes = Math.max(targetMinutes, Math.round(est));
  plan.rows = plan.blocks.flatMap(b => b.items.flatMap(i => i.rows));
  return plan;
}
