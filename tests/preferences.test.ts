import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { currentSlot, slotProgram, updateProfile } from '../src/lib/sequence.ts';
import { conflicts, resetPreferences, withExclusion, withPreference } from '../src/lib/preferences.ts';
import { applyFinish, createSession, skipExercise } from '../src/lib/session.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, Profile } from '../src/types.ts';

const base: Profile = {
  goal: 'Build Muscle',
  experience: 'Intermediate',
  daysPerWeek: 3,
  equipment: ['Dumbbell', 'Barbell', 'Cable', 'Machine'],
  support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars'],
  exclusions: [],
  loads: {},
};
const push = buildPlan(base)[0];
const ids = (profile: Profile) => generateWorkout(profile, push, 0).exercises.map((item) => item.exerciseId);
const stateWith = (profile: unknown) => ({ profile, plan: [], history: [], current: null });

test('validation keeps catalog more/less preferences and rejects anything else', () => {
  const ok = validateState(stateWith({ ...base, preferences: { dip: 'less', 'barbell-bench-press': 'more' } }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.state.profile?.preferences, { dip: 'less', 'barbell-bench-press': 'more' });

  const old = validateState(stateWith(base));
  assert.ok(old.ok, 'a profile saved before preferences existed still loads');
  assert.equal(old.state.profile?.preferences, undefined);

  assert.equal(validateState(stateWith({ ...base, preferences: { dip: 'often' } })).ok, false);
  assert.equal(validateState(stateWith({ ...base, preferences: ['dip'] })).ok, false);
});

test('export and restore carry preferences with the profile', () => {
  const state: AppState = { ...EMPTY_STATE, profile: { ...base, preferences: { dip: 'less' } } };
  const restored = parseState(serializeExport(state));
  assert.ok(restored.ok);
  assert.deepEqual(restored.state.profile?.preferences, { dip: 'less' });
});

test('generator: more sorts ahead, less sorts behind but stays eligible', () => {
  const baseline = generateWorkout(base, push, 0);
  const baselineIds = ids(base);
  // Derived from the baseline so a catalog change cannot silently void the premise.
  const leftOut = ['barbell-bench-press', 'dip', 'machine-chest-press', 'close-grip-bench']
    .find((id) => !baselineIds.includes(id));
  assert.ok(leftOut, 'a pressing exercise outside the baseline must exist');
  const lead = baselineIds[0];

  const more = generateWorkout({ ...base, preferences: { [leftOut]: 'more' } }, push, 0);
  assert.ok(more.exercises.some((item) => item.exerciseId === leftOut));
  assert.equal(more.exercises.length, baseline.exercises.length);
  assert.equal(more.feasibility.status, baseline.feasibility.status);

  const less = generateWorkout({ ...base, preferences: { [lead]: 'less' } }, push, 0);
  assert.notEqual(less.exercises[0].exerciseId, lead, 'a neutral alternative comes first');
  assert.equal(less.exercises.length, baseline.exercises.length);
  assert.equal(less.feasibility.status, baseline.feasibility.status);

  // Only option left for horizontal push: "less" never removes it.
  const onlyDip = { ...base, preferences: { dip: 'less' as const }, exclusions: [
    'barbell-bench-press', 'dumbbell-floor-press', 'dumbbell-bench-press', 'incline-dumbbell-press',
    'machine-chest-press', 'cable-fly', 'push-up', 'close-grip-bench', 'diamond-push-up',
  ] };
  assert.ok(ids(onlyDip).includes('dip'));
});

test('conflict: exclusion wins in the generator, is reported, and either side can be kept', () => {
  const both = { ...base, exclusions: ['barbell-bench-press'], preferences: { 'barbell-bench-press': 'more' as const } };
  assert.ok(!ids(both).includes('barbell-bench-press'), 'a preference never defeats an exclusion');
  assert.deepEqual(conflicts(both), ['barbell-bench-press']);

  const keepExclusion = { ...both, ...withPreference(both, 'barbell-bench-press', null) };
  assert.deepEqual(conflicts(keepExclusion), []);
  assert.deepEqual(keepExclusion.exclusions, ['barbell-bench-press']);
  assert.deepEqual(keepExclusion.preferences, {});

  const keepPreference = { ...both, ...withExclusion(both, 'barbell-bench-press', false) };
  assert.deepEqual(conflicts(keepPreference), []);
  assert.deepEqual(keepPreference.preferences, { 'barbell-bench-press': 'more' });
  assert.ok(ids(keepPreference).includes('barbell-bench-press'));
});

test('more, less and neutral are mutually exclusive by construction', () => {
  let profile: Profile = base;
  profile = { ...profile, ...withPreference(profile, 'dip', 'more') };
  profile = { ...profile, ...withPreference(profile, 'dip', 'less') };
  assert.deepEqual(profile.preferences, { dip: 'less' });
  profile = { ...profile, ...withPreference(profile, 'dip', null) };
  assert.deepEqual(profile.preferences, {});
  assert.deepEqual(base.preferences, undefined, 'the input profile is not mutated');
});

test('reset clears preferences only: exclusions and workout records stay', () => {
  const profile: Profile = { ...base, exclusions: ['dip'], preferences: { 'push-up': 'more', 'cable-fly': 'less' } };
  const session = createSession({ id: 'w1', name: 'Push', dayIndex: 0, now: '2026-01-01T10:00:00.000Z', exercises: [] });
  const state = applyFinish({ ...EMPTY_STATE, profile, current: session }, 'w1', { early: true, now: '2026-01-01T11:00:00.000Z' });
  const next: AppState = { ...state, profile: { ...profile, ...resetPreferences() } };
  assert.deepEqual(next.profile?.preferences, {});
  assert.deepEqual(next.profile?.exclusions, ['dip']);
  assert.deepEqual(next.history, state.history);
  assert.equal(next.history.length, 1);
});

test('repeated skips never create a saved preference or exclusion', () => {
  let state: AppState = { ...EMPTY_STATE, profile: base };
  for (let i = 0; i < 3; i += 1) {
    const session = createSession({
      id: `s${i}`, name: 'Push', dayIndex: 0, now: `2026-01-0${i + 1}T10:00:00.000Z`,
      exercises: [{ exerciseId: 'dip', name: 'Dip', planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false, completedAt: null }] }],
    });
    state = applyFinish({ ...state, current: skipExercise(session, 0) }, `s${i}`, { early: true, now: `2026-01-0${i + 1}T11:00:00.000Z` });
  }
  assert.equal(state.history.length, 3);
  assert.deepEqual(state.profile, base);
});

test('an unknown exercise in saved preferences is dropped, not a lockout', () => {
  const loaded = validateState(stateWith({ ...base, preferences: { dip: 'more', 'removed-lift': 'less' } }));
  assert.ok(loaded.ok, 'a removed catalog exercise must not stop the saved state loading');
  assert.deepEqual(loaded.state.profile?.preferences, { dip: 'more' });
  assert.equal(validateState(stateWith({ ...base, exclusions: [42] })).ok, false, 'exclusions validation unchanged');
});

test('an unknown exercise with an unknown value is still dropped, not a lockout', () => {
  const loaded = validateState(stateWith({ ...base, preferences: { dip: 'more', 'removed-lift': 'sometimes' } }));
  assert.ok(loaded.ok, 'a removed exercise with a value from a future version must not stop loading');
  assert.deepEqual(loaded.state.profile?.preferences, { dip: 'more' });
  assert.equal(validateState(stateWith({ ...base, preferences: { dip: 'sometimes' } })).ok, false, 'a bad value on a known exercise is still rejected');
});

test('live Today path: a Library save reorders the current slot through slotProgram', () => {
  const home: Profile = { ...base, experience: 'Beginner', equipment: ['Dumbbell'], support: ['Bench'], loads: { Dumbbell: [10, 15, 18] }, sessionMinutes: 35 };
  const start: AppState = { ...EMPTY_STATE, profile: home, plan: buildPlan(home) };
  // The same chain App uses for Today and beginSession.
  const today = (state: AppState) => {
    const slot = currentSlot(state);
    assert.ok(slot && state.profile);
    const adapted = adaptWorkout(slotProgram(state.profile, slot, state.history), defaultConstraints(state.profile), state.profile.exclusions);
    const status = generateWorkout(state.profile, slot, slot.index, state.history).feasibility.status;
    return { ids: adapted.exercises.map((item) => item.exerciseId), status };
  };
  const before = today(start);
  // The day's loaded lead opens the session (#97); push-up leads the rest.
  assert.equal(before.ids[1], 'push-up');
  assert.ok(!before.ids.includes('dumbbell-floor-press'));

  const more = today(updateProfile(start, withPreference(home, 'dumbbell-floor-press', 'more')));
  assert.ok(more.ids.includes('dumbbell-floor-press'), '"more" brings an eligible variant into the session');
  assert.equal(more.ids.length, before.ids.length);
  assert.equal(more.status, before.status);

  const less = today(updateProfile(start, withPreference(home, 'push-up', 'less')));
  assert.notEqual(less.ids[1], 'push-up', '"less" moves it behind a neutral alternative');
  assert.equal(less.ids.length, before.ids.length);
  assert.equal(less.status, before.status);

  const excluded = today(updateProfile(start, withExclusion(home, 'push-up', true)));
  assert.ok(!excluded.ids.includes('push-up'), 'an exclusion removes it');
  assert.equal(excluded.status, before.status);
});
