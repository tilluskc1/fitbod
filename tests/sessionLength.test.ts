import assert from 'node:assert/strict';
import test from 'node:test';
import { areIncompatible, EXERCISES } from '../src/data/exercises.ts';
import { isRelevantToDay } from '../src/lib/feasibility.ts';
import { buildPlan, estimatedSeconds, generateWorkout } from '../src/lib/generator.ts';
import { catalogRowMeta } from '../src/lib/liveProgression.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import type { Equipment, Experience, Goal, Profile, SupportEquipment } from '../src/types.ts';

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
const shape = (profile: Profile, dayIndex = 0) => {
  const day = generateWorkout(profile, buildPlan(profile)[dayIndex], dayIndex);
  return { ...day, sets: day.exercises.map((exercise) => exercise.planned.length) };
};

test('session minutes set how many exercises an Upper day holds, within the documented bounds', () => {
  assert.deepEqual(shape(at(20)).sets, [5, 2, 2], 'at least 3 exercises; a short day thins the work behind the lead');
  assert.deepEqual(shape(at(35)).sets, [5, 3, 3, 3]);
  assert.deepEqual(shape(at(45)).sets, [5, 3, 3, 3, 3, 3]);
  assert.deepEqual(shape(at(60)).sets, [5, 3, 3, 3, 3, 3, 3, 3]);
  assert.equal(shape(at(120)).exercises.length, 8, 'Intermediate tops out at 8 exercises');
  assert.equal(shape(at(120, { experience: 'Advanced' })).exercises.length, 8);
  assert.equal(shape(at(120, { experience: 'Beginner' })).exercises.length, 6, 'Beginner tops out at 6');
  assert.deepEqual(shape(at(undefined)).sets, shape(at(35)).sets, 'no saved length reads as the 35 the label shows');
});

test('a longer session adds volume on the day, never off it or onto an incompatible pair', () => {
  const day = buildPlan(FULL_GYM)[0];
  const long = generateWorkout(at(60), day, 0);
  assert.equal(long.feasibility.status, 'ok');
  const picked = long.exercises.map((entry) => EXERCISES.find((exercise) => exercise.id === entry.exerciseId)!);
  for (const exercise of picked) assert.ok(isRelevantToDay(exercise, day), `${exercise.id} trains the day's focus`);
  for (const a of picked) for (const b of picked) assert.ok(!areIncompatible(a.id, b.id), `${a.id} with ${b.id}`);
  const perMuscle = new Map<string, number>();
  for (const exercise of picked) perMuscle.set(exercise.muscles[0], (perMuscle.get(exercise.muscles[0]) ?? 0) + 1);
  for (const [muscle, count] of perMuscle) assert.ok(count <= 2, `${muscle} is not piled on`);
});

test('a Push day the caps fill at 6 spends extra time on sets, and is not called Limited', () => {
  const push = (minutes: number) => shape(at(minutes, { daysPerWeek: 3 }));
  assert.deepEqual(push(45).sets, [5, 3, 3, 3, 3, 3]);
  const long = push(60);
  assert.deepEqual(long.sets, [5, 4, 4, 4, 4, 4], 'the 3-set work behind the lead gets a fourth set');
  assert.equal(long.feasibility.status, 'ok', 'no gap the user could close');
  assert.equal(long.targetCount, 6);
});

test("a 'more' preference reorders the fill without making a full day Limited", () => {
  const push = shape(at(60, { daysPerWeek: 3, experience: 'Beginner', preferences: { 'close-grip-bench': 'more' } }));
  assert.equal(push.feasibility.status, 'ok', `${push.exercises.length} of ${push.targetCount}`);
});

test("Plan's catalog row reads the sets the fitted day gives, not the bare prescription", () => {
  const profile = at(60, { daysPerWeek: 3 });
  const day = slotProgram(profile, planSlots(buildPlan(profile))[0], []);
  const accessory = day.exercises[1];
  assert.equal(accessory.sets, 4, 'the 60-minute Push gives its 3-set work a fourth set');
  const row = catalogRowMeta(EXERCISES.find((exercise) => exercise.id === accessory.exerciseId)!, profile, [], 'kg',
    day.exercises.map((exercise) => exercise.exerciseId),
    Object.fromEntries(day.exercises.map((exercise) => [exercise.exerciseId, exercise.sets])));
  assert.match(row, /^4 sets/);
});

test('a day missing gear reports the gap the gear would close', () => {
  const home = at(60, { daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'] });
  const push = shape(home);
  assert.equal(push.feasibility.status, 'limited');
  assert.ok(push.targetCount > push.exercises.length && push.targetCount <= 6, `${push.exercises.length} of ${push.targetCount}`);
});

test('every generated day fits its labelled minutes, except a 20-minute floor by under a minute', () => {
  const kits: { equipment: Equipment[]; support: SupportEquipment[] }[] = [
    { equipment: [], support: [] },
    { equipment: ['Dumbbell'], support: ['Bench'] },
    { equipment: FULL_GYM.equipment, support: FULL_GYM.support },
  ];
  const experiences: Experience[] = ['Beginner', 'Intermediate', 'Advanced'];
  const goals: Goal[] = ['Build Muscle', 'Get Stronger', 'Lose Fat', 'General Fitness'];
  for (const kit of kits) for (const experience of experiences) for (const goal of goals)
  for (const sessionMinutes of [20, 35, 45, 60, 90]) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    const profile = at(sessionMinutes, { ...kit, experience, goal, daysPerWeek });
    buildPlan(profile).forEach((day, index) => {
      const sets = generateWorkout(profile, day, index).exercises.map((exercise) => exercise.planned.length);
      const slack = sessionMinutes === 20 ? 60 : 0;
      assert.ok(estimatedSeconds(sets) <= sessionMinutes * 60 + slack,
        `${experience} ${goal} ${day.name} at ${sessionMinutes} min: ${sets.join('')} is ${Math.round(estimatedSeconds(sets) / 60)} min`);
    });
  }
});

test('same inputs give the same workout', () => {
  const day = buildPlan(FULL_GYM)[1];
  assert.deepEqual(generateWorkout(at(45), day, 1), generateWorkout(at(45), day, 1));
});
