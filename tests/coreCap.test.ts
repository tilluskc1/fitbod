import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { sessionRests, sessionSeconds, warmUpSeconds } from '../src/lib/sessionTime.ts';
import type { Equipment, PlanDay, Profile, SupportEquipment } from '../src/types.ts';

// #190: a split day that lists Core after its main muscles carries one core exercise of at most
// three sets; the time that frees goes to the day's main muscles. Full Body is not a split day.

const GYM = {
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as Equipment[],
  support: ['Bench', 'Rack', 'Pull-up bar'] as SupportEquipment[],
};
const HOME = { equipment: ['Dumbbell'] as Equipment[], support: ['Bench'] as SupportEquipment[] };

const profileOf = (kit: typeof GYM, daysPerWeek: number, sessionMinutes: number, experience: Profile['experience'] = 'Intermediate') =>
  ({ goal: 'Build Muscle', experience, daysPerWeek, ...kit, exclusions: [], loads: {}, sessionMinutes }) as Profile;

const isCore = (id: string) => ['core_flexion', 'core_stability'].includes(exerciseById(id)?.pattern ?? '');
const splitWithCore = (day: PlanDay) => !day.name.startsWith('Full Body') && day.focus.includes('Core') && day.focus[0] !== 'Core';

function day(profile: Profile, name: string) {
  const plan = buildPlan(profile);
  const index = plan.findIndex((item) => item.name === name);
  const session = generateWorkout(profile, plan[index], index, []);
  const core = session.exercises.filter((exercise) => isCore(exercise.exerciseId));
  const rests = sessionRests(session.exercises.map((exercise) => exercise.exerciseId), profile.goal, profile.sessionMinutes);
  const seconds = sessionSeconds(session.exercises.map((exercise, i) => ({ sets: exercise.planned.length, rest: rests[i] })),
    warmUpSeconds(profile.sessionMinutes));
  const label = `${name}: ${session.exercises.map((exercise) => `${exercise.name} ${exercise.planned.length}`).join(', ')}`;
  return { session, core, coreSets: core.reduce((sum, exercise) => sum + exercise.planned.length, 0), seconds, label };
}

test('5-day gym, 60 min: Pull and Legs carry one core exercise of at most three sets', () => {
  const profile = profileOf(GYM, 5, 60);
  for (const name of ['Pull', 'Legs', 'Lower']) {
    const { core, coreSets, label } = day(profile, name);
    assert.ok(core.length <= 1, label);
    assert.ok(coreSets <= 3, label);
  }
});

test('5-day gym, 60 min: the time Pull no longer spends on core goes to back and biceps, inside the hour', () => {
  const profile = profileOf(GYM, 5, 60);
  const { session, seconds, label } = day(profile, 'Pull');
  const main = session.exercises.filter((exercise) => ['Back', 'Biceps'].includes(exerciseById(exercise.exerciseId)!.muscles[0]));
  // Before #190: Barbell Row 5, Chin-Up 4, Face Pull 4, Dumbbell Curl 4 = 17 back and biceps sets, plus 8 core.
  assert.ok(main.reduce((sum, exercise) => sum + exercise.planned.length, 0) > 17, label);
  assert.ok(seconds <= 60 * 60, `${label} (${(seconds / 60).toFixed(1)} min)`);
  assert.equal(session.feasibility.status, 'ok', label);
});

test('every split day that lists Core after its main muscles keeps the cap, gym and home, 30 to 60 min', () => {
  let checked = 0;
  for (const kit of [GYM, HOME])
    for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const daysPerWeek of [3, 4, 5, 6])
        for (const minutes of [30, 45, 60]) {
          const profile = profileOf(kit, daysPerWeek, minutes, experience);
          for (const item of buildPlan(profile).filter(splitWithCore)) {
            const { core, coreSets, seconds, label } = day(profile, item.name);
            const where = `${kit.equipment.length > 1 ? 'gym' : 'home'} ${experience} ${daysPerWeek}d ${minutes}m ${label}`;
            assert.ok(core.length <= 1, where);
            assert.ok(coreSets <= 3, where);
            assert.ok(seconds <= minutes * 60, where);
            checked += 1;
          }
        }
  assert.ok(checked > 0);
});

test('Full Body is not a split day: its core work is left as it was', () => {
  // With room for every slot, Full Body A ends on a core exercise with its fourth set.
  const { core, label } = day(profileOf(GYM, 2, 90), 'Full Body A');
  assert.equal(core.length, 1, label);
  assert.equal(core[0].planned.length, 4, label);
});
