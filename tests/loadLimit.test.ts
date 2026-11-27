import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCorrection, completeSession, confirmWeight, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { revisePlan, updateProfile } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { dumbbellLoadsPatch, loadLimitMessage, loadLimitText, toKg, typedLoad } from '../src/lib/units.ts';
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

test('#101 review: typing 5-0-0-0 over a 95 lb set ends on the load held at focus, not on 500', () => {
  const focused = toKg(95, 'lb');
  let stored = focused;
  let refused = false;
  for (const text of ['5', '50', '500', '5000']) {
    const next = typedLoad(text, 'lb', focused);
    assert.ok(next);
    stored = next.kg;
    refused = next.refused;
  }
  assert.equal(stored, focused, 'the refused keystroke reverts to the focus value');
  assert.equal(refused, true);
  assert.deepEqual(typedLoad('', 'kg', 40), { kg: 0, refused: false }, 'clearing still means no load');
  assert.deepEqual(typedLoad('42.5', 'kg', 40), { kg: 42.5, refused: false });
  assert.equal(typedLoad('-', 'kg', 40), null, 'a half-typed value changes nothing');
});

test('#101/#103: a history weight field saves each keystroke, so leaving the screen mid-edit loses nothing', async () => {
  const { correctionKeystroke, correctionBlur } = await import('../src/lib/units.ts');
  const focused = toKg(95, 'lb');
  assert.deepEqual(['1', '10', '100'].map((text) => correctionKeystroke(text, 'lb', focused, true)), [0.454, 4.536, 45.359]);
  assert.equal(correctionBlur('100', 'lb', focused, true), null, 'a valid load stands on blur');
});

test('#101: an over-limit history load saves the focus value and reverts to it on blur with the limit', async () => {
  const { correctionKeystroke, correctionBlur } = await import('../src/lib/units.ts');
  const focused = toKg(95, 'lb');
  assert.equal(correctionKeystroke('5000', 'lb', focused, true), focused, 'the stored load is back at the focus value');
  assert.deepEqual(correctionBlur('5000', 'lb', focused, true), { kg: focused, reason: 'limit' });
});

test('#103: a cleared or 0 load on a logged loaded set is held, then reverted to the focus value with the reason', async () => {
  const { correctionKeystroke, correctionBlur } = await import('../src/lib/units.ts');
  const focused = toKg(95, 'lb');
  assert.equal(correctionKeystroke('', 'lb', focused, true), null, 'held as a draft, not saved');
  assert.equal(correctionKeystroke('0', 'lb', focused, true), null);
  assert.deepEqual(correctionBlur('', 'lb', focused, true), { kg: focused, reason: 'needs-load' });
  assert.deepEqual(correctionBlur('0', 'lb', focused, true), { kg: focused, reason: 'needs-load' });
  assert.equal(correctionKeystroke('', 'lb', focused, false), 0, 'a set that needs no load can be cleared');
  assert.equal(correctionBlur('', 'lb', focused, false), null);
});

test('#109: reps or seconds above the limit are never stored, live or in history, and state still loads', async () => {
  const { MAX_REPS } = await import('../src/lib/validate.ts');
  const typed = updatePerformedSet(session(), 0, 0, { reps: 5000 }, NOW);
  assert.equal(typed.exercises[0].performed[0].reps, 8);
  assert.equal(updatePerformedSet(session(), 0, 0, { reps: MAX_REPS }, NOW).exercises[0].performed[0].reps, MAX_REPS);
  assert.equal(validateState({ ...EMPTY_STATE, profile, current: typed }).ok, true);
  const done = completeSession(updatePerformedSet(session(), 0, 0, { done: true }, NOW), { early: true, now: NOW });
  const corrected = applyCorrection({ ...EMPTY_STATE, profile, history: [done], current: null }, 's-1', 0, 0, { reps: 5000 }, NOW);
  assert.equal(corrected.history[0].exercises[0].performed[0].reps, 8);
  assert.equal(validateState(corrected).ok, true);
});

test('#109: typing 5-0-0-0 into a history reps field ends on the reps held at focus, with the reason', async () => {
  const { typedReps, repsLimitMessage } = await import('../src/lib/units.ts');
  const results = ['5', '50', '500', '5000'].map((text) => typedReps(text, 8));
  assert.deepEqual(results.at(-1), { reps: 8, refused: true }, 'the refused keystroke reverts to the focus value, not 500');
  assert.deepEqual(results[2], { reps: 500, refused: false });
  assert.deepEqual(typedReps('', 8), { reps: 0, refused: false }, 'clearing still means 0');
  assert.equal(repsLimitMessage(false), 'Reps go up to 1000. That entry was not saved.');
  assert.equal(repsLimitMessage(true), 'Seconds go up to 1000. That entry was not saved.');
});

test('#109: a 5000 kg weight patched with done on an unloaded set is refused whole, not logged at 0', () => {
  const blank = createSession({ id: 's-2', name: 'Full body A', dayIndex: 0, now: NOW, exercises: [{
    exerciseId: 'barbell-row', name: 'Barbell Row', planned: [{ weight: 0, reps: 8 }],
    performed: [{ weight: 0, reps: 8, done: false, completedAt: null }],
  }] });
  assert.equal(updatePerformedSet(blank, 0, 0, { weight: 5000, done: true }, NOW), blank);
});

test('#109: progression never plans above the load limit; it holds at the top with a truthful reason', async () => {
  const { nextLoad, prescribeExercise, describePrescription, coachLine } = await import('../src/lib/progression.ts');
  const { EXERCISES } = await import('../src/data/exercises.ts');
  assert.equal(nextLoad(MAX_WEIGHT, 2.5, []), MAX_WEIGHT);
  assert.equal(nextLoad(1999, 2.5, []), 1999, 'the next grid step (2002.5) is above the limit');
  assert.equal(nextLoad(1995, 2.5, []), 1997.5);
  const row = EXERCISES.find((item) => item.id === 'barbell-row');
  assert.ok(row);
  for (const top of [MAX_WEIGHT, 1999]) {
    const history = [{
      id: `h-${top}`, date: NOW, name: 'Pull', dayIndex: 0, status: 'completed' as const, completedEarly: false, endedAt: null,
      exercises: [{ exerciseId: 'barbell-row', name: 'Barbell Row', planned: [{ weight: top, reps: 30 }],
        performed: [{ weight: top, reps: 30, done: true, completedAt: NOW }] }],
    }];
    const prescription = prescribeExercise(row, profile, history);
    assert.equal(prescription.weight, top);
    assert.equal(prescription.basis, 'hold');
    assert.ok(prescription.weight <= MAX_WEIGHT);
    assert.match(describePrescription(prescription, 'kg'), /Top of the app's load limit/);
    assert.match(coachLine(prescription, 'kg'), /Top of the app's load limit/);
  }
});
