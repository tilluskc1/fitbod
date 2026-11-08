import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseById } from '../src/data/exercises.ts';
import { catalogRowMeta, progressionLines, recapHighlight } from '../src/lib/liveProgression.ts';
import { removeTodayNotice } from '../src/lib/exerciseActions.ts';
import { completeSession, createSession, logSet, skipExercise, swapPendingExercise } from '../src/lib/session.ts';
import type { Profile, WorkoutExercise, WorkoutRecord } from '../src/types.ts';

// #105: the recap and Plan -> Equipment must describe the session that was generated and logged.

const START = '2026-11-04T10:00:00.000Z';
const at = (minute: number) => new Date(Date.parse(START) + minute * 60_000).toISOString();

const profile: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3,
  equipment: ['Barbell', 'Dumbbell', 'Cable', 'Machine'], support: ['Bench', 'Rack'],
  exclusions: [], loads: {}, sessionMinutes: 45,
};

/** One generated slot: `sets` planned at weight × reps, the slot's requirement marked as liveExercises marks it. */
function slot(exerciseId: string, sets: number, weight: number, reps: number): WorkoutExercise {
  const planned = Array.from({ length: sets }, () => ({ weight, reps }));
  return {
    exerciseId,
    name: exerciseById(exerciseId)?.name ?? exerciseId,
    originalPlannedSets: sets,
    planned,
    performed: planned.map((set) => ({ ...set, done: false, completedAt: null })),
  };
}

function session(exercises: WorkoutExercise[]): WorkoutRecord {
  return createSession({ id: 'w105', name: 'Push', dayIndex: 0, now: START, exercises });
}

/** Log every pending set of one exercise, in order. */
function logAll(workout: WorkoutRecord, exerciseIndex: number): WorkoutRecord {
  let next = workout;
  next.exercises[exerciseIndex].performed.forEach((_, setIndex) => {
    next = logSet(next, exerciseIndex, setIndex, at(setIndex + exerciseIndex * 10 + 1));
  });
  return next;
}

const finish = (workout: WorkoutRecord) => completeSession(workout, { early: false, now: at(60) });
const lineOf = (workout: WorkoutRecord, exerciseId: string) => {
  const line = progressionLines(workout, profile, [workout], 'lb').find((item) => item.exerciseId === exerciseId);
  assert.ok(line, `no recap line for ${exerciseId}`);
  return line;
};

// D1: "Program" is the generated session's sets and range, never the Full body A fixture.

test('D1: a hold reads the sets the session carried, not the fixture\'s two', () => {
  const done = finish(logAll(session([slot('plank', 3, 0, 45)]), 0));
  assert.equal(lineOf(done, 'plank').original, '3 × 45s');
});

test('D1: a lift outside the fixture reads its sets and the range it was prescribed in', () => {
  // Intermediate, building muscle: a barbell lead is 5 × 4–6.
  const done = finish(logAll(session([slot('barbell-bench-press', 5, 60, 6)]), 0));
  assert.equal(lineOf(done, 'barbell-bench-press').original, '5 × 4–6');
});

test('D1: Plan -> Equipment gives a fixture lift off today\'s day the sets its role gets, like its neighbours', () => {
  const beginner: Profile = { ...profile, experience: 'Beginner' };
  const day = ['barbell-bench-press', 'overhead-press', 'lateral-raise'];
  const sets = { 'barbell-bench-press': 4, 'overhead-press': 4, 'lateral-raise': 3 };
  const row = (id: string) => {
    const exercise = exerciseById(id);
    assert.ok(exercise);
    return catalogRowMeta(exercise, beginner, [], 'lb', day, sets);
  };
  // Behind a beginner's lead every compound gets four sets: the Full body A fixture said three.
  assert.match(row('dumbbell-bench-press'), /^4 sets/);
  assert.match(row('dumbbell-floor-press'), /^4 sets/);
  assert.match(row('dumbbell-row'), /^4 sets/);
  // On the day, the row reads the day's own count.
  assert.match(row('overhead-press'), /^4 sets/);
  assert.match(row('lateral-raise'), /^3 sets/);
});

// D2: a swap split is judged across both halves of the slot.
// #105 D2, parked for owner: it changes what the stored originalPlannedSets means and lets a
// swapped-away half progress, so it waits on the owner (branch work/105-d2-swap-owed).

test.skip('D2: a lead swapped after one set, replacement fully logged: neither half is cut short', () => {
  let workout = session([slot('barbell-bench-press', 5, 60, 6), slot('lateral-raise', 3, 8, 12)]);
  workout = logSet(workout, 0, 0, at(1));
  workout = swapPendingExercise(workout, 0, { exerciseId: 'machine-chest-press', name: 'Machine Chest Press', weight: 50, reps: 6 });
  workout = logAll(workout, 1);
  const done = finish(workout);
  const bench = lineOf(done, 'barbell-bench-press');
  const machine = lineOf(done, 'machine-chest-press');
  assert.match(machine.performed ?? '', /^4\/4 sets/);
  assert.match(bench.performed ?? '', /^1\/1 set · /);
  for (const line of [bench, machine]) assert.doesNotMatch(`${line.next} ${line.reason}`, /cut short|unfinished/);
});

test.skip('D2: Push-Up swapped after one set for a press that is fully logged counts the press\'s own sets', () => {
  let workout = session([slot('push-up', 4, 0, 12)]);
  workout = logSet(workout, 0, 0, at(1));
  workout = swapPendingExercise(workout, 0, { exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', weight: 20, reps: 8 });
  const done = finish(logAll(workout, 1));
  const press = lineOf(done, 'dumbbell-bench-press');
  assert.match(press.performed ?? '', /^3\/3 sets/);
  assert.doesNotMatch(press.reason, /cut short|unfinished/);
});

// D3: a fully logged session has nothing skipped, so the review state must not say so.

test('D3: every set logged reads as logged, with no skipped count', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const noop = () => {};
    const render = (workout: WorkoutRecord) => renderToStaticMarkup(createElement(Train, { session: workout, history: [],
      now: Date.parse(at(30)), loadOptions: [], unit: 'lb', onMinimize: noop, onFinish: noop, onUpdateSet: noop,
      onConfirmWeight: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop }))
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const day = session([slot('dumbbell-row', 2, 20, 10), slot('lateral-raise', 1, 8, 12)]);
    const full = render(logAll(logAll(day, 0), 1));
    assert.doesNotMatch(full, /skipped/i);
    assert.match(full, /Every set is logged 3 of 3 sets completed\. Finish saves only completed sets\./);
    assert.match(full, /Lateral Raise 1 of 1 set /, 'one set is singular');

    const set = render(skipExercise(logAll(day, 0), 1));
    assert.match(set, /All remaining work is skipped/);
    assert.match(set, /2 of 3 sets completed · 1 skipped\. Skipping records nothing, and Finish saves only completed sets\./);
  } finally {
    await server.close();
  }
});

// D4: plurals, an empty load and "New best" say only what happened.

test('D4: one set reads "1 × …", never "1 sets"', () => {
  const plank = lineOf(finish(logAll(session([slot('plank', 1, 0, 45)]), 0)), 'plank');
  assert.equal(plank.original, '1 × 45s');
  assert.equal(plank.adapted, '1 set');
  const bench = lineOf(finish(logAll(session([slot('barbell-bench-press', 1, 60, 6)]), 0)), 'barbell-bench-press');
  assert.doesNotMatch(`${bench.original} ${bench.adapted}`, /\b1 sets\b/);
});

test('D4: a lift with no load yet names no load instead of "@ no load yet"', () => {
  // Nothing logged on the row, so its next target has no load to name.
  const workout = finish(logAll(skipExercise(session([slot('dumbbell-row', 3, 20, 10), slot('cable-fly', 3, 0, 12)]), 1), 0));
  const fly = lineOf(workout, 'cable-fly');
  assert.doesNotMatch(fly.next, /no load yet/);
  assert.match(fly.next, /^\d+ reps$/);
});

test('D4: "New best" only when it beats an earlier logged best', () => {
  const pushUps = (id: string, date: string, reps: number) => {
    const workout = session([slot('push-up', 1, 0, reps)]);
    return finish({ ...logAll(workout, 0), id, date });
  };
  const first = pushUps('a', '2026-11-01T10:00:00.000Z', 13);
  const lines = (workout: WorkoutRecord, history: WorkoutRecord[]) =>
    recapHighlight(workout, history, progressionLines(workout, profile, history, 'lb'), 'lb', profile);
  assert.doesNotMatch(lines(first, [first]), /New best/, 'a first session has no best to beat');
  const same = pushUps('b', '2026-11-04T10:00:00.000Z', 13);
  assert.doesNotMatch(lines(same, [same, first]), /New best/, 'matching the target and the last best is not a best');
  const more = pushUps('c', '2026-11-04T10:00:00.000Z', 14);
  assert.match(lines(more, [more, first]), /^New best: 14 reps @ bodyweight on Push-Up$/);
});

// D5: removing the rest of an exercise keeps its logged sets, and the toast says so.

test('D5: the remove-remaining toast keeps logged sets in its words', () => {
  const day = session([slot('dumbbell-row', 3, 20, 10)]);
  const one = skipExercise(logSet(day, 0, 0, at(1)), 0).exercises[0];
  assert.doesNotMatch(removeTodayNotice(one), /Nothing was recorded/);
  assert.match(removeTodayNotice(one), /1 logged set is kept/);
  const none = skipExercise(day, 0).exercises[0];
  assert.equal(removeTodayNotice(none), 'Dumbbell Row skipped for today. Nothing was recorded for it.');
});
