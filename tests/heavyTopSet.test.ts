import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { catalogRowMeta, liveAdapted, progressionLines } from '../src/lib/liveProgression.ts';
import { exerciseMeta } from '../src/data/flagship.ts';
import {
  describePrescription,
  isCompound,
  leadCompoundId,
  leadSlotIds,
  prescribeExercise,
  roleTarget,
} from '../src/lib/progression.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, DEFAULT_CONSTRAINTS, swapCandidateFor } from '../src/lib/adapt.ts';
import { swapPendingExercise } from '../src/lib/session.ts';
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
    // 45 min holds the six exercises these lead and set-count cases were written against (#89).
    sessionMinutes: 45,
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
  // A dumbbell or kettlebell lead keeps five sets in a moderate range: heavy free weights are
  // awkward to set up and grip-limited (#174). The role still wins over the flagship's 8–10.
  assert.equal(shape('dumbbell-floor-press', profileOf(), true), '5 × 6–10');
  assert.equal(shape('goblet-squat', profileOf(), true), '5 × 6–10');
  assert.equal(shape('kettlebell-goblet-squat', profileOf({ goal: 'Get Stronger' }), true), '5 × 5–8');
});

test('a beginner leads with 4 × 8–10, technique first, never fewer sets than a later compound (#133)', () => {
  for (const goal of ['Build Muscle', 'Get Stronger', 'Lose Fat', 'General Fitness'] as const) {
    assert.equal(shape('barbell-bench-press', profileOf({ experience: 'Beginner', goal }), true), '4 × 8–10');
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
  assert.equal(easyLead?.planned.length, 4);
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
  const live = liveAdapted(adaptWorkout(program, DEFAULT_CONSTRAINTS, [], profile.goal), profile, []);
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

test('a first session starts from the role range: 6 for the lead, 12 for isolation, 14 for small muscles', () => {
  const profile = profileOf();
  assert.equal(prescribeExercise(def('barbell-bench-press'), profile, [], true).reps, 6);
  assert.equal(prescribeExercise(def('barbell-bench-press'), profile, []).reps, 8);
  assert.equal(prescribeExercise(def('leg-extension'), profile, []).reps, 12);
  assert.equal(prescribeExercise(def('standing-calf-raise'), profile, []).reps, 14);
});

test('a swap for the lead takes over the lead range, in place or after logged sets', () => {
  const profile = profileOf();
  // A machine press keeps the barbell lead's 4–6 (dumbbell leads are 6–10 since #174).
  const target = def('machine-chest-press');
  assert.equal(swapCandidateFor(target, profile, [], null, true).reps, 6);
  assert.equal(swapCandidateFor(target, profile, [], null).reps, 8);

  // Two bench sets logged, then the remaining three swapped to dumbbells.
  const session = finished('w1', 'barbell-bench-press', 5, 2, 60, 6);
  session.exercises.push({ ...finished('x', 'overhead-press', 3, 0, 40, 8).exercises[0] });
  const split = swapPendingExercise(session, 0, { exerciseId: target.id, name: target.name, weight: 26, reps: 6 });
  assert.deepEqual(split.exercises.map((exercise) => exercise.exerciseId), ['barbell-bench-press', target.id, 'overhead-press']);
  assert.deepEqual(leadSlotIds(split.exercises), ['barbell-bench-press', target.id]);

  // Its sets logged at 7 reps finish the slot (#105): the step restarts at the lead's 4, not 6–10's 6.
  const done = {
    ...split,
    exercises: split.exercises.map((exercise) =>
      exercise.exerciseId === target.id
        ? { ...exercise, performed: exercise.performed.map((set) => ({ ...set, reps: 7, done: true, completedAt: split.date })) }
        : exercise,
    ),
  };
  const line = progressionLines(done, profile, [done], 'kg').find((item) => item.exerciseId === target.id);
  assert.match(line?.next ?? '', /^4 reps @ /);
  assert.match(line?.reason ?? '', /reps restart at 4\./);
});

test('when today\'s setup drops the lead, the next compound takes its five sets', () => {
  const profile = profileOf();
  const program = slotProgram(profile, planSlots(buildPlan(profile))[0], []);
  const ids = program.exercises.map((exercise) => exercise.exerciseId);
  const lead = leadCompoundId(ids);
  assert.ok(lead);
  const heir = leadCompoundId(ids.filter((id) => id !== lead));
  assert.ok(heir);
  // At the saved 45 minutes: a shorter day today caps every movement at 3 sets (#229).
  const adapted = adaptWorkout(program, { ...DEFAULT_CONSTRAINTS, minutes: 45 }, [lead], profile.goal);
  const promoted = adapted.exercises.find((exercise) => exercise.exerciseId === heir);
  assert.equal(promoted?.sets, 5);
  assert.equal(promoted?.originalSets, 5);
  const live = liveAdapted(adapted, profile, []).exercises.find((exercise) => exercise.exerciseId === heir);
  assert.deepEqual(live?.targetReps, [6, 6, 6, 6, 6]);
});

test('bodyweight never takes the heavy lead; a barbell compound does when there is one', () => {
  // 35 min: this kit runs out of exercises at 45, and the spare time would add a set to the push-up (#89).
  const dumbbells = profileOf({ equipment: ['Dumbbell'], support: ['Bench'], sessionMinutes: 35 });
  const push = generateWorkout(dumbbells, buildPlan(dumbbells)[0], 0).exercises;
  assert.notEqual(push[0].exerciseId, 'push-up');
  assert.equal(def(push[0].exerciseId).equipment, 'Dumbbell');
  // Under 45 minutes no movement passes 3 sets (#229), the lead included.
  assert.equal(push[0].planned.length, 3, 'the dumbbell lead opens the session');
  // At 45 the dumbbell lead takes the heavy sets.
  const dumbbells45 = { ...dumbbells, sessionMinutes: 45 };
  const push45 = generateWorkout(dumbbells45, buildPlan(dumbbells45)[0], 0).exercises;
  assert.equal(def(push45[0].exerciseId).equipment, 'Dumbbell');
  assert.equal(push45[0].planned.length, 5, 'the dumbbell lead opens the session with the heavy sets');
  const pushUp = push.find((exercise) => exercise.exerciseId === 'push-up');
  if (pushUp) assert.equal(pushUp.planned.length, 3);
  assert.equal(shape('push-up', profileOf(), true), '3 × 10–20', 'a lead flag cannot make bodyweight heavy');

  // Barbell Bench and Overhead Press both picked: barbell first, then the Push day's first focus (Chest).
  const barbell = profileOf({ equipment: ['Dumbbell', 'Barbell'] });
  const day = generateWorkout(barbell, buildPlan(barbell)[0], 0).exercises;
  assert.ok(day.some((exercise) => exercise.exerciseId === 'overhead-press'));
  assert.equal(day[0].exerciseId, 'barbell-bench-press');
  assert.equal(day[0].planned.length, 5);
  // A full gym that picked no barbell bench still leads with a barbell compound.
  const gym = generateWorkout(profileOf(), buildPlan(profileOf())[0], 0).exercises;
  assert.equal(def(gym[0].exerciseId).equipment, 'Barbell');

  const bare = profileOf({ equipment: [], support: [] });
  const bodyweight = generateWorkout(bare, buildPlan(bare)[0], 0).exercises;
  assert.ok(bodyweight.length > 0);
  assert.equal(leadCompoundId(bodyweight.map((exercise) => exercise.exerciseId)), undefined);
  assert.ok(bodyweight.every((exercise) => exercise.planned.length <= 4), 'no heavy lead on a bodyweight day');
});

test('the reason for a load step prints the reps actually logged', () => {
  const bench = def('barbell-bench-press');
  const record = finished('w1', bench.id, 4, 4, 20, 8);
  const next = prescribeExercise(bench, profileOf(), [record], true);
  assert.equal(next.basis, 'load-increase');
  assert.match(describePrescription(next, 'kg'), /4 sets at 8 reps \(top of 4–6\), 20 kg/);
});

test('a day with no loaded compound keeps four-set compounds and its total', () => {
  const bars = profileOf({ daysPerWeek: 4, equipment: [], support: ['Pull-up bar', 'Dip bars'] });
  const upper = generateWorkout(bars, buildPlan(bars)[0], 0).exercises;
  assert.equal(leadCompoundId(upper.map((exercise) => exercise.exerciseId)), undefined);
  for (const exercise of upper) {
    assert.equal(exercise.planned.length, isCompound(def(exercise.exerciseId)) ? 4 : 3, exercise.exerciseId);
  }
  assert.equal(upper.reduce((sum, exercise) => sum + exercise.planned.length, 0), 16);
  const bare = profileOf({ equipment: [], support: [] });
  const pushUp = generateWorkout(bare, buildPlan(bare)[0], 0).exercises.find((exercise) => exercise.exerciseId === 'push-up');
  assert.equal(pushUp?.planned.length, 4);
});

test('the Plan catalog row reads the same lead and set counts as Today', () => {
  const strong = profileOf({ goal: 'Get Stronger', equipment: ['Barbell', 'Dumbbell'] });
  const day = slotProgram(strong, planSlots(buildPlan(strong))[0], []);
  const ids = day.exercises.map((exercise) => exercise.exerciseId);
  assert.equal(ids[0], 'barbell-bench-press');
  assert.equal(catalogRowMeta(def('barbell-bench-press'), strong, [], 'kg', ids), '5 sets · 5 reps');
  assert.equal(catalogRowMeta(def('overhead-press'), strong, [], 'kg', ids), '3 sets · 8 reps');

  const bare = profileOf({ equipment: [], support: [] });
  const bodyweight = slotProgram(bare, planSlots(buildPlan(bare))[0], []);
  const pushUp = bodyweight.exercises.find((exercise) => exercise.exerciseId === 'push-up');
  assert.equal(pushUp?.sets, 4);
  assert.equal(catalogRowMeta(def('push-up'), bare, [], 'kg', bodyweight.exercises.map((exercise) => exercise.exerciseId)), '4 sets · 12 reps');
});

test('a row with the same reps on every set reads compactly; mixed reps keep the per-set form', () => {
  const base = { exerciseId: 'barbell-bench-press', name: 'Bench', sets: 5, repRange: [4, 6] as [number, number], weight: 20, load: 'total' as const, detail: 'Barbell', requires: 'configured' as const };
  assert.equal(exerciseMeta({ ...base, targetReps: [4, 4, 4, 4, 4] }), '5 × 4 @ 20 kg total');
  assert.equal(exerciseMeta({ ...base, targetReps: [5, 4, 4, 4, 4] }), '5 sets · 5 · 4 · 4 · 4 · 4 @ 20 kg total');
  assert.equal(exerciseMeta({ ...base, targetReps: [4], sets: 1 }), '1 set · 4 @ 20 kg total');
});
