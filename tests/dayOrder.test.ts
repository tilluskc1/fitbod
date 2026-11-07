import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { canLead, isCompound } from '../src/lib/progression.ts';
import type { Profile } from '../src/types.ts';

// #133: every generated day runs lead, other compounds, isolation, core,
// and the lead never has fewer sets than a later compound.

const KITS: Pick<Profile, 'equipment' | 'support'>[] = [
  { equipment: ['Dumbbell'], support: [] },
  { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
  { equipment: ['Dumbbell', 'Barbell', 'Machine', 'Cable'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars'] },
  { equipment: ['Kettlebell'], support: [] },
  { equipment: [], support: [] },
];

function* days() {
  for (const kit of KITS)
    for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const goal of ['Build Muscle', 'Get Stronger', 'General Fitness'] as const)
        for (const daysPerWeek of [3, 4, 5])
          for (const sessionMinutes of [30, 45, 60]) {
            const profile = { ...kit, goal, experience, daysPerWeek, exclusions: [], loads: {}, sessionMinutes } as Profile;
            for (const [index, day] of buildPlan(profile).entries()) {
              const label = `${kit.equipment.join('+') || 'none'} ${experience} ${goal} ${daysPerWeek}d ${sessionMinutes}m ${day.name}`;
              yield { label, exercises: generateWorkout(profile, day, index, []).exercises };
            }
          }
}

const role = (id: string) => {
  const exercise = exerciseById(id)!;
  if (exercise.pattern === 'core_flexion' || exercise.pattern === 'core_stability') return 3;
  return isCompound(exercise) ? 1 : 2;
};

test('day order is lead, other compounds, isolation, then core', () => {
  for (const { label, exercises } of days()) {
    if (exercises.length === 0) continue;
    const ids = exercises.map((exercise) => exercise.exerciseId);
    const lead = canLead(exerciseById(ids[0])!) ? 1 : 0;
    const roles = ids.slice(lead).map(role);
    assert.deepEqual(roles, [...roles].sort((a, b) => a - b), `${label}: ${ids.join(', ')}`);
  }
});

test('the lead never has fewer sets than a later compound', () => {
  for (const { label, exercises } of days()) {
    if (exercises.length === 0 || !canLead(exerciseById(exercises[0].exerciseId)!)) continue;
    const leadSets = exercises[0].planned.length;
    for (const exercise of exercises.slice(1)) {
      if (!isCompound(exerciseById(exercise.exerciseId)!)) continue;
      assert.ok(exercise.planned.length <= leadSets, `${label}: ${exercise.exerciseId} ${exercise.planned.length} > lead ${leadSets}`);
    }
  }
});
