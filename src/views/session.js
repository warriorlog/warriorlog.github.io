// The logging screen. One tap per set is the whole design constraint: the target
// is pre-filled with what you did last time, so tapping DONE means "match it"
// and the only reason to open the stepper is to beat it or fall short.
import { html, raw } from '../util.js';
import { dispatch, go, me, beep, render as rerender } from '../app.js';
import { TYPES } from '../events.js';
import { resolveVest, resolveCardio } from '../engine.js';

let sheet = null;          // the open ± stepper, if any
let rest = null;           // { until, label } for the rest timer
let ticker = null;

export function render(state) { return view(state); }

function view(state) {
  const u = me(state);
  const id = state.route.params.id;
  const s = u.openSession?.session_id === id ? u.openSession : u.sessions.find(x => x.session_id === id);
  if (!s) return html`<div class="empty">That quest is finished.<br><button class="btn ghost" data-action="nav" data-href="#/home">Home</button></div>`;

  const spec = state.spec;
  const rows = (s.plan?.rows ?? []).filter(r => r.prescribed !== false);
  const logged = new Map(s.sets.map(x => [key(x), x]));
  const byExercise = groupRows(rows);

  const doneCount = rows.filter(r => logged.has(key(r))).length;
  const cards = byExercise.map(g => exerciseCard(g, spec, logged, state)).join('');

  return html`<div class="stack">
    <header class="topbar">
      <div class="grow">
        <div class="row-between"><strong>${spec.byTemplate[s.template_id]?.name ?? s.template_id}</strong>
          <span class="tiny">${doneCount} / ${rows.length}</span></div>
        <div class="levelbar">${raw(`<i style="width:${rows.length ? Math.round(doneCount / rows.length * 100) : 0}%"></i>`)}</div>
      </div>
      <button class="btn ghost" style="width:auto;padding:0 12px" data-action="finish" data-key="finish">Finish</button>
    </header>
    ${raw(cards)}
    ${restTimer()}
    ${sheet ? raw(stepper(sheet, state)) : ''}
    <button class="btn ghost" data-action="end-early" data-key="end-early">End early and keep what I did</button>
  </div>`;
}

const key = (r) => `${r.exercise_id}|${r.set_index}|${r.side ?? ''}|${r.part ?? ''}`;

/**
 * The frozen plan stores only what reproducibility needs (which step, what
 * target). Loads, treadmill settings and rest times are resolved from the step
 * and this household's equipment at render time, so a stored session stays small
 * and still renders correctly.
 */
function extras(r, state) {
  const step = state.spec.byStep[r.step_id];
  const u = state.users[state.me];
  const eq = u.equipment ?? {};
  const cardio = resolveCardio(step?.cardio, eq);
  const vest = step?.load?.vest_pct
    ? resolveVest(step.load.vest_pct, u.profile?.bodyweight_lb, eq, step.load.cap_lb ?? 30) : 0;
  return {
    mph: cardio?.mph, incline: cardio?.incline,
    rest_sec: restFor(r, state) ?? 60,
    implement_id: step?.implement_id, vest_lb: vest || undefined,
    minutes: r.minutes ?? cardio?.minutes,
  };
}

function restFor(r, state) {
  for (const t of state.spec.templates ?? []) {
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) if (it.exercise_id === r.exercise_id && it.rest_sec != null) return it.rest_sec;
    }
  }
  return 60;
}

function groupRows(rows) {
  const out = [];
  for (const r of rows) {
    let g = out.find(x => x.exercise_id === r.exercise_id && x.step_id === r.step_id);
    if (!g) { g = { exercise_id: r.exercise_id, step_id: r.step_id, rows: [] }; out.push(g); }
    g.rows.push(r);
  }
  return out;
}

function exerciseCard(g, spec, logged, state) {
  const ex = spec.byExercise[g.exercise_id];
  const step = spec.byStep[g.step_id];
  const allDone = g.rows.every(r => logged.has(key(r)));
  const rowsHtml = g.rows.map(r => setRow(r, logged.get(key(r)), step, state)).join('');
  const checklist = step?.checklist_required && ex?.checklist
    ? `<div class="checklist">${ex.checklist.cues.map((c, i) =>
        `<button class="cue" data-action="cue" data-key="${g.exercise_id}-${i}" data-ex="${g.exercise_id}" data-i="${i}" aria-pressed="false">${escape(c)}</button>`).join('')}</div>`
    : '';
  const cues = (ex?.cues ?? []).slice(0, 3).map(c => `<li>${escape(c)}</li>`).join('');
  return `<section class="exercise${allDone ? ' done' : ''}">
    <header>
      <div class="row-between"><h3>${escape(ex?.name ?? g.exercise_id)}</h3>
        <span class="pill">${escape(implementLabel(step))}</span></div>
      <div class="small muted">${escape(step?.name ?? '')}</div>
    </header>
    <ul class="cues">${cues}</ul>
    ${checklist}
    ${rowsHtml}
  </section>`;
}

function implementLabel(step) {
  const l = step?.load ?? {};
  if (l.kind === 'kb') return '53 lb bell';
  if (l.kind === 'db') return `${l.lb} lb`;
  if (String(l.kind).includes('vest')) return 'vest';
  return 'bodyweight';
}

function setRow(r, hit, step, state) {
  const x = extras(r, state);
  const unit = r.unit === 'sec' ? 's' : r.unit === 'min' ? 'min' : r.unit === 'rounds' ? 'rounds' : '';
  const shown = hit ? hit.value : (r.unit === 'min' ? x.minutes : r.A);
  const sideLabel = r.side ? ` ${r.side}` : r.part ? ` ${r.part.toUpperCase()}` : '';
  const cardio = x.mph ? `${x.mph} mph · ${x.incline}%` : '';
  return `<div class="setrow${hit ? ' logged' : ''}" data-row="${escape(key(r))}">
    <span class="setno">${r.set_index}${escape(sideLabel)}</span>
    <button class="target" data-action="edit" data-key="edit-${escape(key(r))}" data-row="${escape(key(r))}">
      <span>${shown ?? ''}</span><span class="unit">${unit}</span>
      ${cardio ? `<span class="last">${cardio}</span>` : (hit ? '' : (r.last != null ? `<span class="last">last ${r.last}</span>` : ''))}
    </button>
    <button class="done-btn" data-action="done" data-key="done-${escape(key(r))}" data-row="${escape(key(r))}">${hit ? '✓' : 'DONE'}</button>
  </div>`;
}

function restTimer() {
  if (!rest) return '';
  const left = Math.max(0, Math.ceil((rest.until - Date.now()) / 1000));
  return `<div class="resttimer" id="rest">
    <span class="clock">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>
    <span class="grow small muted">${escape(rest.label ?? 'Rest')}</span>
    <button class="btn ghost" style="width:auto;padding:0 14px" data-action="skip-rest" data-key="skip-rest">Skip</button>
  </div>`;
}

const PAIN_REGIONS = [
  ['low_back', 'Low back'], ['shoulder', 'Shoulder'], ['knee', 'Knee'], ['wrist', 'Wrist'],
  ['neck', 'Neck'], ['shin', 'Shin'], ['hip', 'Hip'], ['elbow', 'Elbow'], ['other', 'Somewhere else'],
];

function painSheet(sh) {
  return `<div class="sheet-backdrop" data-action="close-sheet" data-key="close">
    <div class="sheet" data-stop>
      <h3>Where did it hurt?</h3>
      <p class="faint small">This never leaves your phone. It is here so the app can back you off before something small becomes something slow.</p>
      <div class="chips">${PAIN_REGIONS.map(([v, label]) =>
        `<button class="chip" data-action="pain-region" data-key="pr-${v}" data-v="${v}" aria-pressed="${sh.region === v}">${label}</button>`).join('')}</div>
      <div style="height:14px"></div>
      <div class="tiny">How bad, out of 10?</div>
      <div class="chips">${[[1, 'Twinge (1-2)'], [4, 'Real (3-5)'], [7, 'Sharp (6+)']].map(([v, label]) =>
        `<button class="chip" data-action="pain-level" data-key="pl-${v}" data-v="${v}" aria-pressed="${sh.level === v}">${label}</button>`).join('')}</div>
      <div style="height:14px"></div>
      <button class="btn" data-action="pain-save" data-key="pain-save"${sh.region ? '' : ' aria-disabled="true"'}>Log it</button>
      <div style="height:8px"></div>
      <p class="faint small">Sharp pain means stop for today, whatever the plan says.</p>
    </div>
  </div>`;
}

function stepper(sh, state) {
  if (sh.mode === 'pain') return painSheet(sh);
  const unit = sh.unit === 'sec' ? 'seconds' : sh.unit === 'min' ? 'minutes' : sh.unit === 'rounds' ? 'rounds' : 'reps';
  return `<div class="sheet-backdrop" data-action="close-sheet" data-key="close">
    <div class="sheet" data-stop>
      <div class="row-between"><h3>${escape(sh.name)}</h3><span class="tiny">${escape(unit)}</span></div>
      <div class="stepper">
        <button data-action="dec" data-key="dec">−</button>
        <span class="value" id="sheet-value">${sh.value}</span>
        <button data-action="inc" data-key="inc">+</button>
      </div>
      <div class="small muted center">Target ${sh.A}${sh.A !== sh.B ? ` to ${sh.B}` : ''}${sh.last != null ? ` · last time ${sh.last}` : ''}</div>
      <div style="height:14px"></div>
      <div class="tiny">How hard was that?</div>
      <div class="chips">
        ${[['4', 'Easy'], ['2', 'Solid'], ['0', 'All out']].map(([v, l]) =>
          `<button class="chip" data-action="rir" data-key="rir-${v}" data-v="${v}" aria-pressed="${String(sh.rir) === v}">${l}</button>`).join('')}
      </div>
      <div style="height:10px"></div>
      <button class="btn" data-action="save-set" data-key="save">Log it</button>
      <div style="height:8px"></div>
      <button class="btn ghost" data-action="pain" data-key="pain">Something hurt</button>
    </div>
  </div>`;
}

const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- actions
const checklistState = new Map();

export async function act(action, data, state) {
  const u = me(state);
  const s = u.openSession;
  const rows = (s?.plan?.rows ?? []);
  const find = (k) => rows.find(r => key(r) === k);

  switch (action) {
    case 'nav': go(data.href); return;

    case 'done': {
      const r = find(data.row);
      if (!r) return;
      const already = s.sets.some(x => key(x) === data.row);
      if (already) return;                       // a second tap is not a second set
      await logSet(state, s, r, r.unit === 'min' ? extras(r, state).minutes : r.A);
      startRest(r, state);
      return;
    }

    case 'edit': {
      const r = find(data.row);
      if (!r) return;
      const hit = s.sets.find(x => key(x) === data.row);
      const step = state.spec.byStep[r.step_id];
      sheet = {
        rowKey: data.row, value: hit?.value ?? (r.unit === 'min' ? extras(r, state).minutes : r.A),
        A: r.A, B: r.B, unit: r.unit, last: r.last ?? null, rir: hit?.rir ?? null,
        name: `${state.spec.byExercise[r.exercise_id]?.name ?? r.exercise_id} · set ${r.set_index}`,
      };
      rerender(); return;
    }

    case 'inc': case 'dec': {
      if (!sheet) return;
      const stepBy = sheet.unit === 'sec' ? 5 : 1;
      sheet.value = Math.max(0, sheet.value + (action === 'inc' ? stepBy : -stepBy));
      const el = document.getElementById('sheet-value');
      if (el) el.textContent = sheet.value;
      return;
    }

    case 'rir': { if (sheet) { sheet.rir = Number(data.v); rerender(); } return; }

    case 'save-set': {
      if (!sheet) return;
      const r = find(sheet.rowKey);
      const value = sheet.value, rir = sheet.rir;
      sheet = null;
      if (r) { await logSet(state, s, r, value, { rir }); startRest(r, state); }
      return;
    }

    case 'close-sheet': { sheet = null; rerender(); return; }

    case 'cue': {
      const k = `${data.ex}:${data.i}`;
      const now = !checklistState.get(k);
      checklistState.set(k, now);
      const el = document.querySelector(`[data-key="${data.ex}-${data.i}"]`);
      el?.setAttribute('aria-pressed', String(now));
      return;
    }

    case 'pain': {
      if (sheet) sheet = { ...sheet, mode: 'pain', region: null, level: 4 };
      rerender();
      return;
    }

    case 'pain-region': { if (sheet) { sheet.region = data.v; rerender(); } return; }
    case 'pain-level': { if (sheet) { sheet.level = Number(data.v); rerender(); } return; }

    case 'pain-save': {
      const r = find(sheet?.rowKey);
      const region = sheet?.region ?? 'other';
      const level = sheet?.level ?? 4;
      sheet = null;
      if (r) {
        await dispatch(TYPES.PAIN, { exercise_id: r.exercise_id, step_id: r.step_id, region, level });
        const { toast } = await import('../app.js');
        toast(level >= 3
          ? 'Noted. Stop this exercise for today. Two of these in a week and the app steps you back a rung.'
          : 'Noted. Keep an eye on it.');
      }
      return;
    }

    case 'skip-rest': { rest = null; stopTicker(); rerender(); return; }

    case 'finish': case 'end-early': {
      if (!s) return;
      const done = s.sets.length;
      const prescribed = rows.filter(r => r.prescribed !== false).length;
      const type = action === 'end-early' && done < prescribed ? 'ember' : (s.type ?? 'full');
      await dispatch(TYPES.SESSION_END, {
        session_id: s.session_id, duration_min: minutesSince(s.started_at), type,
      }, { render: false });
      rest = null; stopTicker(); sheet = null;
      go(`#/complete/${s.session_id}`);
      return;
    }
  }
}

async function logSet(state, session, r, value, extra = {}) {
  const x = extras(r, state);
  const anyAmber = [...checklistState.entries()].some(([k, v]) => k.startsWith(`${r.exercise_id}:`) && v);
  await dispatch(TYPES.SET, {
    session_id: session.session_id, exercise_id: r.exercise_id, step_id: r.step_id,
    set_index: r.set_index, side: r.side ?? null, part: r.part ?? null,
    unit: r.unit, value, A: r.A, B: r.B,
    implement_id: x.implement_id, vest_lb: x.vest_lb,
    checklist_ok: r.unit === 'reps' ? !anyAmber : undefined,
    talk_test_ok: r.unit === 'min' ? true : undefined,
    done: true, ...extra,
  });
  beep();
}

function startRest(r, state) {
  const secs = extras(r, state).rest_sec;
  if (!secs) return;
  rest = { until: Date.now() + secs * 1000, label: 'Rest' };
  stopTicker();
  ticker = setInterval(() => {
    if (!rest) return stopTicker();
    const left = rest.until - Date.now();
    const el = document.querySelector('#rest .clock');
    if (el) {
      const s = Math.max(0, Math.ceil(left / 1000));
      el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (left <= 0) { rest = null; stopTicker(); beep(); rerender(); }
  }, 250);
}

function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

function minutesSince(iso) {
  const start = Date.parse(iso);
  return Number.isFinite(start) ? Math.max(1, Math.round((Date.now() - start) / 60000)) : null;
}

export function mounted() {
  // Keep the screen awake: a phone locking mid-set costs a tap and a swear word.
  navigator.wakeLock?.request?.('screen').catch(() => {});
}
