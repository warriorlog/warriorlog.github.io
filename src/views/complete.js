// The peak-end moment: what today actually bought, in the order that matters.
import { html, raw } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, go, t } from '../app.js';
import { xpForSession, fidelity } from '../gamify.js';

const LABELS = {
  sets: 'Sets', quest: 'Quest complete', zone2: 'Zone-2 minutes', cardio: 'Cardio',
  intervals: 'Intervals', records: 'Personal records', climbs: 'Ladder climbs',
  armour: 'Armour', setup: 'Setup',
};

export function render(state) {
  const u = me(state);
  const id = state.route.params.id;
  const s = u.sessions.find(x => x.session_id === id) ?? u.sessions[u.sessions.length - 1];
  if (!s) return page(html`<div class="empty">Nothing logged yet.</div>`, tabbar(state));

  const gained = state.progress.sessions.find(x => x.session_id === s.session_id)
    ?? { xp: 0, by_source: {}, prs: [], fidelity: fidelity(s, state.spec) };
  const climbs = u.climbs.filter(c => c.day === s.day);
  const f = gained.fidelity;

  return page(topbar(state), html`<div class="stack">
    <div class="card center stack">
      <div class="tiny">Quest complete</div>
      <div class="bigxp">+${gained.xp.toLocaleString()} XP</div>
      <div class="muted small">${s.duration_min ?? '—'} min · ${f.hit} of ${f.prescribed} targets</div>
    </div>

    ${climbs.length ? raw(`<div class="card stack">
      <div class="tiny">Ladder up</div>
      ${climbs.map(c => `<div class="row-between"><strong>${esc(state.spec.byExercise[c.exercise_id]?.name ?? c.exercise_id)}</strong>
        <span class="pill go">${esc(c.name)}</span></div>`).join('')}
    </div>`) : ''}

    ${gained.prs?.length ? raw(`<div class="card stack">
      <div class="tiny">New record</div>
      ${gained.prs.map(p => `<div class="row-between"><span>${esc(state.spec.byExercise[p.exercise_id]?.name ?? p.exercise_id)}</span>
        <strong class="xpfloat">${p.value}${p.previous != null ? ` (was ${p.previous})` : ''}</strong></div>`).join('')}
    </div>`) : ''}

    <div class="card stack">
      <div class="tiny">Where it came from</div>
      ${raw(Object.entries(gained.by_source).map(([k, v]) =>
        `<div class="xpline"><span class="muted">${esc(LABELS[k] ?? k)}</span><strong>+${v}</strong></div>`).join(''))}
    </div>

    ${partnerPreview(state, s, f)}
    <button class="btn" data-action="nav" data-href="#/home">Done</button>
  </div>`, tabbar(state));
}

function partnerPreview(state, s, f) {
  const name = state.me === 'sean' ? 'Cat' : 'Sean';
  return html`<div class="card card-tight stack">
    <div class="tiny">${name} will see</div>
    <div class="small muted">${state.spec.byTemplate[s.template_id]?.name ?? s.template_id} · ${s.duration_min ?? '—'} min · ${Math.round(f.pct * 100)}% of targets</div>
    <div class="faint small">Your reps, loads, notes and how it felt stay on this phone.</div>
  </div>`;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function act(action, data) { if (action === 'nav') go(data.href); }
