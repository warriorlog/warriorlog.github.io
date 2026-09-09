// Boot, state, router and the single event dispatcher. Everything the user does
// becomes one appended event; every number on screen is derived from those.
import { openStore, settings as settingsStore, deviceId } from './store.js';
import { makeEvent, validate, TYPES } from './events.js';
import { reduce } from './reduce.js';
import { indexSpec, prescribe } from './engine.js';
import { progress } from './gamify.js';
import { dayKey, newId, html, raw } from './util.js';

import * as setupView from './views/setup.js';
import * as homeView from './views/home.js';
import * as sessionView from './views/session.js';
import * as completeView from './views/complete.js';
import * as journalView from './views/journal.js';
import * as bodyView from './views/body.js';
import * as duoView from './views/duo.js';
import * as bossView from './views/boss.js';
import * as settingsView from './views/settings.js';

const CONFIG = window.WARRIORLOG_CONFIG ?? {};
const root = document.getElementById('app');
const toastHost = document.getElementById('toasts');

export const state = {
  config: CONFIG,
  spec: null, gam: null, copy: null,
  store: null, degraded: false,
  settings: {},
  events: [],
  users: null,
  me: 'sean',
  progress: null,
  plan: null,
  route: { name: 'home', params: {} },
  sheet: null,
  sync: { status: 'idle', pending: 0, error: null },
  updateReady: false,
  dirty: false,
};

const VIEWS = {
  setup: setupView, home: homeView, session: sessionView, complete: completeView,
  journal: journalView, body: bodyView, duo: duoView, boss: bossView, settings: settingsView,
};

// ---------------------------------------------------------------- boot
async function boot() {
  const base = CONFIG.basePath ?? './';
  const [program, gam, copy] = await Promise.all(
    ['program.json', 'gamification.json', 'copy.json'].map(f =>
      fetch(new URL(`../data/${f}`, import.meta.url)).then(r => r.json())));
  state.spec = indexSpec(program);
  state.gam = gam;
  state.copy = copy;

  const { store, degraded } = await openStore();
  state.store = store;
  state.degraded = degraded;
  state.settings = settingsStore.read();
  state.settings.dev = await deviceId(store);
  settingsStore.write({ dev: state.settings.dev });
  state.me = state.settings.user ?? 'sean';

  state.events = await store.allEvents();
  recompute();

  window.addEventListener('hashchange', onRoute);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onVisible);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.controller?.postMessage({ type: 'check-update' }))
      .catch(() => { /* file:// or blocked — the app still works */ });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'update-ready') { state.updateReady = true; showUpdateToast(); }
    });
  }
  navigator.storage?.persist?.().catch(() => {});

  onRoute();
}

/** Re-derive everything from the event log. The only path to new numbers. */
export function recompute() {
  const eq = {};
  const out = reduce(state.events, state.spec, { equipment: eq });
  state.users = out.users;
  const me = state.users[state.me];
  state.progress = progress(me, state.spec, state.gam, dayKey());
  state.plan = me.quizDone ? prescribe(state.spec, me, dayKey(), {}) : null;
}

export const me = () => state.users[state.me];
export const partnerId = () => (state.me === 'sean' ? 'cat' : 'sean');
export const partner = () => state.users[partnerId()];
export const t = (key, vars = {}) => {
  const s = state.copy?.[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
};

// ---------------------------------------------------------------- routing
function parseHash() {
  const h = (location.hash || '#/home').slice(2);
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', params: { id: rest[0] } };
}

function onRoute() {
  state.route = parseHash();
  const meUser = me();
  // Setup is not skippable: without a placement there is nothing to prescribe.
  if (!meUser?.quizDone && state.route.name !== 'setup') { location.hash = '#/setup'; return; }
  state.sheet = null;
  render();
  window.scrollTo(0, 0);
}

export function go(hash) { location.hash = hash; }

export function render() {
  const view = VIEWS[state.route.name] ?? homeView;
  const body = view.render(state);
  root.innerHTML = body.__html ?? String(body);
  view.mounted?.(state);
}

/** Patch one element without re-rendering the screen (timers, counters). */
export function patch(id, content) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = content.__html ?? String(content);
}

// ---------------------------------------------------------------- dispatch
const recentTaps = new Map();

/**
 * Append one event and re-derive. Awaits the durable write BEFORE the UI moves,
 * so a tap that shows as done really is on disk.
 */
export async function dispatch(type, data, opts = {}) {
  const ev = makeEvent(type, data, { user: state.me, dev: state.settings.dev });
  const bad = validate(ev);
  if (bad) { console.warn('refusing to persist a malformed event:', bad, ev); return null; }

  // A set may only ever be attached to one of MY sessions. This is the guard that
  // stops a profile switch mid-session from folding one partner's reps into the
  // other's ladders.
  if (data?.session_id) {
    const mine = me();
    const known = mine.openSession?.session_id === data.session_id
      || mine.sessions.some(s => s.session_id === data.session_id);
    if (!known && type !== TYPES.SESSION_START) {
      console.warn('refusing an event for a session that is not this user\'s'); return null;
    }
  }

  await state.store.putEvents([{ ...ev, part: `${ev.user}/${ev.dev}/${ev.day.slice(0, 7)}`, synced: 0 }]);
  state.events.push(ev);
  recompute();
  if (opts.render !== false) render();
  queueSync();
  return ev;
}

let syncTimer = null;
function queueSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => import('./sync.js').then(m => m.flush(state)).catch(() => {}), 1500);
}

// ---------------------------------------------------------------- interaction
/**
 * One delegated CLICK listener. Not pointerup as well: pointerup fires first and
 * the browser then synthesises a click, which would log two sets from one tap.
 */
async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'nav') { go(el.dataset.href); return; }

  // Idempotency: the same logical tap within half a second is one tap.
  const key = `${action}:${el.dataset.key ?? ''}`;
  const now = Date.now();
  if (now - (recentTaps.get(key) ?? 0) < 500) return;
  recentTaps.set(key, now);

  const view = VIEWS[state.route.name];
  if (!view?.act) return;
  el.setAttribute('aria-disabled', 'true');
  try { await view.act(action, el.dataset, state); }
  finally { el.removeAttribute('aria-disabled'); }
}

function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  VIEWS[state.route.name]?.changed?.(el.dataset.change, el, state);
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  navigator.serviceWorker?.controller?.postMessage({ type: 'check-update' });
  import('./sync.js').then(m => m.pull(state)).catch(() => {});
}

// ---------------------------------------------------------------- toasts
export function toast(message, { action, label, timeout = 4000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html`<div class="grow">${message}</div>`.__html
    + (action ? html`<button class="btn" data-toast-action>${label ?? 'OK'}</button>`.__html : '');
  toastHost.appendChild(el);
  if (action) el.querySelector('[data-toast-action]').addEventListener('click', () => { el.remove(); action(); });
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

function showUpdateToast() {
  toast(t('sync.update_ready'), { label: t('sync.reload'), timeout: 0, action: () => location.reload() });
}

/** A short rest-timer beep, made in code so no audio file and no data: URI. */
let audio = null;
export function beep() {
  try {
    audio ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(); osc.stop(audio.currentTime + 0.36);
  } catch { /* audio is a nicety, never a failure */ }
  navigator.vibrate?.(30);
}

export { html, raw, newId, dayKey };
boot().catch(err => {
  console.error(err);
  root.innerHTML = '<div class="empty">Something went wrong starting up. Pull to refresh, or reopen the app.</div>';
});
