import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleTabs } from '../src/views/chrome.js';

const state = ({ me = 'sean', sessions = 0, partner = {}, route = 'home' } = {}) => ({
  me, route: { name: route },
  users: {
    sean: { quizDone: true, sessions: Array.from({ length: me === 'sean' ? sessions : 0 }, () => ({})) },
    cat: { quizDone: false, sessions: [], ...partner },
  },
});
const ids = (s) => visibleTabs(s).map(t => t.id);

test('a solo user sees every screen that has something in it', () => {
  // Body and Journal are useful from the first minute: the silhouette already
  // shows what the placement quiz earned. An earlier version hid them until the
  // first session, which made the app appear to lose features on a reload.
  assert.deepEqual(ids(state()), ['home', 'body', 'journal', 'settings']);
});

test('the tab bar never shrinks as you use the app', () => {
  const before = ids(state({ sessions: 0 }));
  const after = ids(state({ sessions: 12, partner: { quizDone: true } }));
  for (const tab of before) assert.ok(after.includes(tab), `${tab} disappeared once there was more history`);
});

test('the duo tab waits for a partner who has actually joined', () => {
  assert.ok(!ids(state({ sessions: 3 })).includes('duo'), 'no partner, no duo tab');
  assert.ok(ids(state({ sessions: 3, partner: { quizDone: true } })).includes('duo'));
});

test('the screen you are on is always reachable in the bar', () => {
  assert.ok(ids(state({ route: 'boss' })).length >= 2);
  assert.ok(ids(state({ sessions: 0, route: 'journal' })).includes('journal'),
    'deep-linking to a screen must not leave the tab bar without it');
});

test('tabs keep a stable order however they unlock', () => {
  const order = ids(state({ sessions: 5, partner: { quizDone: true } }));
  assert.deepEqual(order, ['home', 'body', 'duo', 'journal', 'settings']);
});
