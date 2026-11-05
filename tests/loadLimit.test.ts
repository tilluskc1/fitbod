import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCorrection, completeSession, confirmWeight, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { revisePlan, updateProfile } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { dumbbellLoadsPatch, loadLimitMessage, loadLimitText, toKg } from '../src/lib/units.ts';
import { MAX_WEIGHT, validateState } from '../src/lib/validate.ts';
import type { Profile } from '../src/types.ts';

const NOW = '2026-01-01T10:00:00.000Z';
const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Barbell', 'Dumbbell'], support: ['Rack'], exclusions: [], loads: {}, unit: 'kg',
};

const session = () => createSession({
  id: 's-1', name: 'Full body A', dayIndex: 0, now: NOW,
  exercises: [{
    exerciseId: 'barbell-row', name: 'Barbell Row',
    planned: [{ weight: 40, reps: 8 }, { weight: 40, reps: 8 }],
    performed: [{ weight: 40, reps: 8, done: false, completedAt: null }, { weight: 40, reps: 8, done: false, completedAt: null }],
  }],
});

test('#101: a typed 5000 kg on a pending set is never stored and the saved state still loads', () => {
  const confirmed = confirmWeight(session(), 0, 42.5, NOW);
  const typed = updatePerformedSet(confirmed, 0, 1, { weight: toKg(5000, 'kg') }, NOW);
  assert.equal(typed.exercises[0].performed[1].weight, 42.5);
  const result = validateState({ ...EMPTY_STATE, profile, current: typed });
  assert.equal(result.ok, true, result.ok ? '' : result.error);
});

test('#101: a first weight above the limit is not confirmed', () => {
  const confirmed = confirmWeight(session(), 0, 2500, NOW);
  assert.deepEqual(confirmed.exercises[0].performed.map((set) => set.weight), [40, 40]);
});

test('#101: a history correction above the limit is not stored', () => {
  const done = completeSession(updatePerformedSet(session(), 0, 0, { done: true }, NOW), { early: true, now: NOW });
  const state = { ...EMPTY_STATE, profile, history: [done], current: null };
  const corrected = applyCorrection(state, 's-1', 0, 0, { weight: 9999 }, NOW);
  assert.equal(corrected.history[0].exercises[0].performed[0].weight, 40);
  assert.equal(validateState(corrected).ok, true);
});

test('#101: the limit itself is still a valid load, in kg and lb', () => {
  assert.equal(updatePerformedSet(session(), 0, 0, { weight: MAX_WEIGHT }, NOW).exercises[0].performed[0].weight, MAX_WEIGHT);
  assert.equal(updatePerformedSet(session(), 0, 0, { weight: toKg(4410, 'lb') }, NOW).exercises[0].performed[0].weight, 40);
  assert.match(loadLimitMessage('kg'), /2000 kg/);
  assert.match(loadLimitMessage('lb'), /4409 lb/);
  assert.equal(loadLimitText('kg'), 'Loads go up to 2000 kg.', 'onboarding has saved nothing, so it states only the limit');
});

test('#101: owned dumbbells above the limit are refused in Settings and never reach state', () => {
  assert.equal(dumbbellLoadsPatch('10, 15, 2500', { ...profile, loads: { Dumbbell: [10, 15] } }), null);
  const state = { ...EMPTY_STATE, profile, current: null };
  const patched = updateProfile(state, { loads: { Dumbbell: [10, 2500] } });
  assert.deepEqual(patched.profile?.loads.Dumbbell, [10]);
  assert.equal(validateState(patched).ok, true);
  const onboarded = revisePlan(EMPTY_STATE, { ...profile, loads: { Dumbbell: [5, 3000] } });
  assert.deepEqual(onboarded.profile?.loads.Dumbbell, [5]);
  assert.equal(validateState(onboarded).ok, true);
});
