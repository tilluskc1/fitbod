import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, confirmedLoads, loadOptions } from '../src/lib/adapt.ts';
import { constraintSentence, defaultConstraints, keywordParser, ownedProfile, resolveConstraints, todayConstraints } from '../src/lib/constraints.ts';
import { ownedLoads, prescribeExercise } from '../src/lib/progression.ts';
import { parseLoads } from '../src/lib/units.ts';
import type { Profile, TodayOverride, WorkoutRecord } from '../src/types.ts';

// #194: a gym profile saved before #180 still holds a 10 lb dumbbell rack.
const lb = (value: number) => parseLoads(String(value), 'lb')[0];
const gym: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3, unit: 'lb',
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench'], exclusions: [],
  loads: { Dumbbell: [lb(10)] },
};
const home: Profile = { ...gym, equipment: ['Dumbbell'] };
const noop = () => {};

test('a gym kit owns no stored rack; a home kit keeps its own', () => {
  assert.deepEqual(ownedLoads(gym), {});
  assert.deepEqual(ownedLoads(home), home.loads);
});

test('a stale rack never caps a gym day: a 20 kg dumbbell prescription stays 20 kg', () => {
  const program = { ...FULL_BODY_A, exercises: FULL_BODY_A.exercises.map((exercise) =>
    exercise.requires === 'dumbbell' ? { ...exercise, weight: 20 } : exercise) };
  const adapted = adaptWorkout(program, defaultConstraints(gym), []);
  const dumbbell = adapted.exercises.filter((exercise) => exercise.requires === 'dumbbell');
  assert.ok(dumbbell.length > 0);
  for (const exercise of dumbbell) assert.equal(exercise.weight, 20, exercise.name);
  assert.doesNotMatch(adapted.note, /confirmed loads/);
  // The home rack still re-targets, as before.
  assert.match(adaptWorkout(program, defaultConstraints(home), []).note, /confirmed loads/);
});

test('today\'s constraints and the profile App hands every screen carry no stale gym rack, with or without an override', () => {
  assert.deepEqual(ownedProfile(gym)?.loads, {});
  assert.deepEqual(ownedProfile(home)?.loads, home.loads);
  assert.equal(ownedProfile(null), null);
  const override = (choice?: TodayOverride['choice']): TodayOverride => ({
    date: '2026-11-05', minutes: 25, equipment: ['Dumbbell'], support: [], appliedAt: '2026-11-05T09:00:00.000Z', choice });
  for (const today of [null, override('home'), override()]) {
    // App passes the owned profile; the helper must hold with the stored one too.
    for (const profile of [gym, ownedProfile(gym)]) {
      const constraints = todayConstraints(profile, today);
      assert.equal(constraints.loads, undefined, `override: ${today?.choice ?? today}`);
      assert.deepEqual(loadOptions(constraints.equipment, constraints.loads), [], 'no one-tap pick');
      assert.deepEqual(confirmedLoads(constraints.equipment, constraints.loads), [], 'no first-load suggestion');
    }
    assert.deepEqual(todayConstraints(home, today).loads, [lb(10)], 'a home rack is still a pick');
  }
});

test('the Adjust sheet names a gym kit\'s setup, not dumbbells', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { AdjustSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const adjust = (profile: Profile) => renderToStaticMarkup(createElement(AdjustSheet, {
      constraints: defaultConstraints(profile), originalMinutes: 35, unit: 'lb', profile, onClose: noop, onPreview: noop }));
    assert.match(adjust(gym), /value="I only have 35 minutes and my gym"/);
    assert.match(adjust(home), /value="I only have 35 minutes and dumbbells"/);
  } finally { await server.close(); }
});

test('a stale rack is not the top of a gym lifter\'s range', () => {
  const press = exerciseById('dumbbell-floor-press')!;
  const range = prescribeExercise(press, gym, []).range;
  const history: WorkoutRecord[] = [{
    id: 'w1', date: '2026-11-04T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId: press.id, name: press.name,
      planned: Array.from({ length: 3 }, () => ({ weight: lb(20), reps: range.min })),
      performed: Array.from({ length: 3 }, () => ({ weight: lb(20), reps: range.max, done: true, completedAt: null })),
    }],
  }];
  assert.deepEqual(prescribeExercise(press, gym, history), prescribeExercise(press, { ...gym, loads: {} }, history));
  assert.notDeepEqual(prescribeExercise(press, home, history), prescribeExercise(press, { ...home, loads: {} }, history));
});

test('the Adjust sentence names the gym, not dumbbells, and reads back unchanged', () => {
  const current = defaultConstraints(gym);
  const sentence = constraintSentence(current, true);
  assert.doesNotMatch(sentence, /dumbbell/i);
  assert.equal(sentence, `I only have ${current.minutes} minutes and my gym`);
  assert.deepEqual(resolveConstraints(current, keywordParser.parse(sentence)).constraints, current);
  assert.equal(constraintSentence(defaultConstraints(home)), `I only have ${current.minutes} minutes and dumbbells`);
});
