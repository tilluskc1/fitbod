import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #444: repeated-failure deloads, break/comeback deloads, and the range-reset floor fix.

/** Just after this file's 2026-01-05 fixtures: keeps #444's "returning after a break" rule predictable. */
const NOW = new Date('2026-01-06T10:00:00.000Z');

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

/** A full session at the range top, so the earned basis is load-increase before any break/feedback rule applies. */
function finishedFull(id: string, date: string, weight: number, feedback?: WorkoutRecord['feedback']): WorkoutRecord {
  return record({
    id,
    date,
    exerciseId: 'barbell-bench-press',
    planned: sets(weight, 8, 4),
    performed: sets(weight, 10, 4),
    feedback,
  });
}

test('two unfinished sessions at the same load deload instead of repeating a third time', () => {
  const history = [unfinished('w1', '2026-01-03T10:00:00.000Z', 60), unfinished('w2', '2026-01-05T10:00:00.000Z', 60)];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'stalled');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('a single unfinished session still repeats: the deload needs the second miss (N=2)', () => {
  const history = [unfinished('w1', '2026-01-05T10:00:00.000Z', 60)];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
});

test('a session with nothing logged breaks the failure streak instead of extending it', () => {
  const history = [
    unfinished('w1', '2026-01-03T10:00:00.000Z', 60),
    silent('w2', '2026-01-04T10:00:00.000Z', 60),
    unfinished('w3', '2026-01-05T10:00:00.000Z', 60),
  ];
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
});

test('a first-ever session is never misread as a repeated failure', () => {
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [], false, true, 'home', NOW);
  assert.equal(prescription.basis, 'first-time');
});

test('returning after a 10+ day break targets a reduced load, not the pre-break top', () => {
  const history = [finishedFull('w1', '2025-12-20T10:00:00.000Z', 60)]; // 17 days before NOW
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'comeback');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('a break shorter than 10 days does not override the earned basis', () => {
  const history = [finishedFull('w1', '2025-12-28T10:00:00.000Z', 60)]; // 9 days before NOW
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'load-increase');
  assert.equal(prescription.weight, 62.5);
});

test('bodyweight work has no load to step down, so a break is left alone', () => {
  const history = [record({
    id: 'w1', date: '2025-12-01T10:00:00.000Z', exerciseId: 'push-up',
    planned: sets(0, 15, 4), performed: sets(0, 20, 4),
  })];
  const prescription = prescribeExercise(meta('push-up'), makeProfile(), history, false, true, 'home', NOW);
  assert.notEqual(prescription.basis, 'comeback');
});

test('a "too much" deload from a stale session is not stepped down twice by the break rule', () => {
  const history = [finishedFull('w1', '2025-12-20T10:00:00.000Z', 60, 'too-much')]; // 17 days before NOW
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'deload');
  assert.equal(prescription.weight, 57.5);
});

test('a range reset with no owned load at or under the estimate keeps the last working weight, not the rack floor', () => {
  const history = [record({
    id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: 'face-pull',
    planned: sets(20, 8, 3), performed: sets(20, 8, 3),
  })];
  // e1RM = 20 x (1 + 8/30) = 25.33; load for 12 reps = 25.33 / 1.4 = 18.10. Both owned cables (19, 22) sit above it.
  const prescription = prescribeExercise(meta('face-pull'), makeProfile({ loads: { Cable: [19, 22] } }), history, false, true, 'home', NOW);
  assert.equal(prescription.basis, 'range-reset');
  assert.equal(prescription.weight, 20, 'carries the last working weight forward, not the 19 kg floor');
  assert.equal(prescription.reps, 12);
});

test('a legacy record with no feedback or setup field reads as a normal home session', () => {
  const legacy: WorkoutRecord = {
    id: 'w1', date: '2025-12-20T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId: 'barbell-bench-press', name: 'Bench Press',
      planned: sets(60, 8, 4),
      performed: sets(60, 10, 4).map((set) => ({ ...set, done: true, completedAt: null })),
    }],
  };
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [legacy], false, true, 'home', NOW);
  assert.equal(prescription.basis, 'comeback');
  assert.equal(prescription.weight, 57.5);
});

test('a lifter who always trains 12+ days apart does not ratchet down every session', () => {
  // A real starting session, earned top of range: the baseline before the cadence kicks in.
  let history: WorkoutRecord[] = [finishedFull('seed', '2025-11-01T10:00:00.000Z', 60)];
  let now = new Date('2025-11-13T10:00:00.000Z'); // 12 days later: the lifter's normal rhythm for this lift.
  let lowestWeight = Infinity;
  for (let i = 0; i < 6; i += 1) {
    const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', now);
    lowestWeight = Math.min(lowestWeight, prescription.weight);
    history.push(record({
      id: `cadence-${i}`,
      date: now.toISOString(),
      exerciseId: 'barbell-bench-press',
      planned: sets(prescription.weight, prescription.reps, 4),
      performed: sets(prescription.weight, prescription.reps, 4),
    }));
    now = new Date(now.getTime() + 12 * 86_400_000);
  }
  // Only the first gap (seed to session 0) is a real break; every later 12-day gap is this lift's own rhythm.
  assert.ok(lowestWeight >= 57.5, `weight should not ratchet below the one real comeback step, got ${lowestWeight}`);
});

test('a mixed cadence (some gaps short, some 10+ days) does not ratchet down forever either', () => {
  let history: WorkoutRecord[] = [finishedFull('seed', '2025-11-01T10:00:00.000Z', 60)];
  let now = new Date('2025-11-13T10:00:00.000Z'); // 12 days: a break.
  const gaps = [12, 3, 12, 3, 12, 3, 12, 3, 12, 3, 12, 3];
  let lowestWeight = Infinity;
  for (const gapDays of gaps) {
    const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', now);
    lowestWeight = Math.min(lowestWeight, prescription.weight);
    history.push(record({
      id: `mixed-${now.toISOString()}`,
      date: now.toISOString(),
      exerciseId: 'barbell-bench-press',
      planned: sets(prescription.weight, prescription.reps, 4),
      performed: sets(prescription.weight, prescription.reps, 4),
    }));
    now = new Date(now.getTime() + gapDays * 86_400_000);
  }
  // One real layoff step (57.5) is expected; it must not compound every time a gap happens to clear 10 days.
  assert.ok(lowestWeight >= 57.5, `weight should not ratchet below the one real comeback step, got ${lowestWeight}`);
});

test('an open session across the break boundary is never read as the last completed session', () => {
  const completed = finishedFull('w1', '2025-12-20T10:00:00.000Z', 60); // 17 days before NOW: a break on its own
  const open = { ...finishedFull('w2', '2026-01-05T10:00:00.000Z', 60), status: 'active' as const }; // still open, 1 day before NOW
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [completed, open], false, true, 'home', NOW);
  assert.equal(prescription.basis, 'comeback');
  assert.equal(prescription.weight, 57.5);
});
