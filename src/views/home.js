// Home: what am I doing today, what is at stake, how is the partner doing.
import { html, raw, dayKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { dispatch, go, me, partner, t, newId } from '../app.js';
import { skirmishPlan, describeGate } from '../engine.js';
import { stakeLines, finishedToday } from '../stakes.js';
import { TYPES } from '../events.js';
import { duoState, hasJoined } from '../duo.js';
import { regionsCard } from './regions.js';

export function render(state) {
  const u = me(state);
  const p = state.progress;
  const plan = state.plan;
  const open = u.openSession;
  // Once today's quest is done, offering it again would only invite a second,
  // double-paid session.
  const done = open ? null : finishedToday(u, dayKey());

  return page(topbar(state), html`<div class="stack">
    ${open ? resume(open) : done ? doneCard(state, done) : plan?.rest ? restCard(state, plan) : questCard(state, plan, p)}
    ${done ? raw('') : stakes(state, plan, p)}
    ${partnerCard(state)}
    ${regionsCard(state, p)}
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

function doneCard(state, s) {
  const gained = state.progress.sessions.find(x => x.session_id === s.session_id);
  const f = gained?.fidelity;
  const title = s.type === 'kindle' ? 'home.done.kindle' : s.type === 'skirmish' ? 'home.done.skirmish' : 'home.done.full';
  return html`<div class="card quest stack">
    <div class="kicker"><span class="pill go">${t('home.done.pill')}</span></div>
    <h1>${t(title)}</h1>
    <p class="muted small">+${(gained?.xp ?? 0).toLocaleString()} XP · ${s.duration_min ?? '—'} min${f?.prescribed ? ` · ${f.hit} of ${f.prescribed} targets` : ''}</p>
    <p class="muted small">${t('home.done.body')}</p>
    <button class="btn secondary" data-action="nav" data-href="#/complete/${s.session_id}">${t('home.done.summary')}</button>
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
  const sets = plan.rows.filter(r => r.prescribed !== false).length;
  return html`<div class="card quest stack">
    <div class="kicker">
      <span class="pill hot">Week ${plan.week === 0 ? 'Muster' : plan.week}</span>
      <span class="pill">${plan.name}</span>
      ${plan.on_ramp ? raw('<span class="pill cool">Building up</span>')
        : plan.deload ? raw('<span class="pill cool">Recovery week</span>') : ''}
      ${plan.boss ? raw('<span class="pill go">Boss week</span>') : ''}
    </div>
    <h1>${plan.name}</h1>
    <p class="muted small">${plan.est_minutes} min · ${sets} sets${phase ? ` · ${phase.name}` : ''}</p>
    <p class="faint small">${t('home.quest.rir', { rir: plan.rir })}${plan.on_ramp ? ` ${t('home.quest.on_ramp')}` : plan.deload ? ` ${t('home.quest.deload')}` : ''}</p>
    ${raw(substitutions(state, plan))}
    <button class="btn" data-action="start" data-key="start">Start quest</button>
    <button class="btn ghost" data-action="skirmish" data-key="skirmish">Short on time? Skirmish</button>
  </div>`;
}

/**
 * Where the plan swapped a locked movement for its fallback, say so, and say
 * what opens it. Thursday quietly ran extra hinge work in place of the swing
 * for two weeks with no word of why anywhere on screen.
 */
function substitutions(state, plan) {
  const lines = [];
  for (const it of (plan.blocks ?? []).flatMap(b => b.items ?? [])) {
    const n = it.locked_note;
    if (!n?.exercise_id) continue;
    const locked = state.spec.byExercise?.[n.exercise_id]?.name ?? n.exercise_id;
    const gate = describeGate(n.blocked, state.spec);
    lines.push(`<div class="small">· ${esc(t('home.quest.locked', { locked, instead: it.name }))}${gate ? ` ${esc(t('home.quest.opens', { gate }))}` : ''}</div>`);
  }
  return lines.length ? `<div class="card-tight quest-subs">${lines.join('')}</div>` : '';
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

/** "as of 3 hours ago" / "as of 4 days ago": how old the partner's last sync is. */
export function staleLabel(hours) {
  if (hours == null) return null;
  if (hours < 48) return `as of ${Math.max(1, Math.round(hours))} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `as of ${days} day${days === 1 ? '' : 's'} ago`;
}

function partnerCard(state) {
  const other = partner(state);
  const name = other?.profile?.name ?? (state.me === 'sean' ? 'Cat' : 'Sean');
  if (!hasJoined(other)) {
    return html`<div class="card card-tight row">
      <div class="avatar partner">${name[0]}</div>
      <div class="grow"><div>${name} has not joined yet</div>
        <div class="tiny">everything you log still counts</div></div>
    </div>`;
  }
  const today = dayKey();
  const todays = other.sessions.filter(s => s.day === today && s.sets.length);
  // Only ever claim what the synced data can actually support.
  const presence = state.presence?.[state.me === 'sean' ? 'cat' : 'sean'];
  const hours = presence?.lastOpen ? (Date.now() - Date.parse(presence.lastOpen)) / 3600000 : null;
  const stale = hours != null && hours > 6;
  const line = todays.length
    ? `${name} trained today · ${todays[0].duration_min ?? '—'} min`
    : stale ? `No session from ${name} yet`
    : `${name} has not trained yet today`;
  // The line under it is the live week, so the card is worth a glance: who is
  // ahead, and by how much, against each person's own plan.
  let week = '';
  try {
    const d = duoState(me(state), other, state.spec, state.gam, today, state.progress, state.partnerProgress);
    week = d.status === 'solo' ? '' : `This week: you ${d.week.mine.S} · ${name} ${d.week.theirs.S}`;
  } catch { week = ''; }
  const sub = [stale ? staleLabel(hours) : null, week].filter(Boolean).join(' · ') || 'Duo';
  return html`<div class="card card-tight row">
    <div class="avatar partner">${name[0]}</div>
    <div class="grow"><div>${line}</div>
      <div class="tiny">${sub}</div></div>
    <button class="btn ghost" style="width:auto;padding:0 14px" data-action="nav" data-href="#/duo">Open</button>
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
 * 150 bytes instead of several kilobytes. The prefill (`target`, what you did
 * here last time) and the rest between sets ride along: they are what the
 * logging screen shows, and without them every set opened at the bottom of the
 * range and "beat last time" was never on the card.
 */
export function slim(r) {
  return {
    exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
    side: r.side ?? null, part: r.part ?? null, unit: r.unit,
    A: r.A, B: r.B,
    target: r.target !== r.A && r.target != null ? r.target : undefined,
    last: r.last ?? undefined,
    rest_sec: r.rest_sec,
    minutes: r.minutes,
    prescribed: r.prescribed === false ? false : undefined,
    counts_for_progression: r.counts_for_progression === false ? false : undefined,
  };
}
