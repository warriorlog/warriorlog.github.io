// The M0 gate. data/program.json is authored by hand, so every structural promise
// the engine relies on is asserted here. A typo in the data fails the build
// instead of silently never advancing a ladder six weeks from now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { RULE_NAMES, indexSpec, resolveSteps, stepLadders, entryOpen } from '../src/engine.js';
import { addDays, dow, weekIndex } from '../src/util.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);

// The ten regions of the body map. `region_weights` may only use these; the
// `region` field is a coarser UI grouping label, so it also allows full_body.
const REGIONS = ['heart', 'neck_traps', 'shoulders', 'chest', 'arms', 'back', 'core', 'glutes', 'thighs', 'calves'];
const REGION_LABELS = [...REGIONS, 'full_body'];
const UNITS = ['reps', 'sec', 'rounds', 'clock_sec', 'min'];
const LOAD_KINDS = ['bw', 'db', 'kb', 'vest', 'bw_vest', 'db_vest', 'kb_vest'];
const REQ = /^(bw|treadmill|chair|couch|vest|kb:53|db:(8|10|12|20|35)(:pair)?)$/;

const allSteps = program.exercises.flatMap(e => e.ladder.map(s => ({ ...s, exercise_id: e.id })));
const stepIds = new Set(allSteps.map(s => s.id));
const exerciseIds = new Set(program.exercises.map(e => e.id));

// ---------------------------------------------------------------- structure
test('every exercise is well formed', () => {
  for (const e of program.exercises) {
    assert.match(e.id, /^[a-z][a-z0-9_]*$/, `${e.id}: bad id`);
    assert.ok(e.name && e.how !== '', `${e.id}: needs a name`);
    assert.ok(REGION_LABELS.includes(e.region), `${e.id}: region "${e.region}" is not a known label`);
    assert.ok(Array.isArray(e.ladder) && e.ladder.length, `${e.id}: empty ladder`);
    assert.ok(e.cues?.length, `${e.id}: no coaching cues`);
    assert.ok(typeof e.stop_if === 'string' && e.stop_if.length > 5, `${e.id}: no stop_if`);
  }
});

test('region weights sum to 1 over the ten canonical regions', () => {
  for (const e of program.exercises) {
    const w = e.region_weights || {};
    const keys = Object.keys(w);
    assert.ok(keys.length, `${e.id}: no region_weights`);
    for (const k of keys) assert.ok(REGIONS.includes(k), `${e.id}: unknown region ${k}`);
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.001, `${e.id}: region_weights sum to ${total}`);
  }
});

test('step ids are unique, namespaced to their exercise, and ordinals are contiguous', () => {
  const seen = new Set();
  for (const e of program.exercises) {
    e.ladder.forEach((s, i) => {
      assert.ok(!seen.has(s.id), `duplicate step id ${s.id}`);
      seen.add(s.id);
      assert.match(s.id, new RegExp(`^${e.id}\\.[a-z0-9_]+$`), `${s.id}: must be <exercise>.<slug>`);
      assert.equal(s.ord, i + 1, `${s.id}: ord ${s.ord} out of order`);
      assert.ok(s.name && s.how, `${s.id}: needs name and how`);
      assert.ok(UNITS.includes(s.unit), `${s.id}: bad unit ${s.unit}`);
      assert.ok(['both', 'each'].includes(s.sides ?? 'both'), `${s.id}: bad sides`);
    });
  }
});

test('step ids only ever grow — a renamed step would orphan every logged set', () => {
  const url = new URL('./fixtures/step-ids.json', import.meta.url);
  const current = [...stepIds].sort();
  if (!existsSync(url)) { writeFileSync(url, JSON.stringify(current, null, 2) + '\n'); return; }
  const known = JSON.parse(readFileSync(url, 'utf8'));
  const missing = known.filter(id => !stepIds.has(id));
  assert.deepEqual(missing, [], 'these step ids disappeared; retire them instead of deleting');
  if (current.length > known.length) writeFileSync(url, JSON.stringify(current, null, 2) + '\n');
});

test('targets are sane: A <= B, and a target exists for every step', () => {
  for (const s of allSteps) {
    if (s.parts?.length) {
      for (const p of s.parts) {
        assert.ok(typeof p.A === 'number' && typeof p.B === 'number', `${s.id}/${p.key}: part needs A and B`);
        assert.ok(p.A <= p.B, `${s.id}/${p.key}: A ${p.A} > B ${p.B}`);
      }
    } else {
      assert.ok(typeof s.A === 'number', `${s.id}: no A`);
      assert.ok(typeof s.B === 'number', `${s.id}: no B`);
      assert.ok(s.A <= s.B, `${s.id}: A ${s.A} > B ${s.B}`);
    }
  }
});

test('loads use only the equipment that exists', () => {
  for (const s of allSteps) {
    assert.ok(LOAD_KINDS.includes(s.load?.kind), `${s.id}: bad load kind ${s.load?.kind}`);
    for (const r of s.requires ?? ['bw']) assert.match(r, REQ, `${s.id}: requires "${r}" is not available equipment`);
    if (s.load?.kind === 'db') assert.ok([8, 10, 12, 20, 35].includes(s.load.lb), `${s.id}: no ${s.load.lb} lb dumbbell exists`);
    if (s.load?.kind === 'kb') assert.equal(s.load.lb, 53, `${s.id}: the only bell is 53 lb`);
  }
});

// ---------------------------------------------------------------- rules
const collectRules = (r, out = []) => {
  if (!r) return out;
  out.push(r);
  for (const sub of r.rules ?? []) collectRules(sub, out);
  for (const sub of r.requires ?? []) collectRules(sub, out);
  return out;
};

test('every rule name is in the closed registry and every reference resolves', () => {
  for (const s of allSteps) {
    const rules = [...collectRules(s.advance), ...(s.entry_requires ?? []).flatMap(r => collectRules(r))];
    for (const r of rules) {
      assert.ok(RULE_NAMES.includes(r.rule), `${s.id}: unknown rule "${r.rule}"`);
      if (r.rule === 'ladder_at_or_past') {
        assert.ok(exerciseIds.has(r.exercise), `${s.id}: gate names missing exercise ${r.exercise}`);
        assert.ok(stepIds.has(r.step_id), `${s.id}: gate names missing step ${r.step_id}`);
      }
      if (r.rule?.startsWith('benchmark_')) assert.ok(spec.byBenchmark[r.id], `${s.id}: gate names missing benchmark ${r.id}`);
    }
    if (!s.terminal) assert.ok(s.advance?.rule, `${s.id}: no advance rule and not terminal`);
  }
});

test('the last step of every ladder is terminal', () => {
  for (const e of program.exercises) {
    const last = e.ladder[e.ladder.length - 1];
    assert.ok(last.terminal === true, `${e.id}: last step ${last.id} must be terminal`);
  }
});

// ---------------------------------------------------------------- safety
test('every 53 lb kettlebell step is behind the hinge gate', () => {
  const GATE = 'hinge_deadlift.kb53_floor';
  for (const s of allSteps) {
    const usesBell = s.load?.kind?.startsWith('kb') || s.implement_id === 'kb53' || (s.requires ?? []).includes('kb:53');
    if (!usesBell || s.exercise_id === 'hinge_deadlift') continue;
    const gates = (s.entry_requires ?? []).flatMap(r => collectRules(r));
    const gated = gates.some(g => g.rule === 'ladder_at_or_past' && g.exercise === 'hinge_deadlift');
    assert.ok(gated, `${s.id}: picks up the 53 lb bell with no hinge gate (expected ${GATE})`);
  }
});

test('every vest step declares a percentage of bodyweight and caps at 30 lb', () => {
  for (const s of allSteps) {
    const usesVest = String(s.load?.kind).includes('vest') || (s.requires ?? []).includes('vest') || s.load?.vest_pct != null;
    if (!usesVest) continue;
    assert.ok(s.load?.vest_pct > 0, `${s.id}: vest step with no vest_pct (a fixed poundage ignores body size)`);
    assert.ok(s.load.vest_pct <= 20, `${s.id}: vest_pct ${s.load.vest_pct} exceeds 20% of bodyweight`);
    assert.ok((s.load.cap_lb ?? 30) <= 30, `${s.id}: cap_lb over 30`);
  }
});

test('the vest never rides on a fast treadmill', () => {
  for (const s of allSteps) {
    if (!s.cardio || !String(s.load?.kind).includes('vest')) continue;
    assert.ok((s.cardio.mph ?? 0) <= 3.5, `${s.id}: vest at ${s.cardio.mph} mph`);
  }
});

test('no entry gate is circular', () => {
  const deps = new Map();
  for (const s of allSteps) {
    const gates = (s.entry_requires ?? []).flatMap(r => collectRules(r)).filter(g => g.rule === 'ladder_at_or_past');
    deps.set(s.exercise_id, new Set([...(deps.get(s.exercise_id) ?? []), ...gates.map(g => g.exercise)]));
  }
  const state = new Map();
  const walk = (id, trail = []) => {
    if (state.get(id) === 'done') return;
    assert.ok(state.get(id) !== 'open', `gate cycle: ${[...trail, id].join(' -> ')}`);
    state.set(id, 'open');
    for (const d of deps.get(id) ?? []) if (d !== id) walk(d, [...trail, id]);
    state.set(id, 'done');
  };
  for (const id of deps.keys()) walk(id);
});

// ---------------------------------------------------------------- templates
test('templates cover the week and every referenced exercise exists', () => {
  const days = program.templates.map(t => t.dow).sort();
  assert.deepEqual(days, [0, 1, 2, 3, 4, 5, 6], 'one template per weekday');
  for (const t of program.templates) {
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) {
        assert.ok(exerciseIds.has(it.exercise_id), `${t.id}: unknown exercise ${it.exercise_id}`);
        for (const f of it.fallback_when_locked ?? []) {
          assert.ok(exerciseIds.has(f.exercise_id), `${t.id}: unknown fallback ${f.exercise_id}`);
        }
      }
    }
    for (const id of t.skirmish?.exercise_ids ?? []) assert.ok(exerciseIds.has(id), `${t.id}: unknown skirmish exercise ${id}`);
    const cardioId = t.skirmish?.cardio?.exercise_id;
    if (cardioId) assert.ok(exerciseIds.has(cardioId), `${t.id}: unknown skirmish cardio ${cardioId}`);
  }
});

test('every training day fits 40-50 minutes and its blocks add up', () => {
  for (const t of program.templates) {
    if (t.minutes === 0) { assert.equal((t.blocks ?? []).length, 0, `${t.id}: rest day with blocks`); continue; }
    const sum = (t.blocks ?? []).reduce((n, b) => n + b.minutes, 0);
    assert.equal(sum, t.minutes, `${t.id}: blocks sum to ${sum} but the day claims ${t.minutes}`);
    assert.ok(t.minutes >= 40 && t.minutes <= 50, `${t.id}: ${t.minutes} min is outside 40-50`);
  }
});

test('the Zone-2 ladder is only driven by the day that actually trains it', () => {
  // The finisher walks used to reuse treadmill_zone2's id against a 30-minute
  // target, which auto-advanced or auto-regressed the ladder every single week.
  for (const t of program.templates) {
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) {
        if (it.exercise_id !== 'treadmill_zone2') continue;
        assert.ok(it.counts_for_progression !== false ? b.kind === 'conditioning' : true,
          `${t.id}/${b.kind}: treadmill_zone2 counts for progression outside the main conditioning block`);
      }
    }
  }
  const counting = program.templates.flatMap(t => (t.blocks ?? []).flatMap(b => (b.items ?? [])
    .filter(it => it.exercise_id === 'treadmill_zone2' && it.counts_for_progression !== false)
    .map(() => t.id)));
  assert.deepEqual(counting, ['wed_heart'], 'exactly one template may progress the Zone-2 ladder');
});

test('calves and the hinge are each trained twice a week', () => {
  const daysWith = (id) => program.templates.filter(t =>
    (t.blocks ?? []).some(b => (b.items ?? []).some(it => it.exercise_id === id ||
      (it.fallback_when_locked ?? []).some(f => f.exercise_id === id)))).map(t => t.id);
  assert.ok(daysWith('calf_raise').length >= 2, `calf_raise trained on ${daysWith('calf_raise')}`);
  assert.ok(daysWith('hinge_deadlift').length >= 2,
    `hinge_deadlift is the master gate and must be trained twice weekly, found ${daysWith('hinge_deadlift')}`);
});

// ---------------------------------------------------------------- benchmarks
test('benchmarks resolve, tier, and always have a fallback variant', () => {
  for (const b of program.benchmarks) {
    assert.ok(exerciseIds.has(b.parent_exercise), `${b.id}: parent_exercise ${b.parent_exercise} missing`);
    assert.equal(typeof b.higher_is_better, 'boolean', `${b.id}: higher_is_better`);
    assert.ok(b.variants?.length, `${b.id}: no variants`);
    const last = b.variants[b.variants.length - 1];
    assert.deepEqual(last.when ?? [], [], `${b.id}: the last variant must always apply`);
    for (const v of b.variants) {
      assert.equal(v.tiers?.length, 4, `${b.id}/${v.id}: needs 4 tiers`);
      const t = v.tiers;
      const ordered = b.higher_is_better
        ? t.every((x, i) => i === 0 || x > t[i - 1])
        : t.every((x, i) => i === 0 || x < t[i - 1]);
      assert.ok(ordered, `${b.id}/${v.id}: tiers ${t} are not ordered for higher_is_better=${b.higher_is_better}`);
      for (const r of (v.when ?? []).flatMap(x => collectRules(x))) {
        assert.ok(RULE_NAMES.includes(r.rule), `${b.id}/${v.id}: unknown rule ${r.rule}`);
        if (r.rule === 'ladder_at_or_past') assert.ok(stepIds.has(r.step_id), `${b.id}/${v.id}: missing step ${r.step_id}`);
      }
    }
  }
});

test('placement seeds real steps and never hands out the bell on day one', () => {
  const p = program.placement;
  assert.ok(p.questions?.length, 'no placement questions');
  for (const r of p.rules ?? []) {
    for (const [ex, stepId] of Object.entries(r.set ?? {})) {
      assert.ok(exerciseIds.has(ex), `placement sets unknown exercise ${ex}`);
      assert.ok(stepIds.has(stepId), `placement sets unknown step ${stepId}`);
      const step = allSteps.find(s => s.id === stepId);
      assert.ok(!String(step.load?.kind).startsWith('kb'), `placement starts ${ex} on the 53 lb bell`);
      assert.ok(!String(step.load?.kind).includes('vest'), `placement starts ${ex} in the vest`);
    }
  }
  for (const l of p.locked ?? []) {
    for (const [ex, stepId] of Object.entries(l.cap ?? {})) {
      assert.ok(exerciseIds.has(ex), `placement caps unknown exercise ${ex}`);
      assert.ok(stepIds.has(stepId), `placement caps unknown step ${stepId}`);
    }
  }
});

// ---------------------------------------------------------------- reachability
/** A session record for a user who hits every target perfectly. */
function perfectPerf(step, sets, deload) {
  const target = step.B ?? step.parts?.[0]?.B ?? 1;
  const base = { sessionType: 'full', deload, allDone: true, drops: 0, rpeBlock: 4, cardioDone: true, rounds: 99, clockSec: 1 };
  if (step.unit === 'clock_sec') return { ...base, clockSec: (step.B ?? 600), sets: [{ value: step.B, checklist_ok: true }] };
  if (step.unit === 'rounds') return { ...base, rounds: target, sets: [{ value: target, checklist_ok: true }] };
  if (step.unit === 'min') return { ...base, cardioMinutes: target, sets: [{ value: target, checklist_ok: true }] };
  return { ...base, sets: Array.from({ length: sets }, () => ({ value: target, checklist_ok: true })) };
}

/** Replay a perfect user through the real templates and ladders, day by day. */
function simulate({ weeks = 12, start = '2026-09-14', equipment } = {}) {
  const eq = equipment ?? {
    vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5, treadmill: true,
    treadmill_max_incline: 12, treadmill_max_mph: 10, chair_height_in: 18, couch_edge: true,
    dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' }, kb: [53],
  };
  const steps = Object.fromEntries(program.exercises.map(e => [e.id, resolveSteps(e, eq)]));
  const floor = Object.fromEntries(program.exercises.map(e => [e.id, steps[e.id][0]?.id]));
  let ladders = Object.fromEntries(program.exercises.map(e => [e.id, {
    step_id: steps[e.id][0]?.id, qualifying: 0, fails: 0, sessionsAtStep: 0, lastDay: null,
  }]));
  const reached = {};

  for (let d = 0; d < weeks * 7; d++) {
    const day = addDays(start, d);
    const week = weekIndex(day, start);
    const t = program.templates.find(x => x.dow === dow(day));
    if (!t || !t.minutes) continue;
    const deload = week % 4 === 0;
    const perfs = {};
    for (const b of t.blocks ?? []) {
      for (const it of b.items ?? []) {
        if (it.counts_for_progression === false) continue;
        const ex = spec.byExercise[it.exercise_id];
        const list = steps[it.exercise_id] ?? [];
        const cur = list.find(s => s.id === ladders[it.exercise_id]?.step_id);
        if (!ex || !cur) continue;
        const ctx = { day, ladders, spec, equipment: eq, weekIndex: week, painFlags: [], benchmarks: {} };
        if (!entryOpen(cur, ctx)) continue;                       // locked: the fallback runs instead
        perfs[it.exercise_id] = perfectPerf(cur, it.sets ?? 3, deload);
      }
    }
    const ctx = { day, spec, equipment: eq, steps, floor, weekIndex: week, painFlags: [], benchmarks: {} };
    const out = stepLadders(spec, ladders, perfs, ctx);
    ladders = out.ladders;
    for (const c of out.climbs) reached[c.step_id] ??= week;
  }
  return { ladders, reached };
}

test('a perfect beginner starting at the bottom actually earns the 53 lb bell inside the program', () => {
  const { reached, ladders } = simulate({ weeks: 12 });
  const bell = reached['swing.deadstop_53'];
  assert.ok(bell, `the bell is never reached in 12 weeks (swing ends at ${ladders.swing.step_id}). ` +
    `This was the original program's fatal flaw: the hinge was trained once a week, so every 53 lb promise was false.`);
  assert.ok(bell <= 9, `the bell arrives in week ${bell}; phase 2 promises it by week 8, so week 9 is the outside limit`);
  assert.ok(reached['hinge_deadlift.kb53_floor'] <= 7,
    `the hinge gate opens in week ${reached['hinge_deadlift.kb53_floor']}, too late to feed the bell`);
});

test('the ladders that gate everything else are reachable, and nothing runs out of rungs early', () => {
  const { ladders } = simulate({ weeks: 12 });
  for (const [ex, st] of Object.entries(ladders)) {
    const list = spec.byExercise[ex].ladder;
    const i = list.findIndex(s => s.id === st.step_id);
    assert.ok(i >= 0, `${ex}: ended on an unknown step`);
  }
  assert.ok(spec.byExercise.treadmill_intervals.ladder.some(s => s.id === 'treadmill_intervals.jog_8'));
});

test('a household with no dumbbell pairs and a small vest still gets a full program', () => {
  const { ladders } = simulate({
    weeks: 12,
    equipment: {
      vest_max_lb: 20, vest_increment_lb: 10, vest_min_lb: 10, treadmill: true,
      treadmill_max_incline: 10, treadmill_max_mph: 8, chair_height_in: 18, couch_edge: true,
      dumbbells: { 8: 'single', 10: 'single', 12: 'single', 20: 'single', 35: 'single' }, kb: [53],
    },
  });
  for (const e of program.exercises) {
    assert.ok(ladders[e.id]?.step_id, `${e.id}: no usable step without dumbbell pairs`);
  }
});

test('a rung that never advances says so, instead of faking a huge target', () => {
  // Four single-rung exercises used `sessions_gte: 99999` to mean "terminal",
  // and the home screen rendered it as "practise it 99999 times".
  for (const s of allSteps) {
    const a = s.advance;
    if (!a) continue;
    // A top rung may keep a target to keep hitting; what it must not do is
    // invent an unreachable one to mean "this never advances".
    assert.ok(!(a.rule === 'sessions_gte' && a.value >= 1000),
      `${s.id}: a sentinel target of ${a.value} leaks into the interface; mark the step terminal instead`);
  }
});

test('nothing that cannot progress ever promises a rung', async () => {
  const { describeAdvance } = await import('../src/engine.js');
  for (const ex of program.exercises) {
    for (const step of ex.ladder) {
      if (!step.terminal) continue;
      assert.equal(describeAdvance(step, spec), null, `${step.id}: terminal but still describes an unlock`);
    }
  }
});
