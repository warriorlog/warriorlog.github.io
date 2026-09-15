// Shared page furniture: the top bar and the tab bar.
import { html, raw } from '../util.js';

const TABS = [
  { id: 'home', glyph: '⚔', label: 'Today' },
  { id: 'body', glyph: '🛡', label: 'Body' },
  { id: 'duo', glyph: '🔥', label: 'Duo' },
  { id: 'journal', glyph: '📜', label: 'Journal' },
  { id: 'settings', glyph: '⚙', label: 'Settings' },
];

/**
 * Which tabs to show. Only Duo is held back, because it is the one screen with
 * genuinely nothing in it until a second person joins. Body and Journal are
 * useful from the first minute — the silhouette already shows what the placement
 * quiz earned, and the journal explains the week ahead.
 *
 * An earlier version also hid those two until the first session. It made the app
 * appear to lose features on a reload, which is a far worse first impression
 * than one extra tab.
 */
export function visibleTabs(state) {
  const partner = state.users?.[state.me === 'sean' ? 'cat' : 'sean'];
  const partnerActive = !!(partner?.quizDone || partner?.sessions?.length);

  const on = new Set(['home', 'body', 'journal', 'settings']);
  if (partnerActive) on.add('duo');
  on.add(state.route?.name === 'complete' ? 'home' : state.route?.name);
  return TABS.filter(t => on.has(t.id));
}

export function tabbar(state) {
  const items = visibleTabs(state).map(tb => {
    const current = state.route.name === tb.id ? ' aria-current="page"' : '';
    return `<a href="#/${tb.id}" data-action="nav" data-href="#/${tb.id}"${current}>
      <span class="glyph">${tb.glyph}</span><span>${tb.label}</span></a>`;
  }).join('');
  return raw(`<nav class="tabbar">${items}</nav>`);
}

/** The sync dot's state. No token means nothing is syncing, and the dot says so. */
export function syncState(state) {
  if (!state.settings?.token) return 'idle';
  if (state.sync?.pending) return 'pending';
  if (state.sync?.error) return 'error';
  return 'synced';
}

const SYNC_TITLE = { idle: 'Sync is not set up on this phone', pending: 'Waiting to sync', error: 'Sync ran into a problem — see Settings', synced: 'Synced' };

export function topbar(state, { title = null } = {}) {
  const p = state.progress;
  const lvl = p.level;
  const flame = p.flame;
  const initial = (state.users[state.me].profile?.name ?? state.me)[0].toUpperCase();
  const pct = Math.round(lvl.pct * 100);
  const sync = syncState(state);
  return html`<header class="topbar">
    <div class="identity grow">
      <div class="avatar">${initial}</div>
      <div class="grow">
        <div class="row-between">
          <strong>${title ?? `Level ${lvl.level} · ${lvl.title}`}</strong>
          <span class="flame" data-state="${flame.state}" title="${flame.state === 'ember' ? 'Ember: two quests this week relight it' : 'Flame: days in a row kept'}">🔥 ${flame.state === 'ember' ? flame.ember_count : flame.count}</span>
        </div>
        <div class="levelbar">${raw(`<i style="width:${pct}%"></i>`)}</div>
        <div class="tiny topbar-xp">${lvl.into.toLocaleString()} of ${lvl.need.toLocaleString()} XP to level ${lvl.level + 1}</div>
      </div>
    </div>
    <span class="syncdot" data-state="${sync}" title="${SYNC_TITLE[sync]}"></span>
  </header>`;
}

export const page = (...parts) => raw(parts.map(p => p?.__html ?? p ?? '').join(''));
