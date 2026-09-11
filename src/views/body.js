// Body and armoury: how full each region is, and what the ten slots still need.
import { html, raw, dayKey, isoWeekKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { silhouette } from './silhouette.js';
import { me, go, t } from '../app.js';
import { ladderStanding } from '../engine.js';

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

  // Two lines per piece: what you wear now, then the one thing that upgrades it.
  // The tier you wear and the tier you are working towards are both named, so
  // the pill can never be misread as the goal.
  const slots = (g.gear_slots ?? []).map(slot => {
    const tier = p.gear[slot.id]?.tier ?? 0;
    const pips = MATERIAL.map((_, i) => `<i data-tier="${i}"${i <= tier ? ' class="on"' : ''}></i>`).join('');
    return `<div class="gear-row">
      <div class="gear-head">
        <div><div class="gear-name">${esc(slot.name)}</div><div class="tiny">${esc(slot.region.replace(/_/g, ' '))}</div></div>
        <div class="gear-tier" data-tier="${tier}"><span class="gear-pips">${pips}</span>${MATERIAL[tier]}</div>
      </div>
      <div class="gear-next small">${nextLine(slot, tier, state)}</div>
    </div>`;
  }).join('');

  const ladders = ladderStanding(state.spec, u.ladders).map(r =>
    `<div class="xpline"><span>${esc(r.name)}<br><span class="faint small">${esc(r.step_name)}</span></span>
      <span class="small muted">${r.locked ? esc(t('body.ladders.locked')) : r.top ? esc(t('body.ladders.top')) : `${r.qualifying} of ${r.need}`}</span></div>`).join('');

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
      <p class="faint small">${t('body.armour.intro')}</p>
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

/** In plain words, the next tier of this piece and the one thing that earns it. Returns HTML. */
function nextLine(slot, tier, state) {
  if (tier >= MATERIAL.length - 1) return esc(t('body.armour.top'));
  const src = slot.source ?? {};
  let how = '';
  if (src.kind === 'benchmark') how = t('body.armour.test', { name: shortBenchmark(state, src.id) });
  else if (src.kind === 'benchmark_max') {
    const names = (src.ids ?? []).map(id => shortBenchmark(state, id));
    if (names.length) how = t('body.armour.test', { name: names.join(' or ') });
  } else {
    const stepId = src.steps?.[tier];
    if (stepId) how = t('body.armour.rung', { name: state.spec.byStep[stepId]?.name ?? stepId });
  }
  if (!how) return '';
  return `<span class="faint">${esc(t('body.armour.next'))}</span> <span class="gear-to" data-tier="${tier + 1}">${MATERIAL[tier + 1]}</span>`
    + ` <span class="faint">·</span> ${esc(how)}`;
}

const shortBenchmark = (state, id) =>
  (state.spec.byBenchmark[id]?.name ?? id).replace(/^Boss Battle \d+:\s*/, '');
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function act(action, data) { if (action === 'nav') go(data.href); }
