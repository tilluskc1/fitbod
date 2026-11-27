import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { coachLine, describePrescription, prescribeExercise } from '../src/lib/progression.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
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

test('#139: a lift that leads one day and follows on another never loses load (36-session rotation)', () => {
  // The lifter does exactly each target; only the role changes between days (#97 lead ranges).
  const start: Partial<Record<string, number>> = { Barbell: 60, Dumbbell: 15, Cable: 25, Machine: 50, Kettlebell: 16 };
  const drops: string[] = [];
  for (const goal of ['Build Muscle', 'Get Stronger', 'Lose Fat'] as const) {
    for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const) {
      for (const daysPerWeek of [2, 3, 4, 5]) {
        for (const kit of ['gym', 'home'] as const) {
          const lifter: Profile = {
            ...profile, goal, experience, daysPerWeek, sessionMinutes: 60,
            equipment: kit === 'gym' ? ['Barbell', 'Dumbbell', 'Cable', 'Machine'] : ['Dumbbell', 'Kettlebell'],
            support: ['Bench', 'Rack', 'Pull-up bar'],
            loads: kit === 'gym' ? {} : {
              Dumbbell: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35],
              Kettlebell: [8, 12, 16, 20, 24, 28, 32],
            },
          };
          const slots = planSlots(buildPlan(lifter));
          const rows: WorkoutRecord[] = [];
          const lastLoad: Record<string, number> = {};
          for (let n = 0; n < 36; n += 1) {
            const slot = slots[n % slots.length];
            const exercises = liveExercises(slotProgram(lifter, slot, rows), lifter, rows);
            for (const exercise of exercises) {
              const equipment = exerciseById(exercise.exerciseId)?.equipment;
              const planned = exercise.planned[0]?.weight ?? 0;
              const weight = planned > 0 ? planned : (equipment && start[equipment]) || 0;
              exercise.performed = exercise.planned.map((set) => ({ weight, reps: set.reps, done: true, completedAt: null }));
              const before = lastLoad[exercise.exerciseId];
              if (before !== undefined && weight < before) {
                drops.push(`${goal}/${experience}/${daysPerWeek}/${kit} ${exercise.exerciseId}: ${before} → ${weight} at session ${n}`);
              }
              lastLoad[exercise.exerciseId] = weight;
            }
            rows.push({
              id: `w${n}`, date: new Date(Date.UTC(2026, 0, 1 + n * 2)).toISOString(), name: slot.name, dayIndex: slot.index,
              status: 'completed', completedEarly: false, endedAt: null, exercises,
            });
          }
        }
      }
    }
  }
  assert.deepEqual(drops.slice(0, 5), [], `${drops.length} load drops`);
});

test('#139: a goal change from strength to muscle resets the lead to its new minimum', () => {
  // Bench led at 100 × 3 under Get Stronger (3–5); as a Build Muscle lead (4–6): 110 / (34/30) = 97.06 → 95 × 4.
  const bench = exerciseById('barbell-bench-press')!;
  const prescription = prescribeExercise(bench, { ...profile, goal: 'Build Muscle' }, history(bench.id, 100, 3, 3), true);
  assert.deepEqual([prescription.weight, prescription.reps, prescription.basis], [95, 4, 'range-reset']);
});

test('#139: a lead last time that follows today keeps its load (a role change is not a range change)', () => {
  // The record holds bench alone, so it led; today it follows in a 6–10-style range.
  const bench = exerciseById('barbell-bench-press')!;
  const prescription = prescribeExercise(bench, profile, history(bench.id, 60, 4, 4), false);
  assert.equal(prescription.weight, 60);
  assert.notEqual(prescription.basis, 'range-reset');
});
