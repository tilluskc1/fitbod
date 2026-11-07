import assert from 'node:assert/strict';
import test from 'node:test';
import { setupConsequence, setupOptions } from '../src/lib/adapt.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import type { Profile } from '../src/types.ts';

const plan = [{ name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] }] as never;
const profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const program = slotProgram(profile, planSlots(plan)[0], []);

test('#149: each setup shows what still fits against the saved gear', () => {
  const options = setupOptions(program, { minutes: 45, equipment: 'home' }, []);
  assert.deepEqual(options.map((option) => option.choice), ['home', 'hotel', 'bodyweight', 'bands']);
  const home = options[0];
  assert.equal(home.kind, 'program');
  assert.match(setupConsequence(home, 'Push'), /^\d+ sets · your gear$/);
  const bodyweight = options[2];
  assert.equal(bodyweight.kind, 'none');
  assert.equal(setupConsequence(bodyweight, 'Push'), 'Nothing in Push works');
  for (const option of options) assert.ok(option.totalSets <= option.baseSets || option.choice === 'home');
});
