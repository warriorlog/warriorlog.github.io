import { html, raw } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, go, toast, recompute, render as rerender } from '../app.js';
import { settings as settingsStore } from '../store.js';

export function render(state) {
  const u = me(state);
  const s = state.settings;
  const masked = s.token ? `•••• ${s.token.slice(-4)}` : 'not set';
  return page(topbar(state), html`<div class="stack">
    <div class="card stack">
      <h3>This phone</h3>
      <div class="xpline"><span class="muted">Logging as</span><strong>${u.profile?.name ?? state.me}</strong></div>
      <div class="xpline"><span class="muted">Device</span><span class="faint">${s.dev ?? '—'}</span></div>
      <div class="xpline"><span class="muted">Storage</span><span class="faint">${state.degraded ? 'in memory only' : 'on device'}</span></div>
    </div>
    <div class="card stack">
      <h3>Sync</h3>
      <p class="faint small">A fine-grained token, scoped to this one repository, kept only on this phone. Everything synced is public on GitHub; body weight, how hard a set felt and any pain you flag never leave this device.</p>
      <div class="xpline"><span class="muted">Token</span><span class="faint">${masked}</span></div>
      <input type="password" data-change="token" placeholder="paste token" autocomplete="off">
      <button class="btn secondary" data-action="save-token" data-key="save-token">Save token</button>
      ${s.token ? raw('<button class="btn ghost" data-action="forget" data-key="forget">Forget token</button>') : ''}
      <div class="xpline"><span class="muted">Waiting to sync</span><span>${state.sync.pending}</span></div>
    </div>
    <div class="card stack">
      <h3>Your data</h3>
      <button class="btn ghost" data-action="export" data-key="export">Export everything as JSON</button>
      <p class="faint small">The export includes the private fields that never sync, so it is the only complete backup.</p>
    </div>
    <div class="card stack">
      <h3>How XP works</h3>
      ${raw(Object.entries(state.gam.xp).filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `<div class="xpline"><span class="muted">${k.replace(/_/g, ' ')}</span><strong>${v}</strong></div>`).join(''))}
    </div>
  </div>`, tabbar(state));
}

let pendingToken = '';
export function changed(field, el) { if (field === 'token') pendingToken = el.value.trim(); }

export async function act(action, data, state) {
  if (action === 'nav') return go(data.href);
  if (action === 'save-token') {
    if (!pendingToken) return;
    state.settings = settingsStore.write({ token: pendingToken });
    pendingToken = '';
    toast('Token saved. The first sync will confirm it can write.');
    rerender();
    const sync = await import('../sync.js');
    sync.flush(state);
    return;
  }
  if (action === 'forget') {
    state.settings = settingsStore.write({ token: null });
    toast('Token removed from this phone.');
    rerender();
    return;
  }
  if (action === 'export') {
    const all = await state.store.allEvents();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `warriorlog-${state.me}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
