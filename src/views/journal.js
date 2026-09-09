// The record. Five things, in the order they matter on a Monday morning:
// the weekly report, the calendar, every session, every personal record, and
// every badge.
//
// Nothing in this file imports app.js. That is deliberate: the whole module
// stays loadable under `node --test`, so the helpers below (readable badge
// criteria, the week roll-up, the Perfect Week rule) are unit-tested rather
// than eyeballed in a browser. Navigation already happens in app.js's delegated
// click handler, and the one interaction this screen owns — tapping a calendar
// day — is a scroll, not a state change.
import { html, raw, esc, dayKey, addDays, weekStart, isoWeekKey, dow, weekIndex } from '../util.js';
import { topbar, tabbar, page } from './chrome.js';
import { regionXpForSession, regionLevel } from '../gamify.js';
import { duelScore } from '../duo.js';

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const SOURCE_LABELS = {
  sets: 'Sets', quest: 'Quests', zone2: 'Zone-2', cardio: 'Cardio',
  intervals: 'Intervals', records: 'Records', climbs: 'Ladder climbs',
  armour: 'Armour', setup: 'Placement',
};
const GATE_NAMES = { hinge: 'hinge', bell: '53 lb bell', run: 'run' };

// ==================================================================== helpers
// Everything above the `render` line is pure and exported for test/journal.test.js.

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Seconds as a readable clock: 45s, 5:00, 12:00. */
export function clock(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One logged value, in the words the unit deserves. */
export function fmtValue(value, unit) {
  const v = Number(value) || 0;
  if (unit === 'clock_sec' || unit === 'sec') return clock(v);
  if (unit === 'min') return `${v} min`;
  if (unit === 'rounds') return plural(v, 'round');
  return plural(v, 'rep');
}

/** "2026-09-07" -> "Mon 7 Sep". Short enough for a 375px row. */
export function shortDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y) return String(day);
  const dt = new Date(y, m - 1, d, 12);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${wd} ${d} ${mon}`;
}

export const dateRange = (start) => `${shortDate(start).slice(4)} – ${shortDate(addDays(start, 6)).slice(4)}`;

/** An implement id as something a person would say out loud. */
export function implementName(id) {
  if (!id || id === 'bw') return 'bodyweight';
  const kb = /^kb(\d+)$/.exec(id);
  if (kb) return `${kb[1]} lb bell`;
  const db = /^db(\d+)$/.exec(id);
  if (db) return `${db[1]} lb dumbbell`;
  return String(id).replace(/_/g, ' ');
}

/**
 * The Zone-2 minutes one full week of the plan asks for, read straight off the
 * templates so the target can never drift from the program. 42 today.
 */
export function zone2TargetMin(spec) {
  const CARDIO = new Set(['treadmill_zone2', 'zone2_finisher', 'vest_walk', 'march_step_zone2']);
  let total = 0;
  for (const t of spec?.templates ?? []) {
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) {
        if (!CARDIO.has(it.exercise_id)) continue;
        const ex = spec.byExercise?.[it.exercise_id];
        total += it.time_override_min ?? ex?.ladder?.[0]?.cardio?.minutes ?? 0;
      }
    }
  }
  return total;
}

/**
 * How many quests the plan asks for in the calendar week starting `start`.
 * A full week is six; the Muster week counts only the days on or after the day
 * the warrior actually arrived, and week 12's taper day is not counted.
 */
export function weekPrescribedQuests(spec, start, { firstDay = null, override = null } = {}) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (firstDay && d < firstDay) continue;
    if (override?.days?.[String(dow(d))] === 'off') continue;
    const t = (spec?.templates ?? []).find(x => x.dow === dow(d));
    if (t && t.minutes > 0) n++;
  }
  return n;
}

/**
 * Perfect Week, exactly as the approved mechanic states it: every prescribed
 * quest done, at least four of them full, and no shield spent.
 */
export function isPerfectWeek(w, g = {}) {
  const cfg = g.perfect_week ?? {};
  const minFull = w.programWeek === 0 ? (cfg.muster_min_full ?? 3) : (cfg.min_full ?? 4);
  return w.prescribed > 0 && w.done >= w.prescribed && w.full >= minFull && w.shields === 0;
}

/** One honest sentence about the week ahead. Never a promise, never a scolding. */
export function nextWeekLine(spec, programWeek) {
  const w = programWeek + 1;
  const every = spec?.deload?.every_n_weeks ?? 4;
  const phases = spec?.phases ?? [];
  const last = phases.length ? phases[phases.length - 1].weeks?.[1] ?? 12 : 12;
  const phase = phases.find(p => w >= (p.weeks?.[0] ?? 0) && w <= (p.weeks?.[1] ?? 0));
  const note = spec?.week_overrides?.[String(w)]?.note;
  if (w > last) return `Week ${w} sits past the twelve, so the plan holds at its final volume until a new one is written.`;
  if (note) return `Week ${w}: ${String(note).replace(/\.$/, '')}.`;
  if (w > 0 && w % every === 0) return `Week ${w} is a boss week — lighter sets all week, then the six tests.`;
  if ((spec?.on_ramp?.weeks ?? []).includes(w)) return `Week ${w} is still on the ramp: the same six quests at reduced sets.`;
  const z2 = zone2TargetMin(spec);
  return `Week ${w} is ${phase?.name ?? 'program'} volume — six quests, two hinge days and ${z2} Zone-2 minutes.`;
}

/** Cumulative region XP after each session, so a week's level changes are knowable. */
export function regionTimeline(user, spec, g, perSession) {
  const byId = new Map((perSession ?? []).map(s => [s.session_id, s]));
  const cum = Object.fromEntries((g.regions ?? []).map(r => [r, 0]));
  const out = [];
  for (const s of user.sessions ?? []) {
    const gained = byId.get(s.session_id);
    if (gained) {
      const add = regionXpForSession(s, spec, g, { by_source: gained.by_source });
      for (const [k, v] of Object.entries(add)) if (cum[k] != null) cum[k] += v;
    }
    out.push({ day: s.day, snapshot: { ...cum } });
  }
  return { entries: out, zero: Object.fromEntries((g.regions ?? []).map(r => [r, 0])) };
}

const snapshotAt = (tl, day) => {
  let snap = tl.zero;
  for (const e of tl.entries) { if (e.day > day) break; snap = e.snapshot; }
  return snap;
};

/**
 * Every week from the first day on record to this one, newest first, each one
 * carrying everything the report card needs. One pass, no scoring reinvented:
 * XP, PRs and fidelity all come from `state.progress`.
 */
export function buildWeeks(user, spec, g, prog, today = dayKey()) {
  const first = user.sessions?.[0]?.day ?? user.placedOn ?? today;
  const programStart = user.profile?.program_start ?? first;
  const tl = regionTimeline(user, spec, g, prog.sessions);
  const z2Target = zone2TargetMin(spec);
  const gained = new Map((prog.sessions ?? []).map(s => [s.session_id, s]));
  const statuses = prog.flame?.statuses ?? new Map();

  const weeks = [];
  const from = weekStart(first);
  // A phone whose clock ran ahead can leave a session dated after today. Ending
  // the run at the later of the two keeps that week on the calendar instead of
  // silently emptying it.
  const stop = weekStart(today) > from ? weekStart(today) : from;
  for (let start = from; start <= stop; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const weekId = isoWeekKey(start);
    const programWeek = weekIndex(start, programStart);
    const override = spec?.week_overrides?.[String(programWeek)] ?? null;

    const sessions = (user.sessions ?? []).filter(s => s.day >= start && s.day <= end);
    const counted = sessions.filter(s => s.type !== 'kindle');
    const bySource = {};
    let xp = 0, prs = [];
    for (const s of counted) {
      const gd = gained.get(s.session_id);
      if (!gd) continue;
      xp += gd.xp;
      for (const [k, v] of Object.entries(gd.by_source ?? {})) bySource[k] = (bySource[k] ?? 0) + v;
      for (const pr of gd.prs ?? []) prs.push({ ...pr, day: s.day });
    }

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const st = d > today ? 'future' : statuses.get(d) ?? (d < first ? 'before' : 'none');
      return { day: d, status: st, session: sessions.find(s => s.day === d && s.sets.length) ?? null };
    });

    const before = snapshotAt(tl, addDays(start, -1));
    const after = snapshotAt(tl, end);
    const regionChanges = Object.keys(after)
      .map(r => ({ region: r, from: regionLevel(before[r] ?? 0, g), to: regionLevel(after[r] ?? 0, g) }))
      .filter(x => x.to > x.from);

    const w = {
      week_id: weekId, start, end, programWeek,
      current: start === stop,
      done: counted.length,
      full: counted.filter(s => s.type === 'full').length,
      skirmish: counted.filter(s => s.type === 'skirmish').length,
      prescribed: weekPrescribedQuests(spec, start, { firstDay: first, override }),
      shields: days.filter(d => d.status === 'shield').length,
      xp, by_source: bySource, prs,
      climbs: (user.climbs ?? []).filter(c => c.day >= start && c.day <= end),
      zone2: { done: Math.round(prog.zone2_by_week?.[weekId] ?? 0), target: z2Target },
      regionChanges, days, sessions,
    };
    w.perfect = isPerfectWeek(w, g);
    w.held = !w.perfect && w.prescribed > 0 && w.done >= w.prescribed - 1 && w.done > 0;
    w.remaining = Math.max(0, w.prescribed - w.done);
    weeks.push(w);
  }
  return weeks.reverse();
}

// -------------------------------------------------------------- badge wording
/**
 * Badge criteria are typed objects, never prose — so the prose is generated
 * here, from the same object the rule engine evaluates. That is the only way
 * a criterion and its description can never drift apart, and it is why there
 * are no fifty hand-written strings anywhere in this app.
 */
export function criterionText(c, spec = {}, g = {}) {
  if (!c) return '';
  const v = c.value;
  const exName = (id) => spec.byExercise?.[id]?.name ?? String(id ?? '').replace(/_/g, ' ');
  const stepName = (id) => spec.byStep?.[id]?.name ?? String(id ?? '').split('.').pop()?.replace(/_/g, ' ');
  const tier = (i) => (g.gear_tiers ?? []).find(x => x.index === i)?.name ?? `tier ${i}`;
  const gate = (id) => GATE_NAMES[id] ?? String(id ?? '').replace(/_/g, ' ');
  const unitOf = (c2) => spec.byStep?.[c2.min_step_id]?.unit
    ?? spec.byExercise?.[c2.exercise]?.ladder?.[0]?.unit ?? 'reps';

  switch (c.metric) {
    case 'flame': return `Keep the flame lit ${plural(v, 'day')} running.`;
    case 'best_flame': return `Reach a best flame of ${plural(v, 'day')}.`;
    case 'duo_flame': return `${plural(v, 'day')} running where you both show up.`;
    case 'level': return `Reach level ${v}.`;
    case 'xp_total': return `Earn ${Number(v).toLocaleString()} XP in total.`;
    case 'sessions_completed':
      if (c.both_users) return `${v} quests between the two of you inside one four-week block.`;
      return `Log ${plural(v, 'quest')}${c.type ? ` of the ${c.type} kind` : ''}.`;
    case 'skirmish_count': return `Log ${plural(v, 'skirmish', 'skirmishes')}.`;
    case 'steps_gained': return `Climb ${plural(v, 'ladder rung')}.`;
    case 'pr_count': return `Set ${plural(v, 'personal record')}.`;
    case 'pledges_kept': return `Keep ${plural(v, 'pledge')}.`;
    case 'perfect_weeks': return `Complete ${plural(v, 'Perfect Week')}.`;
    case 'quiz_done': return 'Finish the placement quiz.';
    case 'vest_used': return 'Train once under the weight vest.';
    case 'ladder_step': return `Reach ${stepName(c.step_id)} on ${exName(c.exercise)}.`;
    case 'gate_passed': return `Open the ${gate(c.gate)} gate.`;
    case 'both_gate_passed': return `Both of you open the ${gate(c.gate)} gate.`;
    case 'gear_min_tier': return `Every armour slot at ${tier(v)} or better.`;
    case 'zone2_week_minutes':
      if (c.as_pct_of_prescribed) return `Both of you at ${v}% of the Zone-2 target, ${plural(c.consecutive_weeks ?? 1, 'week')} running.`;
      return `${v} Zone-2 minutes inside one week.`;
    case 'benchmark_value': {
      const b = spec.byBenchmark?.[c.id];
      const name = String(b?.name ?? c.id).replace(/^Boss Battle \d+:\s*/, '');
      if (b?.unit === 'sec') return c.op === 'lte' ? `${name} in ${clock(v)} or faster.` : `${name} of ${clock(v)} or longer.`;
      return `${name}: ${v} or better.`;
    }
    case 'set_value': {
      const at = c.min_step_id ? ` at ${stepName(c.min_step_id)} or higher` : '';
      const wi = c.implement_id ? ` with the ${implementName(c.implement_id)}` : '';
      const u = unitOf(c);
      if (c.op === 'lte') return `${exName(c.exercise)}${at}${wi} in ${fmtValue(v, u)} or less.`;
      return `One set of ${fmtValue(v, u)} on ${exName(c.exercise)}${at}${wi}.`;
    }
    case 'session_exercise_total': {
      const wi = c.implement_id ? ` with the ${implementName(c.implement_id)}` : '';
      return `${fmtValue(v, unitOf(c))} of ${exName(c.exercise)}${wi} inside one quest.`;
    }
    case 'boss_benchmarks_logged': return `Log all ${v ?? 6} tests of boss battle ${c.battle_n}.`;
    case 'boss_outcome':
      return c.outcome === 'flawless' ? 'Finish a boss battle flawless.'
        : c.synergy_required ? 'Bring a boss down that neither of you could have alone.'
        : 'Bring a boss down together.';
    case 'duel_status':
      if (c.status === 'dead_heat') return `${plural(v, 'week')} running that end in a dead heat.`;
      if (c.status === 'belt_changed') return `The belt changes hands ${plural(v, 'week')} running.`;
      return `${plural(v, 'week')} of the duel resolved as ${String(c.status).replace(/_/g, ' ')}.`;
    case 'duel_sum_s': return `One week where the two duel scores add to ${v}.`;
    case 'duo_same_day_sessions': return `Train within ${c.within_minutes ?? 15} minutes of each other ${plural(v, 'time')}.`;
    case 'duo_perfect_week': return 'A Perfect Week for both of you at once.';
    case 'rekindled': return c.duo ? 'Rekindle the duo flame together.' : 'Rekindle the flame after it cools.';
    default: return 'A rule that has not been described yet.';
  }
}

/**
 * Progress toward a numeric criterion, when it can honestly be computed from
 * this warrior's own totals. Anything needing the partner's log, a rolling
 * window, or a "faster than" comparison returns null rather than a bar that
 * would be a guess.
 */
export function criterionProgress(c, m = {}) {
  if (!c || c.op === 'lte' || c.op === 'eq' || typeof c.value !== 'number') return null;
  const bar = (cur) => (typeof cur === 'number' && c.value > 0 ? { current: Math.min(cur, c.value), target: c.value } : null);
  switch (c.metric) {
    case 'flame': return bar(m.flame);
    case 'best_flame': return bar(m.bestFlame);
    case 'duo_flame': return bar(m.duoFlame);
    case 'level': return bar(m.level);
    case 'xp_total': return bar(m.xpTotal);
    case 'sessions_completed': return (c.both_users || c.window) ? null : bar(m.sessions);
    case 'skirmish_count': return bar(m.skirmishes);
    case 'steps_gained': return bar(m.climbs);
    case 'pr_count': return bar(m.prs);
    case 'pledges_kept': return bar(m.pledges);
    case 'perfect_weeks': return bar(m.perfectWeeks);
    case 'gear_min_tier': return bar(m.minGearTier);
    case 'zone2_week_minutes': return (c.both_users || c.as_pct_of_prescribed) ? null : bar(m.bestZone2Week);
    default: return null;
  }
}

/** The flat bag of totals `criterionProgress` reads. Plain data, easy to test. */
export function badgeMetrics(user, prog, weeks) {
  const sessions = (user.sessions ?? []).filter(s => s.type !== 'kindle');
  return {
    flame: prog.flame?.count ?? 0,
    bestFlame: prog.flame?.best ?? 0,
    duoFlame: prog.duo_flame ?? 0,
    level: prog.level?.level ?? 1,
    xpTotal: prog.xp_total ?? 0,
    sessions: sessions.length,
    skirmishes: sessions.filter(s => s.type === 'skirmish').length,
    climbs: (user.climbs ?? []).length,
    prs: (prog.sessions ?? []).reduce((n, s) => n + (s.prs?.length ?? 0), 0),
    pledges: (user.pledges ?? []).filter(p => p.kept).length,
    perfectWeeks: weeks.filter(w => w.perfect).length,
    minGearTier: Object.keys(prog.gear ?? {}).length ? Math.min(...Object.values(prog.gear).map(x => x.tier)) : 0,
    bestZone2Week: Math.max(0, ...Object.values(prog.zone2_by_week ?? {})),
  };
}

// ===================================================================== render
export function render(state) {
  const u = state.users[state.me];
  const p = state.progress;
  const g = state.gam;
  const today = dayKey();
  const weeks = buildWeeks(u, state.spec, g, p, today);
  const empty = !(u.sessions ?? []).length;
  const metrics = badgeMetrics(u, p, weeks);

  // The Monday moment: while the new week is young, the report that matters is
  // the one that just closed. Later in the week the live one is more use.
  const featuredIx = (!empty && dow(today) >= 1 && dow(today) <= 3 && weeks[1]?.done > 0) ? 1 : 0;
  const featured = weeks[featuredIx];
  const rest = weeks.filter((_, i) => i !== featuredIx);

  return page(topbar(state), html`<div class="stack jr">
    ${empty ? emptyHero(state) : reportCard(state, featured, { featured: featuredIx === 1 })}
    ${empty || rest.length === 0 ? raw('') : pastReports(state, rest)}
    ${calendar(weeks, today)}
    ${sessionList(state, u, p)}
    ${prBoard(state, p)}
    ${badgeBoard(state, p, metrics)}
  </div>`, tabbar(state));
}

const tr = (state, key, fallback) => state.copy?.[key] ?? fallback;

function emptyHero(state) {
  return html`<div class="card quest stack">
    <div class="kicker"><span class="pill">Week one</span></div>
    <h1>${tr(state, 'journal.title', 'Journal')}</h1>
    <p class="muted small">${tr(state, 'journal.empty', 'Nothing logged yet this week. The first set writes the first line.')}</p>
    <p class="faint small">Every quest you finish lands here: the sets, the rungs, the records, and a report every Monday.</p>
    <button class="btn" data-action="nav" data-href="#/home">Go to today's quest</button>
  </div>`;
}

// ------------------------------------------------------------ weekly report
function reportCard(state, w, { featured = false, open = true } = {}) {
  if (!w) return raw('');
  const g = state.gam;
  const cls = `card stack jr-report${w.perfect ? ' jr-perfect' : ''}`;
  const kicker = w.perfect ? '<span class="pill jr-halo-pill">Perfect Week</span>'
    : w.held ? '<span class="pill go">Held the line</span>'
    : w.current ? '<span class="pill hot">In progress</span>' : '';
  return html`<section class="${raw(cls)}">
    <div class="kicker">
      <span class="pill">${w.programWeek === 0 ? 'Muster week' : `Week ${w.programWeek}`}</span>
      ${raw(kicker)}
      ${featured ? raw('<span class="pill cool">New week</span>') : ''}
    </div>
    <div class="row-between">
      <h3>${tr(state, 'journal.report.title', 'Weekly Report').replace(/ · .*$/, '')}</h3>
      <span class="tiny">${dateRange(w.start)}</span>
    </div>
    ${raw(reportBody(state, w, g))}
  </section>`;
}

function reportBody(state, w, g) {
  const parts = [];

  // Quests -------------------------------------------------------------
  const pct = w.prescribed ? Math.round((Math.min(w.done, w.prescribed) / w.prescribed) * 100) : 0;
  parts.push(`<div class="jr-block">
    <div class="row-between"><span class="tiny">Quests</span>
      <strong>${w.done} of ${w.prescribed}</strong></div>
    <div class="levelbar"><i style="width:${Math.max(2, pct)}%"></i></div>
    <div class="faint small">${esc(questNote(w))}</div>
  </div>`);

  // XP by source -------------------------------------------------------
  const sources = Object.entries(w.by_source).sort((a, b) => b[1] - a[1]);
  parts.push(`<div class="jr-block">
    <div class="row-between"><span class="tiny">XP this week</span><strong class="xpfloat">+${w.xp.toLocaleString()}</strong></div>
    ${sources.length
      ? sources.map(([k, v]) => `<div class="xpline"><span class="muted small">${esc(SOURCE_LABELS[k] ?? k)}</span><span>+${v.toLocaleString()}</span></div>`).join('')
      : '<div class="faint small">The first set of the week opens this line.</div>'}
  </div>`);

  // Rungs climbed ------------------------------------------------------
  if (w.climbs.length) {
    parts.push(`<div class="jr-block">
      <div class="tiny">Rungs climbed</div>
      ${w.climbs.map(c => `<div class="row-between jr-row"><span class="small truncate">${esc(state.spec.byExercise?.[c.exercise_id]?.name ?? c.exercise_id)}</span>
        <span class="pill go">${esc(c.name)}</span></div>`).join('')}
    </div>`);
  }

  // Personal records ---------------------------------------------------
  if (w.prs.length) {
    parts.push(`<div class="jr-block">
      <div class="tiny">Personal records</div>
      ${w.prs.map(pr => `<div class="row-between jr-row"><span class="small truncate">${esc(state.spec.byExercise?.[pr.exercise_id]?.name ?? pr.exercise_id)}</span>
        <strong class="xpfloat">${esc(fmtValue(pr.value, pr.unit))}</strong></div>`).join('')}
    </div>`);
  }

  // Region levels ------------------------------------------------------
  if (w.regionChanges.length) {
    parts.push(`<div class="jr-block">
      <div class="tiny">Body map</div>
      ${w.regionChanges.map(r => `<div class="row-between jr-row"><span class="small">${esc(r.region.replace(/_/g, ' '))}</span>
        <span class="small muted">level ${r.from} → <strong>${r.to}</strong></span></div>`).join('')}
    </div>`);
  }

  // Zone-2 -------------------------------------------------------------
  const zpct = w.zone2.target ? Math.round((Math.min(w.zone2.done, w.zone2.target) / w.zone2.target) * 100) : 0;
  parts.push(`<div class="jr-block">
    <div class="row-between"><span class="tiny">Zone-2</span>
      <strong>${w.zone2.done} of ${w.zone2.target} min</strong></div>
    <div class="levelbar"><i style="width:${Math.max(2, zpct)}%;background:linear-gradient(90deg,#2b5f96,var(--cool))"></i></div>
  </div>`);

  // Duel line ----------------------------------------------------------
  const duel = duelLine(state, w);
  if (duel) parts.push(`<div class="jr-block"><div class="tiny">Your week, scored against your own plan</div>${duel}</div>`);

  // Perfect Week halo note, then next week -----------------------------
  if (w.perfect) {
    parts.push(`<div class="jr-block jr-halo">
      <div class="jr-halo-title">PERFECT WEEK</div>
      <div class="small muted">${esc(state.copy?.['flame.perfect_week']?.replace('{xp}', String(state.gam.xp?.perfect_week ?? 300))
        ?? 'Every prescribed quest, four of them full, and the shield untouched.')}</div>
    </div>`);
  }
  parts.push(`<div class="jr-block jr-next"><div class="tiny">Next</div>
    <div class="small">${esc(nextWeekLine(state.spec, w.programWeek))}</div></div>`);

  return parts.join('');
}

/** Wording rule: nothing that scolds. Work not yet done is work still to come. */
function questNote(w) {
  if (!w.prescribed) return 'A rest week — nothing was asked of you.';
  if (w.done >= w.prescribed) return `${plural(w.full, 'full quest')}${w.skirmish ? ` and ${plural(w.skirmish, 'skirmish', 'skirmishes')}` : ''} — the whole week.`;
  if (w.current) return `${plural(w.remaining, 'quest')} still to come this week.`;
  return `${plural(w.full, 'full quest')}${w.skirmish ? ` and ${plural(w.skirmish, 'skirmish', 'skirmishes')}` : ''} held${w.shields ? `, ${plural(w.shields, 'shield')} spent to keep the flame` : ''}.`;
}

function duelLine(state, w) {
  const u = state.users[state.me];
  const lock = u.weekLocks?.[w.week_id];
  let S = lock?.S_me;
  if (S == null) {
    try { S = duelScore(u, state.progress, state.spec, state.gam, w.week_id).S; } catch { return ''; }
  }
  const status = lock ? String(lock.status ?? '').replace(/_/g, ' ') : 'provisional';
  return `<div class="row-between jr-row"><span class="small muted">Duel score</span>
    <span><strong>${Number(S) || 0}</strong> <span class="faint small">/ 100 · ${esc(status)}</span></span></div>`;
}

function pastReports(state, weeks) {
  const rows = weeks.map(w => `<details class="jr-past">
    <summary>
      <span class="jr-past-label">${w.programWeek === 0 ? 'Muster' : `Week ${w.programWeek}`}
        <span class="faint small">${esc(dateRange(w.start))}</span></span>
      <span class="jr-past-meta">${w.perfect ? '<span class="pill jr-halo-pill">Perfect</span>' : ''}
        <span class="tiny">${w.done}/${w.prescribed}</span><span class="xpfloat">+${w.xp.toLocaleString()}</span></span>
    </summary>
    <div class="stack jr-past-body">${reportBody(state, w, state.gam)}</div>
  </details>`).join('');
  return html`<details class="card stack jr-archive">
    <summary><h3>Past reports</h3><span class="tiny">${weeks.length} on record</span></summary>
    <div class="jr-past-list">${raw(rows)}</div>
  </details>`;
}

// ---------------------------------------------------------------- calendar
function calendar(weeks, today) {
  const rows = weeks.map(w => {
    const cells = w.days.map(d => {
      const letter = DAY_LETTERS[(dow(d.day) + 6) % 7];
      const s = d.session;
      const title = `${shortDate(d.day)} · ${d.status === 'before' ? 'before you started' : d.status}`;
      if (s) {
        return `<button data-status="${esc(d.status)}" data-action="day" data-key="day-${esc(d.day)}"
          data-session="${esc(s.session_id)}" title="${esc(title)}" aria-label="${esc(title)}">${letter}</button>`;
      }
      return `<span data-status="${esc(d.status)}" title="${esc(title)}">${letter}</span>`;
    }).join('');
    return `<div class="jr-wk${w.perfect ? ' jr-halo-row' : ''}">
      <span class="jr-wk-label">${w.programWeek === 0 ? 'M0' : `W${w.programWeek}`}</span>
      <div class="week">${cells}</div>
    </div>`;
  }).join('');

  return html`<div class="card stack">
    <div class="row-between"><h3>Calendar</h3><span class="tiny">${plural(weeks.length, 'week')}</span></div>
    <div class="jr-cal">${raw(rows)}</div>
    <div class="jr-key">
      <span><i data-status="trained"></i>trained</span>
      <span><i data-status="rest"></i>rest link</span>
      <span><i data-status="shield"></i>shield</span>
      <span><i data-status="pending"></i>today</span>
    </div>
  </div>`;
}

// ------------------------------------------------------------ session list
function sessionList(state, u, p) {
  const gained = new Map((p.sessions ?? []).map(s => [s.session_id, s]));
  const rows = [...(u.sessions ?? [])].reverse().slice(0, 120).map(s => {
    const gd = gained.get(s.session_id);
    const f = gd?.fidelity ?? { hit: 0, prescribed: 0 };
    const name = state.spec.byTemplate?.[s.template_id]?.name ?? s.template_id;
    const type = s.type === 'skirmish' ? tr(state, 'journal.marker.skirmish', 'Skirmish')
      : s.type === 'kindle' ? 'Easy walk' : tr(state, 'journal.marker.full', 'Full quest');
    return `<details class="jr-sess" id="s-${esc(s.session_id)}">
      <summary>
        <span class="grow">
          <span class="jr-sess-day">${esc(shortDate(s.day))}</span>
          <span class="muted small truncate"> · ${esc(name)}</span>
          <div class="faint small">${esc(type)} · ${s.duration_min ?? '—'} min · ${f.hit} of ${f.prescribed} targets</div>
        </span>
        <span class="xpfloat">+${(gd?.xp ?? 0).toLocaleString()}</span>
      </summary>
      <div class="jr-sets">${setsOf(state, s)}</div>
    </details>`;
  }).join('');

  return html`<div class="card stack">
    <div class="row-between"><h3>Sessions</h3><span class="tiny">${plural((u.sessions ?? []).length, 'quest')}</span></div>
    ${rows ? raw(rows) : raw('<p class="faint small">The first quest you finish opens this list.</p>')}
  </div>`;
}

function setsOf(state, s) {
  const groups = [];
  for (const set of s.sets) {
    let gr = groups.find(x => x.exercise_id === set.exercise_id && x.step_id === set.step_id);
    if (!gr) groups.push(gr = { exercise_id: set.exercise_id, step_id: set.step_id, sets: [] });
    gr.sets.push(set);
  }
  if (!groups.length) return '<div class="faint small">No sets were logged on this one.</div>';
  return groups.map(gr => {
    const name = state.spec.byExercise?.[gr.exercise_id]?.name ?? gr.exercise_id;
    const step = state.spec.byStep?.[gr.step_id]?.name;
    const chips = gr.sets.map(x => `<span class="chip jr-set">${esc(fmtValue(x.value, x.unit))}${x.side ? `<span class="faint"> ${esc(x.side)}</span>` : ''}</span>`).join('');
    return `<div class="jr-group">
      <div class="row-between"><strong class="small truncate">${esc(name)}</strong>
        ${step ? `<span class="tiny truncate">${esc(step)}</span>` : ''}</div>
      <div class="chips">${chips}</div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- PR board
function prBoard(state, p) {
  const all = [];
  for (const s of p.sessions ?? []) for (const pr of s.prs ?? []) all.push({ ...pr, day: s.day });
  all.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const rows = all.slice(0, 100).map(pr => `<div class="jr-pr">
    <div class="grow">
      <div class="small truncate">${esc(state.spec.byExercise?.[pr.exercise_id]?.name ?? pr.exercise_id)}</div>
      <div class="tiny truncate">${esc(state.spec.byStep?.[pr.step_id]?.name ?? pr.step_id ?? '')}</div>
    </div>
    <div class="jr-pr-val">
      <strong class="xpfloat">${esc(fmtValue(pr.value, pr.unit))}</strong>
      <div class="faint small">${esc(shortDate(pr.day))}${pr.previous != null ? ` · was ${esc(fmtValue(pr.previous, pr.unit))}` : ''}</div>
    </div>
  </div>`).join('');

  return html`<div class="card stack">
    <div class="row-between"><h3>${tr(state, 'journal.pr_board', 'Record board')}</h3><span class="tiny">${plural(all.length, 'record')}</span></div>
    ${rows ? raw(rows) : raw('<p class="faint small">A record needs one earlier set at the same rung to beat, so the first one lands on your second visit.</p>')}
  </div>`;
}

// ------------------------------------------------------------------ badges
function badgeBoard(state, p, metrics) {
  const all = p.badges ?? [];
  const earned = all.filter(b => b.earned).length;
  const groups = RARITIES.map(r => ({ rarity: r, list: all.filter(b => b.rarity === r) })).filter(x => x.list.length);

  const body = groups.map(gp => {
    const lit = gp.list.filter(b => b.earned).length;
    const rows = [...gp.list]
      .sort((a, b) => (b.earned === a.earned ? 0 : b.earned ? 1 : -1))
      .map(b => badgeRow(state, b, metrics)).join('');
    return `<details class="jr-rgroup" ${lit ? 'open' : ''}>
      <summary><span class="jr-rarity" data-rarity="${esc(gp.rarity)}">${esc(tr(state, `badges.rarity.${gp.rarity}`, gp.rarity))}</span>
        <span class="tiny">${lit} of ${gp.list.length}</span></summary>
      <div class="jr-badges">${rows}</div>
    </details>`;
  }).join('');

  return html`<div class="card stack">
    <div class="row-between"><h3>${tr(state, 'badges.title', 'Badges')}</h3><span class="tiny">${earned} of ${all.length}</span></div>
    ${raw(body)}
  </div>`;
}

function badgeRow(state, b, metrics) {
  const text = criterionText(b.criterion, state.spec, state.gam);
  const prog = b.earned ? null : criterionProgress(b.criterion, metrics);
  const pct = prog ? Math.round((prog.current / prog.target) * 100) : 0;
  return `<div class="jr-badge${b.earned ? ' lit' : ''}" data-rarity="${esc(b.rarity)}">
    <div class="jr-badge-top">
      <span class="jr-dot" data-rarity="${esc(b.rarity)}"></span>
      <strong class="small grow truncate">${esc(b.name)}</strong>
      ${b.duo ? '<span class="pill cool">Duo</span>' : ''}
    </div>
    <div class="tiny jr-crit">${esc(text)}</div>
    ${prog ? `<div class="levelbar jr-bar"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div>
      <div class="faint small">${esc((state.copy?.['badges.progress'] ?? '{current} of {target}')
        .replace('{current}', prog.current.toLocaleString()).replace('{target}', prog.target.toLocaleString()))}</div>` : ''}
  </div>`;
}

// ================================================================= behaviour
/**
 * The only tap this screen owns. Opening a session is native <details>, so the
 * calendar just points the page at one — no re-render, no lost scroll position.
 */
export async function act(action, data) {
  if (action !== 'day' || !data?.session) return;
  const el = document.getElementById(`s-${data.session}`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('jr-flash');
  setTimeout(() => el.classList.remove('jr-flash'), 1200);
}
