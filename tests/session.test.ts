import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPerformedSet,
  applyCancel,
  applyCorrection,
  applyFinish,
  completeSession,
  createSession,
  latestDoneSet,
  logSet,
  removePerformedSet,
  sessionProgress,
  swapPendingExercise,
  updatePerformedSet,
} from '../src/lib/session.ts';
import type { AppState, WorkoutRecord } from '../src/types.ts';

const START = '2026-01-01T10:00:00.000Z';
const LATER = '2026-01-01T11:00:00.000Z';
const FINISH = '2026-01-01T12:00:00.000Z';

function makeSession(): WorkoutRecord {
  return createSession({
    id: 'workout-1',
    name: 'Push',
    dayIndex: 0,
    now: START,
    exercises: [
      {
        exerciseId: 'push-up',
        name: 'Push-Up',
        planned: [
          { weight: 0, reps: 10 },
          { weight: 0, reps: 10 },
        ],
        performed: [
          { weight: 0, reps: 10, done: false, completedAt: null },
          { weight: 0, reps: 10, done: false, completedAt: null },
        ],
      },
    ],
  });
}

/** The flagship session model: three working sets on one exercise. */
function pressSession(): WorkoutRecord {
  return createSession({
    id: 'workout-press',
    name: 'Full body A',
    dayIndex: 0,
    now: START,
    exercises: [
      {
        exerciseId: 'dumbbell-floor-press',
        name: 'Dumbbell floor press',
        planned: [
          { weight: 10, reps: 10 },
          { weight: 10, reps: 10 },
          { weight: 10, reps: 10 },
        ],
        performed: [
          { weight: 10, reps: 10, done: false, completedAt: null },
          { weight: 10, reps: 10, done: false, completedAt: null },
          { weight: 10, reps: 10, done: false, completedAt: null },
        ],
      },
    ],
  });
}

const PRESS_CANDIDATE = {
  exerciseId: 'dumbbell-floor-press',
  name: 'Dumbbell floor press',
  weight: 10,
  reps: 10,
};
const PUSHUP_CANDIDATE = {
  exerciseId: 'push-up',
  name: 'Push-Up',
  weight: 0,
  reps: 10,
};

function withHistory(): AppState {
  return {
    profile: {
      goal: 'Build Muscle',
      experience: 'Intermediate',
      daysPerWeek: 3,
      equipment: [],
      support: [],
      exclusions: [],
      loads: {},
    },
    plan: [],
    history: [],
    current: makeSession(),
  };
}

test('a swap keeps completed sets and hands only the pending budget to the replacement', () => {
  let session = logSet(pressSession(), 0, 0, LATER);
  const completedAt = session.exercises[0].performed[0].completedAt;
  const before = sessionProgress(session);

  session = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);

  // Completed work stays under its original exercise, exactly as logged.
  const kept = session.exercises[0];
  assert.equal(kept.exerciseId, 'dumbbell-floor-press');
  assert.equal(kept.performed.length, 1);
  assert.equal(kept.performed[0].done, true);
  assert.equal(kept.performed[0].weight, 10);
  assert.equal(kept.performed[0].reps, 10);
  assert.equal(kept.performed[0].completedAt, completedAt);

  // The replacement inherits the remaining budget, not a default workout.
  const replacement = session.exercises[1];
  assert.equal(replacement.exerciseId, 'push-up');
  assert.equal(replacement.performed.length, 2);
  assert.equal(replacement.performed.every((set) => !set.done), true);
  assert.equal(replacement.planned.length, 2);

  const after = sessionProgress(session);
  assert.equal(after.total, before.total);
  assert.equal(after.done, before.done);
});

test('the full swap journey preserves both completed sets through finish', () => {
  let session = logSet(pressSession(), 0, 0, LATER);
  const pressCompletedAt = session.exercises[0].performed[0].completedAt;

  session = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);
  session = logSet(session, 1, 0, '2026-01-01T11:05:00.000Z');
  const pushupCompletedAt = session.exercises[1].performed[0].completedAt;
  session = swapPendingExercise(session, 1, PRESS_CANDIDATE);

  // Two remaining sets gave the replacement two, logging one left one, and
  // swapping back handed exactly that one to the floor press.
  const backEntry = session.exercises[2];
  assert.equal(backEntry.exerciseId, 'dumbbell-floor-press');
  assert.equal(backEntry.performed.length, 1);
  assert.equal(backEntry.performed[0].done, false);

  const progress = sessionProgress(session);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, 3);

  const state: AppState = { ...withHistory(), current: session };
  const finished = applyFinish(state, session.id, { early: true, now: FINISH });
  const workout = finished.history[0];

  const completedPresses = workout.exercises.filter(
    (exercise) => exercise.exerciseId === 'dumbbell-floor-press' && exercise.performed.some((set) => set.done),
  );
  const completedPushups = workout.exercises.filter(
    (exercise) => exercise.exerciseId === 'push-up' && exercise.performed.some((set) => set.done),
  );
  assert.equal(completedPresses.length, 1);
  assert.equal(completedPushups.length, 1);
  const pressSet = completedPresses[0].performed.find((set) => set.done);
  const pushupSet = completedPushups[0].performed.find((set) => set.done);
  assert.deepEqual(
    { weight: pressSet?.weight, reps: pressSet?.reps, completedAt: pressSet?.completedAt },
    { weight: 10, reps: 10, completedAt: pressCompletedAt },
  );
  assert.equal(pushupSet?.reps, 10);
  assert.equal(pushupSet?.completedAt, pushupCompletedAt);
});

test('the swap-back journey logs and corrects the returned set under the original exercise', () => {
  let session = logSet(pressSession(), 0, 0, LATER);
  session = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);
  session = logSet(session, 1, 0, LATER);
  session = swapPendingExercise(session, 1, PRESS_CANDIDATE);

  // The returned press segment is a separate entry; its active set can be
  // logged like any other and carries the original prescription's marker.
  const returned = session.exercises[2];
  assert.equal(returned.exerciseId, 'dumbbell-floor-press');
  assert.equal(returned.originalPlannedSets, 3);
  session = logSet(session, 2, 0, LATER);
  const progress = sessionProgress(session);
  assert.equal(progress.done, 3);
  assert.equal(progress.total, 3);
  assert.equal(progress.complete, true);

  const state: AppState = { ...withHistory(), current: session };
  const finished = applyFinish(state, session.id, { early: true, now: FINISH });
  assert.equal(finished.history[0].exercises[2].performed[0].done, true);

  // Correcting the returned set edits only that set, by the same indices the
  // history screen uses.
  const corrected = applyCorrection(finished, session.id, 2, 0, { weight: 12.5, reps: 7 }, LATER);
  assert.equal(corrected.history[0].exercises[2].performed[0].weight, 12.5);
  assert.equal(corrected.history[0].exercises[2].performed[0].reps, 7);
  assert.equal(corrected.history[0].exercises[0].performed[0].weight, 10);
  assert.equal(corrected.history[0].exercises[1].performed[0].weight, 0);
});

test('completing 1 of an originally 3-set exercise preserves the requirement', () => {
  let session = logSet(pressSession(), 0, 0, LATER);
  session = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);

  const state: AppState = { ...withHistory(), current: session };
  const finished = applyFinish(state, session.id, { early: true, now: FINISH });
  const workout = finished.history[0];

  // The kept press segment and the replacement both carry the slot's original
  // 3-set requirement; neither earned a full session.
  assert.equal(workout.exercises[0].originalPlannedSets, 3);
  assert.equal(workout.exercises[1].originalPlannedSets, 3);

  const pressed = workout.exercises[0].performed.filter((set) => set.done);
  assert.equal(pressed.length, 1);
});

test('a fully completed exercise has no pending work to swap', () => {
  let session = logSet(pressSession(), 0, 0, LATER);
  session = logSet(session, 0, 1, LATER);
  session = logSet(session, 0, 2, LATER);

  const unchanged = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);
  assert.equal(unchanged, session);
  const outOfRange = swapPendingExercise(session, 9, PUSHUP_CANDIDATE);
  assert.equal(outOfRange, session);
});

test('performed edits never mutate the prescription or the previous object', () => {
  const session = makeSession();
  const updated = updatePerformedSet(session, 0, 0, { weight: 22.5, reps: 8 }, LATER);

  assert.equal(session.exercises[0].performed[0].weight, 0);
  assert.deepEqual(updated.exercises[0].planned[0], { weight: 0, reps: 10 });
  assert.equal(updated.exercises[0].performed[0].weight, 22.5);
  assert.equal(updated.exercises[0].performed[0].reps, 8);
  assert.notEqual(updated, session);
});

test('marking a set complete records a timestamp; unmarking clears it', () => {
  const done = updatePerformedSet(makeSession(), 0, 0, { done: true }, LATER);
  assert.equal(done.exercises[0].performed[0].done, true);
  assert.equal(done.exercises[0].performed[0].completedAt, LATER);

  const undone = updatePerformedSet(done, 0, 0, { done: false }, LATER);
  assert.equal(undone.exercises[0].performed[0].done, false);
  assert.equal(undone.exercises[0].performed[0].completedAt, null);
});

test('sets can be added and removed as a correction, keeping planned in sync', () => {
  let session = addPerformedSet(makeSession(), 0);
  assert.equal(session.exercises[0].planned.length, 3);
  assert.equal(session.exercises[0].performed.length, 3);

  session = removePerformedSet(session, 0, 2);
  assert.equal(session.exercises[0].planned.length, 2);
  assert.equal(session.exercises[0].performed.length, 2);

  const single = removePerformedSet(makeSession(), 0, 1);
  const cannotRemoveLast = removePerformedSet(single, 0, 0);
  assert.equal(cannotRemoveLast.exercises[0].performed.length, 1);
});

test('progress and partial completion are computed from performed sets', () => {
  let session = updatePerformedSet(makeSession(), 0, 0, { weight: 20, reps: 10, done: true }, LATER);
  assert.deepEqual(sessionProgress(session), { total: 2, done: 1, volume: 200, complete: false });

  session = updatePerformedSet(session, 0, 1, { weight: 20, reps: 10, done: true }, LATER);
  assert.deepEqual(sessionProgress(session), { total: 2, done: 2, volume: 400, complete: true });
});

test('completeSession records late set timestamps and flags early finishes', () => {
  const partial = updatePerformedSet(makeSession(), 0, 0, { done: true }, LATER);
  const completed = completeSession(partial, { early: false, now: FINISH });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.endedAt, FINISH);
  assert.equal(completed.completedEarly, true);
  assert.equal(completed.exercises[0].performed[0].completedAt, LATER);
});

test('repeated Finish produces exactly one history entry', () => {
  let state = withHistory();
  state = applyFinish(state, 'workout-1', { early: false, now: FINISH });

  assert.equal(state.history.length, 1);
  assert.equal(state.current, null);
  assert.equal(state.history[0].status, 'completed');
  assert.equal(state.history[0].id, 'workout-1');

  const second = applyFinish(state, 'workout-1', { early: false, now: FINISH });
  assert.equal(second, state);
  assert.equal(second.history.length, 1);
});

test('finishing a stale session id does nothing', () => {
  const state = withHistory();
  const result = applyFinish(state, 'some-other-id', { early: false, now: FINISH });
  assert.equal(result, state);
  assert.equal(result.history.length, 0);
  assert.ok(result.current);
});

test('cancel discards the active session without writing history', () => {
  const state = withHistory();
  const result = applyCancel(state, 'workout-1');
  assert.equal(result.current, null);
  assert.equal(result.history.length, 0);

  const stale = applyCancel(state, 'nope');
  assert.equal(stale, state);
});

test('history corrections change performed values only', () => {
  let state = applyFinish(withHistory(), 'workout-1', { early: true, now: FINISH });
  const workoutId = state.history[0].id;

  state = applyCorrection(state, workoutId, 0, 0, { weight: 30, reps: 12 }, LATER);
  assert.equal(state.history[0].exercises[0].performed[0].weight, 30);
  assert.equal(state.history[0].exercises[0].performed[0].reps, 12);
  assert.deepEqual(state.history[0].exercises[0].planned[0], { weight: 0, reps: 10 });

  state = applyCorrection(state, workoutId, 0, 0, { done: true }, LATER);
  assert.equal(state.history[0].exercises[0].performed[0].done, true);
  assert.equal(state.history[0].exercises[0].performed[0].completedAt, LATER);

  const unknown = applyCorrection(state, 'missing', 0, 0, { weight: 1 }, LATER);
  assert.equal(unknown, state);
});

test('a swap-back sees the load already logged in the open session', () => {
  // Log one press set, swap the 2 pending sets away, then ask what the press
  // is holding: the answer must be the logged 10 kg x 10, not a first-time 0.
  let session = logSet(pressSession(), 0, 0, LATER);
  session = swapPendingExercise(session, 0, PUSHUP_CANDIDATE);
  const done = latestDoneSet(session, 'dumbbell-floor-press');
  assert.deepEqual(done, { weight: 10, reps: 10 });
  assert.equal(latestDoneSet(session, 'goblet-squat'), null);
});
