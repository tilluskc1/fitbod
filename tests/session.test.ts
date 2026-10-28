import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPerformedSet,
  applyCancel,
  applyCorrection,
  applyFinish,
  completeSession,
  createSession,
  removePerformedSet,
  sessionProgress,
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
