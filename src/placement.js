// Turn placement answers into a starting rung for every ladder, entirely from
// data/program.json. Keeping this out of the view means the rules are testable
// and a future session edits the JSON, never the UI.
import { indexSpec } from './engine.js';

/** Does one `when` clause hold for these answers? */
export function matches(when, answers) {
  if (!when) return true;
  const v = answers[when.q];
  switch (when.op) {
    case 'eq': return v === when.value;
    case 'ne': return v !== when.value;
    case 'gte': return Number(v) >= when.value;
    case 'lte': return Number(v) <= when.value;
    case 'gt': return Number(v) > when.value;
    case 'lt': return Number(v) < when.value;
    case 'between': return Number(v) >= when.value[0] && Number(v) <= when.value[1];
    case 'in': return Array.isArray(when.value) && when.value.includes(v);
    case 'contains': return Array.isArray(v) ? v.includes(when.value) : v === when.value;
    default: return false;
  }
}

const ordOf = (spec, exId, stepId) =>
  (spec.byExercise?.[exId]?.ladder ?? []).findIndex(s => s.id === stepId);

/**
 * @returns {{start_steps, locked, caps, notes}}
 *   start_steps  every ladder's opening rung
 *   locked       ladders held shut entirely (vest walks, intervals after a
 *                flagged health screen) and any benchmarks that go with them
 *   caps         the ceiling an injury or failed screen imposes
 */
export function resolvePlacement(answers, program) {
  const spec = program.byExercise ? program : indexSpec(program);
  const p = spec.placement ?? {};
  const start = {};

  // Everything starts at the bottom; a rule only ever moves someone up.
  for (const ex of spec.exercises ?? []) start[ex.id] = ex.ladder?.[0]?.id;

  for (const rule of p.rules ?? []) {
    if (!matches(rule.when, answers)) continue;
    for (const [exId, stepId] of Object.entries(rule.set ?? {})) {
      if (ordOf(spec, exId, stepId) < 0) continue;                 // a step that no longer exists
      if (ordOf(spec, exId, stepId) > ordOf(spec, exId, start[exId])) start[exId] = stepId;
    }
  }

  // Caps and locks come last so an injury always beats an ability answer.
  const caps = {}, locked = new Set(), lockedBenchmarks = new Set(), notes = [];
  for (const entry of p.locked ?? []) {
    if (!matches(entry.when, answers)) continue;
    if (entry.note) notes.push(entry.note);
    for (const exId of entry.lock ?? []) locked.add(exId);
    for (const id of entry.lock_benchmarks ?? []) lockedBenchmarks.add(id);
    for (const [exId, stepId] of Object.entries(entry.cap ?? {})) {
      if (ordOf(spec, exId, stepId) < 0) continue;
      const current = caps[exId];
      if (!current || ordOf(spec, exId, stepId) < ordOf(spec, exId, current)) caps[exId] = stepId;
    }
  }

  for (const [exId, capStep] of Object.entries(caps)) {
    if (ordOf(spec, exId, start[exId]) > ordOf(spec, exId, capStep)) start[exId] = capStep;
  }
  for (const exId of locked) start[exId] = spec.byExercise?.[exId]?.ladder?.[0]?.id;

  return {
    start_steps: start,
    caps,
    locked: [...locked],
    locked_benchmarks: [...lockedBenchmarks],
    notes,
  };
}

/** The questions the setup screen should ask, in order, by group. */
export function questionsFor(program, group) {
  const spec = program.byExercise ? program : indexSpec(program);
  return (spec.placement?.questions ?? []).filter(q => (q.group ?? 'placement') === group);
}
