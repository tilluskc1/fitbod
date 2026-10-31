import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptWorkout, estimatedMinutes, setBudget, toWorkoutExercises } from '../src/lib/adapt.ts';
import { keywordParser, programCeilingNotice } from '../src/lib/constraints.ts';
import { FULL_BODY_A, programSetCount } from '../src/data/flagship.ts';

const home = (minutes: number) =>
  adaptWorkout(FULL_BODY_A, { minutes, equipment: 'home' });

test('20 minutes with home dumbbells fits exactly 6 sets', () => {
  const adapted = home(20);

  assert.equal(adapted.minutes, 20);
  assert.equal(adapted.originalMinutes, 35);
  assert.equal(adapted.originalSets, 11);
  assert.equal(adapted.totalSets, 6);
  assert.deepEqual(
    adapted.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]),
    [
      ['dumbbell-floor-press', 2],
      ['goblet-squat', 2],
      ['dumbbell-row', 2],
    ],
  );

  const press = adapted.exercises[0];
  assert.deepEqual(press.targetReps, [9, 9]);
  assert.equal(press.weight, 15);
  assert.equal(press.load, 'each');

  const squat = adapted.exercises[1];
  assert.deepEqual(squat.repRange, [8, 10]);
  assert.equal(squat.weight, 18);
  assert.equal(squat.load, 'total');

  assert.deepEqual(
    adapted.skipped.map((item) => [item.exerciseId, item.reason]),
    [['plank', 'time']],
  );
  assert.equal(
    adapted.note,
    'Volume trimmed to 6 sets to fit 20 min. Plank skipped to fit 20 min.',
  );
});

test('30 minutes with home dumbbells fits 9 sets', () => {
  const adapted = home(30);

  assert.equal(adapted.totalSets, 9);
  assert.deepEqual(
    adapted.exercises.map((exercise) => exercise.sets),
    [3, 3, 2, 1],
  );
  assert.equal(adapted.skipped.length, 0);
  assert.equal(adapted.note, 'Volume trimmed to 9 sets to fit 30 min.');
});

test('35 minutes leaves the programmed workout unchanged', () => {
  const adapted = home(35);

  assert.equal(adapted.totalSets, programSetCount(FULL_BODY_A));
  assert.deepEqual(
    adapted.exercises.map((exercise) => exercise.sets),
    [3, 3, 3, 2],
  );
  assert.equal(adapted.exercises[0].weight, 15);
  assert.deepEqual(adapted.exercises[0].targetReps, [9, 9, 9]);
  assert.equal(adapted.skipped.length, 0);
  assert.equal(adapted.note, 'Same exercises, weights and sets as your program.');
});

test('asking for more time than the program holds caps at the program', () => {
  const sixty = home(60);
  assert.equal(sixty.totalSets, 11);
  assert.equal(sixty.minutes, 35);
  assert.equal(sixty.skipped.length, 0);
  assert.equal(sixty.note, 'Same exercises, weights and sets as your program.');

  const seventyFive = home(75);
  assert.equal(seventyFive.totalSets, 11);
  assert.equal(seventyFive.minutes, 35);
  assert.deepEqual(sixty.cappedMinutes, { asked: 60, applied: 35 });
  assert.equal(programCeilingNotice(sixty)?.kind, 'program-ceiling');
  assert.equal(home(20).cappedMinutes, null);
  assert.equal(programCeilingNotice(home(35)), null);
});

test('the engine only ever returns loads from the program', () => {
  const owned = new Set(FULL_BODY_A.exercises.map((exercise) => exercise.weight));
  for (const minutes of [10, 15, 20, 25, 30, 35, 60]) {
    for (const exercise of home(minutes).exercises) {
      assert.ok(owned.has(exercise.weight), `${exercise.exerciseId} invented ${exercise.weight} kg`);
    }
  }
});

test('set budget scales from the program density and never exceeds it', () => {
  assert.equal(setBudget(FULL_BODY_A, 20), 6);
  assert.equal(setBudget(FULL_BODY_A, 30), 9);
  assert.equal(setBudget(FULL_BODY_A, 35), 11);
  assert.equal(setBudget(FULL_BODY_A, 90), 11);
  assert.equal(setBudget(FULL_BODY_A, 5), 2);
});

test('bodyweight setup drops loaded movements instead of inventing weights', () => {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'bodyweight' });

  assert.deepEqual(
    adapted.exercises.map((exercise) => exercise.exerciseId),
    ['plank'],
  );
  assert.deepEqual(
    adapted.skipped.map((item) => item.reason),
    ['equipment', 'equipment', 'equipment'],
  );
  assert.ok(!/kg/.test(adapted.note), 'note must not mention a load it cannot offer');
});

test('a hotel gym keeps every programmed load', () => {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'hotel' });
  assert.equal(adapted.exercises.length, 3);
  assert.equal(adapted.skipped.length, 1);
});

test('the session model carries per-set targets and the working load', () => {
  const [press] = toWorkoutExercises(home(20));
  assert.equal(press.name, 'Dumbbell floor press');
  assert.deepEqual(
    press.planned.map((set) => [set.weight, set.reps]),
    [
      [15, 9],
      [15, 9],
    ],
  );
  assert.ok(press.performed.every((set) => set.done === false && set.completedAt === null));
});

test('the local parser only fills constraints', () => {
  const parsed = keywordParser.parse('I only have 20 minutes and dumbbells');
  assert.deepEqual(parsed, { minutes: 20, equipment: 'home' });
  assert.deepEqual(keywordParser.parse('20 min at a hotel gym'), {
    minutes: 20,
    equipment: 'hotel',
  });
  assert.deepEqual(keywordParser.parse('no equipment, 30 minutes'), {
    minutes: 30,
    equipment: 'bodyweight',
  });
  assert.deepEqual(keywordParser.parse('bodyweight only'), { equipment: 'bodyweight' });
  assert.deepEqual(keywordParser.parse(''), {});
});

test('the time estimate follows the work that survived, not the request', () => {
  assert.equal(estimatedMinutes(FULL_BODY_A, 11), FULL_BODY_A.minutes);
  assert.ok(estimatedMinutes(FULL_BODY_A, 2) < 10);
  assert.equal(estimatedMinutes(FULL_BODY_A, 0), 0);
});

test('excluded movements are skipped as excluded, never reloaded', () => {
  const adapted = adaptWorkout(
    FULL_BODY_A,
    { minutes: 35, equipment: 'home' },
    ['dumbbell-row'],
  );
  assert.deepEqual(
    adapted.skipped.map((item) => [item.exerciseId, item.reason]),
    [['dumbbell-row', 'excluded']],
  );
  assert.ok(
    adapted.exercises.every((exercise) => exercise.exerciseId !== 'dumbbell-row'),
  );
});
