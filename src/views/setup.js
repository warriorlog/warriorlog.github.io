// Onboarding: who is this phone, what iron is in the house, and a 60-second
// placement so day one is neither insulting nor dangerous.
import { html, raw } from '../util.js';
import { dispatch, go, recompute } from '../app.js';
import { TYPES } from '../events.js';

const draft = { user: null, profile: {}, equipment: {}, answers: {}, screens: {}, step: 0 };

const STEPS = ['who', 'equipment', 'health', 'placement', 'done'];

export function render(state) {
  const spec = state.spec;
  const step = STEPS[draft.step];
  const body = step === 'who' ? who(state)
    : step === 'equipment' ? equipment(state)
    : step === 'health' ? health(state)
    : step === 'placement' ? placement(state)
    : done(state);
  return html`<div class="stack">
    <header class="topbar"><strong>Warriorlog</strong><span class="tiny">${step} · ${draft.step + 1} of ${STEPS.length}</span></header>
    ${body}
  </div>`;
}

function who(state) {
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  const iosSafari = /iP(hone|ad)/.test(navigator.userAgent) && !installed;
  return html`<div class="stack">
    ${iosSafari ? raw(`<div class="card gate"><h3>Install first</h3><p class="muted small">On iPhone the home-screen app keeps its own storage, so anything you set up in Safari would not be there afterwards. Tap Share, then <strong>Add to Home Screen</strong>, and open Warriorlog from your home screen before setting up.</p></div>`) : ''}
    <div class="card stack">
      <h2>Which warrior is this phone?</h2>
      <p class="muted small">Each phone logs for one person. The other profile is visible but read-only here.</p>
      <button class="btn" data-action="pick" data-key="sean" data-user="sean">I am Sean</button>
      <button class="btn secondary" data-action="pick" data-key="cat" data-user="cat">I am Cat</button>
    </div>
  </div>`;
}

const DBS = [8, 10, 12, 20, 35];

function equipment(state) {
  const e = draft.equipment;
  const dbRow = (lb) => html`<div class="row-between">
    <span>${lb} lb dumbbells</span>
    <span class="chips">
      ${raw(['pair', 'single', 'none'].map(v =>
        `<button class="chip" data-action="db" data-key="${lb}-${v}" data-lb="${lb}" data-v="${v}" aria-pressed="${(e.dumbbells?.[lb] ?? 'pair') === v}">${v}</button>`).join(''))}
    </span>
  </div>`;
  return html`<div class="stack">
    <div class="card stack">
      <h2>What iron is in the house?</h2>
      <p class="muted small">Anything you do not have is skipped, and the ladders bridge the gap with tempo and reps instead.</p>
      ${raw(DBS.map(lb => dbRow(lb).__html).join('<div style="height:8px"></div>'))}
    </div>
    <div class="card stack">
      <h3>Weighted vest</h3>
      <label class="row-between"><span class="small muted">Heaviest setting (lb)</span>
        <input type="number" inputmode="numeric" data-change="vest_max" value="${e.vest_max_lb ?? 20}" style="width:88px"></label>
      <label class="row-between"><span class="small muted">Smallest increment (lb)</span>
        <input type="number" inputmode="numeric" data-change="vest_inc" value="${e.vest_increment_lb ?? 5}" style="width:88px"></label>
    </div>
    <div class="card stack">
      <h3>Treadmill</h3>
      <label class="row-between"><span class="small muted">Max incline (%)</span>
        <input type="number" inputmode="numeric" data-change="tm_incline" value="${e.treadmill_max_incline ?? 12}" style="width:88px"></label>
      <label class="row-between"><span class="small muted">Max speed (mph)</span>
        <input type="number" inputmode="decimal" data-change="tm_mph" value="${e.treadmill_max_mph ?? 10}" style="width:88px"></label>
    </div>
    <div class="card stack">
      <h3>Chair and couch</h3>
      <label class="row-between"><span class="small muted">Chair seat height (inches)</span>
        <input type="number" inputmode="numeric" data-change="chair" value="${e.chair_height_in ?? 18}" style="width:88px"></label>
      <p class="faint small">Brace it against a wall. If the seat is above your knee, the app uses a couch cushion instead.</p>
    </div>
    <button class="btn" data-action="next" data-key="eq">Continue</button>
  </div>`;
}

function health(state) {
  const q = state.spec.placement?.questions ?? [];
  const screens = q.filter(x => x.group === 'screen' || x.id?.startsWith('screen') || x.scope === 'screen');
  const list = screens.length ? screens : [
    { id: 'parq', prompt: 'Any chest pain, dizziness, a diagnosed heart condition, high blood pressure, or a doctor telling you to limit exercise?', type: 'bool' },
    { id: 'shoulder', prompt: 'Can you do 10 slow wall slides overhead with no pain?', type: 'bool' },
    { id: 'hipknee', prompt: 'Can you do 10 sit-to-stands from a chair with no pain?', type: 'bool' },
  ];
  return html`<div class="stack">
    <div class="card stack">
      <h2>Before we load anything</h2>
      <p class="muted small">Three questions. They decide what stays locked, not whether you can train.</p>
    </div>
    ${raw(list.map(x => `<div class="card stack">
      <div>${x.prompt}</div>
      <div class="chips">
        <button class="chip" data-action="screen" data-key="${x.id}-y" data-q="${x.id}" data-v="yes" aria-pressed="${draft.screens[x.id] === 'yes'}">Yes</button>
        <button class="chip" data-action="screen" data-key="${x.id}-n" data-q="${x.id}" data-v="no" aria-pressed="${draft.screens[x.id] === 'no'}">No</button>
      </div>
    </div>`).join(''))}
    <button class="btn" data-action="next" data-key="health">Continue</button>
  </div>`;
}

const QUIZ = [
  { id: 'q1', prompt: 'Most clean full push-ups you can do right now', type: 'choice',
    choices: [['0', 'None yet'], ['1-4', '1 to 4'], ['5-9', '5 to 9'], ['10-14', '10 to 14'], ['15+', '15 or more']] },
  { id: 'q2', prompt: 'Chair sit-to-stands', type: 'choice',
    choices: [['<10', 'Fewer than 10'], ['10', '10 comfortably'], ['15deep', '15, full depth']] },
  { id: 'q3', prompt: 'How long can you hold a plank?', type: 'choice',
    choices: [['<20', 'Under 20 s'], ['20-45', '20 to 45 s'], ['>45', 'Over 45 s']] },
  { id: 'q4', prompt: '10 wall hinges keeping a flat back?', type: 'choice',
    choices: [['no', 'Not yet'], ['yes', 'Yes, all ten']] },
  { id: 'q5', prompt: '10 overhead presses with 8 lb, comfortably?', type: 'choice',
    choices: [['no', 'Not yet'], ['yes', 'Yes'], ['easy', 'Yes, easily']] },
  { id: 'q6', prompt: 'Hold a 20 lb dumbbell at your side for 30 s without leaning?', type: 'choice',
    choices: [['no', 'Not yet'], ['yes', 'Yes']] },
  { id: 'q7', prompt: 'Walking 20 minutes at 3 mph is…', type: 'choice',
    choices: [['hard', 'A lot right now'], ['ok', 'Comfortable'], ['jog', 'Easy, and I can jog 5 min']] },
];

function placement(state) {
  return html`<div class="stack">
    <div class="card stack">
      <h2>Where you start</h2>
      <p class="muted small">Answer honestly. Every rung is earned from here, and starting too high is the fastest way to get hurt.</p>
    </div>
    ${raw(QUIZ.map(q => `<div class="card stack">
      <div>${q.prompt}</div>
      <div class="chips">${q.choices.map(([v, label]) =>
        `<button class="chip" data-action="answer" data-key="${q.id}-${v}" data-q="${q.id}" data-v="${v}" aria-pressed="${draft.answers[q.id] === v}">${label}</button>`).join('')}</div>
    </div>`).join(''))}
    <div class="card stack">
      <h3>Body weight</h3>
      <p class="faint small">Used only on this phone, to size the vest and pick your goblet test load. It is never synced.</p>
      <input type="number" inputmode="decimal" data-change="bw" value="${draft.profile.bodyweight_lb ?? ''}" placeholder="lb">
    </div>
    <button class="btn" data-action="finish" data-key="finish">Start training</button>
  </div>`;
}

function done() {
  return html`<div class="empty">Forging your ladders…</div>`;
}

// ---------------------------------------------------------------- placement
/** Map the quiz answers onto a starting rung for every ladder. */
export function startSteps(answers, screens, spec) {
  const s = {};
  const set = (ex, step) => { if (spec.byStep?.[step]) s[ex] = step; };

  set('push_up', { '0': 'push_up.wall', '1-4': 'push_up.knee', '5-9': 'push_up.full', '10-14': 'push_up.full', '15+': 'push_up.full_high' }[answers.q1] ?? 'push_up.wall');
  set('goblet_squat', { '<10': 'goblet_squat.chair', '10': 'goblet_squat.bw_squat', '15deep': 'goblet_squat.db12' }[answers.q2] ?? 'goblet_squat.chair');
  if (answers.q3 === '20-45') { set('hollow_hold', 'hollow_hold.tuck_hold'); set('plank_side_plank', 'plank_side_plank.short'); }
  if (answers.q3 === '>45') { set('hollow_hold', 'hollow_hold.tuck_extend'); set('plank_side_plank', 'plank_side_plank.medium'); }
  if (answers.q4 === 'yes') set('hinge_deadlift', 'hinge_deadlift.rdl_12');
  if (answers.q5 === 'yes') set('db_overhead_press', 'db_overhead_press.half_kneel_10');
  if (answers.q5 === 'easy') set('db_overhead_press', 'db_overhead_press.half_kneel_12');
  if (answers.q6 === 'yes') { set('db_row', 'db_row.db20'); set('suitcase_carry', 'suitcase_carry.db20'); set('farmer_carry', 'farmer_carry.db20'); }
  set('treadmill_zone2', { hard: 'treadmill_zone2.flat_20', ok: 'treadmill_zone2.w30_2', jog: 'treadmill_zone2.w30_4' }[answers.q7] ?? 'treadmill_zone2.flat_20');

  // A failed shoulder screen holds every overhead ladder at its first rung.
  // The screen's id comes from the program data, so match on meaning, not on an
  // exact key that a data edit could rename out from under us.
  const shoulderKey = Object.keys(screens).find(k => /shoulder|slide/i.test(k));
  if (shoulderKey && screens[shoulderKey] === 'no') {
    delete s.db_overhead_press;
    s.db_overhead_press = spec.byExercise.db_overhead_press.ladder[0].id;
    s.pike_push_up = spec.byExercise.pike_push_up.ladder[0].id;
  }
  return s;
}

// ---------------------------------------------------------------- actions
export async function act(action, data, state) {
  if (action === 'pick') { draft.user = data.user; draft.step = 1; state.me = data.user; rerender(); return; }
  if (action === 'db') { (draft.equipment.dumbbells ??= {})[data.lb] = data.v; rerender(); return; }
  if (action === 'screen') { draft.screens[data.q] = data.v; rerender(); return; }
  if (action === 'answer') { draft.answers[data.q] = data.v; rerender(); return; }
  if (action === 'next') { draft.step++; rerender(); return; }
  if (action === 'finish') return finish(state);
}

export function changed(field, el) {
  const n = Number(el.value);
  const map = {
    vest_max: () => draft.equipment.vest_max_lb = n,
    vest_inc: () => draft.equipment.vest_increment_lb = n,
    tm_incline: () => draft.equipment.treadmill_max_incline = n,
    tm_mph: () => draft.equipment.treadmill_max_mph = n,
    chair: () => draft.equipment.chair_height_in = n,
    bw: () => draft.profile.bodyweight_lb = n,
  };
  map[field]?.();
}

function rerender() { import('../app.js').then(m => m.render()); }

async function finish(state) {
  const { settings } = await import('../store.js');
  settings.write({ user: draft.user });
  state.me = draft.user;

  const eq = {
    treadmill: true, kb: [53],
    dumbbells: Object.fromEntries([8, 10, 12, 20, 35].map(lb => [lb, draft.equipment.dumbbells?.[lb] ?? 'pair'])),
    vest_max_lb: draft.equipment.vest_max_lb ?? 20,
    vest_increment_lb: draft.equipment.vest_increment_lb ?? 5,
    vest_min_lb: draft.equipment.vest_increment_lb ?? 5,
    treadmill_max_incline: draft.equipment.treadmill_max_incline ?? 12,
    treadmill_max_mph: draft.equipment.treadmill_max_mph ?? 10,
    chair_height_in: draft.equipment.chair_height_in ?? 18,
    couch_edge: true,
  };
  const startMonday = nextMonday();
  await dispatch(TYPES.PROFILE, {
    name: draft.user === 'sean' ? 'Sean' : 'Cat',
    program_start: startMonday, rest_dow: 0, session_minutes: 50,
    bodyweight_lb: draft.profile.bodyweight_lb ?? null,
  }, { render: false });
  await dispatch(TYPES.EQUIPMENT, eq, { render: false });
  await dispatch(TYPES.SCREEN, draft.screens, { render: false });
  await dispatch(TYPES.QUIZ, draft.answers, { render: false });
  await dispatch(TYPES.ASSESSMENT, {
    start_steps: startSteps(draft.answers, draft.screens, state.spec),
    completed_at: new Date().toISOString(),
  }, { render: false });
  recompute();
  go('#/home');
}

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
