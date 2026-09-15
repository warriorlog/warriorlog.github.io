// The two-player screen. Every number is a ratio to that person's own
// prescription, so it is never a contest about who is stronger.
import { html, raw, dayKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { me, partner, partnerId, go } from '../app.js';
import { duoState } from '../duo.js';
import { battleState } from '../boss.js';
import { staleLabel } from './home.js';

const CATEGORY = {
  sessions: 'Sessions done', fidelity: 'Targets hit', zone2: 'Zone-2 minutes',
  progress: 'Rungs and tiers', xp: 'XP earned',
};

export function render(state) {
  const u = me(state);
  const other = partner(state);
  const name = other?.profile?.name ?? (partnerId(state) === 'cat' ? 'Cat' : 'Sean');
  const today = dayKey();

  if (!other?.quizDone && !other?.sessions?.length) return page(topbar(state), waiting(name), tabbar(state));

  const otherProgress = state.partnerProgress ?? null;
  const d = duoState(u, other, state.spec, state.gam, today, state.progress, otherProgress);
  const battle = battleState(u, other, state.spec, state.gam, today);

  return page(topbar(state), html`<div class="stack">
    ${partnerCard(state, other, name, d)}
    ${duelCard(state, d, name)}
    ${battle ? bossCard(battle, name) : ''}
    ${cabinet(d, u, name)}
  </div>`, tabbar(state));
}

function waiting(name) {
  return html`<div class="stack">
    <div class="card stack">
      <h3>${name} has not set up yet</h3>
      <p class="muted small">Once you have both finished a quest, the duo flame, the weekly belt and the co-op boss all light up here.</p>
      <p class="faint small">Nothing you log now is wasted. It all counts the moment ${name} joins.</p>
    </div>
  </div>`;
}

function partnerCard(state, other, name, d) {
  const stale = staleHours(state);
  const isStale = stale != null && stale > 6;
  // Only ever claim what the synced data can actually support: a phone that
  // has not synced since Friday cannot say what happened today.
  const line = d.partnerTrainedToday ? `${name} trained today`
    : isStale ? `No session from ${name} yet` : `${name} has not trained yet today`;
  const sub = isStale
    ? staleLabel(stale)
    : `${d.duoFlame} day${d.duoFlame === 1 ? '' : 's'} in a row together`;
  return html`<div class="card row">
    <div class="avatar partner">${name[0]}</div>
    <div class="grow">
      <div>${line}</div>
      <div class="tiny">${sub}</div>
    </div>
    <span class="flame">🔥 ${d.duoFlame}</span>
  </div>`;
}

/** Hours since the partner's phone last synced, so we never assert an absence. */
function staleHours(state) {
  const p = state.presence?.[partnerId(state)];
  if (!p?.lastOpen) return null;
  return (Date.now() - Date.parse(p.lastOpen)) / 3600000;
}

function duelCard(state, d, name) {
  const mine = d.week.mine, theirs = d.week.theirs;
  if (d.alliance) {
    const pct = Math.min(100, Math.round((d.combined / d.alliance_target) * 100));
    return html`<div class="card stack">
      <div class="row-between"><h3>Alliance week</h3><span class="pill go">together</span></div>
      <p class="muted small">This week you are on the same side. Reach ${d.alliance_target} between you and you both take a crown.</p>
      <div class="row-between"><strong>${d.combined}</strong><span class="faint small">of ${d.alliance_target}</span></div>
      <div class="levelbar">${raw(`<i style="width:${pct}%"></i>`)}</div>
    </div>`;
  }

  const bars = Object.entries(CATEGORY).map(([k, label]) => {
    const a = mine.parts[k] ?? 0, b = theirs.parts[k] ?? 0;
    return `<div class="stack" style="gap:4px;margin-top:10px">
      <div class="row-between small"><span class="muted">${label}</span><span>${a}% · ${b}%</span></div>
      <div class="levelbar"><i style="width:${a}%"></i></div>
      <div class="levelbar"><i style="width:${b}%;background:linear-gradient(90deg,#2b5f96,#4a8fd6)"></i></div>
    </div>`;
  }).join('');

  const lockDay = d.lock_day ? fmtDay(d.lock_day) : 'Tuesday';
  return html`<div class="card stack">
    <div class="row-between"><h3>This week</h3><span class="pill ${d.status === 'you lead' ? 'go' : d.status === 'they lead' ? 'cool' : ''}">${esc(d.status === 'level' ? 'level' : d.status)}</span></div>
    <div class="row-between">
      <div><div class="tiny">You</div><strong style="font-size:28px">${mine.S}</strong></div>
      <div class="faint">vs</div>
      <div style="text-align:right"><div class="tiny">${esc(name)}</div><strong style="font-size:28px">${theirs.S}</strong></div>
    </div>
    ${d.week.pb ? raw('<span class="pill hot">Personal best week</span>') : ''}
    ${raw(bars)}
    <p class="faint small">Each line is what you did against what your own plan asked of you. Loads and reps are never compared.</p>
    <p class="faint small">Still in play. The week is settled on ${esc(lockDay)}, once both phones have synced the weekend; a week with fewer than two sessions on either side is a no-contest, never a defeat.</p>
  </div>`;
}

const fmtDay = (day) => {
  const [y, m, dd] = String(day).split('-').map(Number);
  if (!y) return String(day);
  const dt = new Date(y, m - 1, dd, 12);
  return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()]} ${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};

function bossCard(battle, name) {
  const pct = Math.min(100, Math.round((battle.damage / Math.max(1, battle.hp)) * 100));
  const a = battle.mine.damage, b = battle.theirs?.damage ?? 0;
  const synergy = battle.solo ? 0 : Math.min(a, b);
  const seg = (v) => Math.round((v / Math.max(1, battle.hp)) * 100);
  const away = battle.days_away;
  const headline = battle.in_window ? 'Battle is open'
    : away > 0 ? `${battle.boss.name} in ${away} day${away === 1 ? '' : 's'}`
    : battle.boss.name;

  return html`<div class="card stack">
    <div class="row-between"><h3>${esc(headline)}</h3>
      <span class="pill ${battle.in_window ? 'hot' : ''}">week ${battle.week}</span></div>
    ${battle.training_camp ? raw('<p class="muted small">Training camp: the next three sessions are your run-up. Your targets are held steady so the test is a fair comparison.</p>') : ''}
    <div class="levelbar" style="height:12px">${raw(
      `<i style="width:${pct}%;background:linear-gradient(90deg,var(--ember-deep),var(--ember))"></i>`)}</div>
    <div class="row-between small">
      <span class="muted">${battle.damage} of ${battle.hp}</span>
      <span class="faint">${esc(battle.solo ? 'solo: half strength' : `you ${a} · ${name} ${b} · together +${synergy}`)}</span>
    </div>
    ${!battle.solo ? raw(`<p class="faint small">The smaller of your two efforts counts twice, so whoever can do less is the one who decides the bonus.</p>`) : ''}
    <button class="btn secondary" data-action="nav" data-href="#/boss">Open the arena</button>
  </div>`;
}

function cabinet(d, u, name) {
  const belt = d.belt ?? {};
  const mineCrowns = belt.crowns?.[u.id ?? 'sean'] ?? 0;
  const theirCrowns = Object.entries(belt.crowns ?? {}).find(([k]) => k !== (u.id ?? 'sean'))?.[1] ?? 0;
  if (!mineCrowns && !theirCrowns && !belt.dead_heats) return raw('');
  return html`<div class="card stack">
    <h3>Crown cabinet</h3>
    <div class="xpline"><span class="muted">Your crowns</span><strong>${mineCrowns}</strong></div>
    <div class="xpline"><span class="muted">${esc(name)}</span><strong>${theirCrowns}</strong></div>
    <div class="xpline"><span class="muted">Dead heats</span><strong>${belt.dead_heats ?? 0}</strong></div>
    <div class="xpline"><span class="muted">Title changes</span><strong>${belt.title_changes ?? 0}</strong></div>
  </div>`;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function act(action, data) { if (action === 'nav') go(data.href); }
