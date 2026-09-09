import test from 'node:test';
import assert from 'node:assert/strict';
import * as u from '../src/util.js';

test('dayKey puts a 00:30 session on the previous day and 04:00 on the new one', () => {
  assert.equal(u.dayKey(new Date(2026, 8, 9, 0, 30).getTime()), '2026-09-08');
  assert.equal(u.dayKey(new Date(2026, 8, 9, 3, 59, 59).getTime()), '2026-09-08');
  assert.equal(u.dayKey(new Date(2026, 8, 9, 4, 0).getTime()), '2026-09-09');
  assert.equal(u.dayKey(new Date(2026, 8, 9, 23, 59).getTime()), '2026-09-09');
});

test('dayKey survives both DST transitions', () => {
  // US spring forward 2027-03-14, fall back 2026-11-01.
  for (const [y, m, d] of [[2026, 10, 1], [2027, 2, 14]]) {
    const before = u.dayKey(new Date(y, m, d, 5, 0).getTime());
    const after = u.dayKey(new Date(y, m, d + 1, 5, 0).getTime());
    assert.equal(u.daysBetween(before, after), 1, `${y}-${m + 1}-${d} boundary`);
  }
});

test('monthKey is derived from the day key, never from the timestamp', () => {
  // A 00:30 session on the 1st belongs to the previous month's file.
  const day = u.dayKey(new Date(2026, 9, 1, 0, 30).getTime());
  assert.equal(day, '2026-09-30');
  assert.equal(u.monthKey(day), '2026-09');
});

test('isoWeekKey matches ISO-8601 including the year boundary', () => {
  assert.equal(u.isoWeekKey('2026-09-14'), '2026-W38');
  assert.equal(u.isoWeekKey('2026-09-20'), '2026-W38');   // Sunday still week 38
  assert.equal(u.isoWeekKey('2026-09-21'), '2026-W39');
  assert.equal(u.isoWeekKey('2027-01-01'), '2026-W53');   // Friday belongs to ISO 2026
  assert.equal(u.isoWeekKey('2026-01-01'), '2026-W01');
});

test('weekIndex is calendar-anchored: muster is 0, the start Monday is 1, boss weeks land on 4/8/12', () => {
  const start = '2026-09-14';
  assert.equal(u.weekIndex('2026-09-08', start), 0);
  assert.equal(u.weekIndex('2026-09-13', start), 0);
  assert.equal(u.weekIndex('2026-09-14', start), 1);
  assert.equal(u.weekIndex('2026-09-20', start), 1);
  assert.equal(u.weekIndex('2026-10-10', start), 4);   // The Gatekeeper
  assert.equal(u.weekIndex('2026-11-07', start), 8);   // The Iron Colossus
  assert.equal(u.weekIndex('2026-12-05', start), 12);  // The Warlord
});

test('weekStart is the Monday, and dow matches the templates', () => {
  assert.equal(u.weekStart('2026-09-20'), '2026-09-14');
  assert.equal(u.dow('2026-09-14'), 1);
  assert.equal(u.dow('2026-09-13'), 0);
});

test('newId is time-ordered and unique', () => {
  const ids = [u.newId(1_000_000), u.newId(1_000_001), u.newId(2_000_000)];
  assert.deepEqual([...ids].sort(), ids);
  const many = new Set(Array.from({ length: 2000 }, () => u.newId(1_000_000)));
  assert.equal(many.size, 2000);
});

test('html escapes every interpolation and passes raw fragments through', () => {
  const out = u.html`<p>${'<img src=x onerror=alert(1)>'}</p>`.toString();
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img'));
  assert.equal(u.html`<b>${u.raw('<i>ok</i>')}</b>`.toString(), '<b><i>ok</i></b>');
  assert.equal(u.html`${['a', '<b>']}`.toString(), 'a&lt;b&gt;');
});

test('parseJsonl skips torn lines and counts them instead of throwing', () => {
  const { rows, bad } = u.parseJsonl('{"id":"a"}\n{"id":"b"\n\n# comment\n{"id":"c"}\n');
  assert.deepEqual(rows.map(r => r.id), ['a', 'c']);
  assert.equal(bad, 1);
});

test('mergeEvents unions by id and sorts by (ts, id)', () => {
  const a = [{ id: '2', ts: '2026-09-09T10:00:00Z' }, { id: '1', ts: '2026-09-09T09:00:00Z' }];
  const b = [{ id: '2', ts: '2026-09-09T10:00:00Z' }, { id: '3', ts: '2026-09-09T10:00:00Z' }];
  const m = u.mergeEvents(a, b);
  assert.deepEqual(m.map(e => e.id), ['1', '2', '3']);
  assert.deepEqual(u.mergeEvents(b, a).map(e => e.id), ['1', '2', '3']);   // order-independent
});

test('base64 round-trips UTF-8 (an emoji note must survive)', () => {
  globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
  const s = 'swings felt good 💪 — 100 in 5:00\n';
  assert.equal(u.b64decode(u.b64encode(s)), s);
});
