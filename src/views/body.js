// Body and armoury: how full each region is, and what the ten slots still need.
import { html, raw, dayKey, isoWeekKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { silhouette } from './silhouette.js';
import { me, go } from '../app.js';

const MATERIAL = ['Iron', 'Bronze', 'Silver', 'Gold'];
const ZONE2_WEEK_TARGET = 150;      // the AHA line; the head ring closes here

export function render(state) {
  const u = me(state);
  const p = state.progress;
  const g = state.gam;

  const regions = (g.regions ?? []).map(r => {
    const reg = p.regions[r] ?? { xp: 0, level: 0 };
    const lvl = reg.level;
    const div = g.region_level?.divisor ?? 40;
    const floor = div * lvl * lvl, next = div * (lvl + 1) * (lvl + 1);
    const pct = Math.max(3, Math.round(((reg.xp - floor) / (next - floor)) * 100));
    const hue = 220 - Math.min(10, lvl) * 19.5;
    return `<div class="region"><span class="name">${r.replace('_', ' ')}</span>
      <span class="bar"><i style="width:${pct}%;background:hsl(${hue} 70% 52%)"></i></span>
      <span class="lvl">${lvl}</span></div>`;
  }).join('');

  const slots = (g.gear_slots ?? []).map(slot => {
    const tier = p.gear[slot.id]?.tier ?? 0;
    const need = nextRequirement(slot, tier, state);
    return `<div class="xpline"><span>${esc(slot.name)} <span class="faint small">${esc(slot.region.replace('_', ' '))}</span></span>
      <span><span class="pill">${MATERIAL[tier]}</span> <span class="faint small">${esc(need)}</span></span></div>`;
  }).join('');

  const ladders = Object.entries(u.ladders).map(([exId, l]) => {
    const ex = state.spec.byExercise[exId];
    const step = state.spec.byStep[l.step_id];
    if (!ex || !step || ex.no_xp) return '';
    const need = step.advance?.consecutive ?? 2;
    return `<div class="xpline"><span>${esc(ex.name)}<br><span class="faint small">${esc(step.name)}</span></span>
      <span class="small muted">${l.qualifying} of ${need}</span></div>`;
  }).join('');

  const zone2 = Math.round(p.zone2_by_week?.[isoWeekKey(dayKey())] ?? 0);
  const figure = silhouette({
    regions: p.regions,
    gear: p.gear,
    heart: { minutes: zone2, target: ZONE2_WEEK_TARGET, tick: 150 },
    divisor: g.region_level?.divisor ?? 40,
  });

  return page(topbar(state), html`<div class="stack">
    <div class="card stack"><h3>Head to toe</h3>
      ${figure}
      <p class="small faint center">Fill is level, outline is armour. Ring: ${zone2} of ${ZONE2_WEEK_TARGET} Zone-2 min this week.</p>
      <div class="wl-legend">${raw(MATERIAL.map((m, i) =>
        `<span><i data-tier="${i}"></i>${m}</span>`).join(''))}</div>
      <div class="regions">${raw(regions)}</div></div>
    <div class="card stack"><h3>Armoury</h3>
      <p class="faint small">Armour comes only from benchmark tiers and named rungs. XP alone never buys it.</p>
      ${raw(slots)}</div>
    <div class="card stack"><h3>Ladders</h3>${raw(ladders)}</div>
  </div>`, tabbar(state));
}

function nextRequirement(slot, tier, state) {
  if (tier >= 3) return 'complete';
  if (slot.source?.kind === 'benchmark') return `next: ${state.spec.byBenchmark[slot.source.id]?.name ?? slot.source.id}`;
  const stepId = slot.source?.steps?.[tier];
  return stepId ? `next: ${state.spec.byStep[stepId]?.name ?? stepId}` : '';
}
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function act(action, data) { if (action === 'nav') go(data.href); }
