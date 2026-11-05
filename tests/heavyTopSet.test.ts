import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { liveAdapted, progressionLines } from '../src/lib/liveProgression.ts';
import {
  describePrescription,
  isCompound,
  leadCompoundId,
  prescribeExercise,
  roleTarget,
} from '../src/lib/progression.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, DEFAULT_CONSTRAINTS } from '../src/lib/adapt.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

function profileOf(overrides: Partial<Profile> = {}): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Intermediate',
    daysPerWeek: 3,
    equipment: ['Barbell', 'Dumbbell', 'Cable', 'Machine'],
    support: ['Bench', 'Rack'],
    exclusions: [],
    loads: {},
    ...overrides,
  };
}

function def(id: string) {
  const exercise = exerciseById(id);
  assert.ok(exercise, `unknown exercise ${id}`);
  return exercise;
}

/** One completed workout: `exerciseId` planned for `required` sets, `done` of them logged at weight × reps. */
function finished(id: string, exerciseId: string, required: number, done: number, weight: number, reps: number): WorkoutRecord {
  return {
    id,
    date: '2026-11-01T10:00:00.000Z',
    name: 'Push',
    dayIndex: 0,
    status: 'completed',
    completedEarly: done < required,
    endedAt: null,
    exercises: [
      {
        exerciseId,
        name: def(exerciseId).name,
        originalPlannedSets: required,
        planned: Array.from({ length: required }, () => ({ weight, reps })),
        performed: Array.from({ length: required }, (_, index) => ({
          weight,
          reps,
          done: index < done,
          completedAt: index < done ? '2026-11-01T10:05:00.000Z' : null,
        })),
      },
    ],
  };
}

const shape = (id: string, profile: Profile, lead = false) => {
  const { sets, range } = roleTarget(def(id), profile, lead);
  return `${sets} × ${range.min}–${range.max}`;
};

test('the first compound is heavy for intermediate and advanced lifters building muscle or strength', () => {
  assert.equal(shape('barbell-bench-press', profileOf(), true), '5 × 4–6');
  assert.equal(shape('back-squat', profileOf({ experience: 'Advanced' }), true), '5 × 4–6');
  assert.equal(shape('barbell-bench-press', profileOf({ goal: 'Get Stronger' }), true), '5 × 3–5');
  assert.equal(shape('deadlift', profileOf({ goal: 'Get Stronger', experience: 'Advanced' }), true), '5 × 3–5');
  // A dumbbell lead is a lead too: the role wins over the flagship's 8–10.
  assert.equal(shape('dumbbell-floor-press', profileOf(), true), '5 × 4–6');
});

test('a beginner leads with 3 × 8–10, technique first', () => {
  for (const goal of ['Build Muscle', 'Get Stronger', 'Lose Fat', 'General Fitness'] as const) {
    assert.equal(shape('barbell-bench-press', profileOf({ experience: 'Beginner', goal }), true), '3 × 8–10');
  }
});

test('other goals keep an ordinary compound in the lead', () => {
  assert.equal(shape('barbell-bench-press', profileOf({ goal: 'Lose Fat' }), true), '4 × 6–10');
  assert.equal(shape('barbell-bench-press', profileOf({ goal: 'General Fitness', experience: 'Advanced' }), true), '4 × 6–10');
});

test('other compounds and isolation work follow their role, not only muscle count', () => {
  // Behind a heavy lead the other compounds drop to three sets.
  assert.equal(shape('overhead-press', profileOf()), '3 × 6–10');
  assert.equal(shape('overhead-press', profileOf({ goal: 'Lose Fat' })), '4 × 6–10');
  assert.equal(shape('overhead-press', profileOf({ experience: 'Beginner' })), '4 × 6–10');
  assert.equal(shape('lateral-raise', profileOf()), '3 × 10–15');
  assert.equal(shape('leg-extension', profileOf()), '3 × 10–15');
  // Two muscles, but a rear-delt fly is isolation on a small muscle.
  assert.equal(isCompound(def('rear-delt-fly')), false);
  assert.equal(shape('rear-delt-fly', profileOf()), '3 × 12–20');
  assert.equal(shape('standing-calf-raise', profileOf({ experience: 'Beginner' })), '3 × 12–20');
  // A one-muscle movement on a pressing pattern is isolation too.
  assert.equal(shape('cable-fly', profileOf()), '3 × 10–15');
  // Not the lead: a lead-only flag on an isolation movement changes nothing.
  assert.equal(shape('lateral-raise', profileOf(), true), '3 × 10–15');
});

test('the lead is the first compound in session order', () => {
  assert.equal(leadCompoundId(['lateral-raise', 'overhead-press', 'barbell-bench-press']), 'overhead-press');
  assert.equal(leadCompoundId(['lateral-raise', 'cable-fly']), undefined);
});

test('a generated day gives its first compound the heavy sets and the rest their role', () => {
  const profile = profileOf();
  const session = generateWorkout(profile, buildPlan(profile)[0], 0);
  const ids = session.exercises.map((exercise) => exercise.exerciseId);
  const lead = leadCompoundId(ids);
  assert.ok(lead, 'a push day has a compound');
  for (const exercise of session.exercises) {
    const role = exercise.exerciseId === lead ? '5 × 6' : '3 ×';
    assert.ok(`${exercise.planned.length} × ${exercise.planned[0].reps}`.startsWith(role), `${exercise.exerciseId} ${role}`);
  }
  const beginner = profileOf({ experience: 'Beginner' });
  const easy = generateWorkout(beginner, buildPlan(beginner)[0], 0);
  const easyLead = easy.exercises.find((exercise) => exercise.exerciseId === leadCompoundId(easy.exercises.map((item) => item.exerciseId)));
  assert.equal(easyLead?.planned.length, 3);
  assert.equal(easyLead?.planned[0].reps, 8);
});

test('the slot program, live numbers and generator agree on the lead target', () => {
  const profile = profileOf();
  const slot = planSlots(buildPlan(profile))[0];
  const program = slotProgram(profile, slot, []);
  const lead = leadCompoundId(program.exercises.map((exercise) => exercise.exerciseId));
  const entry = program.exercises.find((exercise) => exercise.exerciseId === lead);
  assert.deepEqual(entry?.repRange, [4, 6]);
  assert.equal(entry?.sets, 5);
  const live = liveAdapted(adaptWorkout(program, DEFAULT_CONSTRAINTS), profile, []);
  const shown = live.exercises.find((exercise) => exercise.exerciseId === lead);
  assert.equal(shown?.targetReps?.[0], 6);
});

test('double progression inside the lead range: a step at the top, reps restart at the bottom', () => {
  const profile = profileOf();
  const bench = def('barbell-bench-press');
  const climbing = prescribeExercise(bench, profile, [finished('w1', bench.id, 5, 5, 60, 5)], true);
  assert.equal(climbing.basis, 'rep-increase');
  assert.deepEqual([climbing.weight, climbing.reps], [60, 6]);

  const topped = prescribeExercise(bench, profile, [finished('w1', bench.id, 5, 5, 60, 6)], true);
  assert.equal(topped.basis, 'load-increase');
  assert.deepEqual([topped.weight, topped.reps, topped.sets], [62.5, 4, 5]);
  assert.match(describePrescription(topped, 'kg'), /5 sets at 6 reps.*reps restart at 4/);

  const strong = prescribeExercise(bench, profileOf({ goal: 'Get Stronger' }), [finished('w1', bench.id, 5, 5, 80, 5)], true);
  assert.deepEqual([strong.basis, strong.weight, strong.reps], ['load-increase', 82.5, 3]);
});

test('small-muscle isolation steps up only at 20 reps', () => {
  const profile = profileOf({ loads: { Machine: [20, 25, 30] } });
  const calf = def('standing-calf-raise');
  assert.equal(prescribeExercise(calf, profile, [finished('w1', calf.id, 3, 3, 25, 15)]).basis, 'rep-increase');
  const topped = prescribeExercise(calf, profile, [finished('w1', calf.id, 3, 3, 25, 20)]);
  assert.deepEqual([topped.basis, topped.weight, topped.reps], ['load-increase', 30, 12]);
});

test('a shortened lead never earns a step', () => {
  const bench = def('barbell-bench-press');
  const next = prescribeExercise(bench, profileOf(), [finished('w1', bench.id, 5, 3, 60, 6)], true);
  assert.equal(next.basis, 'repeat');
  assert.equal(next.weight, 60);
});

test('a beginner lead keeps progressing in 8–10', () => {
  const bench = def('barbell-bench-press');
  const beginner = profileOf({ experience: 'Beginner' });
  assert.equal(prescribeExercise(bench, beginner, [finished('w1', bench.id, 3, 3, 40, 9)], true).reps, 10);
  const topped = prescribeExercise(bench, beginner, [finished('w1', bench.id, 3, 3, 40, 10)], true);
  assert.deepEqual([topped.basis, topped.weight, topped.reps], ['load-increase', 42.5, 8]);
});

test('the recap reads the lead range for the day it was the lead', () => {
  const profile = profileOf();
  const workout = finished('w1', 'barbell-bench-press', 5, 5, 60, 6);
  const [line] = progressionLines(workout, profile, [workout], 'kg');
  assert.match(line.next, /^4 reps @ 62\.5 kg/);
  assert.match(line.reason, /reps restart at 4/);
});
