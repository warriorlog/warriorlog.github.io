// The event log is the only thing this app persists. Every total — ladder step,
// XP, level, flame, duel score — is derived from these by pure functions, so a
// merge is a set union and a rules change is a recompute, never a migration of
// mutable counters.
import { newId, dayKey } from './util.js';

export const SCHEMA_VERSION = 1;

export const TYPES = /** @type {const} */ ({
  PROFILE: 'profile.updated',
  EQUIPMENT: 'equipment.updated',
  ASSESSMENT: 'assessment.recorded',   // placement result: starting step per ladder
  QUIZ: 'quiz.answered',               // the raw answers (private)
  SCREEN: 'screen.recorded',           // PAR-Q / shoulder / hip screens (private)
  SESSION_START: 'session.started',
  SET: 'set.logged',
  SESSION_END: 'session.finished',
  REST: 'rest.taken',
  MODE_START: 'mode.started',          // recovery | away
  MODE_END: 'mode.ended',
  LADDER_OVERRIDE: 'ladder.override',
  BENCHMARK: 'benchmark.recorded',
  PAIN: 'pain.flagged',
  METRIC: 'metric.logged',             // bodyweight etc. — private by default
  PLEDGE: 'pledge.made',
  REACTION: 'reaction.sent',
  CONTEST_PAUSE: 'contest.paused',
  WEEK_LOCK: 'week.locked',
  BOSS_RESOLVED: 'boss.resolved',
});

const TYPE_SET = new Set(Object.values(TYPES));

/**
 * Fields stripped before an event leaves the phone. The repo is PUBLIC, so this
 * is the real privacy boundary — a partner-UI courtesy is not privacy. Anything
 * derived from bodyweight (vest pounds) counts as a body metric.
 */
export const REDACT = {
  [TYPES.SET]: ['rir', 'pain', 'pain_region', 'rpe_block', 'vest_lb', 'note'],
  [TYPES.SESSION_END]: ['note', 'session_rpe'],
  [TYPES.PROFILE]: ['tz', 'usual_time', 'anchor_text', 'bodyweight_lb', 'height_in', 'age'],
  [TYPES.BENCHMARK]: ['value_private'],
  [TYPES.PAIN]: ['note'],
};

/** Event types that never sync at all unless the user opts in. */
export const PRIVATE_TYPES = new Set([TYPES.METRIC, TYPES.QUIZ, TYPES.SCREEN, TYPES.PLEDGE]);

/** Build an event. `ctx` carries the identity fields the caller owns. */
export function makeEvent(type, data = {}, ctx = {}) {
  if (!TYPE_SET.has(type)) throw new Error(`makeEvent: unknown type ${type}`);
  const ts = ctx.ts ?? new Date().toISOString();
  return {
    v: SCHEMA_VERSION,
    id: ctx.id ?? newId(Date.parse(ts)),
    ts,
    day: ctx.day ?? dayKey(Date.parse(ts)),
    dev: ctx.dev ?? 'unknown',
    user: ctx.user ?? 'sean',
    type,
    private: ctx.private ?? PRIVATE_TYPES.has(type),
    data,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shape check. Returns null when fine, else a reason string. Never throws. */
export function validate(e) {
  if (!e || typeof e !== 'object') return 'not an object';
  if (typeof e.id !== 'string' || e.id.length < 8) return 'bad id';
  if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) return 'bad ts';
  if (typeof e.day !== 'string' || !ISO_DAY.test(e.day)) return 'bad day';
  if (typeof e.type !== 'string' || !e.type.includes('.')) return 'bad type';
  if (e.user !== 'sean' && e.user !== 'cat') return 'bad user';
  if (typeof e.dev !== 'string' || !e.dev) return 'bad dev';
  if (typeof e.v !== 'number') return 'bad v';
  if (e.data == null || typeof e.data !== 'object') return 'bad data';
  return null;
}

/**
 * Upgrade an event written by an older shell. Unknown FUTURE versions are left
 * exactly as they are: the reducer skips what it does not understand, and the
 * next shell update derives with them included. Dropping them would lose a
 * partner's history permanently.
 */
const MIGRATIONS = [
  // index i upgrades v(i+1) -> v(i+2); none needed yet.
];

export function migrateEvent(e) {
  let out = e;
  while (typeof out.v === 'number' && out.v < SCHEMA_VERSION && MIGRATIONS[out.v - 1]) {
    out = MIGRATIONS[out.v - 1](out);
    out.v += 1;
  }
  return out;
}

export const isFuture = (e) => typeof e.v === 'number' && e.v > SCHEMA_VERSION;

/**
 * The serialized form. Strips redacted fields and refuses to emit an event that
 * still carries a private field name — sync calls this, never JSON.stringify.
 */
export function toRemote(e) {
  const fields = REDACT[e.type];
  if (!fields) return { ...e };
  const data = { ...e.data };
  for (const f of fields) delete data[f];
  return { ...e, data };
}

/** True when this event may be pushed at all. */
export function isSyncable(e, { syncMetrics = false } = {}) {
  if (e.private) return e.type === TYPES.METRIC ? !!syncMetrics : false;
  return true;
}

/** Every field name that must never appear in a serialized payload. */
export const REDACTED_FIELD_NAMES = [...new Set(Object.values(REDACT).flat())];
