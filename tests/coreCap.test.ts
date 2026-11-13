import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES, exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { workSeconds } from '../src/lib/adapt.ts';
import type { Equipment, Profile, SupportEquipment } from '../src/types.ts';

// #190: a split day that lists Core after its main muscles carries one core exercise of at most
// three sets; the time that frees goes to the day's main muscles. Full Body is not a split day.

const GYM = {
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as Equipment[],
  support: ['Bench', 'Rack', 'Pull-up bar'] as SupportEquipment[],
};
const HOME = { equipment: ['Dumbbell'] as Equipment[], support: ['Bench'] as SupportEquipment[] };
const DUMBBELLS = { equipment: ['Dumbbell'] as Equipment[], support: [] as SupportEquipment[] };
const BAR = { equipment: [] as Equipment[], support: ['Pull-up bar'] as SupportEquipment[] };
const BACK_MOVES = EXERCISES.filter((exercise) => exercise.muscles[0] === 'Back').map((exercise) => exercise.id);

type Kit = { equipment: Equipment[]; support: SupportEquipment[]; exclusions?: string[] };
const profileOf = (kit: Kit, daysPerWeek: number, sessionMinutes: number, experience: Profile['experience'] = 'Intermediate') =>
  ({ goal: 'Build Muscle', experience, daysPerWeek, exclusions: [], ...kit, loads: {}, sessionMinutes }) as Profile;

const isCore = (id: string) => ['core_flexion', 'core_stability'].includes(exerciseById(id)?.pattern ?? '');
const pattern = (id: string) => exerciseById(id)?.pattern;
/** The split days that list Core after their main muscles, by name. */
const CAPPED = /^(Pull|Legs|Lower)/;

function day(profile: Profile, name: string) {
  const plan = buildPlan(profile);
  const index = plan.findIndex((item) => item.name === name);
  const session = generateWorkout(profile, plan[index], index, []);
  const core = session.exercises.filter((exercise) => isCore(exercise.exerciseId));
  // By the timer's model, supersets included (#88).
  const seconds = workSeconds(session.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, sets: exercise.planned.length })),
    profile.goal, profile.sessionMinutes, profile);
  const label = `${name}: ${session.exercises.map((exercise) => `${exercise.name} ${exercise.planned.length}`).join(', ')}`;
  return { session, core, coreSets: core.reduce((sum, exercise) => sum + exercise.planned.length, 0), seconds, label };
}

test('5-day gym, 60 min: Pull, Legs and Lower carry one core exercise of at most three sets', () => {
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

test('5-day gym, 60 min: the freed Pull slot goes to the direction the day has less of', () => {
  const { session, label } = day(profileOf(GYM, 5, 60), 'Pull');
  const ids = session.exercises.map((exercise) => exercise.exerciseId);
  assert.ok(ids.filter((id) => pattern(id) === 'horizontal_pull').length >= 2, label);
  assert.ok(ids.filter((id) => pattern(id) === 'vertical_pull').length >= 1, label);
});

test('bodyweight and a pull-up bar, 60 min: nothing can take the freed slot, so Pull is shorter', () => {
  // Shorter by owner decision (#190): the cap has no exceptions. At bb952db this day was Pull-Up 4, Chin-Up 4,
  // Plank 4, Russian Twist 4 (Ready, 38 min); no other back or biceps move exists for this kit.
  for (const experience of ['Beginner', 'Intermediate'] as const) {
    const { session, label } = day(profileOf(BAR, 5, 60, experience), 'Pull');
    assert.equal(label, 'Pull: Pull-Up 4, Chin-Up 4, Plank 3');
    assert.equal(session.feasibility.status, 'limited', label);
    assert.match(session.feasibility.reason, /3 of 6 exercises/, label);
  }
});

test('every Pull, Legs and Lower keeps the cap, whatever the kit, 20 to 90 min', () => {
  let checked = 0;
  const kits = [['gym', GYM], ['home', HOME], ['dumbbells', DUMBBELLS], ['bar', BAR],
    ['gym without back moves', { ...GYM, exclusions: BACK_MOVES }]] as const;
  for (const [name, kit] of kits)
    for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const daysPerWeek of [2, 3, 4, 5, 6])
        for (const minutes of [20, 30, 45, 60, 90]) {
          const profile = profileOf(kit, daysPerWeek, minutes, experience);
          for (const item of buildPlan(profile).filter((entry) => CAPPED.test(entry.name))) {
            const { core, coreSets, seconds, label } = day(profile, item.name);
            const where = `${name} ${experience} ${daysPerWeek}d ${minutes}m ${label}`;
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
