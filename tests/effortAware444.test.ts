import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #444: repeated-failure deloads and the range-reset floor fix.
// (The "returning after a break" rule was split out to its own issue — see #444's tracking comment.)

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

function sets(weight: number, reps: number, count = 4) {
  return Array.from({ length: count }, () => ({ weight, reps }));
}

interface Entry {
  id: string;
  date: string;
  exerciseId: string;
  planned: { weight: number; reps: number }[];
  performed: { weight: number; reps: number; done?: boolean }[];
  feedback?: WorkoutRecord['feedback'];
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
    feedback: entry.feedback,
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

/** Two of four planned sets logged at `weight`: the same miss shape every time, so the streak lines up. */
function unfinished(id: string, date: string, weight: number): WorkoutRecord {
  return record({
    id,
    date,
    exerciseId: 'barbell-bench-press',
    planned: sets(weight, 8, 4),
    performed: [{ weight, reps: 6 }, { weight, reps: 6 }],
  });
}

/** Nothing logged at all: silence, not a miss. */
function silent(id: string, date: string, weight: number): WorkoutRecord {
  return record({ id, date, exerciseId: 'barbell-bench-press', planned: sets(weight, 8, 4), performed: [] });
}

test('two unfinished sessions at the same load deload instead of repeating a third time', () => {
  const history = [unfinished('w1', '2026-01-03T10:00:00.000Z', 60), unfinished('w2', '2026-01-05T10:00:00.000Z', 60)];
  const now = new Date('2026-01-06T10:00:00.000Z');
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', now);
  assert.equal(prescription.basis, 'stalled');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('a single unfinished session still repeats: the deload needs the second miss (N=2)', () => {
  const history = [unfinished('w1', '2026-01-05T10:00:00.000Z', 60)];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home');
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
});

test('a session with nothing logged breaks the failure streak instead of extending it', () => {
  const history = [
    unfinished('w1', '2026-01-03T10:00:00.000Z', 60),
    silent('w2', '2026-01-04T10:00:00.000Z', 60),
    unfinished('w3', '2026-01-05T10:00:00.000Z', 60),
  ];
  const now = new Date('2026-01-06T10:00:00.000Z');
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', now);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
});

test('a first-ever session is never misread as a repeated failure', () => {
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [], false, true, 'home');
  assert.equal(prescription.basis, 'first-time');
});

test('a range reset with no owned load at or under the estimate keeps the last working weight, not the rack floor', () => {
  const history = [record({
    id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: 'face-pull',
    planned: sets(20, 8, 3), performed: sets(20, 8, 3),
  })];
  // e1RM = 20 x (1 + 8/30) = 25.33; load for 12 reps = 25.33 / 1.4 = 18.10. Both owned cables (19, 22) sit above it.
  const prescription = prescribeExercise(meta('face-pull'), makeProfile({ loads: { Cable: [19, 22] } }), history, false, true, 'home');
  assert.equal(prescription.basis, 'range-reset');
  assert.equal(prescription.weight, 20, 'carries the last working weight forward, not the 19 kg floor');
  assert.equal(prescription.reps, 12);
});

test('a legacy record with no feedback or status field reads as a normal earned session', () => {
  const legacy: WorkoutRecord = {
    id: 'w1', date: '2025-12-20T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId: 'barbell-bench-press', name: 'Bench Press',
      planned: sets(60, 8, 4),
      performed: sets(60, 10, 4).map((set) => ({ ...set, done: true, completedAt: null })),
    }],
  };
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [legacy], false, true, 'home');
  assert.equal(prescription.basis, 'load-increase');
  assert.equal(prescription.weight, 62.5);
});
