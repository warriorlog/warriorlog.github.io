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

test('day one shows only today and settings', () => {
  assert.deepEqual(ids(state()), ['home', 'settings']);
});

test('the body and the journal appear once there is something in them', () => {
  const after = ids(state({ sessions: 1 }));
  assert.ok(after.includes('body'));
  assert.ok(after.includes('journal'));
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
