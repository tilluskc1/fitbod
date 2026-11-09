import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { coachLine, describePrescription, prescribeExercise } from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const profile: Profile = {
  goal: 'Build Muscle',
  experience: 'Intermediate',
  daysPerWeek: 3,
  equipment: [],
  support: [],
  exclusions: [],
  loads: {},
};

/** One completed session: three sets planned at `planned` reps, each done at `done` reps. */
function history(exerciseId: string, weight: number, planned: number, done: number): WorkoutRecord[] {
  return [{
    id: 'w1',
    date: '2026-11-01T10:00:00.000Z',
    name: 'Pull',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: [{
      exerciseId,
      name: exerciseId,
      planned: Array.from({ length: 3 }, () => ({ weight, reps: planned })),
      performed: Array.from({ length: 3 }, () => ({ weight, reps: done, done: true, completedAt: null })),
    }],
  }];
}

const prescribe = (exerciseId: string, rows: WorkoutRecord[], loads: Profile['loads'] = {}) =>
  prescribeExercise(exerciseById(exerciseId)!, { ...profile, loads }, rows);

test('#139: Face Pull 20 kg × 8 from its old 6–10 range drops to the Epley load for 12', () => {
  // e1RM = 20 × (1 + 8/30) = 25.33; load for 12 = 25.33 / 1.4 = 18.10 → 17.5 on the 2.5 kg cable grid.
  const prescription = prescribe('face-pull', history('face-pull', 20, 8, 8));
  assert.deepEqual(prescription.range, { min: 12, max: 20 });
  assert.equal(prescription.weight, 17.5);
  assert.equal(prescription.reps, 12);
});

test('#139: the Face Pull line names the new range instead of "add a rep"', () => {
  const prescription = prescribe('face-pull', history('face-pull', 20, 8, 8));
  assert.equal(prescription.basis, 'range-reset');
  assert.equal(coachLine(prescription, 'kg'), 'New rep range: 17.5 kg for 12.');
  assert.match(describePrescription(prescription, 'kg'), /20 kg × 8\. The range is now 12–20, so the load drops to 17\.5 kg for 12 reps\./);
});

test('#139: a failed set inside an unchanged range keeps the load and adds a rep', () => {
  // Planned 12 (inside 12–20), lifted 8: a missed target, not a range change.
  const prescription = prescribe('face-pull', history('face-pull', 20, 12, 8));
  assert.equal(prescription.basis, 'rep-increase');
  assert.equal(prescription.weight, 20);
  assert.equal(prescription.reps, 12);
});

test('#139: barbell and dumbbell loads round down to their step', () => {
  // Skull crusher 30 × 8 → 10–15: 30 × 38/30 / (40/30) = 28.5 → 27.5 on the 2.5 kg barbell grid.
  const barbell = prescribe('skull-crusher', history('skull-crusher', 30, 8, 8));
  assert.deepEqual([barbell.weight, barbell.reps, barbell.basis], [27.5, 10, 'range-reset']);
  // Dumbbell curl 12.5 × 8 → 10–15: 11.875 → 10 on the 2.5 kg dumbbell grid.
  const grid = prescribe('dumbbell-curl', history('dumbbell-curl', 12.5, 8, 8));
  assert.deepEqual([grid.weight, grid.reps], [10, 10]);
  // With an owned rack the step is the rack's: 14 × 8 → 13.3 → the 12 kg pair.
  const rack = prescribe('dumbbell-curl', history('dumbbell-curl', 14, 8, 8), { Dumbbell: [8, 10, 12, 14] });
  assert.deepEqual([rack.weight, rack.reps], [12, 10]);
});

test('#139: a bodyweight exercise is unchanged', () => {
  const prescription = prescribe('push-up', history('push-up', 0, 8, 8));
  assert.deepEqual([prescription.weight, prescription.reps, prescription.basis], [0, 10, 'rep-increase']);
});
