import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import type { Profile, SupportEquipment } from '../src/types.ts';

// UI7-13 (#155): Pull at home is back first (2+ back movements, 1 curl at most);
// Push carries no rear-delt work. Swept over home setups, levels, splits and lengths.

const HOME_SUPPORT: SupportEquipment[][] = [[], ['Bench'], ['Pull-up bar'], ['Bench', 'Pull-up bar']];

function days() {
  const out: { label: string; ids: string[]; name: string }[] = [];
  for (const support of HOME_SUPPORT)
    for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const daysPerWeek of [3, 4, 5, 6])
        for (const sessionMinutes of [30, 45, 60]) {
          const profile = {
            goal: 'Build Muscle', experience, daysPerWeek, equipment: ['Dumbbell'], support,
            exclusions: [], loads: {}, sessionMinutes,
          } as Profile;
          buildPlan(profile).forEach((day, index) => {
            const ids = generateWorkout(profile, day, index, []).exercises.map((e) => e.exerciseId);
            out.push({ label: `${support.join('+') || 'dumbbells'} ${experience} ${daysPerWeek}d ${sessionMinutes}m ${day.name}`, ids, name: day.name });
          });
        }
  return out;
}

const back = (id: string) => exerciseById(id)?.muscles[0] === 'Back';
const curl = (id: string) => exerciseById(id)?.pattern === 'elbow_flexion';
const rearDelt = (id: string) => exerciseById(id)?.pattern === 'shoulder_horizontal_abduction';

test('every Pull day at home has at least two back movements and at most one curl', () => {
  const pulls = days().filter((day) => day.name.startsWith('Pull'));
  assert.ok(pulls.length > 0);
  for (const day of pulls) {
    assert.ok(day.ids.filter(back).length >= 2, `${day.label}: ${day.ids.join(', ')}`);
    assert.ok(day.ids.filter(curl).length <= 1, `${day.label}: ${day.ids.join(', ')}`);
  }
});

test('no Push day at home has rear-delt work', () => {
  const pushes = days().filter((day) => day.name.startsWith('Push'));
  assert.ok(pushes.length > 0);
  for (const day of pushes) assert.equal(day.ids.filter(rearDelt).length, 0, `${day.label}: ${day.ids.join(', ')}`);
});
