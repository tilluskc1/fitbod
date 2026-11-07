import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { isRelevantToDay, matchesRequirement, requirementsForDay } from '../src/lib/feasibility.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { sessionRests, sessionSeconds, warmUpSeconds } from '../src/lib/sessionTime.ts';
import type { Equipment, PlanDay, Profile, SupportEquipment } from '../src/types.ts';

// #196: Full Body B required core work, but its focus has no Core, so no core exercise is ever
// eligible and the day was Limited every time. Requirements are read by day name, so the fix holds
// for plans already saved on phones, whatever focus they carry.

const GYM = {
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as Equipment[],
  support: ['Bench', 'Rack', 'Pull-up bar'] as SupportEquipment[],
};
const profileOf = (sessionMinutes: number, experience: Profile['experience']) =>
  ({ goal: 'Build Muscle', experience, daysPerWeek: 2, unit: 'lb', exclusions: [], ...GYM, loads: {}, sessionMinutes }) as Profile;

test('2-day full gym plan: both Full Body days are Ready at 30, 45 and 60 min for every experience', () => {
  for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const) {
    for (const minutes of [30, 45, 60]) {
      const profile = profileOf(minutes, experience);
      for (const slot of planSlots(buildPlan(profile))) {
        const program = slotProgram(profile, slot, []);
        assert.equal(program.feasibility?.status, 'ok', `${experience} ${minutes} min ${slot.name}: ${program.feasibility?.reason}`);
      }
    }
  }
});

test('a Full Body B already saved with its old focus is Ready, inside its minutes, unpadded', () => {
  const saved: PlanDay = { name: 'Full Body B', focus: ['Back', 'Chest', 'Glutes', 'Hamstrings', 'Biceps', 'Triceps', 'Calves'] };
  const profile = profileOf(60, 'Intermediate');
  const session = generateWorkout(profile, saved, 1, []);
  const label = session.exercises.map((exercise) => `${exercise.name} ${exercise.planned.length}`).join(', ');
  assert.equal(session.feasibility.status, 'ok', `${label}: ${session.feasibility.reason}`);
  assert.ok(session.exercises.every((exercise) => {
    const catalog = EXERCISES.find((item) => item.id === exercise.exerciseId)!;
    return isRelevantToDay(catalog, saved);
  }), label);
  const rests = sessionRests(session.exercises.map((exercise) => exercise.exerciseId), profile.goal, 60);
  const seconds = sessionSeconds(session.exercises.map((exercise, i) => ({ sets: exercise.planned.length, rest: rests[i] })), warmUpSeconds(60));
  assert.ok(seconds <= 60 * 60, `${label} (${(seconds / 60).toFixed(1)} min)`);
});

test('every planned day can meet each requirement from its own focus', () => {
  for (const days of [2, 3, 4, 5, 6]) {
    for (const day of buildPlan({ daysPerWeek: days } as Profile)) {
      for (const requirement of requirementsForDay(day)) {
        assert.ok(
          EXERCISES.some((exercise) => isRelevantToDay(exercise, day) && matchesRequirement(exercise, requirement)),
          `${days}-day ${day.name} requires ${requirement.label} but its focus (${day.focus.join(', ')}) trains none`,
        );
      }
    }
  }
});
