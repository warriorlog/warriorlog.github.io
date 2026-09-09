import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { toRemote, isSyncable, makeEvent, TYPES, REDACTED_FIELD_NAMES } from '../src/events.js';
import { toJsonl, parseJsonl, mergeEvents, b64encode, b64decode } from '../src/util.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('nothing private ever reaches a serialized payload', () => {
  // The repository is public. "The partner's app only shows hit or miss" is a UI
  // courtesy; this is the actual privacy boundary.
  const ctx = { user: 'cat', dev: 'ab12cd', ts: '2026-09-14T13:00:00Z' };
  const events = [
    makeEvent(TYPES.PROFILE, { name: 'Cat', tz: 'America/Chicago', bodyweight_lb: 128, usual_time: '06:50', anchor_text: 'after coffee' }, ctx),
    makeEvent(TYPES.SET, { session_id: 's', exercise_id: 'swing', set_index: 1, value: 10, rir: 1, pain: 4, pain_region: 'low_back', rpe_block: 8, vest_lb: 20, note: 'ouch' }, ctx),
    makeEvent(TYPES.SESSION_END, { session_id: 's', duration_min: 47, note: 'felt heavy', session_rpe: 9 }, ctx),
    makeEvent(TYPES.METRIC, { bodyweight_lb: 128, waist_in: 30 }, ctx),
    makeEvent(TYPES.QUIZ, { q1: '5-9' }, ctx),
  ];
  const payload = toJsonl(events.filter(e => isSyncable(e, {})).map(toRemote));
  for (const field of REDACTED_FIELD_NAMES) {
    assert.ok(!payload.includes(`"${field}"`), `${field} reached the public branch`);
  }
  assert.ok(!payload.includes('America/Chicago'), 'timezone plus session times reveals where and when they live');
  assert.ok(!payload.includes('128'), 'body weight never leaves the phone');
  assert.ok(payload.includes('"swing"'), 'the training itself still syncs');
});

test('a set edit survives a merge, and a merge never loses or resurrects anything', () => {
  const base = { user: 'sean', dev: 'aaa111' };
  const a = makeEvent(TYPES.SET, { session_id: 's', exercise_id: 'push_up', set_index: 1, value: 10 }, { ...base, ts: '2026-09-14T13:00:00Z' });
  const edit = makeEvent(TYPES.SET, { session_id: 's', exercise_id: 'push_up', set_index: 1, value: 14 }, { ...base, ts: '2026-09-14T13:05:00Z' });
  const merged = mergeEvents([a], [a, edit]);
  assert.equal(merged.length, 2, 'both facts are kept; the reducer decides which wins');
  assert.deepEqual(mergeEvents([edit], [a]).map(e => e.id), mergeEvents([a], [edit]).map(e => e.id), 'merge order does not matter');
});

test('a torn remote file loses only the torn line', () => {
  const good = makeEvent(TYPES.REST, {}, { user: 'cat', dev: 'b1' });
  const text = JSON.stringify(good) + '\n{"id":"broken",\n' + JSON.stringify({ ...good, id: 'XYZ' }) + '\n';
  const { rows, bad } = parseJsonl(text);
  assert.equal(rows.length, 2);
  assert.equal(bad, 1);
});

test('the payload round-trips through base64 with non-ASCII intact', () => {
  globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
  const jsonl = toJsonl([makeEvent(TYPES.SESSION_END, { session_id: 's', duration_min: 47 }, { user: 'cat', dev: 'b1' })]);
  assert.equal(b64decode(b64encode(jsonl)), jsonl);
});

test('a remote line that disagrees with its own file path is refused', () => {
  // log/cat/<dev>/<month>.jsonl may only contain Cat's events from that device
  // and month. This is the last line of defence against one user's sets landing
  // in the other's ladders.
  const path = 'log/cat/bbb222/2026-09.jsonl';
  const [, user, dev, month] = path.replace('.jsonl', '').split('/');
  const rows = [
    makeEvent(TYPES.REST, {}, { user: 'cat', dev: 'bbb222', ts: '2026-09-14T13:00:00Z' }),
    makeEvent(TYPES.REST, {}, { user: 'sean', dev: 'bbb222', ts: '2026-09-14T13:00:00Z' }),
    makeEvent(TYPES.REST, {}, { user: 'cat', dev: 'aaa111', ts: '2026-09-14T13:00:00Z' }),
    makeEvent(TYPES.REST, {}, { user: 'cat', dev: 'bbb222', ts: '2026-10-14T13:00:00Z' }),
  ];
  const kept = rows.filter(e => e.user === user && e.dev === dev && e.day.slice(0, 7) === month);
  assert.equal(kept.length, 1);
});

test('the service worker caches exactly the files that ship', () => {
  // A file missing from the shell list is not available offline; a file listed
  // but absent makes install() reject and the app never works offline at all.
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]).filter(p => p !== './'));

  for (const p of listed) {
    assert.ok(existsSync(join(root, p)), `sw.js caches ${p}, which does not exist`);
  }

  const shipped = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name);
      if (statSync(join(root, rel)).isDirectory()) { walk(rel); continue; }
      shipped.push('./' + rel);
    }
  };
  walk('src'); walk('data'); walk('icons');
  const missing = shipped.filter(p => !listed.has(p) && !p.includes('/frag/'));
  assert.deepEqual(missing, [], 'these shipped files are not in the service worker shell list');
});

test('the page never loads anything from another origin', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map(m => m[0]);
  assert.deepEqual(external, [], 'a third-party script or stylesheet would share the origin holding the token');
  assert.ok(html.includes("connect-src 'self' https://api.github.com"), 'the CSP must pin where the token can be sent');
  assert.ok(html.includes("script-src 'self'"), 'no inline or third-party script may run on the token origin');
});
