import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePlacement, questionsFor, matches } from '../src/placement.js';
import { indexSpec } from '../src/engine.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const spec = indexSpec(program);
const ord = (ex, step) => spec.byExercise[ex].ladder.findIndex(s => s.id === step);

const CLEAR = { q_parq: false, q_injuries: ['none'], q_shoulder_slides: true, q_hip_sit_stand: true };

test('every comparison the data uses is implemented', () => {
  assert.equal(matches({ q: 'a', op: 'eq', value: 3 }, { a: 3 }), true);
  assert.equal(matches({ q: 'a', op: 'between', value: [5, 9] }, { a: 7 }), true);
  assert.equal(matches({ q: 'a', op: 'between', value: [5, 9] }, { a: 10 }), false);
  assert.equal(matches({ q: 'a', op: 'gte', value: 15 }, { a: 15 }), true);
  assert.equal(matches({ q: 'a', op: 'lte', value: 4 }, { a: 4 }), true);
  assert.equal(matches({ q: 'a', op: 'in', value: ['x', 'y'] }, { a: 'y' }), true);
  assert.equal(matches({ q: 'a', op: 'contains', value: 'knee' }, { a: ['knee', 'wrist'] }), true);
  assert.equal(matches({ q: 'a', op: 'contains', value: 'knee' }, { a: ['wrist'] }), false);
});

test('every ladder gets a real starting rung, even ones no rule mentions', () => {
  const { start_steps } = resolvePlacement(CLEAR, spec);
  for (const ex of program.exercises) {
    assert.ok(start_steps[ex.id], `${ex.id}: no starting step`);
    assert.ok(ex.ladder.some(s => s.id === start_steps[ex.id]), `${ex.id}: unknown step ${start_steps[ex.id]}`);
  }
});

test('a true beginner starts at the bottom of everything that matters', () => {
  const { start_steps } = resolvePlacement({ ...CLEAR, q1_pushups: 0, q2_squat: 'none', q3_plank: 'lt20', q4_hinge: false, q7_cardio: 'cannot_20' }, spec);
  assert.equal(start_steps.push_up, 'push_up.wall');
  assert.equal(start_steps.goblet_squat, 'goblet_squat.chair');
  assert.equal(start_steps.hinge_deadlift, spec.byExercise.hinge_deadlift.ladder[0].id);
  assert.equal(start_steps.swing, spec.byExercise.swing.ladder[0].id, 'the bell is never placed into');
});

test('a stronger starter is placed higher, but never onto the bell or the vest', () => {
  const answers = { ...CLEAR, q1_pushups: 20, q2_squat: 'bw_squat_15', q3_plank: 'gt45', q4_hinge: true, q5_overhead: 'easy', q6_carry: true, q7_cardio: 'can_jog_5' };
  const { start_steps, locked } = resolvePlacement(answers, spec);
  assert.ok(ord('push_up', start_steps.push_up) >= ord('push_up', 'push_up.full'));
  assert.equal(start_steps.goblet_squat, 'goblet_squat.db12');
  for (const [exId, stepId] of Object.entries(start_steps)) {
    // vest_walk is vest work all the way down, which is exactly why the whole
    // ladder starts locked rather than starting on a rung.
    if (locked.includes(exId)) continue;
    const step = spec.byStep[stepId];
    assert.ok(!String(step.load?.kind).startsWith('kb'), `${exId} placed on the 53 lb bell`);
    assert.ok(!String(step.load?.kind).includes('vest'), `${exId} placed into the vest`);
  }
});

test('an injury caps the ladder however strong the ability answers were', () => {
  const strong = { ...CLEAR, q1_pushups: 20, q2_squat: 'bw_squat_15', q3_plank: 'gt45', q4_hinge: true, q6_carry: true };
  const hurt = { ...strong, q_injuries: ['low_back', 'knee'] };
  const a = resolvePlacement(strong, spec).start_steps;
  const b = resolvePlacement(hurt, spec).start_steps;
  assert.equal(b.hinge_deadlift, 'hinge_deadlift.wall_drill', 'a bad back goes back to the wall drill');
  assert.equal(b.goblet_squat, 'goblet_squat.chair', 'a bad knee goes back to the chair');
  assert.ok(ord('hinge_deadlift', b.hinge_deadlift) < ord('hinge_deadlift', a.hinge_deadlift));
});

test('a failed shoulder screen holds every overhead ladder down', () => {
  const { start_steps, caps } = resolvePlacement({ ...CLEAR, q_shoulder_slides: false, q5_overhead: 'easy' }, spec);
  assert.equal(start_steps.db_overhead_press, caps.db_overhead_press);
  assert.equal(start_steps.pike_push_up, caps.pike_push_up);
});

test('a flagged health screen locks running and the tests that need it', () => {
  const { locked, locked_benchmarks, notes } = resolvePlacement({ ...CLEAR, q_parq: true }, spec);
  assert.ok(locked.includes('treadmill_intervals'));
  assert.ok(locked_benchmarks.includes('bb_mile_time'));
  assert.ok(notes.length, 'the user is told why, not just blocked');
});

test('vest walks always start locked, whatever the answers', () => {
  for (const cardio of ['cannot_20', 'comfortable', 'can_jog_5']) {
    const { locked } = resolvePlacement({ ...CLEAR, q7_cardio: cardio }, spec);
    assert.ok(locked.includes('vest_walk'), `${cardio}: vest walks must be earned`);
  }
});

test('the setup screen can find its questions by group', () => {
  assert.ok(questionsFor(spec, 'screen').length >= 3);
  assert.ok(questionsFor(spec, 'placement').length >= 7);
  assert.ok(questionsFor(spec, 'equipment').length >= 5);
});

test('answers record correctly, including the awkward multi-select cases', async () => {
  const { applyAnswer } = await import('../src/placement.js');
  let a = {};
  a = applyAnswer(a, 'q_parq', 'bool', 'false');
  assert.equal(a.q_parq, false, 'a bool answer is a boolean, not the string "false"');
  a = applyAnswer(a, 'q1_pushups', 'int', '12');
  assert.equal(a.q1_pushups, 12);

  a = applyAnswer(a, 'q_injuries', 'multi', 'knee');
  assert.deepEqual(a.q_injuries, ['knee']);
  a = applyAnswer(a, 'q_injuries', 'multi', 'wrist');
  assert.deepEqual(a.q_injuries, ['knee', 'wrist'], 'two flags can be true at once');
  a = applyAnswer(a, 'q_injuries', 'multi', 'knee');
  assert.deepEqual(a.q_injuries, ['wrist'], 'tapping again clears that one');
  a = applyAnswer(a, 'q_injuries', 'multi', 'none');
  assert.deepEqual(a.q_injuries, ['none'], '"none" clears every flag');
  a = applyAnswer(a, 'q_injuries', 'multi', 'knee');
  assert.deepEqual(a.q_injuries, ['knee'], 'and a flag clears "none"');
});

test('the answers a setup run produces really do cap an injured ladder', async () => {
  const { applyAnswer } = await import('../src/placement.js');
  // Exactly the taps a user makes: screens, then the ability questions.
  let a = {};
  for (const [q, t, v] of [
    ['q_parq', 'bool', 'false'], ['q_injuries', 'multi', 'knee'],
    ['q_shoulder_slides', 'bool', 'true'], ['q_hip_sit_stand', 'bool', 'true'],
    ['q1_pushups', 'int', '12'], ['q2_squat', 'choice', 'bw_squat_15'],
    ['q3_plank', 'choice', '20_45'], ['q4_hinge', 'bool', 'true'],
    ['q5_overhead', 'choice', 'easy'], ['q6_carry', 'bool', 'true'],
    ['q7_cardio', 'choice', 'comfortable'],
  ]) a = applyAnswer(a, q, t, v);

  const { start_steps, caps } = resolvePlacement(a, spec);
  assert.ok(caps.goblet_squat, 'a knee flag must produce a goblet ceiling');
  assert.equal(start_steps.goblet_squat, 'goblet_squat.chair',
    'the knee flag beats the strong squat answer');
  assert.equal(start_steps.step_up, 'step_up.low');
  assert.equal(start_steps.push_up, 'push_up.full', 'unrelated ladders are untouched');
});
