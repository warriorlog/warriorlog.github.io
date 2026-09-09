// The two-player screen. Every number here is a ratio to that person's own
// prescription, so it is never a contest of who is stronger.
import { html, raw, dayKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, partner, go } from '../app.js';
import { duoState } from '../duo.js';

export function render(state) {
  const u = me(state);
  const other = partner(state);
  const name = other?.profile?.name ?? (state.me === 'sean' ? 'Cat' : 'Sean');
  const d = duoState(u, other, state.spec, state.gam, dayKey());

  if (!other?.sessions.length) {
    return page(topbar(state), html`<div class="stack">
      <div class="card stack"><h3>${name} has not logged anything yet</h3>
        <p class="muted small">Once you have both finished a quest, the duo flame, the weekly duel and the co-op boss all light up here.</p></div>
    </div>`, tabbar(state));
  }

  const bar = (label, mine, theirs) => `<div class="stack" style="gap:4px">
    <div class="row-between small"><span class="muted">${label}</span><span>${mine}% · ${theirs}%</span></div>
    <div class="levelbar"><i style="width:${mine}%"></i></div>
    <div class="levelbar"><i style="width:${theirs}%;background:linear-gradient(90deg,#2b5f96,#4a8fd6)"></i></div>
  </div>`;

  return page(topbar(state), html`<div class="stack">
    <div class="card row">
      <div class="avatar partner">${name[0]}</div>
      <div class="grow"><div>${d.partnerTrainedToday ? `${name} trained today` : `${name} has not trained yet today`}</div>
        <div class="tiny">Duo flame ${d.duoFlame}</div></div>
      <span class="flame">🔥 ${d.duoFlame}</span>
    </div>
    <div class="card stack">
      <div class="row-between"><h3>This week</h3><span class="pill">${d.week.status}</span></div>
      <div class="row-between"><strong>${d.week.mine.S}</strong><span class="muted">vs</span><strong>${d.week.theirs.S}</strong></div>
      ${raw(['sessions', 'fidelity', 'zone2', 'progress', 'xp'].map(k =>
        bar(k, d.week.mine.parts[k], d.week.theirs.parts[k])).join('<div style="height:10px"></div>'))}
      <p class="faint small">Every line is what you did against what your own plan asked for. Loads and reps are never compared.</p>
    </div>
  </div>`, tabbar(state));
}
export async function act(action, data) { if (action === 'nav') go(data.href); }
