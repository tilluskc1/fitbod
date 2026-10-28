import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { generateWorkout } from '../src/lib/generator.ts';
import {
  availableLoads,
  describePrescription,
  incrementFor,
  lastExercisePerformance,
  nextLoad,
  prescribeExercise,
  repRangeFor,
  setCountFor,
} from '../src/lib/progression.ts';
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

function meta(exerciseId: string) {
  const exercise = EXERCISES.find((item) => item.id === exerciseId);
  assert.ok(exercise, `unknown exercise ${exerciseId}`);
  return exercise;
}

interface Entry {
  id: string;
  date: string;
  exerciseId: string;
  planned: { weight: number; reps: number }[];
  performed: { weight: number; reps: number; done?: boolean }[];
  status?: WorkoutRecord['status'];
}

function record(entry: Entry): WorkoutRecord {
  return {
    id: entry.id,
    date: entry.date,
    name: 'Push',
    dayIndex: 0,
    status: entry.status ?? 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: [
      {
        exerciseId: entry.exerciseId,
        name: meta(entry.exerciseId).name,
        planned: entry.planned,
        performed: entry.performed.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          done: set.done ?? true,
          completedAt: null,
        })),
      },
    ],
  };
}

/** Four completed working sets. */
function sets(weight: number, reps: number, count = 4) {
  return Array.from({ length: count }, () => ({ weight, reps }));
}

test('a first prescription invents no load and starts inside the rep range', () => {
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), []);

  assert.equal(prescription.weight, 0);
  assert.equal(prescription.reps, 8);
  assert.equal(prescription.sets, 4);
  assert.equal(prescription.basis, 'first-time');
  assert.equal(prescription.last, null);
});

test('rep ranges follow the movement class instead of one global number', () => {
  assert.deepEqual(repRangeFor(meta('back-squat').pattern), { min: 6, max: 10 });
  assert.deepEqual(repRangeFor(meta('leg-extension').pattern), { min: 8, max: 12 });
  assert.deepEqual(repRangeFor(meta('lateral-raise').pattern), { min: 10, max: 15 });
});

test('every set at the top of the range adds one step and resets reps', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 10),
      performed: sets(60, 10),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'load-increase');
  assert.equal(prescription.weight, 62.5);
  assert.equal(prescription.reps, 6);
});

test('finishing below the top of the range adds a rep at the same load', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 8),
      performed: sets(60, 8),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'rep-increase');
  assert.equal(prescription.weight, 60);
  assert.equal(prescription.reps, 9);
});

test('the rep climb is capped at the top of the range', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'lateral-raise',
      planned: sets(10, 14),
      performed: sets(10, 14),
    }),
  ];

  const prescription = prescribeExercise(meta('lateral-raise'), makeProfile(), history);
  assert.equal(prescription.reps, 15);
  assert.equal(prescription.weight, 10);
});

test('an unfinished exercise repeats its load instead of progressing', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 10),
      performed: [
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: false },
      ],
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
  assert.equal(prescription.reps, 10);
});

test('a session whose sets were never logged repeats the prescription', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(70, 8),
      performed: sets(70, 8).map((set) => ({ ...set, done: false })),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 70);
  assert.equal(prescription.reps, 8);
});

test('the most recent completed session with the exercise drives the next load', () => {
  const history = [
    record({
      id: 'current',
      date: '2026-03-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(90, 10),
      performed: sets(90, 10),
      status: 'active',
    }),
    record({
      id: 'unrelated',
      date: '2026-02-20T10:00:00.000Z',
      exerciseId: 'lateral-raise',
      planned: sets(12, 12),
      performed: sets(12, 12),
    }),
    record({
      id: 'recent',
      date: '2026-02-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(55, 10),
      performed: sets(55, 10),
    }),
    record({
      id: 'old',
      date: '2026-01-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(50, 10),
      performed: sets(50, 10),
    }),
  ];

  const last = lastExercisePerformance(history, 'barbell-bench-press');
  assert.equal(last?.workoutId, 'recent');
  assert.equal(last?.workoutName, 'Push');
  assert.equal(prescribeExercise(meta('barbell-bench-press'), makeProfile(), history).weight, 57.5);
});

test('recorded loads supply both the step and the next selectable load', () => {
  const loads = { Barbell: [20, 25, 30] };
  const profile = makeProfile({ loads });
  const available = availableLoads(profile, 'Barbell');

  assert.deepEqual(available, [20, 25, 30]);
  assert.equal(incrementFor('Barbell', available), 5);
  assert.equal(nextLoad(25, 5, available), 30);
  // No recorded inventory: the next load is the step above the working weight.
  assert.equal(nextLoad(60, 2.5, []), 62.5);
  // An off-grid weight still moves up one whole step, never down.
  assert.equal(nextLoad(61, 2.5, []), 65);

  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(25, 10),
      performed: sets(25, 10),
    }),
  ];
  const up = prescribeExercise(meta('barbell-bench-press'), profile, history);
  assert.equal(up.weight, 30);
  assert.equal(up.reps, 6);

  const topped = prescribeExercise(meta('barbell-bench-press'), profile, [
    record({
      id: 'w2',
      date: '2026-02-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(30, 10),
      performed: sets(30, 10),
    }),
  ]);
  assert.equal(topped.basis, 'hold');
  assert.equal(topped.weight, 30);
  assert.equal(topped.reps, 10);
  assert.match(describePrescription(topped), /available loads/);
});

test('bodyweight movements hold at the top of the range instead of inventing load', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'push-up',
      planned: sets(0, 10),
      performed: sets(0, 10),
    }),
  ];

  const prescription = prescribeExercise(meta('push-up'), makeProfile(), history);
  assert.equal(prescription.increment, 0);
  assert.equal(prescription.basis, 'hold');
  assert.equal(prescription.weight, 0);
  assert.equal(prescription.reps, 10);
  assert.equal(setCountFor(meta('push-up')), 4);
  assert.equal(setCountFor(meta('lateral-raise')), 3);
});

test('generated sessions carry the prescription into planned and performed sets', () => {
  const profile = makeProfile({ equipment: ['Dumbbell'], support: ['Bench'] });
  const pushExercises = [
    'dumbbell-bench-press',
    'incline-dumbbell-press',
    'dumbbell-shoulder-press',
    'arnold-press',
    'lateral-raise',
    'rear-delt-fly',
  ];
  const history = pushExercises.map((exerciseId, index) =>
    record({
      id: `h${index}`,
      date: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      exerciseId,
      planned: sets(20, 10),
      performed: sets(20, 10),
    }),
  );

  const generated = generateWorkout(
    profile,
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    0,
    history,
  );
  assert.ok(generated.exercises.length > 0);

  for (const exercise of generated.exercises) {
    const definition = meta(exercise.exerciseId);
    const prescription = prescribeExercise(definition, profile, history);
    assert.deepEqual(exercise.planned[0], {
      weight: prescription.weight,
      reps: prescription.reps,
    });
    assert.deepEqual(exercise.performed[0], {
      weight: prescription.weight,
      reps: prescription.reps,
      done: false,
      completedAt: null,
    });
    assert.equal(exercise.planned.length, exercise.performed.length);
  }

  const loaded = generated.exercises.filter((exercise) => exercise.planned[0].weight > 0);
  assert.ok(loaded.length >= 2, 'logged dumbbell work should produce prescribed loads');
  for (const exercise of loaded) {
    // Compound work at the top of a 6–10 range earned a load step; accessory
    // work at 10 reps in a 10–15 range earned a rep instead.
    const range = repRangeFor(meta(exercise.exerciseId).pattern);
    assert.deepEqual(
      exercise.planned[0],
      range.max === 10 ? { weight: 22.5, reps: 6 } : { weight: 20, reps: 11 },
    );
  }
});
