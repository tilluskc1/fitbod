import assert from 'node:assert/strict';
import test from 'node:test';
import { skipForward, switchOptions } from '../src/lib/switchDay.ts';
import { currentSlot } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

const profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];
const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 } } as unknown as AppState;

test('#150: every day in the split, starting with the one up next, with what it skips', () => {
  const options = switchOptions(profile, state, [], { minutes: 45, equipment: 'home' });
  assert.deepEqual(options.map((option) => option.name), ['Push', 'Pull', 'Legs']);
  assert.deepEqual(options.map((option) => option.offset), [0, 1, 2]);
  assert.deepEqual(options[2].skips, ['Push', 'Pull']);
  for (const option of options) assert.ok(option.totalSets > 0);
});

test('#150: picking a later day uses guarded forward skips and records each one', () => {
  const next = skipForward(state, 2, '2026-11-07T10:00:00.000Z');
  assert.equal(currentSlot(next)?.name, 'Legs');
  assert.equal(next.slotSkips?.length, 2, 'both skipped days are recorded');
  const blocked = skipForward({ ...state, current: { id: 'open' } } as unknown as AppState, 2, '2026-11-07T10:00:00.000Z');
  assert.equal(currentSlot(blocked)?.name, 'Push', 'an open session blocks switching');
});
