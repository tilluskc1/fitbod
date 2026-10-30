import assert from 'node:assert/strict';
import test from 'node:test';
import { lastPerformance } from '../src/lib/plan.ts';
import type { WorkoutRecord } from '../src/types.ts';

function workout(performed: { reps: number; done: boolean }[]): WorkoutRecord {
  return {
    id: 'w1',
    date: '2026-10-27T18:00:00.000Z',
    name: 'Full body A',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: [
      {
        exerciseId: 'dumbbell-floor-press',
        name: 'Dumbbell floor press',
        planned: [{ weight: 15, reps: 9 }],
        performed: performed.map((set) => ({
          weight: 15,
          reps: set.reps,
          done: set.done,
          completedAt: set.done ? '2026-10-27T18:10:00.000Z' : null,
        })),
      },
    ],
  };
}

test('lastPerformance reports nothing for an empty history', () => {
  assert.equal(lastPerformance([], 'dumbbell-floor-press'), null);
});

test('lastPerformance ignores sessions with no completed set', () => {
  assert.equal(lastPerformance([workout([{ reps: 9, done: false }])], 'dumbbell-floor-press'), null);
});

test('lastPerformance reports only completed sets', () => {
  const last = lastPerformance(
    [workout([{ reps: 9, done: true }, { reps: 8, done: false }])],
    'dumbbell-floor-press',
  );
  assert.deepEqual(last?.reps, [9]);
  assert.equal(last?.weight, 15);
});

test('lastPerformance aggregates repeated segments of the same exercise', () => {
  const base = workout([{ reps: 10, done: true }]);
  const swappedBack: WorkoutRecord = {
    ...base,
    exercises: [
      ...base.exercises,
      {
        exerciseId: 'dumbbell-floor-press',
        name: 'Dumbbell floor press',
        planned: [{ weight: 15, reps: 9 }],
        performed: [
          { weight: 12.5, reps: 8, done: true, completedAt: '2026-10-27T18:12:00.000Z' },
        ],
      },
    ],
  };

  const last = lastPerformance([swappedBack], 'dumbbell-floor-press');
  assert.deepEqual(last?.reps, [10, 8]);
  assert.equal(last?.weight, 15);
});
