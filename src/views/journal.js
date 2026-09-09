// The record: the week strip, every session, and the personal-record board.
import { html, raw, dayKey, addDays, weekStart } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, go } from '../app.js';

export function render(state) {
  const u = me(state);
  const p = state.progress;
  const statuses = p.flame.statuses;
  const start = weekStart(dayKey());
  const strip = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map(d => {
    const st = statuses.get(d) ?? 'none';
    return `<span data-status="${st}" title="${d}">${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d + 'T12:00').getDay()]}</span>`;
  }).join('');

  const sessions = [...u.sessions].reverse().slice(0, 40).map(s => {
    const g = p.sessions.find(x => x.session_id === s.session_id);
    return `<div class="xpline"><span>${s.day} · <span class="muted">${esc(state.spec.byTemplate[s.template_id]?.name ?? s.template_id)}</span></span>
      <span>${g ? `+${g.xp}` : ''} <span class="faint small">${s.duration_min ?? '—'}m</span></span></div>`;
  }).join('');

  const badges = p.badges.filter(b => b.earned);
  return page(topbar(state), html`<div class="stack">
    <div class="card stack">
      <div class="row-between"><h3>This week</h3><span class="tiny">flame ${p.flame.count}</span></div>
      <div class="week">${raw(strip)}</div>
    </div>
    <div class="card stack">
      <div class="row-between"><h3>Badges</h3><span class="tiny">${badges.length} of ${p.badges.length}</span></div>
      ${badges.length ? raw(`<div class="chips">${badges.map(b => `<span class="chip" aria-pressed="true">${esc(b.name)}</span>`).join('')}</div>`)
        : raw('<p class="faint small">Your first badge lands after your first quest.</p>')}
    </div>
    <div class="card stack">
      <h3>Sessions</h3>
      ${sessions ? raw(sessions) : raw('<p class="faint small">Nothing logged yet.</p>')}
    </div>
  </div>`, tabbar(state));
}
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function act(action, data) { if (action === 'nav') go(data.href); }
