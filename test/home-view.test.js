// The home and session screens import app.js, which wants a DOM, so the few
// globals it touches at boot are stubbed before the import; boot() then falls
// over on its own fetch and is caught by app.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexSpec, prescribe } from '../src/engine.js';
import { reduce } from '../src/reduce.js';
import { progress } from '../src/gamify.js';
import { makeEvent, TYPES } from '../src/events.js';

const el = { innerHTML: '', textContent: '', addEventListener() {}, appendChild() {}, removeChild() {}, querySelector: () => null, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {} } };
globalThis.window ??= { WARRIORLOG_CONFIG: {}, addEventListener() {}, matchMedia: () => ({ matches: false }), scrollTo() {} };
globalThis.document ??= { getElementById: () => el, addEventListener() {}, createElement: () => el, querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible' };
globalThis.location ??= { hash: '#/home' };
globalThis.navigator ??= { userAgent: 'node' };
const realError = console.error;
// app.js boots on import and its fetch cannot succeed under node; that one
// rejection is expected noise, everything else must still be heard.
console.error = (...args) => { if (!String(args[0]?.message ?? args[0]).includes('fetch failed')) realError(...args); };
const app = await import('../src/app.js');
const H = await import('../src/views/home.js');
const S = await import('../src/views/session.js');
const { xpTable, XP_LABELS } = await import('../src/views/settings.js');
const { programStartFor } = await import('../src/views/setup.js');

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const copy = JSON.parse(readFileSync(new URL('../data/copy.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);
const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10, vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5,
  chair_height_in: 18, couch_edge: true, kb: [53], dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};
const CAT = { push_up: 'push_up.wall', goblet_squat: 'goblet_squat.chair', hinge_deadlift: 'hinge_deadlift.wall_drill', swing: 'swing.hike_park_20' };

function userWith(user, floor, extraEvents = []) {
  const ev = (type, data, ts) => makeEvent(type, data, { user, dev: 'd1', ts });
  const events = [
    ev(TYPES.PROFILE, { name: user, program_start: '2026-09-14', rest_dow: 0, session_minutes: 50, bodyweight_lb: 128 }, '2026-09-13T18:00:00Z'),
    ev(TYPES.EQUIPMENT, EQ, '2026-09-13T18:00:01Z'),
    ev(TYPES.ASSESSMENT, { start_steps: floor }, '2026-09-13T18:00:02Z'),
    ...extraEvents,
  ];
  const { users } = reduce(events, spec, { equipment: EQ });
  for (const [id, u] of Object.entries(users)) u.id = id;
  return users;
}

function stateFor(users, me, plan, route = { name: 'home', params: {} }) {
  const mine = users[me];
  Object.assign(app.state, {
    spec, gam, copy, users, me, plan, route,
    progress: progress(mine, spec, gam, plan?.day ?? '2026-09-14'), partnerProgress: null,
    sync: { pending: 0, error: null }, settings: {}, presence: {},
  });
  return app.state;
}

test('the quest card says what runs in place of a locked movement, and why', () => {
  const users = userWith('cat', CAT);
  const thu = prescribe(spec, users.cat, '2026-09-17', { equipment: EQ });
  const out = String(H.render(stateFor(users, 'cat', thu)));
  assert.ok(out.includes('Swing is not open yet'), `the locked swing is named: ${out.slice(0, 200)}`);
  assert.ok(out.includes('runs in its place'));
  assert.ok(out.includes('Hinge and deadlift at'), 'the gate that opens it is spelled out');
  assert.ok(out.includes('Building up'), 'week 1 is on the ramp, and the pill says so');
  assert.ok(out.includes('Stop every set with 4 reps still in you'), 'reps in reserve are plain words');
});

test('the frozen plan carries the prefill and the rest, so one tap means "match last time"', () => {
  const row = { exercise_id: 'push_up', step_id: 'push_up.wall', set_index: 1, side: null, part: null, unit: 'reps', A: 10, B: 15, target: 14, last: 14, rest_sec: 75, minutes: undefined, prescribed: true };
  const s = H.slim(row);
  assert.equal(s.target, 14);
  assert.equal(s.last, 14);
  assert.equal(s.rest_sec, 75);
  assert.equal(H.slim({ ...row, target: 10, last: null }).target, undefined, 'a fresh step carries no prefill beyond A');
});

test('the session screen shows last time\'s number as the one to beat', () => {
  const users = userWith('cat', CAT);
  const plan = prescribe(spec, users.cat, '2026-09-15', { equipment: EQ });
  const rows = plan.rows.map(r => ({ ...H.slim(r), target: 9, last: 9 }));
  const started = makeEvent(TYPES.SESSION_START, { session_id: 'x', template_id: plan.template_id, type: 'full', date: '2026-09-15', plan: { rows } }, { user: 'cat', dev: 'd1', ts: '2026-09-15T13:00:00Z' });
  const withOpen = userWith('cat', CAT, [started]);
  const out = String(S.render(stateFor(withOpen, 'cat', plan, { name: 'session', params: { id: 'x' } })));
  assert.ok(out.includes('last 9'), 'the row shows what was done here last time');
  assert.ok(out.includes('>9<') || out.includes('<span>9</span>'), 'and prefills it');
  assert.ok(out.includes('Tick anything you did not hit on the set you are about to log') || !out.includes('checklist'), 'the checklist says which set it describes');
});

test('the partner card carries the live week and a readable staleness', () => {
  assert.equal(H.staleLabel(3), 'as of 3 hours ago');
  assert.equal(H.staleLabel(1), 'as of 1 hour ago');
  assert.equal(H.staleLabel(91), 'as of 4 days ago');
  assert.equal(H.staleLabel(null), null);
});

test('setting up on a Monday starts week 1 today, any other day the next Monday', () => {
  assert.equal(programStartFor(new Date(2026, 8, 14, 9)), '2026-09-14');
  assert.equal(programStartFor(new Date(2026, 8, 16, 9)), '2026-09-21');
  assert.equal(programStartFor(new Date(2026, 8, 13, 9)), '2026-09-14');
});

test('the XP table on the settings screen lists only what is paid, in words', () => {
  const html = xpTable(gam);
  for (const k of Object.keys(gam.xp)) {
    if (typeof gam.xp[k] !== 'number') continue;
    assert.ok(XP_LABELS[k] || /_pct$/.test(k) || k === 'pledge_kept' || k === 'alliance_crown',
      `${k} has no label; either pay it and label it, or leave it out of the table`);
  }
  assert.ok(!/[a-z]_[a-z]/.test(html.replace(/class="[^"]*"/g, '')), 'no raw key reaches the screen');
  assert.ok(html.includes('Rest-day walk'));
  assert.ok(html.includes('Flame reaches 7 days'));
});
