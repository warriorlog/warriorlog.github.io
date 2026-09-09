// Shared page furniture: the top bar and the tab bar.
import { html, raw } from '../util.js';

const TABS = [
  { id: 'home', glyph: '⚔', label: 'Today' },
  { id: 'body', glyph: '🛡', label: 'Body' },
  { id: 'duo', glyph: '🔥', label: 'Duo' },
  { id: 'journal', glyph: '📜', label: 'Journal' },
  { id: 'settings', glyph: '⚙', label: 'Settings' },
];

export function tabbar(state) {
  const items = TABS.map(tb => {
    const current = state.route.name === tb.id ? ' aria-current="page"' : '';
    return `<a href="#/${tb.id}" data-action="nav" data-href="#/${tb.id}"${current}>
      <span class="glyph">${tb.glyph}</span><span>${tb.label}</span></a>`;
  }).join('');
  return raw(`<nav class="tabbar">${items}</nav>`);
}

export function topbar(state, { title = null } = {}) {
  const p = state.progress;
  const lvl = p.level;
  const flame = p.flame;
  const initial = (state.users[state.me].profile?.name ?? state.me)[0].toUpperCase();
  const pct = Math.round(lvl.pct * 100);
  return html`<header class="topbar">
    <div class="identity grow">
      <div class="avatar">${initial}</div>
      <div class="grow">
        <div class="row-between">
          <strong>${title ?? `Level ${lvl.level} · ${lvl.title}`}</strong>
          <span class="flame" data-state="${flame.state}">🔥 ${flame.state === 'ember' ? flame.ember_count : flame.count}</span>
        </div>
        <div class="levelbar">${raw(`<i style="width:${pct}%"></i>`)}</div>
      </div>
    </div>
    <span class="syncdot" data-state="${state.sync.pending ? 'pending' : state.sync.error ? 'error' : 'synced'}" title="sync"></span>
  </header>`;
}

export const page = (...parts) => raw(parts.map(p => p?.__html ?? p ?? '').join(''));
