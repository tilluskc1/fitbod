import assert from 'node:assert/strict';
import test from 'node:test';
import { consequence, lengthOptions } from '../src/lib/adapt.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import type { Profile } from '../src/types.ts';

const plan = [{ name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] }] as never;
const profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const program = slotProgram(profile, planSlots(plan)[0], []);

test('#148: every length shows its set count and what it costs, against the default', () => {
  const options = lengthOptions(program, { minutes: 45, equipment: 'home' }, [], 45);
  assert.deepEqual(options.map((option) => option.minutes), [15, 20, 30, 45, 60, 90]);
  const byMin = Object.fromEntries(options.map((option) => [option.minutes, option]));
  assert.equal(byMin[45].kind, 'program');
  assert.match(consequence(byMin[45]), /^\d+ sets · your program$/);
  for (const longer of [60, 90]) {
    assert.equal(byMin[longer].kind, 'same', 'longer never adds work');
    assert.equal(byMin[longer].totalSets, byMin[45].totalSets);
    assert.match(consequence(byMin[longer]), /nothing added/);
  }
  assert.ok(byMin[20].totalSets < byMin[45].totalSets);
  assert.match(consequence(byMin[20]), / out$|fewer sets/);
  assert.ok(byMin[15].totalSets <= byMin[20].totalSets);
});

test('#148: a setup with no possible work says so on every option', () => {
  const options = lengthOptions(program, { minutes: 45, equipment: 'bodyweight' }, [], 45);
  for (const option of options) {
    assert.equal(option.kind, 'none');
    assert.equal(consequence(option), 'Nothing fits this setup');
  }
});

// #17: a longer length rebuilds the day at that length, so more time adds real work.
test('#17: with the day rebuilt per length, 60 and 90 min add work and say what they add', () => {
  const at = (minutes: number) => slotProgram({ ...profile, sessionMinutes: minutes }, planSlots(plan)[0], []);
  const options = lengthOptions(program, { minutes: 45, equipment: 'home' }, [], 45, at);
  const byMin = Object.fromEntries(options.map((option) => [option.minutes, option]));
  assert.equal(byMin[60].kind, 'more');
  assert.ok(byMin[60].totalSets > byMin[45].totalSets, `${byMin[60].totalSets} vs ${byMin[45].totalSets}`);
  assert.match(consequence(byMin[60]), /^\d+ sets · (adds .+|more sets, same exercises)$/);
  assert.ok(byMin[90].totalSets >= byMin[60].totalSets);
  // Shorter still trims the saved day.
  assert.ok(byMin[30].totalSets < byMin[45].totalSets);
});

test('#17: Today builds the day at a longer today-only length and the length sheet gets the rebuild', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // Since #188 the longer-than-saved rule lives in todayProgram (pinned in gearRebuild.test.ts).
  assert.match(app, /const program = useMemo\(\(\) => programFor\(constraints\)/);
  assert.match(app, /todayProgram\(profile, slot, state\.history, today\)/);
  // #203 passes the goal so each length is trimmed by the timer's model.
  assert.match(app, /lengthOptions\(defaultProgram, constraints, profile\.exclusions \?\? \[\], profile\.sessionMinutes \?\? 35, \(minutes\) => programFor\(\{ minutes, equipment: constraints\.equipment \}\), profile\.goal\)/);
});
