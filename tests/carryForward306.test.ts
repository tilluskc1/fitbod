import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession, editSet, logSet, setRemaining, swapPendingExercise, undoCarry } from '../src/lib/session.ts';
import { carryMessage, setsPhrase } from '../src/lib/carry.ts';
import type { WorkoutRecord } from '../src/types.ts';
import { toKg } from '../src/lib/units.ts';

// #306: changing a set carries its weight or reps to every later set that still follows it.
const NOW = '2026-11-09T10:00:00.000Z';
const LB45 = toKg(45, 'lb');
const LB135 = toKg(135, 'lb');
const LB115 = toKg(115, 'lb');

function bench(sets = 4, weight = LB45, reps = 8, id = 'barbell-bench-press'): WorkoutRecord {
  return createSession({
    id: 'w-306', name: 'Push', dayIndex: 0, now: NOW,
    exercises: [
      {
        exerciseId: id, name: 'Barbell Bench Press',
        planned: Array.from({ length: sets }, () => ({ weight, reps })),
        performed: Array.from({ length: sets }, () => ({ weight, reps, done: false, completedAt: null })),
      },
      {
        exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press',
        planned: [{ weight: 10, reps: 10 }, { weight: 10, reps: 10 }],
        performed: [{ weight: 10, reps: 10, done: false, completedAt: null }, { weight: 10, reps: 10, done: false, completedAt: null }],
      },
    ],
  });
}
const weights = (s: WorkoutRecord, i = 0) => s.exercises[i].performed.map((set) => set.weight);
const reps = (s: WorkoutRecord, i = 0) => s.exercises[i].performed.map((set) => set.reps);

test('set 1 to 135 carries to sets 2 to 4 at once, and only performed changes', () => {
  const start = bench();
  const { session, carried, previous } = editSet(start, 0, 0, { weight: LB135 }, NOW);
  assert.deepEqual(weights(session), [LB135, LB135, LB135, LB135]);
  assert.deepEqual(carried, [1, 2, 3]);
  assert.deepEqual(previous.map((p) => p.weight), [LB45, LB45, LB45]);
  assert.deepEqual(session.exercises[0].planned, start.exercises[0].planned, 'planned is immutable');
  assert.ok(session.exercises[0].performed.every((set) => !set.done), 'done state is never carried');
  assert.deepEqual(weights(session, 1), [10, 10], 'the next exercise (or a superset partner) is untouched');
});

/** One keystroke burst, as App runs it: the following sets are fixed by the first keystroke. */
function burst(s: WorkoutRecord, set: number, patches: Partial<{ weight: number; reps: number }>[]) {
  let followers;
  for (const patch of patches) {
    const result = editSet(s, 0, set, patch, NOW, followers);
    followers = result.followers;
    s = result.session;
  }
  return s;
}

test('per-keystroke typing (clear, 1, 13, 135) follows through; a cleared field carries nothing', () => {
  const cleared = editSet(bench(), 0, 0, { weight: 0 }, NOW);
  assert.deepEqual(weights(cleared.session), [0, LB45, LB45, LB45], 'clearing set 1 never wipes the prefills');
  assert.deepEqual(cleared.followers?.weight, [1, 2, 3]);
  const s = burst(bench(), 0, [{ weight: 0 }, { weight: toKg(1, 'lb') }, { weight: toKg(13, 'lb') }, { weight: LB135 }]);
  assert.deepEqual(weights(s), [LB135, LB135, LB135, LB135]);
});

test('review probe: a burst passing through a hand-edited value leaves that set alone (weight)', () => {
  const s = burst(editSet(bench(), 0, 3, { weight: toKg(10, 'lb') }, NOW).session, 0,
    [{ weight: toKg(1, 'lb') }, { weight: toKg(10, 'lb') }, { weight: toKg(100, 'lb') }]);
  assert.deepEqual(weights(s), [toKg(100, 'lb'), toKg(100, 'lb'), toKg(100, 'lb'), toKg(10, 'lb')]);
});

test('review probe: stepping reps 8 to 5 on set 1 leaves a hand-set 6 on set 4', () => {
  const s = burst(editSet(bench(), 0, 3, { reps: 6 }, NOW).session, 0, [{ reps: 7 }, { reps: 6 }, { reps: 5 }]);
  assert.deepEqual(reps(s), [5, 5, 5, 6]);
});

test('a hand-edited later set keeps its value', () => {
  let s = editSet(bench(), 0, 3, { weight: LB115 }, NOW).session;
  const result = editSet(s, 0, 0, { weight: LB135 }, NOW);
  s = result.session;
  assert.deepEqual(weights(s), [LB135, LB135, LB135, LB115]);
  assert.deepEqual(result.carried, [1, 2]);
});

test('Undo returns the carried sets to their previous values; they stop following set 1', () => {
  const first = editSet(bench(), 0, 0, { weight: LB135 }, NOW);
  let s = undoCarry(first.session, 0, 'barbell-bench-press', first.previous, NOW);
  assert.deepEqual(weights(s), [LB135, LB45, LB45, LB45]);
  s = editSet(s, 0, 0, { weight: LB115 }, NOW).session;
  assert.deepEqual(weights(s), [LB115, LB45, LB45, LB45]);
});

test('Undo skips a set logged since, and another exercise at that index', () => {
  const first = editSet(bench(), 0, 0, { weight: LB135 }, NOW);
  const logged = logSet(first.session, 0, 1, NOW, 90);
  assert.deepEqual(weights(undoCarry(logged, 0, 'barbell-bench-press', first.previous, NOW)), [LB135, LB135, LB45, LB45]);
  assert.equal(undoCarry(logged, 0, 'squat', first.previous, NOW), logged);
});

test('changing set 3 carries to set 4 only', () => {
  const s = editSet(bench(), 0, 2, { weight: LB135 }, NOW).session;
  assert.deepEqual(weights(s), [LB45, LB45, LB135, LB135]);
});

test('a lighter change carries too', () => {
  const s = editSet(bench(4, LB135), 0, 0, { weight: LB115 }, NOW).session;
  assert.deepEqual(weights(s), [LB115, LB115, LB115, LB115]);
});

test('logged sets are never changed, and a logged set edit carries to the unlogged ones', () => {
  let s = logSet(bench(), 0, 0, NOW, 90);
  s = logSet(s, 0, 1, NOW, 90);
  const result = editSet(s, 0, 0, { weight: LB135, reps: 8, done: true, completedAt: NOW }, NOW);
  assert.deepEqual(weights(result.session), [LB135, LB45, LB135, LB135], 'logged set 2 keeps 45');
  assert.deepEqual(result.carried, [2, 3]);
});

test('reps carry the same way; a hold carries its seconds', () => {
  let s = editSet(bench(), 0, 0, { reps: 6 }, NOW).session;
  assert.deepEqual(reps(s), [6, 6, 6, 6]);
  assert.deepEqual(weights(s), [LB45, LB45, LB45, LB45]);
  const plank = createSession({
    id: 'w-plank', name: 'Core', dayIndex: 0, now: NOW,
    exercises: [{ exerciseId: 'plank', name: 'Plank', planned: [{ weight: 0, reps: 30 }, { weight: 0, reps: 30 }, { weight: 0, reps: 30 }],
      performed: [0, 1, 2].map(() => ({ weight: 0, reps: 30, done: false, completedAt: null })) }],
  });
  s = editSet(plank, 0, 0, { reps: 45 }, NOW).session;
  assert.deepEqual(reps(s), [45, 45, 45]);
});

test('each and total loads carry the stored kilograms unchanged, in kg and lb', () => {
  const dumbbells = createSession({
    id: 'w-db', name: 'Push', dayIndex: 0, now: NOW,
    exercises: [{ exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', planned: [0, 1, 2].map(() => ({ weight: 10, reps: 10 })),
      performed: [0, 1, 2].map(() => ({ weight: 10, reps: 10, done: false, completedAt: null })) }],
  });
  const s = editSet(dumbbells, 0, 0, { weight: 12.5 }, NOW).session;
  assert.deepEqual(weights(s), [12.5, 12.5, 12.5]);
  assert.equal(carryMessage({ field: 'weight', kg: 12.5, reps: 10, carried: [1, 2], unit: 'kg', mode: 'each', seconds: false }),
    '12.5 kg each applied to sets 2 to 3');
  assert.equal(carryMessage({ field: 'weight', kg: LB135, reps: 8, carried: [1, 2, 3], unit: 'lb', mode: 'total', seconds: false }),
    '135 lb applied to sets 2 to 4');
});

test('carry messages name reps, seconds and non-contiguous sets', () => {
  assert.equal(carryMessage({ field: 'reps', kg: 0, reps: 6, carried: [1, 2, 3], unit: 'lb', mode: 'total', seconds: false }), '6 reps applied to sets 2 to 4');
  assert.equal(carryMessage({ field: 'reps', kg: 0, reps: 45, carried: [2], unit: 'lb', mode: 'none', seconds: true }), '45s applied to set 3');
  assert.equal(setsPhrase([1, 3]), 'sets 2 and 4');
  assert.equal(setsPhrase([1, 2, 4]), 'sets 2, 3 and 5');
});

test('set all remaining sets: every unlogged set takes the weight and reps', () => {
  let s = logSet(bench(), 0, 0, NOW, 90);
  const result = setRemaining(s, 0, { weight: LB135, reps: 6 }, NOW);
  s = result.session;
  assert.deepEqual(weights(s), [LB45, LB135, LB135, LB135]);
  assert.deepEqual(reps(s), [8, 6, 6, 6]);
  assert.deepEqual(result.carried, [1, 2, 3]);
  assert.deepEqual(s.exercises[0].planned, bench().exercises[0].planned);
});

test('a mid-session swap: carried values stay with their exercise, not the replacement', () => {
  let s = logSet(bench(), 0, 0, NOW, 90);
  s = editSet(s, 0, 0, { weight: LB135, reps: 8, done: true, completedAt: NOW }, NOW).session;
  s = swapPendingExercise(s, 0, { exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', weight: 0, reps: 10 });
  const replacement = s.exercises.find((e, i) => i > 0 && e.exerciseId === 'dumbbell-bench-press' && e.performed.length === 3);
  assert.ok(replacement, 'the replacement holds the remaining sets');
  assert.ok(replacement.performed.every((set) => set.weight !== LB135));
});

test('reload: carried values are plain performed values and survive a JSON round trip', () => {
  const s = editSet(bench(), 0, 0, { weight: LB135 }, NOW).session;
  assert.deepEqual(weights(JSON.parse(JSON.stringify(s))), [LB135, LB135, LB135, LB135]);
});

test('the owner\'s case: set 1 typed 135 x 5 then logged leaves sets 2 to 4 at 135 x 5, not 45 x 5', () => {
  let s = editSet(bench(), 0, 0, { weight: LB135 }, NOW).session;
  s = editSet(s, 0, 0, { reps: 5 }, NOW).session;
  s = logSet(s, 0, 0, NOW, 90);
  assert.deepEqual(weights(s), [LB135, LB135, LB135, LB135]);
  assert.deepEqual(reps(s), [5, 5, 5, 5]);
  assert.deepEqual(s.exercises[0].planned.map((set) => set.reps), [8, 8, 8, 8], 'the target stays 4 x 8');
});
