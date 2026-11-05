import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, loadOptions, toWorkoutExercises } from '../src/lib/adapt.ts';
import { defaultConstraints, keywordParser, noticeText, resolveConstraints } from '../src/lib/constraints.ts';
import { coachLine, describePrescription, nextLoad, prescribeExercise } from '../src/lib/progression.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { toKg } from '../src/lib/units.ts';
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

test('a contradiction leaves the time and the rack alone, not just the setup', () => {
  const parsed = keywordParser.parse('20 minutes, no dumbbells, 5 kg');
  assert.ok(parsed.contradiction);
  const resolved = resolveConstraints({ minutes: 35, equipment: 'home' }, parsed);
  assert.equal(resolved.constraints.minutes, 35);
  assert.equal(resolved.constraints.equipment, 'home');
  assert.equal(resolved.constraints.loads, undefined);
  assert.match(noticeText(resolved.notices[0]), /nothing changed/);
});

test('a number too large to be a load becomes neither minutes nor a load', () => {
  const parsed = keywordParser.parse('I have 1200 lb plates');
  assert.equal(parsed.loads, undefined);
  assert.equal(parsed.minutes, undefined);
});

test('the home rack never caps a hotel gym or a bodyweight session', () => {
  assert.deepEqual(loadOptions('hotel', [5, 7.5]), loadOptions('hotel'));
  assert.deepEqual(loadOptions('bodyweight', [5, 7.5]), []);
  const hotel = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'hotel', loads: [5, 7.5] }, []);
  assert.deepEqual(
    [...new Set(hotel.exercises.filter((exercise) => exercise.weight > 0).map((exercise) => exercise.weight))].sort((a, b) => a - b),
    [15, 18],
  );
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

test('an unknown rack offers no example dumbbells, only typed entry', () => {
  const constraints = defaultConstraints(unconfirmed);
  assert.equal(constraints.loads, undefined);
  assert.deepEqual(loadOptions(constraints.equipment, constraints.loads), []);
  assert.deepEqual(loadOptions('home', []), []);
});

test('an unknown rack never gets a target it did not log', () => {
  const adapted = adaptWorkout(FULL_BODY_A, defaultConstraints(unconfirmed), []);
  const exercises = liveExercises(adapted, unconfirmed, []);
  assert.deepEqual([...new Set(exercises.flatMap((entry) => entry.planned.map((set) => set.weight)))], [0]);
  // The user types 30 lb for every press set; the next target is that load, not a rack value.
  const typed = toKg(30, 'lb');
  let session = createSession({ id: 'typed', name: adapted.name, dayIndex: 0, now: '2026-11-04T10:00:00.000Z', exercises });
  session.exercises[0].performed.forEach((_, index) => {
    session = logSet(updatePerformedSet(session, 0, index, { weight: typed, reps: 8 }, '2026-11-04T10:01:00.000Z'), 0, index, '2026-11-04T10:01:00.000Z');
  });
  const { history } = applyFinish({ ...EMPTY_STATE, profile: unconfirmed, current: session }, session.id,
    { early: true, now: '2026-11-04T10:30:00.000Z' });
  const press = exerciseById(session.exercises[0].exerciseId);
  assert.ok(press);
  assert.equal(prescribeExercise(press, unconfirmed, history).weight, typed);
});

test('progression stops at the top of the confirmed rack', () => {
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  assert.equal(nextLoad(7.5, 2.5, [5, 7.5]), 7.5);
  const next = prescribeExercise(press, sparseRack, []);
  assert.ok(next.weight <= 7.5, `expected at most 7.5 kg, got ${next.weight}`);
});

/** One finished session: every set of `exerciseId` logged at `weight` × `reps`. */
function loggedAt(exerciseId: string, weight: number, reps: number, profile: Profile) {
  const exercise = exerciseById(exerciseId);
  assert.ok(exercise);
  const sets = prescribeExercise(exercise, profile, []).sets;
  let session = createSession({ id: `${exerciseId}-${weight}`, name: 'Test', dayIndex: 0, now: '2026-11-04T10:00:00.000Z',
    exercises: [{ exerciseId, name: exercise.name, planned: Array.from({ length: sets }, () => ({ weight: 0, reps })),
      performed: Array.from({ length: sets }, () => ({ weight: 0, reps, done: false, completedAt: null })) }] });
  for (let index = 0; index < sets; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight, reps }, '2026-11-04T10:01:00.000Z'), 0, index, '2026-11-04T10:01:00.000Z');
  }
  const { history } = applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-04T10:30:00.000Z' });
  return prescribeExercise(exercise, profile, history);
}

const ceiling = (exerciseId: string) => {
  const exercise = exerciseById(exerciseId);
  assert.ok(exercise);
  return prescribeExercise(exercise, unconfirmed, []).range.max;
};

test('a no-rack dumbbell or kettlebell at the ceiling keeps its typed load and asks for the next one up', () => {
  for (const id of ['dumbbell-floor-press', 'kettlebell-goblet-squat']) {
    const typed = toKg(30, 'lb');
    const next = loggedAt(id, typed, ceiling(id), unconfirmed);
    assert.equal(next.weight, typed, id);
    for (const unit of ['kg', 'lb'] as const) {
      for (const line of [describePrescription(next, unit), coachLine(next, unit)]) {
        assert.match(line, /go heavier/, `${id} ${unit}: ${line}`);
        assert.doesNotMatch(line, /\+/, `${id} ${unit}: ${line}`);
      }
    }
  }
});

test('a confirmed rack still steps to the next owned load', () => {
  const rack: Profile = { ...sparseRack, loads: { Dumbbell: [5, 7.5, 10] } };
  const next = loggedAt('dumbbell-floor-press', 7.5, ceiling('dumbbell-floor-press'), rack);
  assert.equal(next.weight, 10);
  assert.equal(next.basis, 'load-increase');
});

test('a typed barbell load keeps the standard plate step', () => {
  const next = loggedAt('barbell-row', 40, ceiling('barbell-row'), unconfirmed);
  assert.equal(next.weight, 42.5);
  assert.equal(next.basis, 'load-increase');
});

test('an unconfirmed home rack never drops a typed off-rack load as missing equipment', () => {
  for (const typed of [6.8, 12.5]) {
    const program = { ...FULL_BODY_A, exercises: FULL_BODY_A.exercises.map((exercise) =>
      exercise.weight > 0 ? { ...exercise, weight: typed } : exercise) };
    const home = adaptWorkout(program, { minutes: 35, equipment: 'home' }, []);
    assert.deepEqual(home.skipped.filter((item) => item.reason === 'equipment'), [], `home @ ${typed}`);
    assert.deepEqual(home.exercises.filter((exercise) => exercise.weight > 0).map((exercise) => exercise.weight),
      program.exercises.filter((exercise) => exercise.weight > 0).map(() => typed));
    // A hotel gym's rack is still the gym's: an off-rack load is not there.
    const hotel = adaptWorkout(program, { minutes: 35, equipment: 'hotel' }, []);
    assert.ok(hotel.skipped.some((item) => item.reason === 'equipment'), `hotel @ ${typed}`);
  }
});
