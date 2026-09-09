// A deliberately tiny program: two ladders, one template. Lets the reducer and
// engine tests assert behaviour without depending on the real 38-exercise data.
export const miniProgram = {
  id: 'mini', schemaVersion: 1, rulesVersion: 1,
  phases: [{ id: 'p1', name: 'One', weeks: [1, 12], rir: 3 }],
  deload: { set_multiplier: 0.6, min_sets: 2, every_n_weeks: 4 },
  templates: [{
    id: 'day_a', dow: 1, name: 'Day A', minutes: 40,
    blocks: [{ kind: 'strength_a', minutes: 40, items: [
      { exercise_id: 'push_up', sets: 3, rest_sec: 90 },
      { exercise_id: 'swing', sets: 3, rest_sec: 60 },
    ] }],
  }],
  exercises: [
    {
      id: 'push_up', name: 'Push-up', region: 'chest', pattern: 'push', equipment: 'bw',
      cues: ['plank line'], stop_if: 'sharp pain', region_weights: { chest: 1 },
      ladder: [
        { id: 'push_up.wall', ord: 1, name: 'Wall', how: 'x', unit: 'reps', sides: 'both', A: 10, B: 15,
          load: { kind: 'bw', lb: 0 }, implement_id: 'bw', requires: ['bw'],
          advance: { rule: 'all_sets_reps_gte', value: 15, consecutive: 2 } },
        { id: 'push_up.knee', ord: 2, name: 'Knee', how: 'x', unit: 'reps', sides: 'both', A: 8, B: 12,
          load: { kind: 'bw', lb: 0 }, implement_id: 'bw', requires: ['bw'],
          advance: { rule: 'all_sets_reps_gte', value: 12, consecutive: 2 } },
        { id: 'push_up.full', ord: 3, name: 'Full', how: 'x', unit: 'reps', sides: 'both', A: 5, B: 12,
          load: { kind: 'bw', lb: 0 }, implement_id: 'bw', requires: ['bw'], terminal: true },
      ],
    },
    {
      id: 'swing', name: 'Swing', region: 'glutes', pattern: 'power', equipment: 'db, kb',
      cues: ['hinge'], stop_if: 'sharp pain', region_weights: { glutes: 1 },
      checklist: { n: 5, cues: ['a', 'b', 'c', 'd', 'e'] },
      ladder: [
        { id: 'swing.db20', ord: 1, name: 'DB swing', how: 'x', unit: 'reps', sides: 'both', A: 5, B: 10,
          load: { kind: 'db', lb: 20 }, implement_id: 'db20', requires: ['db:20'], checklist_required: true,
          advance: { rule: 'all_sets_reps_gte', value: 10, consecutive: 2 } },
        { id: 'swing.kb53', ord: 2, name: 'Bell swing', how: 'x', unit: 'reps', sides: 'both', A: 5, B: 10,
          load: { kind: 'kb', lb: 53 }, implement_id: 'kb53', requires: ['kb:53'], terminal: true,
          entry_requires: [{ rule: 'ladder_at_or_past', exercise: 'push_up', step_id: 'push_up.knee' }] },
      ],
    },
  ],
  benchmarks: [], placement: { questions: [], rules: [] },
};
export const equipment = {
  treadmill: true, vest_max_lb: 40, vest_increment_lb: 5, chair_height_in: 18, couch_edge: true,
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' }, kb: [53],
};
