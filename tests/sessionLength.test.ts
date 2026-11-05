import assert from 'node:assert/strict';
import test from 'node:test';
import { areIncompatible, EXERCISES } from '../src/data/exercises.ts';
import { isRelevantToDay } from '../src/lib/feasibility.ts';
import { buildPlan, generateWorkout, targetCountFor } from '../src/lib/generator.ts';
import type { Profile } from '../src/types.ts';

const FULL_GYM: Profile = {
  goal: 'Build Muscle',
  experience: 'Intermediate',
  daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'],
  support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'],
  exclusions: [],
  loads: {},
};

const at = (sessionMinutes: number | undefined, overrides: Partial<Profile> = {}): Profile =>
  ({ ...FULL_GYM, sessionMinutes, ...overrides });

test('session minutes set how many exercises a day holds, within documented bounds', () => {
  assert.equal(targetCountFor(at(20)), 3, 'a short session still gets the minimum');
  assert.equal(targetCountFor(at(35)), 4);
  assert.equal(targetCountFor(at(45)), 6);
  assert.equal(targetCountFor(at(60)), 8);
  assert.equal(targetCountFor(at(120)), 8, 'Intermediate tops out at 8');
  assert.equal(targetCountFor(at(120, { experience: 'Advanced' })), 8);
  assert.equal(targetCountFor(at(60, { experience: 'Beginner' })), 6, 'Beginner tops out at 6');
  assert.equal(targetCountFor(at(10)), 3);
  assert.equal(targetCountFor(at(undefined)), targetCountFor(at(35)), 'no saved length reads as the 35 the label shows');
});

test('the same Upper day grows with a longer session, staying on the day and off incompatible pairs', () => {
  const day = buildPlan(FULL_GYM)[0];
  const short = generateWorkout(at(35), day, 0);
  const long = generateWorkout(at(60), day, 0);
  assert.equal(short.exercises.length, 4);
  assert.equal(long.exercises.length, 8);
  assert.equal(long.feasibility.status, 'ok');
  const longSets = long.exercises.reduce((sum, exercise) => sum + exercise.planned.length, 0);
  const shortSets = short.exercises.reduce((sum, exercise) => sum + exercise.planned.length, 0);
  assert.ok(longSets > shortSets, 'more time, more volume');

  const picked = long.exercises.map((entry) => EXERCISES.find((exercise) => exercise.id === entry.exerciseId)!);
  for (const exercise of picked) assert.ok(isRelevantToDay(exercise, day), `${exercise.id} trains the day's focus`);
  for (const a of picked) for (const b of picked) assert.ok(!areIncompatible(a.id, b.id), `${a.id} with ${b.id}`);
  const perMuscle = new Map<string, number>();
  for (const exercise of picked) perMuscle.set(exercise.muscles[0], (perMuscle.get(exercise.muscles[0]) ?? 0) + 1);
  for (const [muscle, count] of perMuscle) assert.ok(count <= 2, `${muscle} is not piled on`);
});

test('a generated day fits the minutes it is labelled with', () => {
  const day = buildPlan(FULL_GYM)[0];
  for (const minutes of [35, 45, 60, 90]) {
    const { exercises } = generateWorkout(at(minutes), day, 0);
    const sets = exercises.reduce((sum, exercise) => sum + exercise.planned.length, 0);
    // Same per-set time the count is built from: 35 s work + 75 s rest, plus 60 s per exercise.
    const seconds = sets * 110 + exercises.length * 60;
    assert.ok(seconds <= minutes * 60, `${minutes} min: ${sets} sets over ${exercises.length} exercises is ${Math.round(seconds / 60)} min`);
  }
});

test('same inputs give the same workout', () => {
  const day = buildPlan(FULL_GYM)[1];
  assert.deepEqual(generateWorkout(at(45), day, 1), generateWorkout(at(45), day, 1));
});
