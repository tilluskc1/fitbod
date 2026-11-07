import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptWorkout, promisedMinutes, promisedProgramMinutes } from '../src/lib/adapt.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import type { Profile } from '../src/types.ts';

const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
] as never;
const base = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, support: [], exclusions: [],
  loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const push = (profile: Profile) => slotProgram(profile, planSlots(plan)[0], []);

test('UI7-02: a bodyweight day never promises the requested 45 minutes for a few sets', () => {
  const program = push({ ...base, equipment: [] } as Profile);
  const adapted = adaptWorkout(program, { minutes: 45, equipment: 'home' }, []);
  assert.ok(adapted.totalSets > 0 && adapted.totalSets <= 6, `expected a small day, got ${adapted.totalSets} sets`);
  const promised = promisedMinutes(program, adapted);
  assert.ok(promised < 20, `promised ${promised} min for ${adapted.totalSets} sets`);
  assert.equal(promisedProgramMinutes(program), promised);
});

test('UI7-02: a day that fills the requested length still shows that length', () => {
  const program = push({ ...base, equipment: ['Dumbbell'], support: ['Bench'] } as Profile);
  const adapted = adaptWorkout(program, { minutes: 45, equipment: 'home' }, []);
  assert.equal(promisedMinutes(program, adapted), 45);
  assert.equal(promisedProgramMinutes(program), 45);
});

test('UI7-03: a short session trims isolation before a later compound', () => {
  const program = push({ ...base, equipment: ['Dumbbell'], support: ['Bench'] } as Profile);
  const ids = program.exercises.map((exercise) => exercise.exerciseId);
  assert.ok(ids.includes('dumbbell-bench-press') && ids.includes('rear-delt-fly'));
  for (const minutes of [15, 20]) {
    const adapted = adaptWorkout(program, { minutes, equipment: 'home' }, []);
    const kept = adapted.exercises.map((exercise) => exercise.exerciseId);
    const lead = ids[0];
    assert.ok(kept.includes(lead), `${minutes} min dropped the lead ${lead}`);
    if (!kept.includes('dumbbell-bench-press')) {
      assert.ok(!kept.includes('rear-delt-fly') && !kept.includes('dumbbell-overhead-triceps-extension'),
        `${minutes} min dropped the bench press but kept isolation: ${kept.join(', ')}`);
    }
  }
});
