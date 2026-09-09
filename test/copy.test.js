import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copy = JSON.parse(readFileSync(join(root, 'data', 'copy.json'), 'utf8'));

// The tone rule from the design: nothing in this app tells you that you failed.
// A held streak reads "held", a quiet week reads "still to come".
const BANNED = ['lost', 'lose', 'loser', 'failed', 'fail', 'failure', 'missed', 'behind', 'lazy'];
const pattern = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

test('no user-facing string tells someone they failed', () => {
  const offenders = [];
  const walk = (obj, path = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const at = path ? `${path}.${k}` : k;
      if (typeof v === 'string') { if (pattern.test(v)) offenders.push(`${at}: "${v}"`); }
      else if (v && typeof v === 'object') walk(v, at);
    }
  };
  walk(copy);
  assert.deepEqual(offenders, [], 'these strings use language the design rules out');
});

test('the views do not smuggle banned language past the copy file', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name);
      if (statSync(join(root, rel)).isDirectory()) { walk(rel); continue; }
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(join(root, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');            // comments may say anything
        for (const m of code.matchAll(/[`'"]([^`'"]{8,})[`'"]/g)) {
          const text = m[1];
          if (!/[a-z]\s[a-z]/i.test(text)) continue;          // identifiers and ids, not prose
          if (/^[\w.\-/#?=&${}]+$/.test(text)) continue;
          if (pattern.test(text)) offenders.push(`${rel}:${i + 1}  "${text.trim()}"`);
        }
      });
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'these strings use language the design rules out');
});

test('every string the copy file holds is actually a string', () => {
  const bad = [];
  const walk = (obj, path = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const at = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v, at);
      else if (typeof v !== 'string') bad.push(at);
    }
  };
  walk(copy);
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(copy).length > 10, 'the copy file should not be near-empty');
});
