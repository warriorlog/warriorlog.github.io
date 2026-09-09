// The Journal screen is a pure string builder, so everything it decides — the
// week roll-up, the Perfect Week rule, and the readable text for all fifty
// badge criteria — is testable without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as J from '../src/views/journal.js';
import { indexSpec, prescribe } from '../src/engine.js';
import { reduce } from '../src/reduce.js';
import { progress } from '../src/gamify.js';
import { makeEvent, TYPES } from '../src/events.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const gam = JSON.parse(readFileSync(new URL('../data/gamification.json', import.meta.url), 'utf8'));
const copy = JSON.parse(readFileSync(new URL('../data/copy.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/views/journal.js', import.meta.url), 'utf8');
const spec = indexSpec(program);

const EQ = {
  treadmill: true, treadmill_max_incline: 12, treadmill_max_mph: 10,
  vest_max_lb: 40, vest_increment_lb: 5, vest_min_lb: 5, chair_height_in: 18, couch_edge: true, kb: [53],
  dumbbells: { 8: 'pair', 10: 'pair', 12: 'pair', 20: 'pair', 35: 'pair' },
};
const FLOOR = { push_up: 'push_up.knee', goblet_squat: 'goblet_squat.chair', hinge_deadlift: 'hinge_deadlift.rdl_12' };
const START = '2026-08-10';                       // a Monday
const WEEK = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'];

let n = 0;
const ev = (type, data, user, ts) => makeEvent(type, data, { user, dev: 'dev1', ts });

/** A warrior who trained every prescribed day of `days`, hitting every target. */
function warrior(days, { user = 'sean', type = 'full' } = {}) {
  const events = [
    ev(TYPES.PROFILE, { name: 'Sean', program_start: START, rest_dow: 0, session_minutes: 50, bodyweight_lb: 190 }, user, '2026-08-09T18:00:00Z'),
    ev(TYPES.EQUIPMENT, EQ, user, '2026-08-09T18:01:00Z'),
    ev(TYPES.ASSESSMENT, { start_steps: FLOOR }, user, '2026-08-09T18:02:00Z'),
  ];
  let u = reduce(events, spec, { equipment: EQ }).users[user];
  for (const day of days) {
    const plan = prescribe(spec, u, day, { equipment: EQ });
    if (plan.rest) continue;
    const id = `s_${day.replace(/-/g, '')}`;
    events.push(ev(TYPES.SESSION_START, {
      session_id: id, template_id: plan.template_id, type, date: day,
      deload: plan.deload, plan: { rows: plan.rows },
    }, user, `${day}T13:00:00Z`));
    for (const r of plan.rows) {
      if (r.prescribed === false) continue;
      events.push(ev(TYPES.SET, {
        session_id: id, exercise_id: r.exercise_id, step_id: r.step_id, set_index: r.set_index,
        side: r.side, part: r.part, unit: r.unit, value: r.unit === 'min' ? r.minutes : r.B,
        implement_id: r.implement_id, checklist_ok: true, talk_test_ok: true, done: true,
      }, user, `${day}T13:${String(10 + (n++ % 45)).padStart(2, '0')}:00Z`));
    }
    events.push(ev(TYPES.SESSION_END, { session_id: id, duration_min: 47 }, user, `${day}T14:00:00Z`));
    u = reduce(events, spec, { equipment: EQ }).users[user];
  }
  return u;
}

/** The smallest state object `render` needs, with a hostile string planted. */
function fakeState(user, today) {
  const p = progress(user, spec, gam, today);
  return {
    me: 'sean', users: { sean: user, cat: { ...user, sessions: [], climbs: [] } },
    spec, gam, copy, progress: p, plan: null,
    route: { name: 'journal', params: {} },
    sync: { pending: 0, error: null },
  };
}

// ------------------------------------------------------------------- tone
const BANNED = /\b(lost|failed|fail|failing|missed|behind|lazy)\b/i;

test('the journal never uses a word that scolds', () => {
  // Comments are the author talking to the next author, so they are stripped;
  // everything else in the file could end up in front of a person.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  const hit = BANNED.exec(code);
  assert.equal(hit, null, hit ? `journal.js uses "${hit[0]}" near: ${code.slice(Math.max(0, hit.index - 60), hit.index + 60)}` : '');
});

test('every rendered badge criterion is free of discouraging words', () => {
  for (const b of gam.badges) {
    const text = J.criterionText(b.criterion, spec, gam);
    assert.ok(!BANNED.test(text), `${b.id}: ${text}`);
  }
});

// ---------------------------------------------------------------- formatting
test('values read in the unit they were logged in', () => {
  assert.equal(J.fmtValue(1, 'reps'), '1 rep');
  assert.equal(J.fmtValue(12, 'reps'), '12 reps');
  assert.equal(J.fmtValue(45, 'sec'), '45s');
  assert.equal(J.fmtValue(300, 'clock_sec'), '5:00');
  assert.equal(J.fmtValue(305, 'clock_sec'), '5:05');
  assert.equal(J.fmtValue(20, 'min'), '20 min');
  assert.equal(J.fmtValue(3, 'rounds'), '3 rounds');
});

test('a day key becomes a short human date', () => {
  assert.equal(J.shortDate('2026-09-14'), 'Mon 14 Sep');
  assert.equal(J.dateRange('2026-09-14'), '14 Sep – 20 Sep');
});

test('implement ids read as objects in the room', () => {
  assert.equal(J.implementName('kb53'), '53 lb bell');
  assert.equal(J.implementName('db35'), '35 lb dumbbell');
  assert.equal(J.implementName('bw'), 'bodyweight');
});

// ------------------------------------------------------------------ the week
test('the Zone-2 target is read off the templates, not hardcoded', () => {
  assert.equal(J.zone2TargetMin(spec), 42);
  assert.equal(J.zone2TargetMin({ templates: [] }), 0);
});

test('a full week prescribes six quests; a part week only counts the days on record', () => {
  assert.equal(J.weekPrescribedQuests(spec, START), 6);
  assert.equal(J.weekPrescribedQuests(spec, START, { firstDay: '2026-08-13' }), 3);
  // Week 12 tapers Friday off.
  assert.equal(J.weekPrescribedQuests(spec, START, { override: program.week_overrides['12'] }), 5);
});

test('Perfect Week needs every prescribed quest, four full ones, and an unspent shield', () => {
  const base = { programWeek: 3, prescribed: 6, done: 6, full: 5, shields: 0 };
  assert.equal(J.isPerfectWeek(base, gam), true);
  assert.equal(J.isPerfectWeek({ ...base, done: 5 }, gam), false, 'a quest still to come is not perfect');
  assert.equal(J.isPerfectWeek({ ...base, full: 3 }, gam), false, 'four full quests are required');
  assert.equal(J.isPerfectWeek({ ...base, shields: 1 }, gam), false, 'a spent shield is not perfect');
  assert.equal(J.isPerfectWeek({ ...base, prescribed: 0, done: 0 }, gam), false, 'an empty week is not perfect');
  // The Muster week has a lower bar for full quests.
  assert.equal(J.isPerfectWeek({ programWeek: 0, prescribed: 3, done: 3, full: 3, shields: 0 }, gam), true);
});

test('the next-week sentence is one honest line for every week of the program', () => {
  for (let w = 0; w <= 13; w++) {
    const line = J.nextWeekLine(spec, w);
    assert.ok(line.length > 20 && line.endsWith('.'), `week ${w}: ${line}`);
    assert.ok(!BANNED.test(line), line);
    assert.equal(line.split('.').filter(Boolean).length, 1, `one sentence for week ${w}: ${line}`);
  }
  assert.match(J.nextWeekLine(spec, 3), /boss week/);
  assert.match(J.nextWeekLine(spec, 11), /[Tt]aper/);
});

test('a full first week rolls up as a Perfect Week', () => {
  const u = warrior(WEEK);
  const p = progress(u, spec, gam, '2026-08-17');
  const weeks = J.buildWeeks(u, spec, gam, p, '2026-08-17');
  const first = weeks.find(w => w.start === START);
  assert.ok(first, 'the training week is on the calendar');
  assert.equal(first.done, 6);
  assert.equal(first.prescribed, 6);
  assert.equal(first.full, 6);
  assert.equal(first.shields, 0);
  assert.equal(first.perfect, true);
  assert.ok(first.xp > 0);
  assert.ok(Object.keys(first.by_source).length >= 2);
  assert.equal(first.days.length, 7);
  assert.equal(first.zone2.target, 42);
  assert.ok(first.zone2.done > 0);
});

test('the week the warrior did not appear is still a week, and never called a loss', () => {
  const u = warrior(WEEK);
  const p = progress(u, spec, gam, '2026-08-24');
  const weeks = J.buildWeeks(u, spec, gam, p, '2026-08-24');
  assert.ok(weeks.length >= 2, 'the silent week is on record');
  assert.equal(weeks[0].start, '2026-08-24');       // newest first
  const quiet = weeks.find(w => w.start === '2026-08-17');
  assert.equal(quiet.done, 0);
  assert.equal(quiet.perfect, false);
  assert.equal(quiet.remaining, quiet.prescribed);
});

test('a brand new account still produces a week, with nothing in it', () => {
  const u = warrior([]);
  const p = progress(u, spec, gam, '2026-08-12');
  const weeks = J.buildWeeks(u, spec, gam, p, '2026-08-12');
  assert.ok(weeks.length >= 1, 'the placement week is on the calendar');
  assert.ok(weeks.every(w => w.done === 0 && !w.perfect));
  assert.ok(weeks.every(w => w.prs.length === 0 && w.climbs.length === 0));
  assert.ok(weeks.every(w => w.days.length === 7));
});

// ----------------------------------------------------------------- badges
test('all fifty badges get readable criterion text with nothing left unresolved', () => {
  assert.equal(gam.badges.length, 50);
  const seen = new Set();
  for (const b of gam.badges) {
    const text = J.criterionText(b.criterion, spec, gam);
    assert.ok(text.length > 8, `${b.id} is too terse: ${text}`);
    assert.ok(text.endsWith('.'), `${b.id} should read as a sentence: ${text}`);
    assert.ok(!/undefined|null|NaN|\[object/.test(text), `${b.id} leaks a raw value: ${text}`);
    assert.ok(!/_/.test(text), `${b.id} leaks an id: ${text}`);
    assert.notEqual(text, 'A rule that has not been described yet.', `${b.id} has no wording`);
    seen.add(text);
  }
  assert.equal(seen.size, gam.badges.length, 'no two badges describe themselves the same way');
});

test('criterion text names the real exercise, rung and benchmark', () => {
  const byId = Object.fromEntries(gam.badges.map(b => [b.id, b.criterion]));
  assert.match(J.criterionText(byId.ten_clean, spec, gam), /Push-up/);
  assert.match(J.criterionText(byId.ten_clean, spec, gam), /10 reps/);
  assert.match(J.criterionText(byId.bell_earned, spec, gam), /Reach .+ on Kettlebell swing|Reach /);
  assert.match(J.criterionText(byId.mile_soldier, spec, gam), /12:00 or faster/);
  assert.match(J.criterionText(byId.sub_10_mile, spec, gam), /9:59 or faster/);
  assert.match(J.criterionText(byId.gold_warrior, spec, gam), /Gold/);
  assert.match(J.criterionText(byId.century_bell, spec, gam), /53 lb bell/);
  assert.match(J.criterionText(byId.kindling_7, spec, gam), /7 days/);
  assert.equal(J.criterionText(byId.mirror_faced, spec, gam), 'Finish the placement quiz.');
});

test('progress is offered only where it can honestly be computed', () => {
  const m = {
    flame: 3, bestFlame: 9, duoFlame: 2, level: 4, xpTotal: 900, sessions: 12,
    skirmishes: 1, climbs: 5, prs: 2, pledges: 0, perfectWeeks: 1, minGearTier: 1, bestZone2Week: 60,
  };
  assert.deepEqual(J.criterionProgress({ metric: 'flame', op: 'gte', value: 7 }, m), { current: 3, target: 7 });
  assert.deepEqual(J.criterionProgress({ metric: 'steps_gained', op: 'gte', value: 20 }, m), { current: 5, target: 20 });
  // Capped at the target so a bar can never overflow.
  assert.deepEqual(J.criterionProgress({ metric: 'best_flame', op: 'gte', value: 7 }, m), { current: 7, target: 7 });
  // Boolean, "or faster", partner-dependent and windowed criteria get no bar.
  assert.equal(J.criterionProgress({ metric: 'quiz_done', op: 'eq', value: true }, m), null);
  assert.equal(J.criterionProgress({ metric: 'benchmark_value', op: 'lte', value: 720 }, m), null);
  assert.equal(J.criterionProgress({ metric: 'sessions_completed', op: 'gte', value: 22, both_users: true }, m), null);
  assert.equal(J.criterionProgress({ metric: 'zone2_week_minutes', op: 'gte', value: 100, as_pct_of_prescribed: true }, m), null);
  assert.equal(J.criterionProgress({ metric: 'boss_outcome', op: 'gte', value: 1 }, m), null);
});

test('every badge either shows a bar or is honest about having none, and never crashes', () => {
  const u = warrior(WEEK);
  const p = progress(u, spec, gam, '2026-08-17');
  const m = J.badgeMetrics(u, p, J.buildWeeks(u, spec, gam, p, '2026-08-17'));
  for (const b of gam.badges) {
    const bar = J.criterionProgress(b.criterion, m);
    if (bar) {
      assert.ok(bar.current >= 0 && bar.current <= bar.target, `${b.id}: ${bar.current}/${bar.target}`);
      assert.ok(Number.isFinite(bar.target) && bar.target > 0, b.id);
    }
  }
  assert.equal(m.sessions, 6);
  assert.equal(m.perfectWeeks, 1);
});

// ----------------------------------------------------------------- render
test('the screen renders for a real log, and escapes everything it interpolates', () => {
  const u = warrior(WEEK);
  // A hostile name reaching the DOM would be the one unrecoverable bug here.
  const hostile = '<img src=x onerror=alert(1)>';
  const poisoned = indexSpec({
    ...program,
    templates: program.templates.map(t => (t.id === 'mon_lower_a' ? { ...t, name: hostile } : t)),
  });
  const state = { ...fakeState(u, '2026-08-17'), spec: poisoned };
  state.progress = progress(u, poisoned, gam, '2026-08-17');
  const out = String(J.render(state));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the template name is escaped');
  assert.ok(!out.includes('<img src=x'), 'no raw markup from data reaches the page');
  assert.ok(!BANNED.test(stripped(out)), 'no discouraging word survives to the page');
  assert.ok(out.includes('Weekly Report'));
  assert.ok(out.includes('Calendar'));
  assert.ok(out.includes('Sessions'));
  assert.ok(out.includes('Record board'));
  assert.ok(out.includes('Badges'));
});

test('a brand new account renders a deliberate empty state, not a broken one', () => {
  const u = warrior([]);
  const out = String(J.render(fakeState(u, '2026-08-12')));
  assert.ok(out.includes('Journal'));
  assert.ok(out.includes('Calendar'));
  assert.ok(out.includes('Badges'));
  assert.ok(!out.includes('undefined'));
  assert.ok(!out.includes('NaN'));
  assert.ok(!BANNED.test(stripped(out)));
  // All fifty badges are still legible, with their criteria spelled out.
  assert.ok(out.includes('Finish the placement quiz.'));
});

/** Text as the reader sees it: tags and attributes stripped. */
const stripped = (html) => html.replace(/<[^>]*>/g, ' ');
