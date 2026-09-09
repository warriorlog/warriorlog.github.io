import test from 'node:test';
import assert from 'node:assert/strict';
import * as ev from '../src/events.js';

const ctx = { user: 'cat', dev: 'ab12cd', ts: '2026-09-09T13:02:11.123Z' };

test('makeEvent stamps the envelope and rejects unknown types', () => {
  const e = ev.makeEvent(ev.TYPES.SET, { exercise_id: 'push_up' }, ctx);
  assert.equal(e.v, ev.SCHEMA_VERSION);
  assert.equal(e.day, '2026-09-09');
  assert.equal(e.user, 'cat');
  assert.equal(e.private, false);
  assert.equal(ev.validate(e), null);
  assert.throws(() => ev.makeEvent('nope.nope', {}, ctx), /unknown type/);
});

test('a 00:30 event is stamped with the previous day', () => {
  const e = ev.makeEvent(ev.TYPES.SET, {}, { ...ctx, ts: new Date(2026, 8, 9, 0, 30).toISOString(), day: undefined });
  assert.equal(e.day, '2026-09-08');
});

test('validate catches every malformed envelope', () => {
  const good = ev.makeEvent(ev.TYPES.REST, {}, ctx);
  for (const [patch, why] of [
    [{ id: 'x' }, 'bad id'], [{ ts: 'nope' }, 'bad ts'], [{ day: '9/9/26' }, 'bad day'],
    [{ user: 'dave' }, 'bad user'], [{ dev: '' }, 'bad dev'], [{ v: '1' }, 'bad v'], [{ data: null }, 'bad data'],
  ]) assert.equal(ev.validate({ ...good, ...patch }), why);
});

test('toRemote strips every private field from a public event', () => {
  const e = ev.makeEvent(ev.TYPES.SET, {
    exercise_id: 'goblet_squat', step_id: 'goblet_squat.db12', value: 12,
    rir: 2, pain: 0, rpe_block: 4, vest_lb: 18, note: 'felt heavy',
  }, ctx);
  const out = ev.toRemote(e);
  assert.deepEqual(Object.keys(out.data).sort(), ['exercise_id', 'step_id', 'value']);
  assert.equal(e.data.rir, 2, 'the local event is not mutated');
  const serialized = JSON.stringify(out);
  for (const f of ev.REDACTED_FIELD_NAMES) assert.ok(!serialized.includes(`"${f}"`), `${f} leaked`);
});

test('profile timezone and free text never leave the phone', () => {
  const e = ev.makeEvent(ev.TYPES.PROFILE, { name: 'Cat', tz: 'America/Chicago', usual_time: '06:50', anchor_text: 'after coffee', bodyweight_lb: 128 }, ctx);
  assert.deepEqual(Object.keys(ev.toRemote(e).data), ['name']);
});

test('body metrics are private by default and only sync when opted in', () => {
  const m = ev.makeEvent(ev.TYPES.METRIC, { bodyweight_lb: 128 }, ctx);
  assert.equal(m.private, true);
  assert.equal(ev.isSyncable(m, {}), false);
  assert.equal(ev.isSyncable(m, { syncMetrics: true }), true);
  const quiz = ev.makeEvent(ev.TYPES.QUIZ, { q1: 6 }, ctx);
  assert.equal(ev.isSyncable(quiz, { syncMetrics: true }), false, 'raw quiz answers never sync');
});

test('an event from a newer shell is kept intact, not dropped', () => {
  const future = { ...ev.makeEvent(ev.TYPES.SET, { value: 9 }, ctx), v: ev.SCHEMA_VERSION + 1, type: 'set.logged' };
  assert.equal(ev.isFuture(future), true);
  assert.deepEqual(ev.migrateEvent(future), future);
});
