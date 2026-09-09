// The Boss Arena. Six benchmarks, one boss, two warriors, and a bar that only
// ever fills. Every number on this screen comes from src/boss.js — the view
// decides how a battle READS, never what it is worth.
//
// Three states share one screen: the days before the window (countdown and the
// two tiers within reach), the window itself (the boss draining live), and the
// aftermath (deltas against the last battle and what it paid).
import { html, raw, esc, dayKey } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { dispatch, go, me, partner, t, render as rerender } from '../app.js';
import { TYPES } from '../events.js';
import { battleState, scoreResult, coopDamage, TIERS } from '../boss.js';

let sheet = null;                    // the open logging sheet, if any

// ---------------------------------------------------------------- formatting
export const fmtClock = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A benchmark value the way a person says it: 9:42, or 26. */
export function fmtValue(unit, v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return unit === 'sec' ? fmtClock(v) : String(Math.round(Number(v) * 10) / 10);
}

export const tierName = (i) => (i == null ? null : (TIERS[i] ?? 'recruit').replace(/^./, c => c.toUpperCase()));

const TITLE_PREFIX = /^Boss Battle \d+:\s*/;
export const shortName = (n) => String(n ?? '').replace(TITLE_PREFIX, '');

/** The variant a person actually earned, in four words rather than a paragraph. */
const VARIANTS = {
  bb_mile_time: { walk: 'Walk the mile', run: 'Run the mile' },
  bb_pushups_2min: { full: 'Full push-ups', knee: 'Knee push-ups · half a point each' },
  bb_hollow_hold: { full: 'Full hollow', tuck: 'Tuck hollow · half a second each' },
  bb_swings_5min: { kb53: 'Bell swings · 53 lb', db: 'Dumbbell swings · your current bell weight', locked: 'Continuous swings' },
  bb_goblet_bw: { loaded: 'Loaded goblet squats', bodyweight: 'Bodyweight squats' },
  bb_vest_stepups_3min: { vest10: 'Step-ups in the vest', unweighted: 'Step-ups, no vest' },
};

export function variantLabel(card) {
  const base = VARIANTS[card.id]?.[card.variant?.id] ?? shortName(card.name);
  const lb = card.load?.lb;
  return lb && card.variant?.uses_load_rule ? `${base} · ${lb} lb` : base;
}

/**
 * Why this test is shut, in the words that actually apply: a variant that locks
 * itself carries the rung you still have to earn, which is more use than the
 * benchmark's general health-screen note.
 */
export function lockNote(card) {
  const v = card.variant;
  return (v?.locked && v?.lock_note) ? v.lock_note : (card.locked_note ?? 'Not open yet.');
}

/** The protocol in short form: the first sentence of this variant's own how-to. */
export function shortProtocol(card) {
  const src = card.variant?.how ?? card.protocol ?? '';
  const first = String(src).split(/(?<=\.)\s+/)[0] ?? '';
  return first.length > 150 ? `${first.slice(0, 147)}…` : first;
}

// ---------------------------------------------------------------- tier maths
/** The four tiers as raw numbers for THIS person's variant, not the scaled ones. */
export function tierRows(card) {
  const v = card.variant;
  if (!v || !Array.isArray(v.tiers)) return [];
  const mult = v.multiplier ?? 1;
  const cap = v.tier_cap ?? 3;
  const reached = card.previous ? (card.tier ?? 0) : -1;
  return TIERS.map((name, i) => ({
    i,
    name: tierName(i),
    raw: mult ? v.tiers[i] / mult : null,
    open: i <= cap,
    reached: i <= reached,
  }));
}

/** The next tier this test can reach, and how far off it is. Null when topped out. */
export function nextTierGap(card) {
  if (card.locked) return null;
  const v = card.variant;
  const mult = v?.multiplier ?? 1;
  if (!v || !Array.isArray(v.tiers) || !mult) return null;
  const cap = v.tier_cap ?? 3;
  const have = card.previous?.value ?? null;
  const at = card.previous ? (card.tier ?? 0) : -1;
  // With nothing on the board yet the honest target is soldier, not the recruit
  // line every logged result already clears.
  const next = Math.min(cap, Math.max(1, at + 1));
  if (next < 1 || next <= at) return null;
  const need = v.tiers[next] / mult;
  const gap = have == null ? null
    : Math.round(((card.higher_is_better ? need - have : have - need)) * 10) / 10;
  return {
    id: card.id, name: shortName(card.name), unit: card.unit,
    tier: next, tier_name: tierName(next), need, have, gap,
    ratio: have == null || !need ? Infinity : Math.abs(gap) / Math.abs(need),
  };
}

/**
 * The tiers within reach. A person with results is ranked by how small the gap
 * is; a brand new warrior is simply shown the first tiers on the board, because
 * "nothing yet" is a fine place to stand in week one.
 */
export function closestTiers(cards, n = 2) {
  const gaps = cards.filter(c => !c.locked).map(nextTierGap).filter(Boolean);
  const known = gaps.filter(g => g.have != null && g.gap > 0).sort((a, b) => a.ratio - b.ratio);
  const fresh = gaps.filter(g => g.have == null);
  const done = gaps.filter(g => g.have != null && g.gap <= 0);
  return [...known, ...fresh, ...done].slice(0, n);
}

// ---------------------------------------------------------------- the co-op bar
/**
 * Three visible slices of one bar: mine, theirs, and the synergy that counts the
 * smaller of the two a second time. Scaled to HP, or to the total once the pair
 * has gone past it, so an overkill still shows every slice.
 */
export function segments(mineDamage, theirDamage, hp) {
  const a = Math.max(0, Math.round(mineDamage ?? 0));
  const b = theirDamage == null ? null : Math.max(0, Math.round(theirDamage));
  const total = b == null ? a : coopDamage(a, b);
  const synergy = b == null ? 0 : total - a - b;
  const scale = Math.max(hp || 0, total, 1);
  const pct = (x) => Math.round((x / scale) * 1000) / 10;
  return {
    mine: a, theirs: b, synergy, total, scale, hp,
    remaining: Math.max(0, (hp ?? 0) - total),
    pct: { mine: pct(a), theirs: pct(b ?? 0), synergy: pct(synergy), hp: pct(hp ?? 0) },
  };
}

/** Each of my results this battle, next to the same test at the last one. */
export function battleDeltas(user, b) {
  const hist = user?.benchmarkHistory ?? [];
  return (b.mine.results ?? []).map(r => ({
    ...r,
    before: hist.filter(h => h.benchmark_id === r.benchmark_id && (h.battle_n ?? 0) < b.n).slice(-1)[0] ?? null,
    strike: b.mine.strikes?.[r.benchmark_id] ?? 0,
  }));
}

/** Which of the three faces of this screen to wear today. */
export function phaseOf(b, user) {
  if (!b) return 'none';
  if (user?.bossResolved?.[b.n]) return 'sealed';
  const open = b.cards.filter(c => !c.locked).length;
  const allIn = open > 0 && b.mine.logged >= open;
  if (b.in_window && b.mine.logged > 0 && (allIn || b.days_away < 0)) return 'result';
  return b.in_window ? 'open' : 'before';
}

// ---------------------------------------------------------------- render
export function render(state) {
  const u = me(state);
  const other = partner(state);
  const b = battleState(u, other, state.spec, state.gam, dayKey());
  if (!b) {
    return page(topbar(state), html`<div class="empty">The arena opens once your program has a start date.
      <br><button class="btn ghost" data-action="nav" data-href="#/home">Back to today</button></div>`, tabbar(state));
  }
  const phase = phaseOf(b, u);
  const partnerName = other?.profile?.name ?? (state.me === 'sean' ? 'Cat' : 'Sean');

  return page(topbar(state, { title: t('boss.title') }), html`<div class="stack">
    ${hero(state, b, phase)}
    ${b.training_camp ? camp() : ''}
    ${phase === 'result' || phase === 'sealed' ? resultCard(state, b, u, phase) : ''}
    ${phase === 'before' ? reach(b) : ''}
    ${coop(b, partnerName, phase)}
    <div class="tiny">The six tests</div>
    ${raw(cardsFor(b, phase))}
    ${lastTime(state, u, b)}
    <p class="faint small">${t('boss.no_defeat')}</p>
    ${sheet ? raw(sheetHtml(state, b)) : ''}
  </div>`, tabbar(state));
}

function hero(state, b, phase) {
  const s = segments(b.mine.damage, b.solo ? null : (b.theirs?.damage ?? 0), b.hp);
  const left = Math.round((s.remaining / Math.max(1, b.hp)) * 100);
  const saturday = fmtDay(addDaysSafe(b.window_start, 5));
  const line = phase === 'before'
    ? (b.days_away === 1 ? 'The battle is tomorrow' : `${b.days_away} days until the battle`)
    : phase === 'open'
      ? (b.days_away > 0 ? 'The window is open — battle day is Saturday'
        : `The window is open · ${Math.max(0, daysTo(b.window_end))} days left to log`)
      : `Battle ${b.n} · week ${b.week}`;

  return html`<section class="card bhero stack">
    <div class="kicker row">
      <span class="pill hot">Battle ${b.n}</span>
      <span class="pill">Week ${b.week}</span>
      ${b.solo ? raw('<span class="pill cool">Solo</span>') : ''}
    </div>
    <div class="row">
      <div class="bsigil" aria-hidden="true">${sigil(b.n)}</div>
      <div class="grow">
        <h1>${b.boss.name}</h1>
        <div class="small muted">${line}</div>
        <div class="tiny">Saturday ${saturday} · week ${b.week}</div>
      </div>
    </div>
    <div class="hpbar" role="img" aria-label="${b.hp - Math.min(b.hp, s.total)} of ${b.hp} hit points remaining">
      ${raw(`<i style="width:${Math.max(0, Math.min(100, left))}%"></i>`)}
    </div>
    <div class="row-between small">
      <span class="muted">${phase === 'before' ? `${b.hp} HP, untouched` : `${Math.min(s.total, b.hp)} of ${b.hp} HP struck`}</span>
      <span class="xpfloat">${s.total} damage</span>
    </div>
  </section>`;
}

const sigil = (n) => ['🗝', '🛡', '⚔', '🥋', '👑'][(n - 1) % 5] ?? '⚔';

function camp() {
  return html`<div class="card card-tight bcamp stack">
    <div class="tiny">Training camp</div>
    <div class="small">${t('boss.training_camp')}</div>
    <div class="faint small">These are the three sessions before the battle. Hold what you have; the tests want it fresh.</div>
  </div>`;
}

function coop(b, partnerName, phase = 'open') {
  const s = segments(b.mine.damage, b.solo ? null : (b.theirs?.damage ?? 0), b.hp);
  const bars = [
    `<i class="s-mine" style="width:${s.pct.mine}%"></i>`,
    b.solo ? '' : `<i class="s-theirs" style="width:${s.pct.theirs}%"></i>`,
    b.solo ? '' : `<i class="s-syn" style="width:${s.pct.synergy}%"></i>`,
  ].join('');

  const legend = b.solo
    ? `<span><i class="s-mine"></i>You ${s.mine}</span>
       <span><i class="s-wait"></i>${esc(partnerName)}'s strikes land here</span>`
    : `<span><i class="s-mine"></i>You ${s.mine}</span>
       <span><i class="s-theirs"></i>${esc(partnerName)} ${s.theirs}</span>
       <span><i class="s-syn"></i>Synergy +${s.synergy}</span>`;

  const quiet = phase === 'before';
  const note = b.solo
    ? (quiet ? t('boss.coop.solo') : `${t('boss.coop.solo')} It stands at half strength for one warrior, so this is winnable alone.`)
    : (quiet ? 'Synergy counts the smaller of the two hits a second time.'
      : `Synergy is the smaller of the two, counted a second time — ${t('boss.coop.explain')}`);

  return html`<section class="card${quiet ? ' card-tight' : ''} stack">
    <div class="row-between"><h3>Co-op damage</h3><span class="tiny">${s.total} of ${b.hp} HP</span></div>
    <div class="coopbar">${raw(bars)}${raw(s.total > b.hp ? `<u style="left:${s.pct.hp}%"></u>` : '')}</div>
    <div class="blegend">${raw(legend)}</div>
    <p class="faint small">${note}</p>
  </section>`;
}

function reach(b) {
  const picks = closestTiers(b.cards, 2);
  if (!picks.length) return raw('');
  const rows = picks.map(g => {
    const need = `${fmtValue(g.unit, g.need)}${g.unit === 'reps' ? ' reps' : ''}`;
    const tail = g.have == null
      ? 'open from your first log'
      : g.gap > 0
        ? `your best is ${fmtValue(g.unit, g.have)} — ${fmtValue(g.unit, Math.abs(g.gap))} to go`
        : `already yours at ${fmtValue(g.unit, g.have)}`;
    return `<div class="small"><strong>${esc(g.tier_name)}</strong> on ${esc(g.name.toLowerCase())} needs ${esc(need)} · <span class="muted">${esc(tail)}</span></div>`;
  }).join('');
  return html`<section class="card card-tight stack">
    <div class="tiny">Within reach</div>
    ${raw(rows)}
  </section>`;
}

function cardsFor(b, phase) {
  return [...b.cards].sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map(c => testCardHtml(c, b, phase)).join('');
}

function testCardHtml(card, b, phase) {
  const logged = (b.mine.results ?? []).find(r => r.benchmark_id === card.id) ?? null;
  const tier = logged ? logged.tier : card.tier;
  const rows = tierRows(card);
  const track = rows.map(r => `<span class="bt" data-on="${r.reached ? '1' : '0'}" data-open="${r.open ? '1' : '0'}">
      <b>${esc(r.name)}</b><i>${r.i === 0 ? 'log it' : esc(fmtValue(card.unit, r.raw))}</i></span>`).join('');
  const capped = rows.some(r => !r.open);
  const prev = card.previous
    ? `${esc(fmtValue(card.unit, card.previous.value))}${card.previous.tier != null ? ` · ${esc(tierName(card.previous.tier))}` : ''}`
    : 'nothing on the board yet';

  if (card.locked) {
    return `<section class="card bcard locked stack">
      <div class="row-between"><h3>🔒 ${esc(shortName(card.name))}</h3><span class="pill">Test ${card.order}</span></div>
      <div class="small muted">${esc(lockNote(card))}</div>
      <div class="faint small">It costs you nothing while it waits — the other tests carry this battle.</div>
    </section>`;
  }

  return `<section class="card bcard stack">
    <div class="row-between">
      <div class="grow"><h3>${esc(shortName(card.name))}</h3>
        <div class="small">${esc(variantLabel(card))}</div></div>
      ${tier != null ? `<span class="pill go">${esc(tierName(tier))}</span>` : `<span class="pill">Test ${card.order}</span>`}
    </div>
    <div class="muted small">${esc(shortProtocol(card))}</div>
    <details class="bproto"><summary>Full protocol</summary><p class="small muted">${esc(card.protocol)}</p></details>
    <div class="btiers">${track}</div>
    ${capped ? `<div class="faint small">Caps at ${esc(tierName(card.variant?.tier_cap ?? 3))} · the harder variant opens the top tiers.</div>` : ''}
    <div class="row-between small"><span class="muted">Last time</span><strong>${prev}</strong></div>
    ${logged ? `<div class="row-between small"><span class="muted">This battle</span><strong class="xpfloat">${esc(fmtValue(card.unit, logged.value))} · ${esc(tierName(logged.tier))}</strong></div>` : ''}
    <button class="btn ${logged ? 'ghost' : 'secondary'}" data-action="open" data-key="open-${esc(card.id)}" data-id="${esc(card.id)}">${logged ? 'Log it again' : 'Log a result'}</button>
  </section>`;
}

function resultCard(state, b, u, phase) {
  const deltas = battleDeltas(u, b);
  const key = `boss.result.${b.outcome}`;
  const gxp = state.gam?.xp ?? {};
  const pct = b.outcome === 'flawless' ? Math.round((gxp.boss_flawless_pct ?? 0.2) * 100)
    : b.outcome === 'defeated' ? Math.round((gxp.boss_defeated_pct ?? 0.1) * 100) : null;

  const lines = deltas.map(d => {
    const card = b.cards.find(c => c.id === d.benchmark_id);
    const unit = card?.unit ?? 'reps';
    const now = fmtValue(unit, d.value);
    const climbed = d.tier_prev != null && d.tier > d.tier_prev;
    const delta = d.variant_changed ? 'new variant · tier counted fresh'
      : d.before == null ? 'first time on the board'
        : d.imp_pct > 0 ? `+${d.imp_pct}% on ${fmtValue(unit, d.before.value)}`
          : `holding ${fmtValue(unit, d.before.value)}`;
    return `<div class="drow">
      <div class="grow"><strong>${esc(shortName(card?.name ?? d.benchmark_id))}</strong>
        <div class="tiny">${esc(delta)}</div></div>
      <div class="dval">${esc(now)}</div>
      <div class="pill ${climbed ? 'go' : ''}">${esc(tierName(d.tier))}${climbed ? ' ▲' : ''}</div>
      <div class="dstrike">+${d.strike}</div>
    </div>`;
  }).join('');

  return html`<section class="card bresult stack" data-outcome="${b.outcome}">
    <div class="tiny">${b.boss.name}</div>
    <h2>${t(key, { damage: b.damage, hp: b.hp })}</h2>
    ${raw(lines ? `<div class="stack" style="gap:6px">${lines}</div>` : '')}
    ${pct != null ? html`<div class="small">${t('boss.loot', { pct })}</div>` : ''}
    ${b.outcome === 'wounded' ? html`<div class="small">${t('boss.rematch', { tests: 'any test you want another go at' })}</div>` : ''}
    ${b.outcome === 'escaped' ? html`<div class="small">It walks off with nothing of yours, and comes back next boss week carrying +${state.gam?.boss_damage?.escaped_revenge_bonus ?? 10} revenge damage for you.</div>` : ''}
    ${phase === 'sealed'
      ? html`<div class="faint small">Sealed. This battle is frozen exactly as it stands.</div>`
      : html`<button class="btn" data-action="seal" data-key="seal-${b.n}">Seal this battle</button>`}
  </section>`;
}

function lastTime(state, u, b) {
  const prev = u.bossResolved?.[b.n - 1];
  if (!prev) return raw('');
  return html`<div class="card card-tight row-between">
    <span class="small muted">Battle ${prev.battle_n} · ${prev.boss_name ?? ''}</span>
    <span class="pill go">${String(prev.outcome ?? '').toUpperCase()}</span>
  </div>`;
}

// ---------------------------------------------------------------- the sheet
function sheetHtml(state, b) {
  const card = b.cards.find(c => c.id === sheet.id);
  if (!card) return '';
  const clock = card.unit === 'sec';
  const rows = tierRows(card);
  const soldier = rows[1];
  const mult = card.variant?.multiplier ?? 1;
  const chips = clock
    ? [['-60', '− 1:00'], ['60', '+ 1:00']]
    : [['-10', '− 10'], ['10', '+ 10']];
  return `<div class="sheet-backdrop" data-action="close-sheet" data-key="close-sheet">
    <div class="sheet" data-stop>
      <div class="row-between"><h3>${esc(shortName(card.name))}</h3>
        <span class="tiny">${esc(clock ? 'minutes : seconds' : (card.unit ?? 'reps'))}</span></div>
      <div class="small muted">${esc(variantLabel(card))}</div>
      <div class="stepper">
        <button data-action="dec" data-key="dec-${sheet.value}" aria-label="less">−</button>
        <span class="value" id="boss-value">${esc(fmtValue(card.unit, sheet.value))}</span>
        <button data-action="inc" data-key="inc-${sheet.value}" aria-label="more">+</button>
      </div>
      <div class="chips" style="justify-content:center">
        ${chips.map(([by, label]) => `<button class="chip" data-action="jump" data-by="${by}" data-key="jump${by}-${sheet.value}">${label}</button>`).join('')}
      </div>
      <div style="height:12px"></div>
      <div class="small muted center">${card.previous ? `Last time ${esc(fmtValue(card.unit, card.previous.value))} · ` : ''}${esc(t('boss.test.tier', { tier: soldier?.name ?? 'Soldier', value: fmtValue(card.unit, soldier?.raw) }))}</div>
      ${mult !== 1 ? `<div class="faint small center">Scored at ${mult} per rep on this variant.</div>` : ''}
      <div style="height:14px"></div>
      <button class="btn" data-action="save" data-key="save-${esc(card.id)}">Land the strike</button>
      <div style="height:8px"></div>
      <button class="btn ghost" data-action="close-sheet" data-key="cancel">Not now</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- actions
export async function act(action, data, state) {
  const u = me(state);
  const b = battleState(u, partner(state), state.spec, state.gam, dayKey());
  if (!b) return;

  switch (action) {
    case 'nav': go(data.href); return;

    case 'open': {
      const card = b.cards.find(c => c.id === data.id);
      if (!card || card.locked) return;
      const rows = tierRows(card);
      sheet = {
        id: card.id, unit: card.unit,
        value: Math.round(card.previous?.value ?? rows[1]?.raw ?? 0),
        battle_n: b.n,
      };
      rerender();
      return;
    }

    case 'inc': case 'dec': case 'jump': {
      if (!sheet) return;
      const base = sheet.unit === 'sec' ? 5 : 1;
      const by = action === 'jump' ? Number(data.by) : (action === 'inc' ? base : -base);
      sheet.value = Math.max(0, sheet.value + by);
      const el = document.getElementById('boss-value');
      if (el) el.textContent = fmtValue(sheet.unit, sheet.value);
      // The tap de-duplicator keys on data-key, so move the key with the value:
      // a warrior stabbing + twenty times must get twenty reps.
      data.key = `${action}${action === 'jump' ? data.by : ''}-${sheet.value}`;
      return;
    }

    case 'close-sheet': { sheet = null; rerender(); return; }

    case 'save': {
      if (!sheet) return;
      const bench = state.spec.byBenchmark[sheet.id];
      const value = sheet.value;
      const battle_n = sheet.battle_n;
      sheet = null;
      if (!bench) { rerender(); return; }
      await dispatch(TYPES.BENCHMARK, { ...scoreResult(bench, u, state.spec, value), battle_n });
      return;
    }

    case 'seal': {
      if (u.bossResolved?.[b.n]) return;
      await dispatch(TYPES.BOSS_RESOLVED, {
        battle_n: b.n, boss_id: b.boss.id ?? null, boss_name: b.boss.name,
        week: b.week, outcome: b.outcome, damage: b.damage, hp: b.hp,
        solo: b.solo, my_damage: b.mine.damage, partner_damage: b.theirs?.damage ?? null,
        logged_benchmarks: b.mine.logged,
      });
      return;
    }
  }
}

// ---------------------------------------------------------------- small bits
const fmtDay = (day) => {
  const [, m, d] = String(day).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`.trim();
};

function addDaysSafe(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysTo(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Math.round((new Date(y, m - 1, d, 12) - new Date(new Date().setHours(12, 0, 0, 0))) / 86400000);
}
