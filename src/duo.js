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

/** Everything the duo screen shows, for one pair, on one day. */
export function duoState(mine, theirs, spec, gam, today) {
  const weekId = isoWeekKey(today);
  const gA = flame(mine, gam, today).statuses;
  const gB = theirs ? flame(theirs, gam, today).statuses : new Map();
  const myScore = duelScore(mine, mine.progressCache, spec, gam, weekId);
  const theirScore = theirs ? duelScore(theirs, theirs.progressCache, spec, gam, weekId) : { S: 0, parts: { sessions: 0, fidelity: 0, zone2: 0, progress: 0, xp: 0 } };

  const margin = gam.duel?.dead_heat_margin ?? 2;
  const status = Math.abs(myScore.S - theirScore.S) < margin ? 'dead heat'
    : myScore.S > theirScore.S ? 'you lead' : 'they lead';

  return {
    weekId,
    partnerTrainedToday: trainedOn(theirs, today),
    duoFlame: theirs ? duoFlame(mine, theirs, gA, gB, today) : 0,
    week: { status, mine: myScore, theirs: theirScore },
  };
}
