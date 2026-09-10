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

  const totalXp = Object.values(p.regions ?? {}).reduce((n, r) => n + (r.xp ?? 0), 0);
  const earned = (g.gear_slots ?? []).filter(sl => (p.gear[sl.id]?.tier ?? 0) > 0);

  return page(topbar(state), html`<div class="stack">
    ${explainer(totalXp, earned, zone2)}

    <div class="card stack"><h3>Head to toe</h3>
      ${figure}
      <p class="small faint center">${totalXp > 0
        ? `Colour shows how much work each part has taken. Outlines are armour. The ring around the head is ${zone2} of ${ZONE2_WEEK_TARGET} Zone-2 minutes this week.`
        : `Nothing filled in yet. The ring around the head tracks Zone-2 minutes: ${zone2} of ${ZONE2_WEEK_TARGET} this week.`}</p>
      <div class="wl-legend">${raw(MATERIAL.map((m, i) =>
        `<span><i data-tier="${i}"></i>${m}</span>`).join(''))}</div>
      <div class="regions">${raw(regions)}</div></div>

    <div class="card stack"><h3>Armour</h3>
      <p class="faint small">One piece per body part. It is never bought with XP: each piece is earned by passing a benchmark test or reaching a named rung, so it is always a claim you could prove.</p>
      ${raw(slots)}</div>

    <div class="card stack"><h3>Where every exercise stands</h3>
      <p class="faint small">Your current rung, and how many good sessions are left before the next one.</p>
      ${raw(ladders)}</div>
  </div>`, tabbar(state));
}

/**
 * The screen is meaningless on day one without this. A figure covered in zeros
 * with two unexplained orange outlines tells a new user nothing, and the armour
 * they already have needs a reason attached to it.
 */
function explainer(totalXp, earned, zone2) {
  if (totalXp > 0) return raw('');
  const names = earned.map(sl => `<strong>${esc(sl.name)}</strong> (${esc(sl.region.replace(/_/g, ' '))})`);
  const list = names.length <= 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const already = earned.length
    ? `<p class="small">You are already wearing ${earned.length === 1 ? 'one piece' : `${earned.length} pieces`} of bronze:
        ${list}. Your setup answers showed you can already do the movement each one is earned by,
        so you start with ${earned.length === 1 ? 'it' : 'them'} on.</p>`
    : '';
  return html`<div class="card stack">
    <h3>This is you, before you start</h3>
    <p class="small">The figure fills in as you train. Every set you log colours the part of the body it worked, so after a few weeks you can see at a glance what you have been giving attention to and what you have not.</p>
    ${raw(already)}
    <p class="faint small">Nothing here is a score out of anything. It is a picture of where your work has gone.</p>
  </div>`;
}

/** In plain words, what would put the next piece of this armour on. */
function nextRequirement(slot, tier, state) {
  if (tier >= 3) return 'complete';
  const src = slot.source ?? {};
  if (src.kind === 'benchmark') return `earn it at ${shortBenchmark(state, src.id)}`;
  if (src.kind === 'benchmark_max') {
    const names = (src.ids ?? []).map(id => shortBenchmark(state, id));
    return names.length ? `earn it at ${names.join(' or ')}` : '';
  }
  const stepId = src.steps?.[tier];
  return stepId ? `reach ${state.spec.byStep[stepId]?.name ?? stepId}` : '';
}

const shortBenchmark = (state, id) =>
  (state.spec.byBenchmark[id]?.name ?? id).replace(/^Boss Battle \d+:\s*/, '');
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function act(action, data) { if (action === 'nav') go(data.href); }
