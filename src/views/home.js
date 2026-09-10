// Home: what am I doing today, what is at stake, how is the partner doing.
import { html, raw, dayKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { dispatch, go, me, partner, t, newId } from '../app.js';
import { skirmishPlan } from '../engine.js';
import { stakeLines } from '../stakes.js';
import { TYPES } from '../events.js';
import { regionLevel } from '../gamify.js';

export function render(state) {
  const u = me(state);
  const p = state.progress;
  const plan = state.plan;
  const open = u.openSession;

  return page(topbar(state), html`<div class="stack">
    ${open ? resume(open) : plan?.rest ? restCard(state, plan) : questCard(state, plan, p)}
    ${stakes(state, plan, p)}
    ${partnerCard(state)}
    ${regions(state, p)}
  </div>`, tabbar(state));
}

function resume(open) {
  return html`<div class="card quest stack">
    <div class="kicker"><span class="pill hot">In progress</span></div>
    <h1>Pick up where you left off</h1>
    <p class="muted small">${open.sets.length} sets already logged.</p>
    <button class="btn" data-action="resume" data-key="resume">Back to the quest</button>
  </div>`;
}

function restCard(state, plan) {
  return html`<div class="card quest stack">
    <div class="kicker"><span class="pill cool">Rest day</span>${plan.off ? raw('<span class="pill">Taper</span>') : ''}</div>
    <h1>Rest is part of the plan</h1>
    <p class="muted small">Your flame keeps burning today. An easy 20-minute walk is optional and adds Zone-2 minutes.</p>
    <button class="btn secondary" data-action="kindle" data-key="kindle">Log an easy walk</button>
  </div>`;
}

function questCard(state, plan, p) {
  if (!plan) return html`<div class="card"><p>Finish setup to see today's quest.</p></div>`;
  const phase = state.spec.phases.find(x => x.id === plan.phase_id);
  const strength = plan.blocks.filter(b => b.kind.startsWith('strength')).flatMap(b => b.items);
  const headline = strength[0]?.name ?? plan.name;
  return html`<div class="card quest stack">
    <div class="kicker">
      <span class="pill hot">Week ${plan.week === 0 ? 'Muster' : plan.week}</span>
      <span class="pill">${plan.name}</span>
      ${plan.onRamp ? raw('<span class="pill cool">Building up</span>')
        : plan.deload ? raw('<span class="pill cool">Recovery week</span>') : ''}
      ${plan.boss ? raw('<span class="pill go">Boss week</span>') : ''}
    </div>
    <h1>${plan.name}</h1>
    <p class="muted small">${plan.est_minutes} min · ${plan.rows.filter(r => r.prescribed !== false).length} sets · leave ${plan.rir} in reserve${phase ? ` · ${phase.name}` : ''}</p>
    <button class="btn" data-action="start" data-key="start">Start quest</button>
    <button class="btn ghost" data-action="skirmish" data-key="skirmish">Short on time? Skirmish</button>
  </div>`;
}

/** Up to three concrete things today could move. Never vague encouragement. */
function stakes(state, plan, p) {
  const lines = stakeLines(state.spec, me(state), plan, p.regions);
  if (!lines.length) return raw('');
  return html`<div class="card card-tight stack">
    <div class="tiny">At stake today</div>
    ${raw(lines.map(l => `<div class="small">· ${esc(l)}</div>`).join(''))}
  </div>`;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function partnerCard(state) {
  const other = partner(state);
  const name = other?.profile?.name ?? (state.me === 'sean' ? 'Cat' : 'Sean');
  if (!other?.sessions.length && !other?.quizDone) {
    return html`<div class="card card-tight row">
      <div class="avatar partner">${name[0]}</div>
      <div class="grow"><div>${name} has not joined yet</div>
        <div class="tiny">everything you log still counts</div></div>
    </div>`;
  }
  const today = dayKey();
  const todays = other.sessions.filter(s => s.day === today);
  // Only ever claim what the synced data can actually support.
  const presence = state.presence?.[state.me === 'sean' ? 'cat' : 'sean'];
  const hours = presence?.lastOpen ? (Date.now() - Date.parse(presence.lastOpen)) / 3600000 : null;
  const stale = hours != null && hours > 6;
  const line = todays.length
    ? `${name} trained today · ${todays[0].duration_min ?? '—'} min`
    : stale ? `No session from ${name} yet`
    : `${name} has not trained yet today`;
  const sub = stale ? `as of ${Math.round(hours)} hours ago` : 'Duo';
  return html`<div class="card card-tight row">
    <div class="avatar partner">${name[0]}</div>
    <div class="grow"><div>${line}</div>
      <div class="tiny">${sub}</div></div>
    <button class="btn ghost" style="width:auto;padding:0 14px" data-action="nav" data-href="#/duo">Open</button>
  </div>`;
}

function regions(state, p) {
  const g = state.gam;
  const rows = (g.regions ?? []).map(r => {
    const region = p.regions[r] ?? { xp: 0, level: 0 };
    const lvl = region.level;
    const floor = (g.region_level?.divisor ?? 40) * lvl * lvl;
    const next = (g.region_level?.divisor ?? 40) * (lvl + 1) * (lvl + 1);
    const pct = next > floor ? Math.round(((region.xp - floor) / (next - floor)) * 100) : 0;
    const hue = 220 - Math.min(10, lvl) * 19.5;
    return `<div class="region">
      <span class="name">${r.replace('_', ' ')}</span>
      <span class="bar"><i style="width:${Math.max(3, pct)}%;background:hsl(${hue} 70% 52%)"></i></span>
      <span class="lvl">${lvl}</span>
    </div>`;
  }).join('');
  return html`<div class="card stack">
    <div class="row-between"><h3>Head to toe</h3><span class="tiny">${p.xp_total.toLocaleString()} XP</span></div>
    <div class="regions">${raw(rows)}</div>
  </div>`;
}

export async function act(action, data, state) {
  const u = me(state);
  if (action === 'resume') { go(`#/session/${u.openSession.session_id}`); return; }
  if (action === 'start' || action === 'skirmish') {
    const short = action === 'skirmish';
    const plan = short ? skirmishPlan(state.spec, u, state.plan?.day ?? dayKey(), {}) : state.plan;
    if (!plan || plan.rest) return;
    const id = newId();
    await dispatch(TYPES.SESSION_START, {
      session_id: id, template_id: plan.template_id, type: action === 'skirmish' ? 'skirmish' : 'full',
      date: plan.day, deload: plan.deload, boss: plan.boss,
      plan: { rows: plan.rows.map(slim), est_minutes: plan.est_minutes, rir_target: plan.rir },
    }, { render: false });
    go(`#/session/${id}`);
    return;
  }
  if (action === 'kindle') {
    const id = newId();
    const kindle = state.spec.byTemplate?.sun_rest?.kindle ?? {};
    const exId = kindle.exercise_id ?? 'zone2_finisher';
    const minutes = kindle.minutes_min ?? kindle.minutes ?? 20;
    await dispatch(TYPES.SESSION_START, {
      session_id: id, template_id: 'sun_rest', type: 'kindle', date: dayKey(),
      plan: { rows: [{
        exercise_id: exId, step_id: state.spec.byExercise[exId]?.ladder?.[0]?.id,
        set_index: 1, side: null, part: null, unit: 'min',
        A: minutes, B: minutes, minutes, prescribed: true, counts_for_progression: false,
      }] },
    }, { render: false });
    go(`#/session/${id}`);
  }
}

/**
 * Freeze only what reproducibility needs. Names, cues and unlock text are
 * resolved from the program data at render time, which keeps an event near
 * 150 bytes instead of several kilobytes.
 */
export function slim(r) {
  return {
    exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
    side: r.side ?? null, part: r.part ?? null, unit: r.unit,
    A: r.A, B: r.B,
    minutes: r.minutes,
    prescribed: r.prescribed === false ? false : undefined,
    counts_for_progression: r.counts_for_progression === false ? false : undefined,
  };
}
