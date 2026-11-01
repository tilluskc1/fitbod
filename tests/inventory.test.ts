import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, loadOptions, toWorkoutExercises } from '../src/lib/adapt.ts';
import { defaultConstraints, keywordParser, noticeText, resolveConstraints } from '../src/lib/constraints.ts';
import { nextLoad, prescribeExercise } from '../src/lib/progression.ts';
import { createSession } from '../src/lib/session.ts';
import type { Profile } from '../src/types.ts';

const sparseRack: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: [5, 7.5] },
};

const unconfirmed: Profile = { ...sparseRack, loads: {} };

test('a weight with a unit is a load, never a session length', () => {
  const parsed = keywordParser.parse('I only have 5 kg dumbbells');
  assert.deepEqual(parsed.loads, [5]);
  assert.equal(parsed.minutes, undefined);
});

test('time and load in one sentence are separated', () => {
  const parsed = keywordParser.parse('20 minutes, 5 kg dumbbells');
  assert.equal(parsed.minutes, 20);
  assert.deepEqual(parsed.loads, [5]);
});

test('pounds convert to canonical kilograms', () => {
  const parsed = keywordParser.parse('20 minutes, 11 lb dumbbells');
  assert.equal(parsed.minutes, 20);
  assert.deepEqual(parsed.loads, [5]);
});

test('a contradictory sentence changes nothing and says so', () => {
  const parsed = keywordParser.parse('dumbbells only, no dumbbells');
  assert.ok(parsed.contradiction);
  const resolved = resolveConstraints({ minutes: 35, equipment: 'home' }, parsed);
  assert.equal(resolved.constraints.equipment, 'home');
  assert.equal(resolved.constraints.minutes, 35);
  assert.equal(resolved.notices[0]?.kind, 'contradictory-input');
  assert.match(noticeText(resolved.notices[0]), /nothing changed/);
});

test('a confirmed rack reaches Start: no target offers a load the user does not own', () => {
  const constraints = defaultConstraints(sparseRack);
  assert.deepEqual(constraints.loads, [5, 7.5]);
  const adapted = adaptWorkout(FULL_BODY_A, constraints, sparseRack.exclusions);
  assert.ok(adapted.exercises.length > 0);
  assert.deepEqual(
    adapted.exercises.filter((exercise) => exercise.weight > 0).map((exercise) => exercise.weight),
    adapted.exercises.filter((exercise) => exercise.weight > 0).map(() => 7.5),
  );
  assert.match(adapted.note, /confirmed loads/);
  // Every surface reads the same inventory, including the logger's chips.
  assert.deepEqual(loadOptions(constraints.equipment, constraints.loads), [5, 7.5]);
  for (const chip of loadOptions(constraints.equipment, constraints.loads)) {
    assert.ok(chip <= 7.5);
  }
  const session = createSession({
    id: 'sparse-rack', name: adapted.name, dayIndex: 0, durationMin: adapted.minutes,
    now: '2026-11-01T09:00:00.000Z', exercises: toWorkoutExercises(adapted),
  });
  assert.deepEqual(
    [...new Set(session.exercises.flatMap((exercise) => exercise.planned.map((set) => set.weight)))].sort((a, b) => a - b),
    [0, 7.5],
  );
});

test('an unknown rack keeps the fixture rack instead of inventing one', () => {
  const constraints = defaultConstraints(unconfirmed);
  assert.equal(constraints.loads, undefined);
  assert.deepEqual(loadOptions(constraints.equipment, constraints.loads), loadOptions(constraints.equipment));
});

test('progression stops at the top of the confirmed rack', () => {
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  assert.equal(nextLoad(7.5, 2.5, [5, 7.5]), 7.5);
  const next = prescribeExercise(press, sparseRack, []);
  assert.ok(next.weight <= 7.5, `expected at most 7.5 kg, got ${next.weight}`);
});
