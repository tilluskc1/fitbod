import assert from 'node:assert/strict';
import test from 'node:test';
import * as adaptation from '../src/lib/adapt.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { applyFinish, createSession, logSet, sessionProgress, swapPendingExercise } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {},
};
function shortened() {
  const workout = adaptation.adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' }, [], undefined);
  return createSession({ id: 'undo-session', name: workout.name, dayIndex: 0,
    durationMin: 20, now: '2026-10-31T10:00:00.000Z', exercises: adaptation.toWorkoutExercises(workout) });
}
function done(session: WorkoutRecord) {
  return session.exercises.flatMap((exercise) => exercise.performed.flatMap((set, index) =>
    set.done ? [{ exerciseId: exercise.exerciseId, planned: exercise.planned[index], actual: set }] : []));
}

test('Undo restores original pending work while retaining the later logged actual and session', () => {
  const active = logSet(shortened(), 0, 0, '2026-10-31T10:05:00.000Z');
  const original = adaptation.adaptWorkout(FULL_BODY_A, defaultConstraints(profile), profile.exclusions, profile.goal);
  const restored = adaptation.restorePendingWorkout(active, original);
  assert.equal(sessionProgress(restored).total, 11);
  assert.equal(restored.exercises[0].planned.length, 3);
  assert.equal(restored.durationMin, 35);
  assert.equal(restored.id, active.id);
  assert.equal(restored.date, active.date);
  assert.equal(restored.restStartedAt, active.restStartedAt);
  assert.deepEqual(done(restored), done(active));
  assert.equal(sessionProgress(active).total, 8, '20 min keeps 8 sets by the timer (#203)');
  assert.deepEqual(adaptation.restorePendingWorkout(restored, original), restored);
});

test('Undo counts completed swap variants once and never transfers their loads', () => {
  let active = logSet(shortened(), 0, 0, '2026-10-31T10:05:00.000Z');
  active = swapPendingExercise(active, 0, { exerciseId: 'push-up', name: 'Push-Up', weight: 0, reps: 8 });
  active = logSet(active, 1, 0, '2026-10-31T10:06:00.000Z');
  const original = adaptation.adaptWorkout(FULL_BODY_A, defaultConstraints(profile), profile.exclusions, profile.goal);
  const restored = adaptation.restorePendingWorkout(active, original);
  assert.equal(sessionProgress(restored).total, 11);
  assert.deepEqual(done(restored), done(active));
  // The slot's pending set goes to the last part of its swap, on the push-up's own load (#250).
  const press = restored.exercises.find((exercise) => exercise.exerciseId === 'dumbbell-floor-press');
  const pushUp = restored.exercises.find((exercise) => exercise.exerciseId === 'push-up');
  assert.equal(press?.performed.filter((set) => !set.done).length, 0);
  assert.equal(pushUp?.performed.filter((set) => !set.done).length, 1);
  assert.deepEqual(pushUp?.performed.map((set) => set.weight), [0, 0]);
  assert.deepEqual(adaptation.restorePendingWorkout(restored, original), restored);
});

test('accepting a shortened adaptation mid-session keeps the logged set and trims only pending work', () => {
  const full = adaptation.adaptWorkout(FULL_BODY_A, defaultConstraints(profile), profile.exclusions, profile.goal);
  const active = logSet(
    createSession({ id: 'mid-session', name: full.name, dayIndex: 0, durationMin: full.minutes,
      now: '2026-10-31T10:00:00.000Z', exercises: adaptation.toWorkoutExercises(full) }),
    0, 0, '2026-10-31T10:05:00.000Z',
  );
  const adapted = adaptation.adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' }, profile.exclusions, undefined);
  const merged = adaptation.restorePendingWorkout(active, adapted);
  // Same session, new length, completed work untouched.
  assert.equal(merged.id, active.id);
  assert.equal(merged.durationMin, 20);
  assert.equal(sessionProgress(merged).done, 1);
  assert.deepEqual(done(merged), done(active));
  assert.equal(merged.exercises[0].planned.length, 2);
  // The original 3-set obligation survives, so a shortened finish cannot earn progression.
  assert.equal(merged.exercises[0].originalPlannedSets, 3);
  const finished = applyFinish({ ...EMPTY_STATE, profile, current: merged }, merged.id,
    { early: true, now: '2026-10-31T10:30:00.000Z' });
  assert.equal(finished.history.length, 1);
  assert.equal(finished.current, null);
  assert.equal(finished.history[0].exercises[0].performed.filter((set) => set.done).length, 1);
});

test('Undo uses saved defaults and exclusions while preserving already completed excluded work', () => {
  const saved = { ...profile, sessionMinutes: 30, exclusions: ['dumbbell-row'] };
  const active = logSet(shortened(), 2, 0, '2026-10-31T10:05:00.000Z');
  const original = adaptation.adaptWorkout(FULL_BODY_A, defaultConstraints(saved), saved.exclusions, saved.goal);
  const restored = adaptation.restorePendingWorkout(active, original);
  assert.equal(restored.durationMin, 30);
  assert.deepEqual(done(restored), done(active));
  const row = restored.exercises.find((exercise) => exercise.exerciseId === 'dumbbell-row');
  assert.equal(row?.performed.length, 1);
  assert.equal(row?.performed[0].done, true);
  assert.equal(sessionProgress(restored).total, original.totalSets + 1);
});
