// Onboarding, driven entirely by data/program.json's placement block: the
// questions, the rules that turn answers into starting rungs, and the injury
// caps all live in the data, so this file only has to ask and record.
import { html, raw } from '../util.js';
import { dispatch, go, recompute } from '../app.js';
import { TYPES } from '../events.js';
import { resolvePlacement, questionsFor } from '../placement.js';

const draft = { user: null, answers: {}, equipment: {}, bodyweight: null, step: 0 };
const STEPS = ['who', 'equipment', 'screen', 'placement'];

export function render(state) {
  const step = STEPS[draft.step];
  const body = step === 'who' ? who(state)
    : step === 'equipment' ? equipment(state)
    : step === 'screen' ? questionPage(state, 'screen', 'Before we load anything', 'Three quick checks. They decide what stays locked, never whether you can train.')
    : questionPage(state, 'placement', 'Where you start', 'Answer honestly. Every rung is earned from here, and starting too high is the fastest way to get hurt.');
  return html`<div class="stack">
    <header class="topbar">
      <div class="grow">
        <div class="row-between"><strong>Warriorlog</strong><span class="tiny">${draft.step + 1} of ${STEPS.length}</span></div>
        <div class="levelbar">${raw(`<i style="width:${((draft.step + 1) / STEPS.length) * 100}%"></i>`)}</div>
      </div>
    </header>
    ${body}
  </div>`;
}

function who(state) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const tip = standalone ? ''
    : ios
      ? `<div class="card gate"><h3>Add to your home screen first</h3><p class="muted small">On iPhone the home-screen app keeps its own storage, so anything you set up in Safari would not be there afterwards. Tap Share, then <strong>Add to Home Screen</strong>, and open Warriorlog from there.</p></div>`
      : `<div class="card gate"><h3>Install it first</h3><p class="muted small">Installing gives you offline access and a proper app icon.</p>
         <button class="btn secondary" data-action="install" data-key="install" id="install-btn">Add to home screen</button>
         <p class="faint small" id="install-hint">If nothing happens, use your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p></div>`;
  return html`<div class="stack">
    ${raw(tip)}
    <div class="card stack">
      <h2>Which warrior is this phone?</h2>
      <p class="muted small">Each phone logs for one person. The other profile is visible here but read-only.</p>
      <button class="btn" data-action="pick" data-key="sean" data-user="sean">I am Sean</button>
      <button class="btn secondary" data-action="pick" data-key="cat" data-user="cat">I am Cat</button>
    </div>
  </div>`;
}

const DBS = [8, 10, 12, 20, 35];

function equipment(state) {
  const e = draft.equipment;
  const dbRow = (lb) => `<div class="row-between" style="margin-top:8px">
    <span>${lb} lb dumbbells</span>
    <span class="chips">${['pair', 'single', 'none'].map(v =>
      `<button class="chip" data-action="db" data-key="db-${lb}-${v}" data-lb="${lb}" data-v="${v}" aria-pressed="${(e.dumbbells?.[lb] ?? 'pair') === v}">${v}</button>`).join('')}</span>
  </div>`;
  const num = (field, label, value, hint = '') => `<label class="row-between" style="margin-top:10px">
    <span class="small muted grow">${label}${hint ? `<br><span class="faint">${hint}</span>` : ''}</span>
    <input type="number" inputmode="decimal" data-change="${field}" value="${value}" style="width:92px">
  </label>`;
  return html`<div class="stack">
    <div class="card stack">
      <h2>What iron is in the house?</h2>
      <p class="muted small">Anything you do not have is skipped, and the ladders bridge the gap with tempo and reps instead.</p>
      ${raw(DBS.map(dbRow).join(''))}
    </div>
    <div class="card"><h3>Weighted vest</h3>
      ${raw(num('vest_max', 'Heaviest setting (lb)', e.vest_max_lb ?? 20))}
      ${raw(num('vest_inc', 'Smallest increment (lb)', e.vest_increment_lb ?? 5))}
    </div>
    <div class="card"><h3>Treadmill</h3>
      ${raw(num('tm_incline', 'Max incline (%)', e.treadmill_max_incline ?? 12))}
      ${raw(num('tm_mph', 'Max speed (mph)', e.treadmill_max_mph ?? 10))}
    </div>
    <div class="card"><h3>Chair</h3>
      ${raw(num('chair', 'Seat height (inches)', e.chair_height_in ?? 18, 'Brace it against a wall. Above knee height and the app uses a couch cushion instead.'))}
    </div>
    <button class="btn" data-action="next" data-key="next-eq">Continue</button>
  </div>`;
}

function questionPage(state, group, title, blurb) {
  const qs = questionsFor(state.spec, group);
  const cards = qs.map(q => questionCard(q)).join('');
  const last = group === 'placement';
  const bw = last ? `<div class="card stack"><h3>Body weight</h3>
      <p class="faint small">Used only on this phone, to size the vest and pick your goblet test load. It is never synced.</p>
      <input type="number" inputmode="decimal" data-change="bw" value="${draft.bodyweight ?? ''}" placeholder="lb"></div>` : '';
  return html`<div class="stack">
    <div class="card stack"><h2>${title}</h2><p class="muted small">${blurb}</p></div>
    ${raw(cards)}${raw(bw)}
    <button class="btn" data-action="${last ? 'finish' : 'next'}" data-key="next-${group}">${last ? 'Start training' : 'Continue'}</button>
  </div>`;
}

function questionCard(q) {
  const a = draft.answers[q.id];
  let control;
  if (q.type === 'bool') {
    control = [[true, 'Yes'], [false, 'No']].map(([v, label]) =>
      `<button class="chip" data-action="answer" data-key="${q.id}-${v}" data-q="${q.id}" data-t="bool" data-v="${v}" aria-pressed="${a === v}">${label}</button>`).join('');
  } else if (q.type === 'int') {
    control = `<input type="number" inputmode="numeric" data-change="q:${q.id}" value="${a ?? ''}" placeholder="${q.min ?? 0}" style="width:110px">`;
  } else {
    control = (q.choices ?? []).map(c => {
      const on = q.multi ? Array.isArray(a) && a.includes(c.value) : a === c.value;
      return `<button class="chip" data-action="answer" data-key="${q.id}-${c.value}" data-q="${q.id}" data-t="${q.multi ? 'multi' : 'choice'}" data-v="${esc(c.value)}" aria-pressed="${on}">${esc(c.label)}</button>`;
    }).join('');
  }
  return `<div class="card stack">
    <div>${esc(q.prompt)}</div>
    ${q.help ? `<p class="faint small">${esc(q.help)}</p>` : ''}
    <div class="chips">${control}</div>
  </div>`;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- actions
let installPrompt = null;
window.addEventListener?.('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

export async function act(action, data, state) {
  switch (action) {
    case 'install': {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    case 'pick': draft.user = data.user; state.me = data.user; draft.step = 1; return rerender();
    case 'db': (draft.equipment.dumbbells ??= {})[data.lb] = data.v; return rerender();
    case 'answer': {
      const v = data.t === 'bool' ? data.v === 'true' : data.v;
      if (data.t === 'multi') {
        const list = new Set(Array.isArray(draft.answers[data.q]) ? draft.answers[data.q] : []);
        // "None" and a real flag cannot both be true.
        if (v === 'none') { list.clear(); list.add('none'); }
        else { list.delete('none'); list.has(v) ? list.delete(v) : list.add(v); }
        draft.answers[data.q] = [...list];
      } else {
        draft.answers[data.q] = v;
      }
      return rerender();
    }
    case 'next': draft.step++; return rerender();
    case 'finish': return finish(state);
  }
}

export function changed(field, el) {
  if (field.startsWith('q:')) { draft.answers[field.slice(2)] = Number(el.value); return; }
  const n = Number(el.value);
  ({
    vest_max: () => draft.equipment.vest_max_lb = n,
    vest_inc: () => draft.equipment.vest_increment_lb = n,
    tm_incline: () => draft.equipment.treadmill_max_incline = n,
    tm_mph: () => draft.equipment.treadmill_max_mph = n,
    chair: () => draft.equipment.chair_height_in = n,
    bw: () => draft.bodyweight = n,
  })[field]?.();
}

const rerender = () => import('../app.js').then(m => m.render());

async function finish(state) {
  const { settings } = await import('../store.js');
  settings.write({ user: draft.user });
  state.me = draft.user;

  const placement = resolvePlacement(draft.answers, state.spec);
  const eq = {
    treadmill: true, kb: [53], couch_edge: true,
    dumbbells: Object.fromEntries(DBS.map(lb => [lb, draft.equipment.dumbbells?.[lb] ?? 'pair'])),
    vest_max_lb: draft.equipment.vest_max_lb ?? 20,
    vest_increment_lb: draft.equipment.vest_increment_lb ?? 5,
    vest_min_lb: draft.equipment.vest_increment_lb ?? 5,
    treadmill_max_incline: draft.equipment.treadmill_max_incline ?? 12,
    treadmill_max_mph: draft.equipment.treadmill_max_mph ?? 10,
    chair_height_in: draft.equipment.chair_height_in ?? 18,
  };

  await dispatch(TYPES.PROFILE, {
    name: draft.user === 'sean' ? 'Sean' : 'Cat',
    program_start: nextMonday(), rest_dow: 0, session_minutes: 50,
    bodyweight_lb: draft.bodyweight ?? null,
  }, { render: false });
  await dispatch(TYPES.EQUIPMENT, eq, { render: false });
  await dispatch(TYPES.SCREEN, screenAnswers(state, draft.answers), { render: false });
  await dispatch(TYPES.QUIZ, draft.answers, { render: false });
  await dispatch(TYPES.ASSESSMENT, {
    start_steps: placement.start_steps,
    locked: placement.locked,
    locked_benchmarks: placement.locked_benchmarks,
    caps: placement.caps,
    completed_at: new Date().toISOString(),
  }, { render: false });
  recompute();
  go('#/home');
}

/** The health answers, kept out of the public log by events.js's redaction. */
function screenAnswers(state, answers) {
  const out = {};
  for (const q of questionsFor(state.spec, 'screen')) out[q.id] = answers[q.id] ?? null;
  return out;
}

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
