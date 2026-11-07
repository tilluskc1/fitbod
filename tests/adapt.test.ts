import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptWorkout, estimatedMinutes, todayGlance, toWorkoutExercises } from '../src/lib/adapt.ts';
import { keywordParser, noticeText, programCeilingNotice, withCeiling } from '../src/lib/constraints.ts';
import { FULL_BODY_A, programSetCount } from '../src/data/flagship.ts';

const home = (minutes: number) =>
  adaptWorkout(FULL_BODY_A, { minutes, equipment: 'home' }, [], undefined);

// #203: trimming fits the length by the rest timer's clock, not by the program's sets-per-minute
// ratio, then refills what still fits: 20 min keeps 8 sets (19 min by the timer) where the ratio
// kept 6 and dropped the plank.
test('20 minutes with home dumbbells fits 8 sets by the timer', () => {
  const adapted = home(20);

  assert.equal(adapted.minutes, 20);
  assert.equal(adapted.originalMinutes, 35);
  assert.equal(adapted.originalSets, 11);
  assert.equal(adapted.totalSets, 8);
  assert.ok(todayGlance(adapted, null).minutes <= 20);
  assert.deepEqual(
    adapted.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]),
    [
      ['dumbbell-floor-press', 2],
      ['goblet-squat', 2],
      ['dumbbell-row', 2],
      ['plank', 2],
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

  assert.deepEqual(adapted.skipped, []);
  assert.equal(adapted.note, 'Volume trimmed to 8 sets to fit 20 min.');
});

test('30 minutes with home dumbbells fits 10 sets by the timer (#203)', () => {
  const adapted = home(30);

  assert.equal(adapted.totalSets, 10);
  assert.ok(todayGlance(adapted, null).minutes <= 30);
  assert.deepEqual(
    adapted.exercises.map((exercise) => exercise.sets),
    [3, 3, 3, 1],
  );
  assert.equal(adapted.skipped.length, 0);
  assert.equal(adapted.note, 'Volume trimmed to 10 sets to fit 30 min.');
});

test('a 15-minute day drops whole movements until the timer fits it, then refills the lead (#203)', () => {
  const adapted = home(15);
  assert.deepEqual(adapted.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]), [['dumbbell-floor-press', 3], ['goblet-squat', 2]]);
  assert.ok(todayGlance(adapted, null).minutes <= 15);
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
  // #203: the ceiling names what the 11 sets take by the timer (31), not the fixture's 35.
  assert.deepEqual(sixty.cappedMinutes, { asked: 60, applied: 31 });
  assert.equal(programCeilingNotice(sixty)?.kind, 'program-ceiling');
  assert.equal(home(20).cappedMinutes, null);
  assert.equal(programCeilingNotice(home(35)), null);
});

test('a capped request says what the work takes, even with a movement excluded (#17)', () => {
  const excluded = adaptWorkout(FULL_BODY_A, { minutes: 60, equipment: 'home' }, [FULL_BODY_A.exercises[0].exerciseId], undefined);
  assert.equal(excluded.minutes, estimatedMinutes(FULL_BODY_A, excluded.totalSets));
  assert.ok(excluded.minutes < FULL_BODY_A.minutes);
  assert.match(noticeText(programCeilingNotice(home(60))!), /^You asked for 60 min — the program has no more work to add, so this shows the 31 min it takes\./);
  // At or under the program, the label is the request, as before.
  assert.equal(adaptWorkout(FULL_BODY_A, { minutes: 30, equipment: 'home' }, [FULL_BODY_A.exercises[0].exerciseId], undefined).minutes, 30);
  // Nothing left to do is not a 0-minute workout.
  const all = FULL_BODY_A.exercises.map((exercise) => exercise.exerciseId);
  assert.equal(adaptWorkout(FULL_BODY_A, { minutes: 60, equipment: 'home' }, all, undefined).cappedMinutes, null);
});

test('the engine only ever returns loads from the program', () => {
  const owned = new Set(FULL_BODY_A.exercises.map((exercise) => exercise.weight));
  for (const minutes of [10, 15, 20, 25, 30, 35, 60]) {
    for (const exercise of home(minutes).exercises) {
      assert.ok(owned.has(exercise.weight), `${exercise.exerciseId} invented ${exercise.weight} kg`);
    }
  }
});

test('bodyweight setup drops loaded movements instead of inventing weights', () => {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'bodyweight' }, [], undefined);

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
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'hotel' }, [], undefined);
  // #203: 20 min by the timer keeps all four movements; nothing is skipped.
  assert.equal(adapted.exercises.length, 4);
  assert.equal(adapted.skipped.length, 0);
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
    ['dumbbell-row'], undefined,
  );
  assert.deepEqual(
    adapted.skipped.map((item) => [item.exerciseId, item.reason]),
    [['dumbbell-row', 'excluded']],
  );
  assert.ok(
    adapted.exercises.every((exercise) => exercise.exerciseId !== 'dumbbell-row'),
  );
});

test('a typed request above 120 gets one ceiling notice that keeps what was typed (#17)', () => {
  const clamp = { kind: 'minutes-adjusted' as const, asked: '150 min', applied: '120 min' };
  const notices = withCeiling([clamp], home(120));
  assert.deepEqual(notices.map((notice) => notice.kind), ['program-ceiling']);
  assert.match(noticeText(notices[0]), /^You asked for 150 min — .* shows the 31 min it takes\./);
  assert.deepEqual(withCeiling([clamp], home(20)), [clamp]);
});
