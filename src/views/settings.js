// Settings: identity, the sync token, recovery and travel, body metrics that
// never leave the phone, and every recovery path when something goes wrong.
import { html, raw, dayKey, addDays } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, go, toast, recompute, render as rerender, dispatch } from '../app.js';
import { settings as settingsStore } from '../store.js';
import { TYPES } from '../events.js';

export function render(state) {
  const u = me(state);
  const s = state.settings;
  const masked = s.token ? `•••• ${s.token.slice(-4)}` : 'not set';
  const mode = activeMode(u);
  const metrics = [...(u.metrics ?? [])].reverse();

  return page(topbar(state), html`<div class="stack">
    <div class="card stack">
      <h3>This phone</h3>
      <div class="xpline"><span class="muted">Logging as</span><strong>${u.profile?.name ?? state.me}</strong></div>
      <div class="xpline"><span class="muted">Program starts</span><span>${u.profile?.program_start ?? '—'}</span></div>
      <div class="xpline"><span class="muted">Session length</span>
        <span class="chips">${raw([40, 45, 50].map(m =>
          `<button class="chip" data-action="minutes" data-key="min-${m}" data-v="${m}" aria-pressed="${(u.profile?.session_minutes ?? 50) === m}">${m} min</button>`).join(''))}</span></div>
      <div class="xpline"><span class="muted">Storage</span><span class="faint">${state.degraded ? 'in memory only' : 'on this device'}</span></div>
    </div>

    <div class="card stack">
      <h3>${mode ? modeLabel(mode) : 'Recovery and travel'}</h3>
      ${mode
        ? raw(`<p class="muted small">Your flame is paused and the week is a no-contest. Nothing is being taken away.</p>
               <button class="btn secondary" data-action="end-mode" data-key="end-mode">I am back</button>`)
        : raw(`<p class="muted small">Ill, hurt or away? Pause instead of pushing through. Your flame holds and the week stops being scored.</p>
               <div class="chips">
                 <button class="chip" data-action="mode" data-key="m-recovery" data-kind="recovery">Recovering</button>
                 <button class="chip" data-action="mode" data-key="m-away" data-kind="away">Travelling</button>
               </div>`)}
    </div>

    <div class="card stack">
      <h3>Body</h3>
      <p class="faint small">Kept on this phone only. Used to size the vest and pick your goblet test load. It is never synced and your partner never sees it.</p>
      <div class="row">
        <input class="grow" type="number" inputmode="decimal" data-change="weight" placeholder="body weight (lb)">
        <button class="btn secondary" style="width:auto;padding:0 16px" data-action="log-weight" data-key="log-weight">Log</button>
      </div>
      ${metrics.length ? raw(`<div class="xpline"><span class="muted">Latest</span><strong>${metrics[0].bodyweight_lb ?? '—'} lb <span class="faint small">${metrics[0].day}</span></strong></div>`) : ''}
    </div>

    <div class="card stack">
      <h3>Sync</h3>
      <p class="faint small">A fine-grained token, scoped to one repository, kept only on this phone. Everything synced is public on GitHub. Body weight, how hard a set felt, any pain you flag, your notes and your quiz answers never leave this device.</p>
      <div class="xpline"><span class="muted">Token</span><span class="faint">${masked}</span></div>
      <div class="xpline"><span class="muted">Waiting to sync</span><span>${state.sync.pending}</span></div>
      ${state.sync.error ? raw(`<p class="small" style="color:#e5766b">${esc(state.sync.error)}</p>`) : ''}
      <input type="password" data-change="token" placeholder="paste token" autocomplete="off">
      <button class="btn secondary" data-action="save-token" data-key="save-token">Save token</button>
      ${s.token ? raw(`<button class="btn ghost" data-action="sync-now" data-key="sync-now">Sync now</button>
                       <button class="btn ghost" data-action="forget" data-key="forget">Forget token</button>`) : ''}
    </div>

    <div class="card stack">
      <h3>If something goes wrong</h3>
      <button class="btn ghost" data-action="export" data-key="export">Export everything as JSON</button>
      <p class="faint small">The only complete backup: it includes the private fields that never sync.</p>
      <button class="btn ghost" data-action="import" data-key="import">Import a backup</button>
      <button class="btn ghost" data-action="pull-all" data-key="pull-all">Pull everything from GitHub</button>
      <p class="faint small">Rebuilds this phone from the public branch. Safe to run any time; nothing is overwritten.</p>
      <button class="btn ghost" data-action="rebuild" data-key="rebuild">Rebuild from the log</button>
      <p class="faint small">Recomputes every total from your events. A no-op unless something had drifted.</p>
    </div>

    <div class="card stack">
      <h3>How XP works</h3>
      <p class="faint small">Every number in the app comes from this table. A set pays the same whatever the load, which is what keeps the weekly duel fair.</p>
      ${raw(Object.entries(state.gam.xp).filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `<div class="xpline"><span class="muted">${esc(k.replace(/_/g, ' '))}</span><strong>${v}</strong></div>`).join(''))}
    </div>
  </div>`, tabbar(state));
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const activeMode = (u) => (u.modes ?? []).find(m => !m.closed && (!m.to || m.to >= dayKey()));
const modeLabel = (m) => (m.kind === 'away' ? 'Travelling' : 'Recovering');

let pendingToken = '';
let pendingWeight = null;

export function changed(field, el) {
  if (field === 'token') pendingToken = el.value.trim();
  if (field === 'weight') pendingWeight = Number(el.value) || null;
}

export async function act(action, data, state) {
  const u = me(state);
  switch (action) {
    case 'nav': return go(data.href);

    case 'minutes':
      await dispatch(TYPES.PROFILE, { session_minutes: Number(data.v) });
      return;

    case 'mode':
      await dispatch(TYPES.MODE_START, { kind: data.kind, start: dayKey(), end: addDays(dayKey(), 7) });
      toast(data.kind === 'away' ? 'Travel mode on. Your flame is holding.' : 'Recovery mode on. Rest properly.');
      return;

    case 'end-mode': {
      const m = activeMode(u);
      if (m) await dispatch(TYPES.MODE_END, { kind: m.kind, end: dayKey() });
      toast('Welcome back.');
      return;
    }

    case 'log-weight':
      if (!pendingWeight) return;
      await dispatch(TYPES.METRIC, { bodyweight_lb: pendingWeight });
      await dispatch(TYPES.PROFILE, { bodyweight_lb: pendingWeight });
      pendingWeight = null;
      toast('Logged on this phone only.');
      return;

    case 'save-token': {
      if (!pendingToken) return;
      state.settings = settingsStore.write({ token: pendingToken, tokenState: 'unknown' });
      pendingToken = '';
      rerender();
      const sync = await import('../sync.js');
      await sync.flush(state);
      toast(state.sync.error ? state.sync.error : 'Token saved and the first push went through.');
      rerender();
      return;
    }

    case 'sync-now': {
      const sync = await import('../sync.js');
      await sync.flush(state);
      await sync.pull(state);
      toast(state.sync.error ?? 'Up to date.');
      rerender();
      return;
    }

    case 'forget':
      state.settings = settingsStore.write({ token: null });
      toast('Token removed from this phone.');
      rerender();
      return;

    case 'pull-all': {
      const sync = await import('../sync.js');
      toast('Pulling everything…');
      await sync.pullAll(state);
      state.events = await state.store.allEvents();
      recompute();
      rerender();
      toast(`${state.events.length} events on this phone.`);
      return;
    }

    case 'rebuild': {
      state.events = await state.store.allEvents();
      recompute();
      rerender();
      toast('Rebuilt from your log.');
      return;
    }

    case 'export': {
      const all = await state.store.allEvents();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `warriorlog-${state.me}-${dayKey()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return;
    }

    case 'import': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const rows = JSON.parse(await file.text());
          if (!Array.isArray(rows)) throw new Error('not a Warriorlog export');
          const have = new Set(state.events.map(e => e.id));
          const fresh = rows.filter(e => e?.id && !have.has(e.id))
            .map(e => ({ ...e, part: `${e.user}/${e.dev}/${String(e.day).slice(0, 7)}`, synced: 0 }));
          if (fresh.length) await state.store.putEvents(fresh);
          state.events = await state.store.allEvents();
          recompute();
          rerender();
          toast(`Imported ${fresh.length} events.`);
        } catch (err) {
          toast(`That file could not be read: ${err.message}`);
        }
      });
      input.click();
    }
  }
}
