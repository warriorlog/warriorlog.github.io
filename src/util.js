// Small pure helpers shared by every module. No DOM, no IndexedDB, no fetch —
// so every function here is unit-testable under `node --test`.

// ---------------------------------------------------------------- day keys
// The training day boundary is 04:00 LOCAL, not midnight: a session finished at
// 00:30 belongs to the night before. Streaks, weeks, month files and the duel all
// key on this, so it lives in exactly one place.
export const DAY_BOUNDARY_HOURS = 4;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date (YYYY-MM-DD) of `ts` shifted back by the 04:00 boundary. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) throw new TypeError('dayKey: invalid timestamp');
  d.setTime(d.getTime() - DAY_BOUNDARY_HOURS * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-09" from a day key. The only definition of a month partition. */
export const monthKey = (day) => day.slice(0, 7);

/** Parse a day key as a local noon Date (noon dodges every DST edge). */
export function dayDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export const MS_DAY = 86_400_000;

/** Whole days from `a` to `b` (both day keys); negative when b precedes a. */
export function daysBetween(a, b) {
  return Math.round((dayDate(b) - dayDate(a)) / MS_DAY);
}

/** Day key `n` days after `day` (n may be negative). */
export function addDays(day, n) {
  const d = dayDate(day);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 0 = Sunday … 6 = Saturday, matching the templates' `dow`. */
export const dow = (day) => dayDate(day).getDay();

/** ISO-8601 week key, e.g. "2026-W38". Weeks start Monday; week 1 holds Jan 4. */
export function isoWeekKey(day) {
  const d = dayDate(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);      // Thursday of this week
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const week1Thu = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + 3, 12, 0, 0, 0);
  const week = 1 + Math.round((d - week1Thu) / (7 * MS_DAY));
  return `${isoYear}-W${pad(week)}`;
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day) {
  return addDays(day, -((dow(day) + 6) % 7));
}

/**
 * Program week for a day: 1 on the Monday of `programStart`'s week, counting ISO
 * weeks. Days before that Monday are week 0 — the "Muster" setup week.
 * Calendar-anchored on purpose: both partners must share boss weeks.
 */
export function weekIndex(day, programStart) {
  const weeks = Math.round(daysBetween(weekStart(programStart), weekStart(day)) / 7);
  return weeks < 0 ? 0 : weeks + 1;
}

// ---------------------------------------------------------------- ids
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford, no I/L/O/U

/**
 * ULID-like: 10 chars of millisecond timestamp then 16 random chars. Sorts by
 * time as a plain string, which is what the reducer's last-write-wins uses to
 * break ties, and is unique enough for two phones.
 */
export function newId(ts = Date.now(), rnd = Math.random) {
  let time = '';
  let t = ts;
  for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  let tail = '';
  for (let i = 0; i < 16; i++) tail += B32[Math.floor(rnd() * 32)];
  return time + tail;
}

// ---------------------------------------------------------------- text
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolation. Views use only this. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    out += (v && v.__html ? v.__html : Array.isArray(v) ? v.map(x => (x && x.__html) ? x.__html : esc(x)).join('') : esc(v)) + strings[i + 1];
  }
  return { __html: out, toString: () => out };
}

/** Mark an already-escaped fragment as safe to embed. */
export const raw = (s) => ({ __html: String(s), toString: () => String(s) });

// ---------------------------------------------------------------- jsonl / base64
/** Tolerant JSONL parse: returns {rows, bad} and never throws on a torn line. */
export function parseJsonl(text) {
  const rows = [];
  let bad = 0;
  for (const line of String(text).split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    try { rows.push(JSON.parse(s)); } catch { bad++; }
  }
  return { rows, bad };
}

export const toJsonl = (rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

/** Union by event id, stable-sorted by (ts, id) — the merge the sync layer uses. */
export function mergeEvents(...lists) {
  const byId = new Map();
  for (const list of lists) for (const e of list || []) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** UTF-8 safe base64 (btoa alone corrupts anything non-ASCII, e.g. an emoji note). */
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
