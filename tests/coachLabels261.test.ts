import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentTitle, sessionLength } from '../src/lib/coachLabels.ts';

// #261: Coach > What I know labels the kit by the saved setup (gym kit, home gear, no gear) and
// reads the saved length as "N min sessions". Browser pass: scripts/e2e/coach-tabs.mjs.
const base = { name: 'Sam', goal: 'muscle', experience: 'intermediate', daysPerWeek: 4, unit: 'lb', loads: {} };
const cases = [
  ['gym kit', { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack'], sessionMinutes: 30 }, 'Gym equipment', '30 min sessions'],
  ['home gear', { equipment: ['Dumbbell'], support: ['Bench'], sessionMinutes: 45 }, 'Home equipment', '45 min sessions'],
  ['support only', { equipment: [], support: ['Pull-up bar'], sessionMinutes: 20 }, 'Home equipment', '20 min sessions'],
  ['no gear', { equipment: [], support: [] }, 'Bodyweight', '35 min sessions'],
] as const;

test('What I know labels follow the saved setup and length', () => {
  for (const [name, gear, title, length] of cases) {
    const profile = { ...base, ...gear };
    assert.equal(equipmentTitle(profile), title, `${name}: equipment title`);
    assert.equal(sessionLength(profile), length, `${name}: length value`);
  }
});
