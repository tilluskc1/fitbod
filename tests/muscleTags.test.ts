import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import type { Equipment, Profile, SupportEquipment } from '../src/types.ts';

// #191: an exercise's first muscle is its primary, and the generator fills a day by it. The barbell
// Deadlift is filed under the glutes (ExRx), so it leads with Glutes.

const GYM = {
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as Equipment[],
  support: ['Bench', 'Rack', 'Pull-up bar'] as SupportEquipment[],
};

test('every 4- and 5-day gym day at 60 min trains its own muscles', () => {
  // Two checks, both strict. "Primary muscle in the focus, or the day's required pattern" would be
  // true by construction: the hinge rule in isRelevantToDay admits any hinge on a Lower day whatever
  // its tag, which is how a Back-first Deadlift sat on Lower days. So:
  // 1. every exercise's primary muscle is one of the day's focus muscles, with no pattern exception;
  // 2. a row or a vertical pull is back work: Back first. The one exception is Chin-Up, which stays
  //    Biceps first on purpose: it is the pull the app counts as biceps work (#174), so a pull-up bar
  //    alone can fill a Pull day's biceps slot. It still has to sit on a day whose focus has Biceps (1).
  let checked = 0;
  for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const)
    for (const daysPerWeek of [4, 5]) {
      const profile = { goal: 'Build Muscle', experience, daysPerWeek, exclusions: [], ...GYM, loads: {}, sessionMinutes: 60 } as Profile;
      buildPlan(profile).forEach((day, index) => {
        const session = generateWorkout(profile, day, index, []);
        const label = `${experience} ${daysPerWeek}d ${day.name}: ${session.exercises.map((item) => item.exerciseId).join(', ')}`;
        assert.equal(session.feasibility.status, 'ok', label);
        for (const item of session.exercises) {
          const exercise = exerciseById(item.exerciseId)!;
          assert.ok(day.focus.includes(exercise.muscles[0]), `${exercise.name} (${exercise.muscles[0]}) is off ${label}`);
          if (['horizontal_pull', 'vertical_pull'].includes(exercise.pattern) && exercise.id !== 'chin-up') {
            assert.equal(exercise.muscles[0], 'Back', `${exercise.name} on ${label}`);
          }
        }
        checked += 1;
      });
    }
  assert.equal(checked, 3 * (4 + 5));
});
