// XP, levels, the flame, region fill and badges — all derived, all deterministic,
// all driven by data/gamification.json so the "How XP works" screen and the code
// can never disagree.
//
// The one rule that matters most: XP NEVER depends on load, implement or step
// ordinal. A wall push-up pays exactly what a vest push-up pays. That is what
// keeps the duel fair between two people of different strength, and it removes
// any incentive to reach for the 53 lb bell before it has been earned.
import { addDays, daysBetween, dayKey, isoWeekKey, weekStart, weekIndex, dow, clamp } from './util.js';

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
  const bestHere = new Map();      // exercise:step -> the best set of THIS session

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
    if (set.unit === 'rounds') {
      // An interval block pays for the rounds in the block, never more: a row
      // that once read its 19-minute length as 19 rounds must not pay for 19.
      const step = spec.byStep?.[set.step_id];
      const cap = step?.cardio?.rounds ?? step?.B ?? null;
      const rounds = cap ? Math.min(set.value ?? 0, cap) : (set.value ?? 0);
      add('intervals', rounds * (xp.interval_round ?? 12));
      continue;
    }

    if (!logged(row, set)) continue;
    add('sets', xp.set_logged ?? 10);
    if (met(row, set)) add('sets', xp.set_met ?? 5);

    const key = `${set.exercise_id}:${set.step_id}`;
    const cur = bestHere.get(key);
    const beats = (a, b) => (set.unit === 'clock_sec' ? a < b : a > b);
    if (!cur || beats(set.value, cur.value)) bestHere.set(key, set);
  }

  // A personal record needs prior history at this exact step, so day one is
  // never a shower of records — and it is one record per movement per session:
  // two sets of twenty after a best of twelve is one new best, not two.
  const prs = [];
  for (const [key, set] of bestHere) {
    const prior = history.best?.[key];
    const seen = history.sessionsAtStep?.[key] ?? 0;
    const better = set.unit === 'clock_sec' ? (prior != null && set.value < prior) : (prior != null && set.value > prior);
    if (seen >= 1 && better && prs.length < (xp.pr_max_per_session ?? 3)) {
      prs.push({ ...set, previous: prior });
      add('records', xp.rep_pr ?? 25);
    }
  }

  const type = session.type ?? 'full';
  const completed = isComplete(session, spec);
  // A rest-day walk is a kindling, not a quest: it pays what the rest-day card
  // promises (the kindle line in the XP table), never a full quest bonus.
  if (completed) add('quest', type === 'kindle' ? (xp.kindle_walk ?? 20) : type === 'skirmish' ? (xp.quest_skirmish ?? 25) : (xp.quest_full ?? 50));
  else if (session.sets.length) add('quest', xp.ember ?? 5);

  return { total: Object.values(by).reduce((a, b) => a + b, 0), by_source: by, prs, zone2_min: zone2Paid };
}

/**
 * The XP one full week of the plan can pay, read off the templates: every
 * working set logged and met, every Zone-2 minute, every quest bonus. The duel's
 * XP term and the boss loot are both measured against this number.
 */
export function xpAvailableWeek(spec, gam) {
  const xp = gam.xp ?? {};
  const Z2 = new Set(['treadmill_zone2', 'zone2_finisher', 'vest_walk', 'march_step_zone2']);
  let total = 0;
  for (const t of spec.templates ?? []) {
    if (!t.minutes) continue;
    let rows = 0, minutes = 0;
    for (const b of t.blocks ?? []) for (const it of b.items ?? []) {
      const ex = spec.byExercise?.[it.exercise_id];
      if (!ex || ex.no_xp) continue;
      if (Z2.has(ex.id)) minutes += it.time_override_min ?? 30;
      else rows += it.sets ?? 1;
    }
    total += rows * ((xp.set_logged ?? 10) + (xp.set_met ?? 5)) + minutes * (xp.zone2_per_min ?? 3) + (xp.quest_full ?? 50);
  }
  return Math.max(1, Math.round(total));
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

/** The flame count, its state, the best it has ever been, and how often it was relit. */
export function flame(user, g, today) {
  const f = g.flame ?? {};
  const { statuses, shieldsLeft } = dayStatuses(user, g, today);
  const days = [...statuses.keys()];

  let count = 0, best = 0, state = 'lit', emberFrom = null, rekindles = 0, wasOut = false;
  for (const d of days) {
    const s = statuses.get(d);
    if (s === 'trained' || s === 'rest' || s === 'shield') {
      if (count === 0 && wasOut) { rekindles++; wasOut = false; }
      count++; best = Math.max(best, count); state = 'lit';
    }
    else if (s === 'recovery' || s === 'away' || s === 'pending') { /* frozen: no change */ }
    else { if (count > 0) { state = 'ember'; emberFrom = d; wasOut = true; } count = 0; }
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
  return { count, best, state, shields: shieldsLeft, ember_count: emberCount, rekindles, statuses };
}

/**
 * Perfect weeks: every prescribed quest done, enough of them full, and no shield
 * spent. Counted here rather than in a view because a badge depends on it.
 * Days still to come count as prescribed, so a week in progress is never perfect
 * yet and a paid week can never be taken back. Must agree with the journal's
 * `isPerfectWeek`, or the halo and the XP would disagree.
 */
export function perfectWeeks(user, spec, gam, statuses, today = dayKey()) {
  const cfg = gam.perfect_week ?? {};
  const first = user.sessions[0]?.day;
  if (!first) return { count: 0, weeks: [], xp: 0 };

  const byWeek = new Map();
  for (const s of user.sessions) {
    if (s.type === 'kindle') continue;
    const k = isoWeekKey(s.day);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(s);
  }

  const weeks = [];
  const xp = gam.xp ?? {};
  for (const [weekId, sessions] of byWeek) {
    const start = weekStart(sessions[0].day);
    const programStart = user.profile?.program_start;
    // Calendar-anchored, exactly as the engine counts weeks (invariant 6).
    const programWeek = programStart ? weekIndex(start, programStart) : 1;
    let prescribed = 0;
    let shields = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      if (day < first) continue;                       // the week they joined is only counted from day one
      const template = (spec.templates ?? []).find(t => t.dow === dow(day));
      if (!template?.minutes) continue;
      // A taper week can switch a training day off.
      if (spec.week_overrides?.[String(programWeek)]?.days?.[String(dow(day))] === 'off') continue;
      prescribed++;
      if (statuses?.get(day) === 'shield') shields++;
    }
    const done = sessions.filter(s => s.sets.length).length;
    const full = sessions.filter(s => s.type === 'full' && isComplete(s, spec)).length;
    // The partial setup week asks for fewer full quests, never for fewer than
    // three — and pays the smaller bonus the XP table lists for it.
    const muster = programWeek <= 0;
    const minFull = muster ? (cfg.muster_min_full ?? 3) : (cfg.min_full ?? 4);
    const perfect = prescribed > 0 && done >= prescribed && full >= minFull && shields === 0;
    const bonus = perfect ? (muster ? (xp.perfect_week_muster ?? 150) : (xp.perfect_week ?? 300)) : 0;
    weeks.push({ week_id: weekId, start, programWeek, prescribed, done, full, shields, perfect, xp: bonus });
  }
  return { count: weeks.filter(w => w.perfect).length, weeks, xp: weeks.reduce((n, w) => n + w.xp, 0) };
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
    case 'sessions_completed':
      // "Between the two of you inside one four-week block" needs the partner's
      // log; until it is there the badge stays dark rather than lighting on one
      // person's count alone.
      if (c.both_users) return cmp(m.duo?.blockSessionsMax ?? 0, c.value, op);
      return cmp(m.sessions.filter(s => !c.type || s.type === c.type).length, c.value, op);
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
    case 'zone2_week_minutes':
      if (c.as_pct_of_prescribed || c.both_users) return cmp(m.duo?.zone2WeeksRun ?? 0, c.consecutive_weeks ?? 1, op);
      return cmp(Math.max(0, ...Object.values(m.zone2ByWeek)), c.value, op);
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
      // Counted from the tests actually logged, so the badge lights the moment
      // the sixth result lands rather than waiting for the battle to be sealed.
      const logged = new Set((m.user.benchmarkHistory ?? []).filter(r => r.battle_n === c.battle_n).map(r => r.benchmark_id)).size;
      const sealed = m.user.bossResolved?.[c.battle_n]?.logged_benchmarks ?? 0;
      return Math.max(logged, sealed) >= (c.value ?? 6);
    }
    case 'boss_outcome': return Object.values(m.user.bossResolved ?? {}).some(b =>
      b.outcome === c.outcome && (c.battle_n == null || b.battle_n === c.battle_n)
      // "Neither of you could have alone": the two strikes each fall short of the
      // boss, and only the synergy of the smaller one counted twice brings it down.
      && (!c.synergy_required || (b.partner_damage != null && b.my_damage != null
        && b.my_damage + b.partner_damage < b.hp && b.damage >= b.hp)));
    case 'duel_status': {
      const locks = sortedLocks(m.user);
      if (c.status === 'belt_changed') {
        // The belt changing hands n weeks running: contested weeks, alternating winners.
        const contested = locks.filter(l => l.status === 'contested' && l.winner);
        let run = 0, best = 0;
        for (let i = 1; i < contested.length; i++) {
          run = contested[i].winner !== contested[i - 1].winner ? run + 1 : 0;
          best = Math.max(best, run);
        }
        return best >= (c.value ?? 1);
      }
      if (c.consecutive) return runOf(locks, l => l.status === c.status) >= (c.value ?? 1);
      return locks.filter(l => l.status === c.status).length >= (c.value ?? 1);
    }
    case 'duel_sum_s': return Object.values(m.user.weekLocks ?? {}).some(l => (l.S_me ?? 0) + (l.S_partner ?? 0) >= c.value);
    case 'both_gate_passed': return !!(m.gates?.[c.gate] && m.duo?.partnerGates?.[c.gate]);
    case 'duo_same_day_sessions': return cmp(m.duo?.sameDayCount ?? 0, c.value, op);
    case 'duo_perfect_week': return !!m.duo?.perfectWeekTogether;
    case 'rekindled': return c.duo ? (m.duo?.rekindles ?? 0) >= 1 : (m.flame.rekindles ?? 0) >= 1;
    default: return false;
  }
}

const sortedLocks = (user) => Object.values(user.weekLocks ?? {}).sort((a, b) => (a.week_id < b.week_id ? -1 : a.week_id > b.week_id ? 1 : 0));

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

/** Which badges are earned. */
export function badges(metrics, g) {
  const out = [];
  for (const b of g.badges ?? []) {
    let earned = false;
    try { earned = evalCriterion(b.criterion, metrics); } catch { earned = false; }
    out.push({ ...b, earned });
  }
  return out;
}

/**
 * Re-judge the badges with the partner's numbers in hand. `progress` itself
 * knows one user; the duo badges (the shared flame, training in step, the boss
 * brought down together) need both, so the app computes those metrics in duo.js
 * and hands them in here. Nothing about XP changes — only which badges are lit.
 */
export function withDuo(prog, duo, g) {
  if (!prog || !duo) return prog;
  const metrics = { ...prog.metrics, duo };
  return { ...prog, metrics, badges: badges(metrics, g) };
}

// ---------------------------------------------------------------- roll-up
/** Everything the UI needs about one user, derived from the reduced state. */
export function progress(user, spec, g, today = dayKey()) {
  const best = {}, sessionsAtStep = {}, regions = Object.fromEntries((g.regions ?? []).map(r => [r, 0]));
  const zone2ByWeek = {};
  let xpTotal = 0, prCount = 0;
  const bySource = {};
  const perSession = [];
  const xp = g.xp ?? {};

  // A rung climbs on the session that earned it, so its XP belongs to that
  // session: the completion screen, the home card and the weekly report all
  // read one number and agree. Climbs only ever come from full sessions.
  const climbsByDay = new Map();
  for (const c of user.climbs) (climbsByDay.get(c.day) ?? climbsByDay.set(c.day, []).get(c.day)).push(c);
  const attributed = new Set();

  for (const s of user.sessions) {
    const gained = xpForSession(s, spec, g, { best, sessionsAtStep });
    const climbs = (s.type === 'full' || s.type == null) && !attributed.has(s.day) ? (climbsByDay.get(s.day) ?? []) : [];
    if (climbs.length) attributed.add(s.day);
    const climbXp = climbs.length * (xp.ladder_advance ?? 100);
    const by = { ...gained.by_source };
    if (climbXp) by.climbs = climbXp;

    xpTotal += gained.total + climbXp;
    prCount += gained.prs.length;
    for (const [k, v] of Object.entries(by)) bySource[k] = (bySource[k] ?? 0) + v;
    const r = regionXpForSession(s, spec, g, gained);
    for (const [k, v] of Object.entries(r)) regions[k] += v;
    const wk = isoWeekKey(s.day);
    zone2ByWeek[wk] = (zone2ByWeek[wk] ?? 0) + gained.zone2_min;
    perSession.push({
      session_id: s.session_id, day: s.day, type: s.type ?? 'full',
      xp: gained.total + climbXp, by_source: by, prs: gained.prs, climbs, fidelity: fidelity(s, spec),
    });

    for (const set of s.sets) {
      const key = `${set.exercise_id}:${set.step_id}`;
      sessionsAtStep[key] = (sessionsAtStep[key] ?? 0) + 1;
      const prior = best[key];
      if (prior == null) best[key] = set.value;
      else if (set.unit === 'clock_sec') best[key] = Math.min(prior, set.value);
      else best[key] = Math.max(prior, set.value);
    }
  }
  // A climb whose day has no full session on record (an override, say) is still paid.
  for (const [day, list] of climbsByDay) {
    if (attributed.has(day)) continue;
    const n = list.length * (xp.ladder_advance ?? 100);
    xpTotal += n; bySource.climbs = (bySource.climbs ?? 0) + n;
  }

  if (user.quizDone) { xpTotal += xp.placement ?? 150; bySource.setup = (bySource.setup ?? 0) + (xp.placement ?? 150); }

  // Armour reflects what you can wear today, so a stronger starter is placed
  // straight into Bronze. XP is for what you EARN, though, so only tiers gained
  // above the placement baseline are paid for.
  const gear = gearTiers(user, spec, g);
  const baseline = gearTiers({ ...user, ladders: baselineLadders(user, spec), benchmarks: {} }, spec, g);
  const gearXp = Object.entries(gear)
    .reduce((n, [id, x]) => n + Math.max(0, x.tier - (baseline[id]?.tier ?? 0)) * (xp.gear_tier ?? 150), 0);
  xpTotal += gearXp; if (gearXp) bySource.armour = gearXp;

  const fl = flame(user, g, today);
  const gates = {
    hinge: atOrPastStep({ spec, user }, 'hinge_deadlift', 'hinge_deadlift.kb53_floor'),
    bell: atOrPastStep({ spec, user }, 'swing', 'swing.deadstop_53'),
    run: atOrPastStep({ spec, user }, 'treadmill_intervals', 'treadmill_intervals.jog_8'),
  };
  // The three gates are the program's real milestones, and the XP table has
  // always listed a price for opening one.
  const gateXp = Object.values(gates).filter(Boolean).length * (xp.gate ?? 75);
  xpTotal += gateXp; if (gateXp) bySource.gates = gateXp;

  const perfect = perfectWeeks(user, spec, g, fl.statuses, today);
  xpTotal += perfect.xp; if (perfect.xp) bySource.perfect_weeks = perfect.xp;

  // The flame: milestones as the best run passes each one, and a rekindle each
  // time it is relit after going out.
  const milestoneXp = Object.entries(xp.flame_milestones ?? {})
    .reduce((n, [days, v]) => n + (fl.best >= Number(days) ? v : 0), 0);
  xpTotal += milestoneXp; if (milestoneXp) bySource.flame = milestoneXp;
  const rekindleXp = (fl.rekindles ?? 0) * (xp.rekindle ?? 50);
  xpTotal += rekindleXp; if (rekindleXp) bySource.flame = (bySource.flame ?? 0) + rekindleXp;

  // Boss battles: every test logged pays, all six in one battle pays a little
  // more, and a boss brought down shares out its loot as a slice of the week.
  const byBattle = new Map();
  for (const r of user.benchmarkHistory ?? []) {
    if (r.battle_n == null) continue;
    (byBattle.get(r.battle_n) ?? byBattle.set(r.battle_n, new Set()).get(r.battle_n)).add(r.benchmark_id);
  }
  let bossXp = 0;
  for (const tests of byBattle.values()) {
    bossXp += tests.size * (xp.boss_per_benchmark ?? 30);
    if (tests.size >= (g.boss_benchmarks?.length ?? 6)) bossXp += xp.boss_all_six ?? 20;
  }
  const weekXp = xpAvailableWeek(spec, g);
  for (const b of Object.values(user.bossResolved ?? {})) {
    const pct = b.outcome === 'flawless' ? (xp.boss_flawless_pct ?? 0.2) : b.outcome === 'defeated' ? (xp.boss_defeated_pct ?? 0.1) : 0;
    bossXp += Math.round(weekXp * pct);
  }
  xpTotal += bossXp; if (bossXp) bySource.boss = bossXp;

  // The duel: a week won, or shared, is paid once its record is locked.
  let duelXp = 0;
  for (const l of Object.values(user.weekLocks ?? {})) {
    if (l.status === 'contested' && l.winner === user.id) duelXp += xp.duel_win ?? 100;
    else if (l.status === 'dead_heat') duelXp += xp.duel_dead_heat ?? 50;
  }
  xpTotal += duelXp; if (duelXp) bySource.duel = duelXp;

  const level = levelFor(xpTotal, g);
  const metrics = {
    user, spec, xpTotal, level, flame: fl, gear, gates, prCount,
    sessions: user.sessions, allSets: user.sessions.flatMap(s => s.sets),
    pledgesKept: user.pledges.filter(p => p.kept).length,
    perfectWeeks: perfect.count, zone2ByWeek,
    duo: null,
  };

  return {
    xp_total: xpTotal, by_source: bySource, level, flame: fl, gear, gates,
    regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, { xp: v, level: regionLevel(v, g) }])),
    zone2_by_week: zone2ByWeek, sessions: perSession, perfect_weeks: perfect,
    xp_available_week: weekXp,
    badges: badges(metrics, g), metrics,
  };
}

// ---------------------------------------------------------------- regions, for the screens
/**
 * One body part's bar, the way both the home card and the body screen draw it:
 * all-time XP for that part, and how far it sits between its current level and
 * the next. `pct` is 0 at a fresh level so an empty bar reads as empty.
 */
export function regionBar(region, g) {
  const div = g.region_level?.divisor ?? 40;
  const xp = Math.max(0, region?.xp ?? 0);
  const level = regionLevel(xp, g);
  const floor = div * level * level;
  const next = div * (level + 1) * (level + 1);
  const pct = next > floor ? Math.round(((xp - floor) / (next - floor)) * 100) : 100;
  return { xp: Math.round(xp), level, floor, next, to_next: Math.max(0, next - Math.round(xp)), pct: Math.min(100, Math.max(0, pct)) };
}
