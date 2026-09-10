// What today can actually change. Pure functions over derived state, so the home
// screen only has to render them — and so they can be tested without a browser.
//
// The bar for putting a line here is high: it has to be true, specific to today,
// and something the user can act on. A status observation dressed up as a stake
// is worse than an empty card.
import { addDays, dayKey, dow } from './util.js';

const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Ladders that will climb a rung if today goes well. */
export function climbLines(spec, user, plan, limit = 2) {
  const out = [];
  for (const item of (plan?.blocks ?? []).flatMap(b => b.items ?? [])) {
    if (out.length >= limit) break;
    const ladder = user.ladders?.[item.exercise_id];
    // Finisher walks and the warm-up flows earn XP but never feed a ladder, so
    // promising a rung for them is simply untrue.
    if (!ladder || !item.next_unlock) continue;
    if (item.counts_for_progression === false) continue;
    if (spec.byExercise?.[item.exercise_id]?.no_xp) continue;
    const need = spec.byStep?.[item.step_id]?.advance?.consecutive ?? 2;
    if (ladder.qualifying >= need - 1) {
      out.push(`${item.name} climbs a rung today: ${String(item.next_unlock).toLowerCase()}`);
    }
  }
  return out;
}

/**
 * The region that has had the least work — but only when that is a real finding.
 * With no history every region sits at zero, so naming whichever one sorts first
 * dresses an arbitrary tie up as a fact. It also has to be actionable, and it has
 * to say what it means: "heart is your coldest region" on the morning of a
 * 33-minute Zone-2 walk is worse than saying nothing at all.
 */
export function coldRegionLine(spec, user, plan, regions, { minTrainingDays = 7, behindRatio = 0.6 } = {}) {
  const trainingDays = new Set((user.sessions ?? []).filter(s => s.sets?.length).map(s => s.day)).size;
  if (trainingDays < minTrainingDays) return null;

  const entries = Object.entries(regions ?? {});
  if (entries.length < 3) return null;
  const sorted = [...entries].sort((a, b) => a[1].xp - b[1].xp);
  const [region, value] = sorted[0];
  const median = sorted[Math.floor(sorted.length / 2)][1].xp;
  if (median <= 0) return null;                       // nothing trained yet: no laggard exists
  if (value.xp > median * behindRatio) return null;   // lowest, but not meaningfully so

  const label = region.replace(/_/g, ' ');
  const todayHits = new Set((plan?.blocks ?? []).flatMap(b => b.items ?? [])
    .flatMap(it => Object.keys(spec.byExercise?.[it.exercise_id]?.region_weights ?? {})));
  if (todayHits.has(region)) return `today's session works ${label}, which has had the least attention lately`;

  const day = nextDayTraining(spec, region, plan?.day);
  return day
    ? `${label} has had the least attention lately — ${day} trains it next`
    : `${label} has had the least attention lately`;
}

/** The next weekday whose template actually trains that region. */
function nextDayTraining(spec, region, fromDay) {
  const start = fromDay ?? dayKey();
  for (let i = 1; i <= 7; i++) {
    const day = addDays(start, i);
    const t = (spec.templates ?? []).find(x => x.dow === dow(day));
    if (!t?.minutes) continue;
    const hits = (t.blocks ?? []).flatMap(b => b.items ?? []).some(it =>
      (spec.byExercise?.[it.exercise_id]?.region_weights ?? {})[region] > 0);
    if (hits) return i === 1 ? 'tomorrow' : DAY_NAME[dow(day)];
  }
  return null;
}

/** Every line worth showing under "At stake today", best first. */
export function stakeLines(spec, user, plan, regions) {
  if (!plan || plan.rest) return [];
  const lines = climbLines(spec, user, plan);
  const cold = coldRegionLine(spec, user, plan, regions);
  if (cold && lines.length < 3) lines.push(cold);
  return lines;
}
