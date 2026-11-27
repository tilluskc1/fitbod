// The week is the user's local calendar week; pin a zone with a DST change nearby.
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveExercises, progressionLines, recapHighlight } from '../src/lib/liveProgression.ts';
import { workoutsThisWeek } from '../src/lib/plan.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'Krishna', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'kg',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK }, [], undefined);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

/**
 * applyFinish → recap model. Logs `sets` of the press (index 0) at one load,
 * then finishes early. Returns the history after the finish and the record.
 */
function finishPress(history: WorkoutRecord[], id: string, day: string, weight: number, reps: number, sets = 3) {
  let session = createSession({ id, name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, history), now: `${day}T10:00:00.000Z` });
  for (let index = 0; index < sets; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight, reps }), 0, index, `${day}T10:0${index + 1}:00.000Z`);
  }
  const state = applyFinish({ ...EMPTY_STATE, profile, history, current: session }, id,
    { early: true, now: `${day}T10:30:00.000Z` });
  const workout = state.history.find((item) => item.id === id);
  assert.ok(workout);
  return { history: state.history, workout };
}

const highlightOf = (run: { history: WorkoutRecord[]; workout: WorkoutRecord }) =>
  recapHighlight(run.workout, run.history, progressionLines(run.workout, profile, run.history, 'kg'), 'kg');

test('an earned load step leads the recap, naming the next load and the exercise', () => {
  // Top of the 8–10 range on every set at one rack load earns 18 kg.
  const run = finishPress([], 'a', '2026-11-02', 15, 10);
  assert.equal(highlightOf(run), 'Next time: 18 kg each on Dumbbell floor press');
});

test('no history and nothing earned: first session on the program', () => {
  const run = finishPress([], 'a', '2026-11-02', 15, 8);
  assert.equal(highlightOf(run), 'First session on the program');
});

test('a new best on the exact variant beats first-session and fallback', () => {
  const first = finishPress([], 'a', '2026-11-02', 15, 8);
  const second = finishPress(first.history, 'b', '2026-11-04', 15, 9);
  assert.equal(highlightOf(second), 'New best: 9 reps @ 15 kg each on Dumbbell floor press');
});

test('an early finish can still show a new best but never an unearned step', () => {
  const first = finishPress([], 'a', '2026-11-02', 15, 8);
  // One set at the top of the range: heavier-or-equal work, but the slot was not finished.
  const short = finishPress(first.history, 'b', '2026-11-04', 15, 10, 1);
  assert.ok(short.workout.completedEarly);
  assert.equal(highlightOf(short), 'New best: 10 reps @ 15 kg each on Dumbbell floor press');
});

test('matching the previous best is not a new best: work recorded', () => {
  const first = finishPress([], 'a', '2026-11-02', 15, 8);
  const same = finishPress(first.history, 'b', '2026-11-04', 15, 8);
  assert.equal(highlightOf(same), 'Work recorded');
});

test('a best on another variant is never transferred', () => {
  // Prior work exists only on the bench press; today's floor press has no record to beat.
  const bench: WorkoutRecord = {
    id: 'bench', date: '2026-11-01T10:00:00.000Z', name: 'Bench', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: '2026-11-01T10:30:00.000Z',
    exercises: [{ exerciseId: 'dumbbell-bench-press', name: 'Dumbbell bench press',
      planned: [{ weight: 10, reps: 8 }],
      performed: [{ weight: 10, reps: 8, done: true, completedAt: '2026-11-01T10:05:00.000Z' }] }],
  };
  const run = finishPress([bench], 'a', '2026-11-02', 15, 8);
  assert.equal(highlightOf(run), 'Work recorded');
});

// --- Weekly goal -----------------------------------------------------------

function record(id: string, date: string, done: boolean, extra: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    id, date, name: 'W', dayIndex: 0, status: 'completed', completedEarly: !done, endedAt: date,
    exercises: [{ exerciseId: 'dumbbell-floor-press', name: 'Press', planned: [{ weight: 15, reps: 8 }],
      performed: [{ weight: 15, reps: 8, done, completedAt: done ? date : null }] }],
    ...extra,
  };
}

test('the weekly count follows the local Sunday-start week across the boundary', () => {
  const history = [
    record('sat-local', '2026-11-08T04:00:00.000Z', true), // Sat 23:00 in New York
    record('mon', '2026-11-02T15:00:00.000Z', true),
    record('prev-sat', '2026-11-01T03:00:00.000Z', true), // Sat Oct 31, 23:00 EDT: last week
    record('zero-work', '2026-11-03T15:00:00.000Z', false),
    record('skipped-all', '2026-11-04T15:00:00.000Z', false, {
      exercises: [{ exerciseId: 'goblet-squat', name: 'Squat', skipped: true, planned: [{ weight: 0, reps: 8 }],
        performed: [{ weight: 0, reps: 8, done: false, completedAt: null }] }] }),
    record('active', '2026-11-05T15:00:00.000Z', true, { status: 'active', endedAt: null }),
  ];
  // Sat Nov 7, 23:30 New York (Sun 04:30 UTC): still the week of Nov 1.
  assert.equal(workoutsThisWeek(history, new Date('2026-11-08T04:30:00.000Z')), 2);
  // Sun Nov 8, 00:30 New York: a fresh week; nothing carries over or is owed.
  assert.equal(workoutsThisWeek(history, new Date('2026-11-08T05:30:00.000Z')), 0);
  // Viewed from last week, this week's sessions are not counted.
  assert.equal(workoutsThisWeek(history, new Date('2026-10-31T12:00:00.000Z')), 1);
});

test('rendered recap leads with the highlight and Today shows N of daysPerWeek', async () => {
  const run = finishPress([], 'a', '2026-11-02', 15, 10);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Recap } = await server.ssrLoadModule('/src/screens/RecapScreen.tsx');
    const lines = progressionLines(run.workout, profile, run.history, 'kg');
    const recap = plain(renderToStaticMarkup(createElement(Recap, { workout: run.workout, progression: lines,
      highlight: recapHighlight(run.workout, run.history, lines, 'kg'), feedbackWrite: null,
      onFeedback: noop, onRetryFeedback: noop, onViewHistory: noop, onBackToday: noop })));
    const lead = recap.indexOf('Next time: 18 kg each on Dumbbell floor press');
    assert.ok(lead >= 0, recap);
    assert.ok(lead < recap.indexOf('Minutes'), 'the highlight sits above the stats');

    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const today = plain(renderToStaticMarkup(createElement(Today, { profile, program: FULL_BODY_A, adapted,
      equipment: 'home', adjusted: false, history: run.history, current: null,
      now: new Date('2026-11-04T12:00:00.000Z'), onPreview: noop, onAdjust: noop,
      onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop })));
    assert.match(today, /Weekly goal: 1 of 3 this week/);
    assert.equal(today.match(/of 3/g)?.length, 1, 'one weekly indicator');
  } finally { await server.close(); }
});
