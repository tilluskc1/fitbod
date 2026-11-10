import assert from 'node:assert/strict';
import test from 'node:test';
import { generalWarmUpMinutes, rampExerciseIndex, rampSets, setWarmUpChecks, showsGeneralWarmUp, warmUpChecks } from '../src/lib/warmUp.ts';
import { completeSession, createSession, logSet, sessionProgress, skipExercise, swapPendingExercise } from '../src/lib/session.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { sessionSeconds, warmUpSeconds } from '../src/lib/sessionTime.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { HOTEL_DUMBBELLS } from '../src/data/flagship.ts';
import { toKg } from '../src/lib/units.ts';
import type { Profile, WorkoutExercise } from '../src/types.ts';

// #300: a Warm-up block at the top of every session, inside the minutes already promised.

const lb = (value: number) => toKg(value, 'lb');
const close = (actual: number[], expected: number[]) =>
  assert.deepEqual(actual.map((kg) => Math.round(kg * 1000) / 1000), expected.map((kg) => Math.round(kg * 1000) / 1000));

function entry(exerciseId: string, weight: number, sets: number, reps = 6): WorkoutExercise {
  const planned = Array.from({ length: sets }, () => ({ weight, reps }));
  return {
    exerciseId,
    name: exerciseById(exerciseId)?.name ?? exerciseId,
    planned,
    performed: planned.map((set) => ({ ...set, done: false, completedAt: null })),
  };
}

function pushDay(benchKg = 60) {
  return createSession({
    id: 's1', name: 'Push', dayIndex: 0, now: '2026-11-09T08:00:00.000Z', durationMin: 45,
    exercises: [entry('barbell-bench-press', benchKg, 5), entry('dumbbell-bench-press', 20, 3, 10), entry('push-up', 0, 3, 12)],
  });
}

test('acceptance: Bench at 60 kg ramps 30 kg x 8 then 45 kg x 3', () => {
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 60, unit: 'kg' }), [{ weight: 30, reps: 8 }, { weight: 45, reps: 3 }]);
});

test('general warm-up reads 5 min, 3 min at 30 minutes and under, from the same budget the minutes hold', () => {
  for (const minutes of [undefined, 20, 30, 45, 60, 90]) {
    assert.equal(generalWarmUpMinutes(minutes), warmUpSeconds(minutes) / 60);
  }
  assert.equal(generalWarmUpMinutes(30), 3);
  assert.equal(generalWarmUpMinutes(45), 5);
  // Snapshot of today's budget: the warm-up block changes none of it.
  assert.deepEqual([20, 30, 45, 60, 90].map((minutes) => warmUpSeconds(minutes)), [180, 180, 300, 300, 300]);
  const work = [{ sets: 5, rest: 120 }, { sets: 3, rest: 90 }];
  assert.equal(sessionSeconds(work, warmUpSeconds(45)) - sessionSeconds(work, 0), generalWarmUpMinutes(45) * 60);
  assert.equal(sessionSeconds(work, warmUpSeconds(30)) - sessionSeconds(work, 0), generalWarmUpMinutes(30) * 60);
});

test('barbell ramps never go under the empty bar or over the working load', () => {
  // At or below the bar: no ramp rows.
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 20, unit: 'kg' }), []);
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 15, unit: 'kg' }), []);
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: lb(45), unit: 'lb' }), []);
  // Just over the bar: both rows sit on the bar.
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 22.5, unit: 'kg' }).map((set) => set.weight), [20, 20]);
  for (let working = 20.5; working <= 200; working += 0.5) {
    for (const set of rampSets({ equipment: 'Barbell', working, unit: 'kg' })) {
      assert.ok(set.weight >= 20 && set.weight <= working + 1e-9, `${working}: ${set.weight}`);
      assert.equal(Math.round(set.weight / 2.5) * 2.5, set.weight, `${working}: on a 2.5 kg step`);
    }
  }
});

test('pound lifters ramp in whole 5 lb steps, ties going down', () => {
  close(rampSets({ equipment: 'Barbell', working: lb(135), unit: 'lb' }).map((set) => set.weight), [lb(65), lb(100)]);
  close(rampSets({ equipment: 'Barbell', working: lb(225), unit: 'lb' }).map((set) => set.weight), [lb(110), lb(170)]);
  close(rampSets({ equipment: 'Barbell', working: lb(55), unit: 'lb' }).map((set) => set.weight), [lb(45), lb(45)]);
  // Review 1: exact pound conversion, so 377 and 397 lb round to the nearest step.
  close(rampSets({ equipment: 'Barbell', working: lb(377), unit: 'lb' }).map((set) => set.weight), [lb(190), lb(285)]);
  close(rampSets({ equipment: 'Barbell', working: lb(397), unit: 'lb' }).map((set) => set.weight), [lb(200), lb(300)]);
});

test('dumbbells ramp from the rack: none at the lightest, never above the working load', () => {
  const rack = [5, 7.5, 10, 12.5, 15, 17.5, 20];
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 5, unit: 'kg', rack }), []);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 20, unit: 'kg', rack }).map((set) => set.weight), [10, 15]);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 7.5, unit: 'kg', rack }).map((set) => set.weight), [5, 5]);
  // No listed rack: the step is the lightest dumbbell.
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 2.5, unit: 'kg' }), []);
  // Travel today-only kit: the hotel rack's own loads.
  const hotel = [...HOTEL_DUMBBELLS];
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 25, unit: 'kg', rack: hotel }).map((set) => set.weight), [10, 18]);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 10, unit: 'kg', rack: hotel }), []);
  for (const working of hotel) {
    for (const set of rampSets({ equipment: 'Dumbbell', working, unit: 'kg', rack: hotel })) {
      assert.ok(hotel.includes(set.weight) && set.weight <= working);
    }
  }
});

test('bodyweight and unloaded work never ramp', () => {
  assert.deepEqual(rampSets({ equipment: 'Bodyweight', working: 0, unit: 'kg' }), []);
  assert.deepEqual(rampSets({ equipment: 'Bodyweight', working: 10, unit: 'kg' }), []);
  // A beginner's first session plans no load: no rows until a starting load is confirmed.
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 0, unit: 'kg' }), []);
});

test('ramp rows sit on the lead compound only, until its first set is logged', () => {
  const session = pushDay();
  assert.equal(rampExerciseIndex(session), 0);
  assert.equal(showsGeneralWarmUp(session), true);
  const logged = logSet(session, 0, 0, '2026-11-09T08:10:00.000Z');
  assert.equal(rampExerciseIndex(logged), -1);
  assert.equal(showsGeneralWarmUp(logged), false);
  // A bodyweight-only day has no lead: general warm-up only.
  const bodyweight = createSession({ id: 'b', name: 'BW', dayIndex: 0, now: '2026-11-09T08:00:00.000Z', exercises: [entry('push-up', 0, 3, 12)] });
  assert.equal(rampExerciseIndex(bodyweight), -1);
  assert.equal(showsGeneralWarmUp(bodyweight), true);
  // A skipped lead hands nothing on: other lifts start at working weight.
  assert.equal(rampExerciseIndex(skipExercise(session, 0)), -1);
  // Legacy session already under way: no warm-up rows.
  const underway = logSet(session, 1, 0, '2026-11-09T08:10:00.000Z');
  assert.equal(showsGeneralWarmUp(underway), false);
});

test('a swap of the lead follows the new lead before a working set, never after', () => {
  const session = pushDay();
  // Swapped before any working set: the new lead (now first) carries the rows.
  const before = swapPendingExercise(session, 0, { exerciseId: 'barbell-row', name: 'Barbell Row', weight: 50, reps: 6 } as never);
  assert.equal(before.exercises[0].exerciseId, 'barbell-row');
  assert.equal(rampExerciseIndex(before), 0);
  // Swapped to a lift that cannot lead: no rows anywhere, never on a lift further down (review 1).
  for (const exerciseId of ['cable-fly', 'push-up']) {
    const swapped = swapPendingExercise(session, 0, { exerciseId, name: exerciseId, weight: 0, reps: 12 } as never);
    assert.equal(swapped.exercises[0].exerciseId, exerciseId);
    assert.equal(rampExerciseIndex(swapped), -1, exerciseId);
  }
  // A day that opens on push-ups: general warm-up only, even with a loaded press behind it.
  const pushUpsFirst = createSession({ id: 'p', name: 'P', dayIndex: 0, now: '2026-11-09T08:00:00.000Z',
    exercises: [entry('push-up', 0, 3, 12), entry('dumbbell-bench-press', 20, 3, 10)] });
  assert.equal(rampExerciseIndex(pushUpsFirst), -1);
  const after = swapPendingExercise(logSet(session, 0, 0, '2026-11-09T08:10:00.000Z'), 0, { exerciseId: 'dumbbell-bench-press', name: 'DB', weight: 20, reps: 8 } as never);
  assert.equal(rampExerciseIndex(after), -1);
});

test('warm-up checks live in memory and change no sets, volume, minutes, bests or next target', () => {
  const session = pushDay();
  const snapshot = structuredClone(session);
  setWarmUpChecks(session.id, { general: true, timerStartedAt: 1, ramps: ['barbell-bench-press:0', 'barbell-bench-press:1'] });
  assert.deepEqual(warmUpChecks(session.id).ramps.length, 2);
  rampSets({ equipment: 'Barbell', working: 60, unit: 'kg' });
  rampExerciseIndex(session);
  assert.deepEqual(session, snapshot, 'nothing on the record moved');

  let done = session;
  for (let set = 0; set < 5; set += 1) done = logSet(done, 0, set, `2026-11-09T08:1${set}:00.000Z`);
  const withChecks = completeSession(done, { early: true, now: '2026-11-09T09:00:00.000Z' });
  setWarmUpChecks(session.id, { general: false, timerStartedAt: null, ramps: [] });
  const without = completeSession(done, { early: true, now: '2026-11-09T09:00:00.000Z' });
  assert.deepEqual(withChecks, without);
  const progress = sessionProgress(withChecks);
  assert.equal(progress.done, 5);
  assert.equal(progress.total, 11);
  assert.equal(progress.volume, 5 * 60 * 6);
  assert.equal(withChecks.durationMin, 45);

  const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, unit: 'kg', sessionMinutes: 45,
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack'], exclusions: [], loads: {} } as unknown as Profile;
  const next = prescribeExercise(exerciseById('barbell-bench-press')!, profile, [withChecks], true);
  // Only the five working sets at 60 kg count: no 30 or 45 kg set reads as mixed loads or drags the load down.
  assert.equal(next.basis, 'load-increase');
  assert.equal(next.weight, 62.5);
  assert.equal(next.last?.done.length, 5);
  assert.ok(next.last?.done.every((set) => set.weight === 60));
});
