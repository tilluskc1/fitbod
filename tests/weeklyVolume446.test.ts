import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklySetsPerMuscle } from '../src/lib/progressTotals.ts';
import type { WorkoutRecord } from '../src/types.ts';

// #446: weekly sets-per-muscle tracking (backend-only slice). The split-picker UI
// part moved to its own issue, #463, blocked on design approval.

function sets(weight: number, reps: number, count: number, done = true) {
  return Array.from({ length: count }, () => ({ weight, reps, done, completedAt: null }));
}

function workout(id: string, date: string, exercises: { exerciseId: string; performed: ReturnType<typeof sets> }[]): WorkoutRecord {
  return {
    id,
    date,
    name: 'Push',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: exercises.map((entry) => ({
      exerciseId: entry.exerciseId,
      name: entry.exerciseId,
      planned: entry.performed.map(({ weight, reps }) => ({ weight, reps })),
      performed: entry.performed,
    })),
  };
}

test('sums done sets per muscle, crediting every muscle a multi-muscle exercise trains', () => {
  const history = [
    workout('w1', '2026-01-05T10:00:00.000Z', [
      { exerciseId: 'barbell-bench-press', performed: sets(60, 8, 4) }, // Chest, Triceps, Shoulders
    ]),
  ];
  const totals = weeklySetsPerMuscle(history, new Date('2026-01-06T00:00:00.000Z'));
  assert.equal(totals.Chest, 4);
  assert.equal(totals.Triceps, 4);
  assert.equal(totals.Shoulders, 4);
});

test('adds across sessions and exercises that share a muscle', () => {
  const history = [
    workout('w1', '2026-01-03T10:00:00.000Z', [{ exerciseId: 'barbell-row', performed: sets(60, 8, 4) }]), // Back, Biceps
    workout('w2', '2026-01-05T10:00:00.000Z', [{ exerciseId: 'face-pull', performed: sets(15, 12, 3) }]), // Back, Shoulders
  ];
  const totals = weeklySetsPerMuscle(history, new Date('2026-01-06T00:00:00.000Z'));
  assert.equal(totals.Back, 7);
  assert.equal(totals.Biceps, 4);
  assert.equal(totals.Shoulders, 3);
});

test('a session exactly 7 days back counts; one past the window does not', () => {
  const now = new Date('2026-01-08T12:00:00.000Z');
  const history = [
    workout('in', '2026-01-01T12:00:00.000Z', [{ exerciseId: 'barbell-row', performed: sets(60, 8, 4) }]),
    workout('out', '2026-01-01T11:00:00.000Z', [{ exerciseId: 'face-pull', performed: sets(15, 12, 3) }]),
  ];
  const totals = weeklySetsPerMuscle(history, now);
  assert.equal(totals.Back, 4, 'the session exactly at the 7-day boundary counts');
  assert.equal(totals.Shoulders, undefined, 'an hour older falls outside the window');
});

test('a planned-but-not-done set does not count', () => {
  const history = [
    workout('w1', '2026-01-05T10:00:00.000Z', [
      { exerciseId: 'barbell-bench-press', performed: [...sets(60, 8, 2, true), ...sets(60, 8, 2, false)] },
    ]),
  ];
  const totals = weeklySetsPerMuscle(history, new Date('2026-01-06T00:00:00.000Z'));
  assert.equal(totals.Chest, 2);
});

test('an exercise no longer in the catalog is skipped, not thrown', () => {
  const history = [
    workout('w1', '2026-01-05T10:00:00.000Z', [{ exerciseId: 'retired-exercise-id', performed: sets(60, 8, 4) }]),
  ];
  const totals = weeklySetsPerMuscle(history, new Date('2026-01-06T00:00:00.000Z'));
  assert.deepEqual(totals, {});
});

test('empty history gives an empty total, not an error', () => {
  const totals = weeklySetsPerMuscle([], new Date('2026-01-06T00:00:00.000Z'));
  assert.deepEqual(totals, {});
});

test('an unfinished session still credits the sets actually done', () => {
  const history = [{
    ...workout('w1', '2026-01-05T10:00:00.000Z', [{ exerciseId: 'barbell-row', performed: sets(60, 8, 2) }]),
    status: 'active' as const,
  }];
  const totals = weeklySetsPerMuscle(history, new Date('2026-01-06T00:00:00.000Z'));
  assert.equal(totals.Back, 2);
});
