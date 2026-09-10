// XP, levels, the flame, region fill and badges — all derived, all deterministic,
// all driven by data/gamification.json so the "How XP works" screen and the code
// can never disagree.
//
// The one rule that matters most: XP NEVER depends on load, implement or step
// ordinal. A wall push-up pays exactly what a vest push-up pays. That is what
// keeps the duel fair between two people of different strength, and it removes
// any incentive to reach for the 53 lb bell before it has been earned.
import { addDays, daysBetween, dayKey, isoWeekKey, weekStart, dow, clamp } from './util.js';

// ---------------------------------------------------------------- levels
export function xpForLevel(level, g) {
  const { coefficient = 120, exponent = 1.5 } = g.level ?? {};
  return Math.round(coefficient * Math.pow(Math.max(0, level - 1), exponent));
}

export function levelFor(xpTotal, g) {
  const { coefficient = 120, exponent = 1.5 } = g.level ?? {};
  let level = Math.max(1, 1 + Math.floor(Math.pow(Math.max(0, xpTotal) / coefficient, 1 / exponent)));
  // Math.pow is not exact: 343^(2/3) comes back as 48.99999999999999, which
  // would leave someone one level short on the exact threshold. Correct against
  // the real table rather than trusting the float.
  while (xpForLevel(level + 1, g) <= xpTotal) level++;
  while (level > 1 && xpForLevel(level, g) > xpTotal) level--;
  const floor = xpForLevel(level, g);
  const next = xpForLevel(level + 1, g);
  const rank = [...(g.ranks ?? [])].reverse().find(r => level >= r.level);
  return {
    level, title: rank?.title ?? 'Recruit',
    into: xpTotal - floor, need: next - floor,
    pct: next > floor ? clamp((xpTotal - floor) / (next - floor), 0, 1) : 1,
    next_title: (g.ranks ?? []).find(r => r.level > level) ?? null,
  };
}

// ---------------------------------------------------------------- session XP
const met = (row, set) => {
  const B = row?.B ?? set.B;
  if (B == null) return false;
  if (set.unit === 'clock_sec') return set.value <= B;
  if (set.checklist_required && set.checklist_ok === false) return false;
  return set.value >= B;
};
const logged = (row, set) => {
  const A = row?.A ?? set.A ?? 0;
  if (set.unit === 'clock_sec') return set.value > 0;
  return set.value >= 0.6 * A;
};

/**
 * XP for one finished session, split by source so the completion screen can show
 * where it came from. `history` supplies previous bests for personal records.
 */
export function xpForSession(session, spec, g, history = { best: {}, sessionsAtStep: {} }) {
  const xp = g.xp ?? {};
  const by = {};
  const add = (k, n) => { if (n) by[k] = (by[k] ?? 0) + n; };
  const rowsByKey = new Map((session.plan?.rows ?? []).map(r => [`${r.exercise_id}|${r.set_index}|${r.side ?? ''}|${r.part ?? ''}`, r]));

  let zone2Paid = 0;
  let prCount = 0;
  const prs = [];

  for (const set of session.sets) {
    const row = rowsByKey.get(`${set.exercise_id}|${set.set_index}|${set.side ?? ''}|${set.part ?? ''}`);
    if (row && row.prescribed === false) continue;             // trimmed by the time guard
    const ex = spec.byExercise?.[set.exercise_id];
    if (!ex || ex.no_xp) continue;

    if (set.unit === 'min') {
      // Zone-2 minutes, capped per day. The talk test — not RPE — decides whether
      // a minute counts, because RPE never leaves the phone and both phones must
      // compute the same number.
      const room = Math.max(0, (xp.zone2_daily_cap_min ?? 45) - zone2Paid);
      const mins = Math.min(set.value ?? 0, room);
      zone2Paid += mins;
      const rate = set.talk_test_ok === false ? (xp.zone2_talk_fail_per_min ?? 2) : (xp.zone2_per_min ?? 3);
      add(set.talk_test_ok === false ? 'cardio' : 'zone2', Math.round(mins * rate));
      continue;
    }
    if (set.unit === 'rounds') { add('intervals', (set.value ?? 0) * (xp.interval_round ?? 12)); continue; }

    if (!logged(row, set)) continue;
    add('sets', xp.set_logged ?? 10);
    if (met(row, set)) add('sets', xp.set_met ?? 5);

    // A personal record needs prior history at this exact step, so day one is
    // never a shower of records.
    const key = `${set.exercise_id}:${set.step_id}`;
    const prior = history.best?.[key];
    const seen = history.sessionsAtStep?.[key] ?? 0;
    const better = set.unit === 'clock_sec' ? (prior != null && set.value < prior) : (prior != null && set.value > prior);
    if (seen >= 1 && better && prCount < (xp.pr_max_per_session ?? 3)) {
      prCount++; prs.push({ ...set, previous: prior });
      add('records', xp.rep_pr ?? 25);
    }
  }

  const type = session.type ?? 'full';
  const completed = isComplete(session, spec);
  if (completed) add('quest', type === 'skirmish' ? (xp.quest_skirmish ?? 25) : (xp.quest_full ?? 50));
  else if (session.sets.length) add('quest', xp.ember ?? 5);

  return { total: Object.values(by).reduce((a, b) => a + b, 0), by_source: by, prs, zone2_min: zone2Paid };
}

/** Every prescribed row has a logged value. */
export function isComplete(session, spec = null) {
  const rows = (session.plan?.rows ?? []).filter(r => r.prescribed !== false
    && !spec?.byExercise?.[r.exercise_id]?.no_xp);
  if (!rows.length) return session.sets.length > 0;
  const done = new Set(session.sets.map(s => `${s.exercise_id}|${s.set_index}|${s.side ?? ''}|${s.part ?? ''}`));
  return rows.every(r => done.has(`${r.exercise_id}|${r.set_index}|${r.side ?? ''}|${r.part ?? ''}`));
}

/**
 * How much of the plan was actually hit — the duel's fidelity term.
 * The warm-up and cooldown flows are one-tap and pay no XP, so they are not
 * scored targets; counting them would inflate everyone's fidelity equally and
 * tell the user nothing.
 */
export function fidelity(session, spec = null) {
  const rows = (session.plan?.rows ?? []).filter(r => r.prescribed !== false
    && !spec?.byExercise?.[r.exercise_id]?.no_xp);
  if (!rows.length) return { prescribed: 0, hit: 0, pct: 0, by_exercise: {} };
  const byEx = {};
  for (const r of rows) (byEx[r.exercise_id] ??= { prescribed: 0, hit: 0 }).prescribed++;
  for (const s of session.sets) {
    const r = rows.find(x => x.exercise_id === s.exercise_id && x.set_index === s.set_index
      && (x.side ?? null) === (s.side ?? null) && (x.part ?? null) === (s.part ?? null));
    if (!r) continue;
    if ((s.value ?? 0) >= (r.A ?? 0)) byEx[s.exercise_id].hit++;
  }
  const prescribed = rows.length;
  const hit = Object.values(byEx).reduce((n, x) => n + x.hit, 0);
  const hits = Object.fromEntries(Object.entries(byEx).map(([k, v]) => [k, v.hit >= v.prescribed]));
  return { prescribed, hit, pct: prescribed ? hit / prescribed : 0, by_exercise: hits };
}

// ---------------------------------------------------------------- regions
/** Split a session's XP into the ten body regions by each exercise's weights. */
export function regionXpForSession(session, spec, g, sessionXp) {
  const out = Object.fromEntries((g.regions ?? []).map(r => [r, 0]));
  const paid = sessionXp.by_source ?? {};
  const total = (paid.sets ?? 0) + (paid.records ?? 0);
  if (total > 0) {
    const bySet = {};
    let n = 0;
    for (const s of session.sets) {
      if (s.unit === 'min' || s.unit === 'rounds') continue;
      if (spec.byExercise?.[s.exercise_id]?.no_xp) continue;
      bySet[s.exercise_id] = (bySet[s.exercise_id] ?? 0) + 1; n++;
    }
    for (const [exId, count] of Object.entries(bySet)) {
      const w = spec.byExercise?.[exId]?.region_weights ?? {};
      for (const [region, weight] of Object.entries(w)) {
        if (out[region] == null) continue;
        out[region] += (total * (count / n)) * weight;
      }
    }
  }
  const cardio = (paid.zone2 ?? 0) + (paid.cardio ?? 0) + (paid.intervals ?? 0);
  if (cardio > 0) {
    const cardioSets = session.sets.filter(s => (s.unit === 'min' || s.unit === 'rounds') && !spec.byExercise?.[s.exercise_id]?.no_xp);
    for (const s of cardioSets) {
      const w = spec.byExercise?.[s.exercise_id]?.region_weights ?? { heart: 1 };
      for (const [region, weight] of Object.entries(w)) if (out[region] != null) out[region] += cardio * weight / Math.max(1, cardioSets.length);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v)]));
}

export const regionLevel = (xp, g) => Math.floor(Math.sqrt(Math.max(0, xp) / (g.region_level?.divisor ?? 40)));

/** Where every ladder started, so day-zero capability is not mistaken for progress. */
function baselineLadders(user, spec) {
  const out = {};
  for (const ex of spec.exercises ?? []) {
    out[ex.id] = { step_id: user.floor?.[ex.id] ?? ex.ladder?.[0]?.id };
  }
  return out;
}

// ---------------------------------------------------------------- the flame
export const DAY_STATUS = ['trained', 'rest', 'shield', 'recovery', 'away', 'none', 'pending'];

/**
 * Resolve a status for every day from the flame epoch to today, in order.
 * Rest is a rolling link (one per seven days), not a fixed weekday, so moving a
 * rest day never costs anything. Shields are spent silently. Illness and travel
 * freeze the count rather than breaking it.
 */
export function dayStatuses(user, g, today) {
  const f = g.flame ?? {};
  const trained = new Set();
  for (const s of user.sessions) if (s.sets.length && s.type !== 'kindle') trained.add(s.day);
  const epoch = user.flame_epoch ?? firstDay(user) ?? today;

  const statuses = new Map();
  let shields = f.shields_start ?? 1;
  let lastRest = null;
  const inMode = (day) => user.modes.find(m => day >= m.from && (m.to ? day <= m.to : !m.closed));

  for (let d = epoch; daysBetween(d, today) >= 0; d = addDays(d, 1)) {
    if (trained.has(d)) { statuses.set(d, 'trained'); continue; }
    if (d === today) { statuses.set(d, 'pending'); continue; }        // today can never be broken yet
    const mode = inMode(d);
    if (mode) { statuses.set(d, mode.kind === 'away' ? 'away' : 'recovery'); continue; }
    const restedRecently = lastRest && daysBetween(lastRest, d) < (f.rest_per_days ?? 7);
    if (user.rests.has(d) || !restedRecently) { statuses.set(d, 'rest'); lastRest = d; continue; }
    if (shields > 0) { shields--; statuses.set(d, 'shield'); continue; }
    statuses.set(d, 'none');
  }
  return { statuses, shieldsLeft: shields };
}

const firstDay = (user) => user.sessions[0]?.day ?? null;

/** The flame count, its state, and the best it has ever been. */
export function flame(user, g, today) {
  const f = g.flame ?? {};
  const { statuses, shieldsLeft } = dayStatuses(user, g, today);
  const days = [...statuses.keys()];

  let count = 0, best = 0, state = 'lit', emberFrom = null;
  for (const d of days) {
    const s = statuses.get(d);
    if (s === 'trained' || s === 'rest' || s === 'shield') { count++; best = Math.max(best, count); state = 'lit'; }
    else if (s === 'recovery' || s === 'away' || s === 'pending') { /* frozen: no change */ }
    else { if (count > 0) { state = 'ember'; emberFrom = d; } count = 0; }
  }
  // An ember keeps showing the old count for a week, and two quests restore it.
  let emberCount = 0;
  if (state === 'ember' && emberFrom) {
    const expires = addDays(emberFrom, f.ember_days ?? 7);
    if (daysBetween(today, expires) < 0) { state = 'cold'; }
    else {
      emberCount = [...statuses.entries()].reduce((n, [d, s]) => (d < emberFrom && (s === 'trained' || s === 'rest' || s === 'shield') ? n + 1 : d < emberFrom ? 0 : n), 0);
    }
  }
  return { count, best, state, shields: shieldsLeft, ember_count: emberCount, statuses };
}

/**
 * Perfect weeks: every prescribed quest done, enough of them full, and no shield
 * spent. Counted here rather than in a view because a badge depends on it.
 */
export function perfectWeeks(user, spec, gam, statuses, today = dayKey()) {
  const cfg = gam.perfect_week ?? {};
  const first = user.sessions[0]?.day;
  if (!first) return { count: 0, weeks: [] };

  const byWeek = new Map();
  for (const s of user.sessions) {
    if (s.type === 'kindle') continue;
    const k = isoWeekKey(s.day);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(s);
  }

  const weeks = [];
  for (const [weekId, sessions] of byWeek) {
    const start = weekStart(sessions[0].day);
    const programStart = user.profile?.program_start;
    let prescribed = 0;
    let shields = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      if (day < first) continue;                       // the week they joined is only counted from day one
      if (daysBetween(day, today) < 0) continue;        // days that have not happened yet
      const template = (spec.templates ?? []).find(t => t.dow === dow(day));
      if (!template?.minutes) continue;
      // A taper week can switch a training day off.
      if (programStart) {
        const week = Math.floor(daysBetween(programStart, day) / 7) + 1;
        if (spec.week_overrides?.[String(week)]?.days?.[String(dow(day))] === 'off') continue;
      }
      prescribed++;
      if (statuses?.get(day) === 'shield') shields++;
    }
    const done = sessions.filter(s => s.sets.length).length;
    const full = sessions.filter(s => s.type === 'full' && isComplete(s, spec)).length;
    const minFull = Math.min(cfg.min_full ?? 4, prescribed);
    const perfect = prescribed > 0 && done >= prescribed && full >= minFull && shields === 0;
    weeks.push({ week_id: weekId, prescribed, done, full, shields, perfect });
  }
  return { count: weeks.filter(w => w.perfect).length, weeks };
}

// ---------------------------------------------------------------- gear
/** Armour comes only from benchmark tiers and named ladder rungs — never from XP. */
export function gearTiers(user, spec, g) {
  const out = {};
  for (const slot of g.gear_slots ?? []) {
    let tier = 0;
    if (slot.source?.kind === 'benchmark') {
      tier = user.benchmarks?.[slot.source.id]?.tier ?? 0;
    } else if (slot.source?.kind === 'benchmark_max') {
      // Thighs are served by two different tests; the better one dresses them.
      tier = Math.max(0, ...(slot.source.ids ?? []).map(id => user.benchmarks?.[id]?.tier ?? 0));
    } else if (slot.source?.kind === 'ladder') {
      const cur = user.ladders?.[slot.source.exercise]?.step_id;
      const ladder = spec.byExercise?.[slot.source.exercise]?.ladder ?? [];
      const at = ladder.findIndex(s => s.id === cur);
      slot.source.steps?.forEach((stepId, i) => {
        const need = ladder.findIndex(s => s.id === stepId);
        if (need >= 0 && at >= need) tier = i + 1;
      });
    }
    out[slot.id] = { tier, region: slot.region, name: slot.name };
  }
  return out;
}

// ---------------------------------------------------------------- badges
/** Every badge criterion is a small typed object — never free text. */
export function evalCriterion(c, m) {
  const cmp = (a, b, op) => op === 'lte' ? a <= b : op === 'eq' ? a === b : a >= b;
  const op = c.op ?? 'gte';
  switch (c.metric) {
    case 'flame': return cmp(m.flame.count, c.value, op);
    case 'best_flame': return cmp(m.flame.best, c.value, op);
    case 'duo_flame': return cmp(m.duo?.flame ?? 0, c.value, op);
    case 'level': return cmp(m.level.level, c.value, op);
    case 'xp_total': return cmp(m.xpTotal, c.value, op);
    case 'sessions_completed': return cmp(m.sessions.filter(s => !c.type || s.type === c.type).length, c.value, op);
    case 'skirmish_count': return cmp(m.sessions.filter(s => s.type === 'skirmish').length, c.value, op);
    case 'steps_gained': return cmp(m.user.climbs.length, c.value, op);
    case 'pr_count': return cmp(m.prCount, c.value, op);
    case 'pledges_kept': return cmp(m.pledgesKept, c.value, op);
    case 'perfect_weeks': return cmp(m.perfectWeeks, c.value, op);
    case 'quiz_done': return !!m.user.quizDone;
    case 'vest_used': return m.allSets.some(s => (s.vest_lb ?? 0) > 0);
    case 'ladder_step': return atOrPastStep(m, c.exercise, c.step_id);
    case 'gate_passed': return !!m.gates?.[c.gate];
    case 'gear_min_tier': return cmp(Math.min(...Object.values(m.gear).map(x => x.tier)), c.value, op);
    case 'zone2_week_minutes': return cmp(Math.max(0, ...Object.values(m.zone2ByWeek)), c.value, op);
    case 'benchmark_value': {
      const v = m.user.benchmarks?.[c.id]?.value;
      return v != null && cmp(v, c.value, op);
    }
    case 'set_value': {
      return m.allSets.some(s => s.exercise_id === c.exercise
        && (!c.implement_id || s.implement_id === c.implement_id)
        && (!c.min_step_id || atOrPastStepId(m, c.exercise, s.step_id, c.min_step_id))
        && cmp(s.value ?? 0, c.value, op));
    }
    case 'session_exercise_total': {
      return m.sessions.some(sess => {
        const total = sess.sets.filter(s => s.exercise_id === c.exercise
          && (!c.implement_id || s.implement_id === c.implement_id))
          .reduce((n, s) => n + (s.value ?? 0), 0);
        return cmp(total, c.value, op);
      });
    }
    case 'boss_benchmarks_logged': {
      const battle = m.user.bossResolved?.[c.battle_n];
      return (battle?.logged_benchmarks ?? 0) >= (c.value ?? 6);
    }
    case 'boss_outcome': return Object.values(m.user.bossResolved ?? {}).some(b =>
      b.outcome === c.outcome && (c.battle_n == null || b.battle_n === c.battle_n));
    case 'duel_status': {
      const locks = Object.values(m.user.weekLocks ?? {});
      if (c.consecutive) return runOf(locks, l => l.status === c.status) >= c.consecutive;
      return locks.filter(l => l.status === c.status).length >= (c.value ?? 1);
    }
    case 'duel_sum_s': return Object.values(m.user.weekLocks ?? {}).some(l => (l.S_me ?? 0) + (l.S_partner ?? 0) >= c.value);
    case 'both_gate_passed': return !!(m.gates?.[c.gate] && m.duo?.partnerGates?.[c.gate]);
    case 'duo_same_day_sessions': return cmp(m.duo?.sameDayCount ?? 0, c.value, op);
    case 'duo_perfect_week': return !!m.duo?.perfectWeekTogether;
    case 'rekindled': return c.duo ? !!m.duo?.rekindled : !!m.rekindled;
    default: return false;
  }
}

const runOf = (list, fn) => list.reduce((acc, x) => fn(x) ? { cur: acc.cur + 1, max: Math.max(acc.max, acc.cur + 1) } : { cur: 0, max: acc.max }, { cur: 0, max: 0 }).max;

function atOrPastStep(m, exercise, stepId) {
  const ladder = m.spec.byExercise?.[exercise]?.ladder ?? [];
  const at = ladder.findIndex(s => s.id === m.user.ladders?.[exercise]?.step_id);
  const need = ladder.findIndex(s => s.id === stepId);
  return need >= 0 && at >= need;
}
function atOrPastStepId(m, exercise, haveId, needId) {
  const ladder = m.spec.byExercise?.[exercise]?.ladder ?? [];
  return ladder.findIndex(s => s.id === haveId) >= ladder.findIndex(s => s.id === needId);
}

/** Which badges are earned, and on what day each was first true. */
export function badges(metrics, g) {
  const out = [];
  for (const b of g.badges ?? []) {
    const earned = evalCriterion(b.criterion, metrics);
    out.push({ ...b, earned, earned_on: earned ? (metrics.earnedOn?.[b.id] ?? null) : null });
  }
  return out;
}

// ---------------------------------------------------------------- roll-up
/** Everything the UI needs about one user, derived from the reduced state. */
export function progress(user, spec, g, today = dayKey()) {
  const best = {}, sessionsAtStep = {}, regions = Object.fromEntries((g.regions ?? []).map(r => [r, 0]));
  const zone2ByWeek = {};
  let xpTotal = 0, prCount = 0;
  const bySource = {};
  const perSession = [];

  for (const s of user.sessions) {
    const gained = xpForSession(s, spec, g, { best, sessionsAtStep });
    xpTotal += gained.total;
    prCount += gained.prs.length;
    for (const [k, v] of Object.entries(gained.by_source)) bySource[k] = (bySource[k] ?? 0) + v;
    const r = regionXpForSession(s, spec, g, gained);
    for (const [k, v] of Object.entries(r)) regions[k] += v;
    const wk = isoWeekKey(s.day);
    zone2ByWeek[wk] = (zone2ByWeek[wk] ?? 0) + gained.zone2_min;
    perSession.push({ session_id: s.session_id, day: s.day, xp: gained.total, by_source: gained.by_source, prs: gained.prs, fidelity: fidelity(s, spec) });

    for (const set of s.sets) {
      const key = `${set.exercise_id}:${set.step_id}`;
      sessionsAtStep[key] = (sessionsAtStep[key] ?? 0) + 1;
      const prior = best[key];
      if (prior == null) best[key] = set.value;
      else if (set.unit === 'clock_sec') best[key] = Math.min(prior, set.value);
      else best[key] = Math.max(prior, set.value);
    }
  }

  const xp = g.xp ?? {};
  if (user.quizDone) { xpTotal += xp.placement ?? 150; bySource.setup = (bySource.setup ?? 0) + (xp.placement ?? 150); }
  const climbXp = user.climbs.length * (xp.ladder_advance ?? 100);
  xpTotal += climbXp; if (climbXp) bySource.climbs = climbXp;

  // Armour reflects what you can wear today, so a stronger starter is placed
  // straight into Bronze. XP is for what you EARN, though, so only tiers gained
  // above the placement baseline are paid for.
  const gear = gearTiers(user, spec, g);
  const baseline = gearTiers({ ...user, ladders: baselineLadders(user, spec), benchmarks: {} }, spec, g);
  const gearXp = Object.entries(gear)
    .reduce((n, [id, x]) => n + Math.max(0, x.tier - (baseline[id]?.tier ?? 0)) * (xp.gear_tier ?? 150), 0);
  xpTotal += gearXp; if (gearXp) bySource.armour = gearXp;

  const fl = flame(user, g, today);
  const level = levelFor(xpTotal, g);
  const gates = {
    hinge: atOrPastStep({ spec, user }, 'hinge_deadlift', 'hinge_deadlift.kb53_floor'),
    bell: atOrPastStep({ spec, user }, 'swing', 'swing.deadstop_53'),
    run: atOrPastStep({ spec, user }, 'treadmill_intervals', 'treadmill_intervals.jog_8'),
  };

  const perfect = perfectWeeks(user, spec, g, fl.statuses, today);
  const perfectXp = perfect.count * (xp.perfect_week ?? 300);
  xpTotal += perfectXp; if (perfectXp) bySource.perfect_weeks = perfectXp;

  const metrics = {
    user, spec, xpTotal, level, flame: fl, gear, gates, prCount,
    sessions: user.sessions, allSets: user.sessions.flatMap(s => s.sets),
    pledgesKept: user.pledges.filter(p => p.kept).length,
    perfectWeeks: perfect.count, zone2ByWeek, rekindled: fl.state === 'lit' && fl.best > fl.count,
    duo: null, earnedOn: {},
  };

  return {
    xp_total: xpTotal, by_source: bySource, level, flame: fl, gear, gates,
    regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, { xp: v, level: regionLevel(v, g) }])),
    zone2_by_week: zone2ByWeek, sessions: perSession, perfect_weeks: perfect,
    badges: badges(metrics, g), metrics,
  };
}
