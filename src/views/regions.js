// The "Head to toe" bars, drawn the same way on the home screen and the body
// screen. One body part per row: its all-time level, and a bar showing how far
// it sits towards the next level. The card explains its own units, because a
// bar with a bare number beside it left both readers asking whether it was this
// week's work or all of it, and whether it ever reset.
import { html, raw, esc } from '../util.js';
import { regionBar } from '../gamify.js';

const LABEL = {
  heart: 'Heart', neck_traps: 'Neck & traps', shoulders: 'Shoulders', chest: 'Chest', arms: 'Arms',
  back: 'Back', core: 'Core', glutes: 'Glutes & hips', thighs: 'Thighs', calves: 'Calves',
};

export const regionLabel = (id) => LABEL[id] ?? String(id).replace(/_/g, ' ');

/** Hue for a region level: cold blue at zero, ember at ten and above. */
export const regionHue = (level) => 220 - Math.min(10, Math.max(0, level)) * 19.5;

/** One row per region. Returns an HTML string. */
export function regionRows(regions, g) {
  return (g.regions ?? []).map(r => {
    const bar = regionBar(regions?.[r] ?? { xp: 0, level: 0 }, g);
    const title = `${regionLabel(r)}: level ${bar.level}, ${bar.xp.toLocaleString()} XP all time · ${bar.to_next.toLocaleString()} more to level ${bar.level + 1}`;
    return `<div class="region" title="${esc(title)}">
      <span class="name">${esc(regionLabel(r))}</span>
      <span class="bar" role="img" aria-label="${esc(title)}"><i style="width:${bar.pct}%;background:hsl(${regionHue(bar.level)} 70% 52%)"></i></span>
      <span class="lvl">Lv ${bar.level}</span>
    </div>`;
  }).join('');
}

/**
 * The whole card. `t` is the app's copy lookup; the two sentences under the
 * title are the answer to "what is this bar?", so they are never omitted.
 */
export function regionsCard(state, p, { heading = 'Head to toe' } = {}) {
  const g = state.gam;
  const copy = (k, fallback) => state.copy?.[k] ?? fallback;
  const total = Object.values(p.regions ?? {}).reduce((n, r) => n + (r.xp ?? 0), 0);
  return html`<div class="card stack regions-card">
    <div class="row-between"><h3>${heading}</h3><span class="tiny">${copy('regions.scope', 'all time')}</span></div>
    <p class="small muted">${copy('regions.body', 'Every set you log colours the body part it works. Each part has its own level; the bar is how close it is to the next one.')}</p>
    <div class="regions">${raw(regionRows(p.regions, g))}</div>
    <p class="faint small">${total > 0
      ? copy('regions.note', 'Counted over everything you have ever logged, not just this week. When a bar fills, that part goes up a level and the bar starts again from empty.')
      : copy('regions.empty', 'Nothing counted yet. Your first set colours the parts it works, and each part goes up a level as its bar fills.')}</p>
  </div>`;
}
