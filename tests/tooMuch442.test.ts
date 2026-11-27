import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Intermediate',
    daysPerWeek: 3,
    equipment: [],
    support: [],
    exclusions: [],
    loads: {},
    ...overrides,
  };
}

/** Just after this file's 2026-01-05 fixtures: keeps #444's "returning after a break" rule from firing on history this old relative to the real clock. */
const NOW = new Date('2026-01-06T10:00:00.000Z');

function meta(exerciseId: string) {
  const exercise = EXERCISES.find((item) => item.id === exerciseId);
  assert.ok(exercise, `unknown exercise ${exerciseId}`);
  return exercise;
}

function sets(weight: number, reps: number, count = 4) {
  return Array.from({ length: count }, () => ({ weight, reps }));
}

function record(
  id: string,
  exerciseId: string,
  weight: number,
  reps: number,
  feedback?: WorkoutRecord['feedback'],
): WorkoutRecord {
  return {
    id,
    date: '2026-01-05T10:00:00.000Z',
    name: 'Push',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    feedback,
    exercises: [
      {
        exerciseId,
        name: meta(exerciseId).name,
        planned: sets(weight, reps),
        performed: sets(weight, reps).map((set) => ({ ...set, done: true, completedAt: null })),
      },
    ],
  };
}

// #442: a workout marked "Too much" steps the next prescription down instead of up or holding.

test('"too much" steps a load-increase down instead of up', () => {
  const history = [record('w1', 'barbell-bench-press', 60, 10, 'too-much')];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'deload');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('feedback on a different workout does not trigger a deload', () => {
  const history = [
    record('w1', 'barbell-bench-press', 57.5, 10),
    record('w2', 'incline-dumbbell-press', 20, 10, 'too-much'),
  ];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.notEqual(prescription.basis, 'deload');
});

test('"about right" and no feedback leave progression alone', () => {
  const about = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [
    record('w1', 'barbell-bench-press', 60, 10, 'about-right'),
  ], false, true, 'home', NOW);
  assert.equal(about.basis, 'load-increase');

  const none = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [
    record('w1', 'barbell-bench-press', 60, 10),
  ], false, true, 'home', NOW);
  assert.equal(none.basis, 'load-increase');
});

test('bodyweight work has no load to deload, so "too much" is left alone', () => {
  const history = [record('w1', 'bodyweight-squat', 0, 20, 'too-much')];
  const prescription = prescribeExercise(meta('bodyweight-squat'), makeProfile(), history, false, true, 'home', NOW);
  assert.notEqual(prescription.basis, 'deload');
});

test('already at the rack\'s lowest owned load, "too much" holds rather than faking a deload', () => {
  const profile = makeProfile({ loads: { Dumbbell: [10, 15, 20] } });
  const history = [record('w1', 'dumbbell-pullover', 10, 12, 'too-much')];
  const prescription = prescribeExercise(meta('dumbbell-pullover'), profile, history, false, true, 'home', NOW);
  assert.notEqual(prescription.basis, 'deload');
});
