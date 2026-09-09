// The two-player layer. Every score is a ratio against that person's OWN
// prescription, so a smaller beginner can win any week by executing their plan,
// and no formula anywhere compares loads, reps or speeds between the two.
import { isoWeekKey, weekStart, addDays, daysBetween, clamp } from './util.js';
import { fidelity, flame } from './gamify.js';

/** Did the partner train today? Read from their synced sessions, nothing else. */
export const trainedOn = (user, day) =>
  !!user?.sessions.some(s => s.day === day && s.sets.length && s.type !== 'kindle');

/**
 * The duo flame: consecutive days on which BOTH trained. Either partner's rest
 * link keeps it, and a freeze day is neutral rather than a break.
 */
export function duoFlame(a, b, gA, gB, today) {
  const first = firstCommonDay(a, b);
  if (!first) return 0;
  let count = 0;
  for (let d = first; daysBetween(d, today) > 0; d = addDays(d, 1)) {
    const sa = gA.get(d), sb = gB.get(d);
    const kept = (s) => s === 'trained' || s === 'rest' || s === 'shield';
    const neutral = (s) => s === 'recovery' || s === 'away' || s === 'pending' || s == null;
    if (sa === 'trained' && sb === 'trained') { count++; continue; }
    if (neutral(sa) || neutral(sb)) continue;              // one of them is paused: no change
    if (kept(sa) && kept(sb)) { count++; continue; }        // a rest day either side still counts
    count = 0;
  }
  return count;
}

function firstCommonDay(a, b) {
  const da = a?.sessions[0]?.day, db = b?.sessions[0]?.day;
  if (!da || !db) return null;
  return da > db ? da : db;
}

/**
 * The weekly duel score, 0-100. Five terms, every one capped at 100 and measured
 * against that user's own plan:
 *   sessions 30 · fidelity 25 · zone-2 20 · progress 15 · xp 10
 */
export function duelScore(user, progress, spec, gam, weekId) {
  const w = gam.duel?.weights ?? { sessions: 0.30, fidelity: 0.25, zone2: 0.20, progress: 0.15, xp: 0.10 };
  const cfg = gam.duel?.session_counts ?? { min_minutes: 20, min_fidelity: 0.6, skirmish_min_minutes: 12 };

  const weekSessions = user.sessions.filter(s => isoWeekKey(s.day) === weekId);
  const counted = weekSessions.filter(s => {
    const f = fidelity(s, spec);
    if (s.type === 'kindle') return false;
    if (s.type === 'skirmish') return (s.duration_min ?? 0) >= cfg.skirmish_min_minutes;
    return (s.duration_min ?? 0) >= cfg.min_minutes && f.pct >= cfg.min_fidelity;
  });

  const prescribedSessions = sessionsPrescribed(user, spec, weekId);
  const sessions = pct(counted.length, prescribedSessions);

  const fids = counted.map(s => fidelity(s, spec).pct);
  const fidelityPct = fids.length ? Math.round((fids.reduce((a, b) => a + b, 0) / fids.length) * 100) : 0;

  const zone2Done = weekSessions.reduce((n, s) => n + s.sets.filter(x => x.unit === 'min' && x.talk_test_ok !== false)
    .reduce((m, x) => m + (x.value ?? 0), 0), 0);
  const zone2 = pct(zone2Done, zone2Prescribed(user, spec, weekId));

  const steps = user.climbs.filter(c => isoWeekKey(c.day) === weekId).length;
  const tiers = user.benchmarkHistory.filter(b => isoWeekKey(b.day) === weekId && (b.tier ?? 0) > (b.tier_prev ?? 0)).length;
  const prog = Math.min(100, steps * (gam.duel?.progress?.per_step ?? 34) + tiers * (gam.duel?.progress?.per_tier ?? 50));

  const xpWeek = (progress?.sessions ?? []).filter(s => isoWeekKey(s.day) === weekId).reduce((n, s) => n + s.xp, 0);
  const xpAvailable = xpAvailableWeek(user, spec, gam, weekId);
  const xpPct = pct(xpWeek, xpAvailable);

  const parts = { sessions, fidelity: fidelityPct, zone2, progress: prog, xp: xpPct };
  const S = Math.round(w.sessions * sessions + w.fidelity * fidelityPct + w.zone2 * zone2 + w.progress * prog + w.xp * xpPct);
  return { S, parts, counted: counted.length, prescribed: prescribedSessions };
}

const pct = (done, of) => (of > 0 ? Math.min(100, Math.round((done / of) * 100)) : 0);

function sessionsPrescribed(user, spec, weekId) {
  const training = (spec.templates ?? []).filter(t => t.minutes > 0).length;
  const start = weekStart(user.sessions[0]?.day ?? '2026-01-01');
  return training || 6;
}

function zone2Prescribed(user, spec, weekId) {
  let total = 0;
  for (const t of spec.templates ?? []) {
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) {
        const ex = spec.byExercise?.[it.exercise_id];
        if (!ex || !['treadmill_zone2', 'zone2_finisher', 'vest_walk', 'march_step_zone2'].includes(ex.id)) continue;
        total += it.time_override_min ?? ex.ladder?.[0]?.cardio?.minutes ?? 0;
      }
    }
  }
  return total || 1;
}

function xpAvailableWeek(user, spec, gam, weekId) {
  const xp = gam.xp ?? {};
  let total = 0;
  for (const t of spec.templates ?? []) {
    if (!t.minutes) continue;
    let rows = 0, minutes = 0;
    for (const b of t.blocks ?? []) for (const it of b.items ?? []) {
      const ex = spec.byExercise?.[it.exercise_id];
      if (!ex || ex.no_xp) continue;
      if (['treadmill_zone2', 'zone2_finisher', 'vest_walk', 'march_step_zone2'].includes(ex.id)) minutes += it.time_override_min ?? 30;
      else rows += it.sets ?? 1;
    }
    total += rows * ((xp.set_logged ?? 10) + (xp.set_met ?? 5)) + minutes * (xp.zone2_per_min ?? 3) + (xp.quest_full ?? 50);
  }
  return Math.max(1, total);
}

/**
 * Resolve a finished week into a result. Statuses matter as much as the score:
 * a week where one of them was ill is a no-contest, not a loss, and a week where
 * someone simply did not appear is worded neutrally rather than as a defeat.
 */
export function resolveWeek(mine, theirs, spec, gam, weekId, progressMine, progressTheirs) {
  const cfg = gam.duel ?? {};
  const a = duelScore(mine, progressMine, spec, gam, weekId);
  const b = theirs ? duelScore(theirs, progressTheirs, spec, gam, weekId) : null;
  if (!b) return { week_id: weekId, status: 'solo', mine: a, theirs: null, winner: null };

  const pausedA = pausedDays(mine, weekId), pausedB = pausedDays(theirs, weekId);
  const minSessions = cfg.min_sessions_contested ?? 2;
  const maxPaused = cfg.max_paused_contested ?? 3;

  let status = 'contested';
  if (pausedA >= maxPaused || pausedB >= maxPaused) status = 'no_contest';
  else if (a.counted === 0 && b.counted >= minSessions && pausedA === 0) status = 'unexplained';
  else if (b.counted === 0 && a.counted >= minSessions && pausedB === 0) status = 'unexplained';
  else if (a.counted < minSessions || b.counted < minSessions) status = 'no_contest';
  else if (Math.abs(a.S - b.S) < (cfg.dead_heat_margin ?? 2)) status = 'dead_heat';

  const winner = status === 'contested' ? (a.S > b.S ? mine.id : theirs.id) : null;
  return {
    week_id: weekId, status, mine: a, theirs: b, winner,
    pb_star_mine: isPersonalBest(mine, a.S, weekId, gam),
    margin: Math.abs(a.S - b.S),
  };
}

const PAUSED = new Set(['recovery', 'away', 'shield']);

function pausedDays(user, weekId) {
  const start = weekStart(dayOfWeekId(weekId));
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if ((user.modes ?? []).some(m => d >= m.from && (!m.to || d <= m.to))) n++;
  }
  return n;
}

/** ISO week ids are opaque; keep one place that turns one back into a date. */
function dayOfWeekId(weekId) {
  const [y, w] = weekId.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const d = new Date(mondayOfWeek1);
  d.setUTCDate(mondayOfWeek1.getUTCDate() + (w - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function isPersonalBest(user, S, weekId, gam) {
  const past = Object.values(user.weekLocks ?? {})
    .filter(l => l.week_id !== weekId && l.status === 'contested')
    .slice(-4).map(l => l.S_me ?? 0);
  if (past.length < 2) return false;
  return S >= Math.max(...past) + (gam.duel?.pb_star_margin ?? 5);
}

/**
 * The belt, the crowns and the alliance rule, replayed from locked weeks only.
 * Nothing here is stored: change a rule and the whole history re-derives.
 */
export function beltState(mine, theirs, gam) {
  const locks = Object.values(mine.weekLocks ?? {}).sort((x, y) => (x.week_id < y.week_id ? -1 : 1));
  let holder = null, crowns = { [mine.id]: 0, [theirs?.id ?? 'partner']: 0 };
  let deadHeats = 0, changes = 0, lossRun = { [mine.id]: 0, [theirs?.id ?? 'partner']: 0 };

  for (const l of locks) {
    if (l.status === 'dead_heat') { deadHeats++; lossRun[mine.id] = 0; if (theirs) lossRun[theirs.id] = 0; continue; }
    if (l.status !== 'contested' || !l.winner) continue;
    if (holder && holder !== l.winner) changes++;
    holder = l.winner;
    crowns[l.winner] = (crowns[l.winner] ?? 0) + 1;
    lossRun[l.winner] = 0;
    const loser = l.winner === mine.id ? theirs?.id : mine.id;
    if (loser) lossRun[loser] = (lossRun[loser] ?? 0) + 1;
  }

  // After three losses in a row the next week is co-operative, so a bad month
  // cannot become a losing streak that nobody wants to open the app for.
  const allianceNext = Object.values(lossRun).some(n => n >= (gam.duel?.alliance_after_losses ?? 3));
  return { holder, crowns, dead_heats: deadHeats, title_changes: changes, loss_run: lossRun, alliance_next: allianceNext };
}

/** Everything the duo screen shows, for one pair, on one day. */
export function duoState(mine, theirs, spec, gam, today, progressMine = null, progressTheirs = null) {
  const weekId = isoWeekKey(today);
  const gA = flame(mine, gam, today).statuses;
  const gB = theirs ? flame(theirs, gam, today).statuses : new Map();
  const week = resolveWeek(mine, theirs, spec, gam, weekId, progressMine, progressTheirs);
  const belt = beltState(mine, theirs, gam);
  const alliance = belt.alliance_next;

  const status = week.status === 'solo' ? 'solo'
    : alliance ? 'alliance'
    : week.status === 'dead_heat' ? 'dead heat'
    : week.status !== 'contested' ? week.status.replace('_', ' ')
    : week.mine.S > (week.theirs?.S ?? 0) ? 'you lead' : 'they lead';

  return {
    weekId, status, alliance,
    alliance_target: gam.duel?.alliance_target ?? 150,
    combined: week.mine.S + (week.theirs?.S ?? 0),
    partnerTrainedToday: trainedOn(theirs, today),
    duoFlame: theirs ? duoFlame(mine, theirs, gA, gB, today) : 0,
    belt,
    week: { status, mine: week.mine, theirs: week.theirs ?? { S: 0, parts: { sessions: 0, fidelity: 0, zone2: 0, progress: 0, xp: 0 } }, pb: week.pb_star_mine },
  };
}

// ---------------------------------------------------------------- locking
/**
 * A week becomes a permanent fact on Tuesday night, once both phones have had a
 * day to sync the weekend. Before that the result is provisional and may still
 * move; after it, the belt and the crowns replay from these records for ever.
 */
export function weeksDueForLock(mine, theirs, spec, gam, today, progressMine, progressTheirs) {
  const cfg = gam.duel ?? {};
  const lockDow = cfg.lock_dow ?? 2;            // Tuesday
  const due = [];
  const first = mine.sessions[0]?.day;
  if (!first) return due;

  const seen = new Set(Object.keys(mine.weekLocks ?? {}));
  let cursor = weekStart(first);
  const guard = 200;
  for (let i = 0; i < guard; i++) {
    const weekId = isoWeekKey(cursor);
    const lockDay = addDays(cursor, 7 + (lockDow - 1));      // the Tuesday after that week
    if (daysBetween(lockDay, today) < 0) break;              // not resolvable yet
    if (!seen.has(weekId)) {
      const result = resolveWeek(mine, theirs, spec, gam, weekId, progressMine, progressTheirs);
      if (result.status !== 'solo') due.push(result);
    }
    cursor = addDays(cursor, 7);
  }
  return due;
}

/** The shape written into a `week.locked` event. */
export function lockRecord(result, mine, theirs) {
  return {
    week_id: result.week_id,
    status: result.status,
    winner: result.winner,
    S_me: result.mine?.S ?? 0,
    S_partner: result.theirs?.S ?? 0,
    pb_star_me: !!result.pb_star_mine,
    partner_updated_at: theirs?.sessions?.[theirs.sessions.length - 1]?.ended_at ?? null,
    locked_at: new Date().toISOString(),
  };
}
