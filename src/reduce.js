// Fold the event log into per-user state. Pure: the same events always produce
// the same state, in any order they arrive, on either phone. Nothing here is
// stored — a rules change just re-runs this.
import { TYPES, isFuture } from './events.js';
import { indexSpec, resolveSteps, stepLadders, applyPainRegressions } from './engine.js';
import { daysBetween } from './util.js';

export const USERS = ['sean', 'cat'];

const emptyUser = (id) => ({
  id,
  profile: {},
  equipment: {},
  floor: {},              // placement result: the step each ladder may never fall below
  quizDone: false,
  screens: {},
  sessions: [],           // finished sessions, in day order, with their summaries
  openSession: null,
  ladders: {},
  climbs: [],
  slips: [],
  benchmarks: {},         // id -> latest result
  benchmarkHistory: [],
  painFlags: [],
  rests: new Set(),
  modes: [],
  metrics: [],
  pledges: [],
  reactions: [],
  weekLocks: {},
  bossResolved: {},
  overrides: [],
  unknownEvents: 0,
});

/** Key for last-write-wins on a logged set. Side and part make each row distinct. */
export const setKey = (d) => `${d.session_id}|${d.exercise_id}|${d.set_index}|${d.side ?? ''}|${d.part ?? ''}`;

/**
 * @param events every known event, both users, any order
 * @param spec   indexSpec(program.json)
 */
export function reduce(events, program, opts = {}) {
  const spec = program.byExercise ? program : indexSpec(program);
  const users = Object.fromEntries(USERS.map(u => [u, emptyUser(u)]));

  const ordered = [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sessions = new Map();   // session_id -> draft
  const setRows = new Map();    // setKey -> winning event

  for (const e of ordered) {
    const u = users[e.user];
    if (!u) continue;                       // an event for nobody we know: ignore, never crash
    if (isFuture(e)) { u.unknownEvents++; continue; }   // written by a newer shell; kept on disk, skipped here
    const d = e.data ?? {};

    switch (e.type) {
      case TYPES.PROFILE: Object.assign(u.profile, d); break;
      case TYPES.EQUIPMENT: Object.assign(u.equipment, d); break;
      case TYPES.ASSESSMENT:
        Object.assign(u.floor, d.start_steps ?? {});
        u.quizDone = true;
        u.placedOn = e.day;
        break;
      case TYPES.SCREEN: Object.assign(u.screens, d); break;
      case TYPES.SESSION_START: {
        sessions.set(d.session_id, {
          session_id: d.session_id, user: e.user, day: d.date ?? e.day,
          template_id: d.template_id, type: d.type ?? 'full', deload: !!d.deload,
          boss: !!d.boss, plan: d.plan ?? null, started_at: e.ts, ended_at: null,
          duration_min: null, sets: [],
        });
        break;
      }
      case TYPES.SET: {
        const k = setKey(d);
        const prev = setRows.get(k);
        if (!prev || prev.ts < e.ts || (prev.ts === e.ts && prev.id < e.id)) setRows.set(k, e);
        break;
      }
      case TYPES.SESSION_END: {
        const s = sessions.get(d.session_id);
        if (s) { s.ended_at = e.ts; s.duration_min = d.duration_min ?? null; s.summary = d; }
        break;
      }
      case TYPES.REST: u.rests.add(e.day); break;
      case TYPES.MODE_START: u.modes.push({ kind: d.kind, from: d.start ?? e.day, to: d.end ?? null }); break;
      case TYPES.MODE_END: {
        const m = [...u.modes].reverse().find(x => x.kind === d.kind && !x.closed);
        if (m) { m.to = d.end ?? e.day; m.closed = true; }
        break;
      }
      case TYPES.BENCHMARK:
        u.benchmarkHistory.push({ ...d, day: e.day });
        u.benchmarks[d.benchmark_id] = { ...d, day: e.day };
        break;
      case TYPES.PAIN: u.painFlags.push({ ...d, day: e.day }); break;
      case TYPES.METRIC: u.metrics.push({ ...d, day: e.day }); break;
      case TYPES.PLEDGE: u.pledges.push({ ...d, day: e.day }); break;
      case TYPES.REACTION: u.reactions.push({ ...d, day: e.day }); break;
      case TYPES.LADDER_OVERRIDE: u.overrides.push({ ...d, day: e.day }); break;
      case TYPES.CONTEST_PAUSE: (u.contestPauses ??= []).push({ ...d, day: e.day }); break;
      case TYPES.WEEK_LOCK: u.weekLocks[d.week_id] = { ...d, ts: e.ts }; break;
      case TYPES.BOSS_RESOLVED: u.bossResolved[d.battle_n] = { ...d, ts: e.ts }; break;
      case TYPES.QUIZ: u.quizAnswers = d; break;
      default: u.unknownEvents++;
    }
  }

  // Attach the winning set rows to their sessions. A set whose session belongs to
  // another user is dropped: a switch-user bug must never fold Cat's reps into
  // Sean's ladders.
  for (const e of setRows.values()) {
    const s = sessions.get(e.data.session_id);
    if (!s || s.user !== e.user) continue;
    if (e.data.done === false) continue;                       // an undo, not a set
    s.sets.push({ ...e.data, ts: e.ts, day: e.day });
  }

  for (const s of sessions.values()) {
    const u = users[s.user];
    if (!u) continue;
    s.sets.sort((a, b) => a.exercise_id.localeCompare(b.exercise_id) || (a.set_index - b.set_index));
    if (s.ended_at) u.sessions.push(s); else u.openSession = s;
  }

  for (const u of Object.values(users)) {
    u.sessions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.started_at < b.started_at ? -1 : 1));
    deriveLadders(u, spec, opts);
    for (const s of u.sessions) s.perf = perfFor(s, spec);
  }

  return { users, spec };
}

/** Turn one session's logged sets into the per-exercise records the rules read. */
export function perfFor(session, spec) {
  const byEx = {};
  for (const set of session.sets) {
    (byEx[set.exercise_id] ??= { sets: [], exercise_id: set.exercise_id, step_id: set.step_id }).sets.push(set);
  }
  const plan = session.plan?.rows ?? [];
  for (const [exId, p] of Object.entries(byEx)) {
    const planned = plan.filter(r => r.exercise_id === exId);
    p.prescribed = planned.length || p.sets.length;
    p.allDone = p.sets.length >= p.prescribed;
    p.sessionType = session.type;
    p.deload = session.deload;
    p.rounds = Math.max(0, ...p.sets.map(s => (s.unit === 'rounds' ? s.value : 0)));
    p.clockSec = Math.min(Infinity, ...p.sets.filter(s => s.unit === 'clock_sec').map(s => s.value));
    if (!Number.isFinite(p.clockSec)) p.clockSec = null;
    p.cardioMinutes = p.sets.filter(s => s.unit === 'min').reduce((n, s) => n + (s.value || 0), 0);
    p.cardioDone = p.cardioMinutes > 0;
    p.rpeBlock = p.sets.find(s => s.rpe_block != null)?.rpe_block ?? null;
    p.drops = p.sets.reduce((n, s) => n + (s.drops || 0), 0);
    p.counts_for_progression = planned.length ? planned[0].counts_for_progression !== false : true;
    p.zone2Min = p.sets.filter(s => s.unit === 'min' && s.talk_test_ok !== false).reduce((n, s) => n + (s.value || 0), 0);
  }
  return byEx;
}

/** Replay every finished session through the ladder stepper, in order. */
function deriveLadders(u, spec, opts = {}) {
  const eq = { ...(opts.equipment ?? {}), ...u.equipment };
  const steps = {};
  for (const ex of spec.exercises ?? []) steps[ex.id] = resolveSteps(ex, eq);

  u.stepsByExercise = steps;
  u.ladders = Object.fromEntries((spec.exercises ?? []).map(ex => {
    const list = steps[ex.id] ?? [];
    const floorId = u.floor[ex.id] && list.some(s => s.id === u.floor[ex.id]) ? u.floor[ex.id] : list[0]?.id;
    return [ex.id, { step_id: floorId, qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: null }];
  }));

  for (const s of u.sessions) {
    const perfs = perfFor(s, spec);
    const painWindow = u.painFlags
      .filter(f => daysBetween(f.day, s.day) >= 0 && daysBetween(f.day, s.day) <= 14)
      .map(f => ({ ...f, daysAgo: daysBetween(f.day, s.day) }));
    const ctx = {
      day: s.day, spec, equipment: eq, steps, floor: u.floor,
      weekIndex: s.week ?? 0, painFlags: painWindow,
      benchmarks: u.benchmarks, ladders: u.ladders,
    };
    const out = stepLadders(spec, u.ladders, perfs, ctx);
    u.ladders = out.ladders;
    u.climbs.push(...out.climbs);
    u.slips.push(...out.slips);

    const pain = applyPainRegressions(spec, u.ladders, painWindow.filter(f => f.daysAgo <= 7), ctx);
    u.ladders = pain.ladders;
    u.slips.push(...pain.slips);
  }

  // A manual override is the user telling us the placement was wrong; it wins.
  for (const o of u.overrides) {
    if (u.ladders[o.exercise_id] && (steps[o.exercise_id] ?? []).some(s => s.id === o.step_id)) {
      u.ladders[o.exercise_id] = { step_id: o.step_id, qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: o.day };
    }
  }
}
