import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { patternsOf } from '../src/lib/feasibility.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import type { Equipment, Experience, Profile, SupportEquipment } from '../src/types.ts';

const KITS: Record<string, { equipment: Equipment[]; support: SupportEquipment[] }> = {
  'full gym': {
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'],
    support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'],
  },
  'barbell+dumbbell': { equipment: ['Barbell', 'Dumbbell'], support: ['Bench', 'Rack'] },
};

const profileOf = (kit: string, overrides: Partial<Profile> = {}): Profile => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, exclusions: [], loads: {},
  ...KITS[kit], ...overrides,
});
const picks = (profile: Profile, dayIndex: number) =>
  generateWorkout(profile, buildPlan(profile)[dayIndex], dayIndex).exercises.map((item) => exerciseById(item.exerciseId)!);
const isHinge = (id: string) => patternsOf(exerciseById(id)!).includes('hinge');

test('Upper A at 60 and 90 min fills its slots without a hinge; its Back work is rows and pulldowns (#120)', () => {
  for (const kit of Object.keys(KITS)) for (const experience of ['Intermediate', 'Advanced'] as Experience[])
  for (const sessionMinutes of [60, 90]) {
    const profile = profileOf(kit, { experience, sessionMinutes });
    assert.equal(buildPlan(profile)[0].name, 'Upper A');
    const day = picks(profile, 0);
    const label = `${kit} ${experience} ${sessionMinutes} min: ${day.map((exercise) => exercise.id).join(', ')}`;
    assert.ok(!day.some((exercise) => isHinge(exercise.id)), label);
    const back = day.filter((exercise) => exercise.muscles[0] === 'Back');
    assert.ok(back.length > 0, label);
    for (const exercise of back) assert.match(exercise.pattern, /^(horizontal|vertical)_pull$/, label);
  }
});

test('no Upper, Push or Pull day in any plan picks a hinge; Legs, Lower and Full Body still do', () => {
  const hingeDays = new Set<string>();
  for (const kit of Object.keys(KITS)) for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as Experience[])
  for (const sessionMinutes of [35, 60, 90]) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    const profile = profileOf(kit, { experience, sessionMinutes, daysPerWeek });
    buildPlan(profile).forEach((day, index) => {
      const hinges = picks(profile, index).filter((exercise) => isHinge(exercise.id));
      if (/^(upper|push|pull)/i.test(day.name)) {
        assert.deepEqual(hinges.map((exercise) => exercise.id), [], `${kit} ${experience} ${daysPerWeek}d ${sessionMinutes} min ${day.name}`);
      } else if (hinges.length > 0) hingeDays.add(day.name.replace(/ [AB]$/, ''));
    });
  }
  assert.deepEqual([...hingeDays].sort(), ['Full Body', 'Legs', 'Lower']);
});
