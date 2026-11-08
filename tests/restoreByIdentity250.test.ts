import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, restorePendingWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import type { AdaptedWorkout } from '../src/lib/adapt.ts';
import type { Constraints } from '../src/lib/constraints.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { createSession, logSet, sessionProgress, swapPendingExercise, updatePerformedSet } from '../src/lib/session.ts';
import { talkConstraints } from '../src/lib/todayTalk.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

/**
 * #250: restoring a shortened running session matches each prescribed exercise to its logged
 * entries by identity (same exercise, then the swap split the session already stores), not by
 * movement pattern. A Push day holds bench and incline press, both horizontal pushes.
 */
const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 5,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60,
};
const slots = planSlots(buildPlan(gym));
const push = slots.find((slot) => slot.name === 'Push')!;
const NOW = '2026-11-08T10:00:00.000Z';
let clock = 0;
const at = () => new Date(Date.parse(NOW) + (clock += 1) * 60_000).toISOString();

/** The day as App builds it: programFor(today) adapted at today's constraints. */
const dayAt = (slot = push, today: Partial<Constraints> = {}): AdaptedWorkout => {
  const constraints: Constraints = { ...defaultConstraints(gym), ...today };
  return adaptWorkout(todayProgram(gym, slot, [], today), constraints, gym.exclusions, gym.goal);
};
const start = (workout: AdaptedWorkout, slot = push) => createSession({ id: `s-${slot.name}`, name: workout.name,
  dayIndex: slot.index, now: NOW, durationMin: workout.minutes, exercises: liveExercises(workout, gym, []) });
/** Log a set with a load, as the logger does after calibration. */
const log = (session: WorkoutRecord, exerciseId: string, weight = 40): WorkoutRecord => {
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId && exercise.performed.some((set) => !set.done));
  const set = session.exercises[index].performed.findIndex((entry) => !entry.done);
  return logSet(updatePerformedSet(session, index, set, { weight }, at()), index, set, at());
};
const done = (session: WorkoutRecord) => session.exercises.flatMap((exercise) => exercise.performed.flatMap((set, index) =>
  set.done ? [{ exerciseId: exercise.exerciseId, planned: exercise.planned[index], actual: set }] : []));
const ids = (session: WorkoutRecord) => session.exercises.map((exercise) => exercise.exerciseId);
const pendingOf = (session: WorkoutRecord, exerciseId: string) => session.exercises
  .filter((exercise) => exercise.exerciseId === exerciseId)
  .reduce((sum, exercise) => sum + exercise.performed.filter((set) => !set.done).length, 0);
const doneOf = (session: WorkoutRecord, exerciseId: string) => session.exercises
  .filter((exercise) => exercise.exerciseId === exerciseId)
  .reduce((sum, exercise) => sum + exercise.performed.filter((set) => set.done).length, 0);

/** Every prescribed exercise appears once, owes its plan minus what it logged, and nothing logged moved. */
function assertRestored(restored: WorkoutRecord, before: WorkoutRecord, workout: AdaptedWorkout, label: string) {
  const list = ids(restored);
  for (const exercise of workout.exercises) {
    assert.equal(list.filter((id) => id === exercise.exerciseId).length, 1, `${label}: ${exercise.exerciseId} once in ${list.join(', ')}`);
    assert.equal(pendingOf(restored, exercise.exerciseId), Math.max(0, exercise.sets - doneOf(before, exercise.exerciseId)),
      `${label}: ${exercise.exerciseId} owes its plan minus its own logged sets`);
  }
  assert.equal(new Set(list).size, list.length, `${label}: no exercise listed twice: ${list.join(', ')}`);
  assert.deepEqual(done(restored), done(before), `${label}: logged sets untouched`);
}

test('#250: shortening a running Push mid-session and restoring lists each exercise once and keeps the incline', () => {
  const full = dayAt();
  assert.ok(full.exercises.some((exercise) => exercise.exerciseId === 'barbell-bench-press'));
  assert.ok(full.exercises.some((exercise) => exercise.exerciseId === 'incline-dumbbell-press'));
  assert.equal(exerciseById('barbell-bench-press')?.pattern, exerciseById('incline-dumbbell-press')?.pattern, 'two exercises, one pattern');
  const running = log(start(full), 'barbell-bench-press', 60);
  for (const minutes of [15, 20, 30, 45]) {
    const short = dayAt(push, { minutes });
    const shortened = restorePendingWorkout(running, short, gym, []);
    assertRestored(shortened, running, short, `shortened to ${minutes}`);
    const restored = restorePendingWorkout(shortened, full, gym, []);
    assertRestored(restored, running, full, `restored from ${minutes}`);
    assert.equal(sessionProgress(restored).total, full.totalSets, `restored from ${minutes}: the full day's sets`);
    assert.deepEqual(restorePendingWorkout(restored, full, gym, []), restored, `restored from ${minutes}: restoring twice changes nothing`);
  }
});

test('#250: every generated day, logged deep into the session, shortens and restores by identity', () => {
  for (const slot of slots) {
    const full = dayAt(slot);
    let running = start(full, slot);
    // Mid-session: the first exercise twice, the next two once each.
    for (const exerciseId of [0, 0, 1, 2].map((index) => full.exercises[index].exerciseId)) running = log(running, exerciseId);
    for (const minutes of [15, 20, 30, 45]) {
      const short = dayAt(slot, { minutes });
      const shortened = restorePendingWorkout(running, short, gym, []);
      // Shortening never drops logged work; an exercise the short day leaves out keeps only its logged sets.
      assert.deepEqual(done(shortened), done(running), `${slot.name} ${minutes}: logged sets untouched`);
      assert.equal(new Set(ids(shortened)).size, ids(shortened).length, `${slot.name} ${minutes}: ${ids(shortened).join(', ')}`);
      const restored = restorePendingWorkout(shortened, full, gym, []);
      assertRestored(restored, running, full, `${slot.name} restored from ${minutes}`);
      // Logging after the shorten, then restoring, still counts each set against its own exercise.
      const later = log(shortened, shortened.exercises.find((exercise) => exercise.performed.some((set) => !set.done))!.exerciseId);
      assertRestored(restorePendingWorkout(later, full, gym, []), later, full, `${slot.name} logged after ${minutes}`);
    }
  }
});

const inDay = (workout: AdaptedWorkout) => workout.exercises.map((exercise) => exerciseById(exercise.exerciseId)!);
const replacementFor = (workout: AdaptedWorkout, exerciseId: string) => rankedReplacements(exerciseById(exerciseId)!, gym, inDay(workout))[0];
const swap = (session: WorkoutRecord, exerciseId: string, workout: AdaptedWorkout) => {
  const candidate = replacementFor(workout, exerciseId);
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId && exercise.performed.some((set) => !set.done));
  return swapPendingExercise(session, index, { exerciseId: candidate.id, name: candidate.name, weight: 30, reps: 8 });
};

test('#250: swap halves stay together and count once against their slot, swapped before or after the shorten', () => {
  const full = dayAt();
  const short = dayAt(push, { minutes: 30 });
  const replacement = replacementFor(full, 'incline-dumbbell-press');
  assert.ok(replacement && !full.exercises.some((exercise) => exercise.exerciseId === replacement.id));
  const cases: [string, WorkoutRecord][] = [];
  // Swap first: incline 1 set, then its replacement 1 set, then shorten.
  let before = log(start(full), 'barbell-bench-press', 60);
  before = log(before, 'incline-dumbbell-press');
  before = swap(before, 'incline-dumbbell-press', full);
  before = log(before, replacement.id);
  cases.push(['swap before the shorten', restorePendingWorkout(before, short, gym, [])]);
  // Shorten first, then swap mid-way through the shortened incline.
  let after = restorePendingWorkout(log(start(full), 'barbell-bench-press', 60), short, gym, []);
  after = log(after, 'incline-dumbbell-press');
  after = swap(after, 'incline-dumbbell-press', short);
  after = log(after, replacement.id);
  cases.push(['swap after the shorten', after]);
  for (const [label, shortened] of cases) {
    const restored = restorePendingWorkout(shortened, full, gym, []);
    const list = ids(restored);
    const incline = list.indexOf('incline-dumbbell-press');
    assert.equal(list[incline + 1], replacement.id, `${label}: the replacement follows the half it replaced: ${list.join(', ')}`);
    assert.equal(list.filter((id) => id === 'incline-dumbbell-press').length, 1, `${label}: ${list.join(', ')}`);
    assert.equal(list.filter((id) => id === 'barbell-bench-press').length, 1, `${label}: ${list.join(', ')}`);
    // The slot's 4 sets: 1 incline + 1 replacement logged, 2 pending on the incline.
    assert.equal(pendingOf(restored, 'incline-dumbbell-press'), 2, label);
    assert.equal(pendingOf(restored, replacement.id), 0, label);
    assert.equal(pendingOf(restored, 'barbell-bench-press'), 4, `${label}: bench owes its own 5 minus its own 1`);
    assert.deepEqual(done(restored), done(shortened), `${label}: logged sets untouched`);
    assert.equal(sessionProgress(restored).total, full.totalSets, label);
  }
});

test('#250: a replacement swapped in before any set keeps its slot\'s budget on restore', () => {
  const full = dayAt();
  const replacement = replacementFor(full, 'incline-dumbbell-press');
  let running = log(start(full), 'barbell-bench-press', 60);
  running = swap(running, 'incline-dumbbell-press', full);
  running = log(running, replacement.id);
  const restored = restorePendingWorkout(restorePendingWorkout(running, dayAt(push, { minutes: 20 }), gym, []), full, gym, []);
  assert.deepEqual(done(restored), done(running));
  assert.equal(ids(restored).filter((id) => id === 'barbell-bench-press').length, 1, ids(restored).join(', '));
  assert.equal(pendingOf(restored, 'barbell-bench-press'), 4, 'bench is not charged for the incline\'s replacement');
  assert.equal(pendingOf(restored, 'incline-dumbbell-press'), 3, 'the incline slot owes 4 minus its replacement\'s 1');
});

test('#250: #188 setup segments survive a shorten and restore', () => {
  const full = dayAt();
  const hotel = dayAt(push, { equipment: 'hotel' });
  const shared = hotel.exercises.find((exercise) => full.exercises.some((item) => item.exerciseId === exercise.exerciseId))!;
  assert.ok(shared, 'a dumbbell exercise both setups run');
  let running = log(start(full), shared.exerciseId, 20);
  running = restorePendingWorkout(running, hotel, gym, []);
  running = log(running, shared.exerciseId, 15);
  const segments = (session: WorkoutRecord) => session.exercises.filter((exercise) => exercise.exerciseId === shared.exerciseId);
  assert.deepEqual(segments(running).map((segment) => segment.setup), [undefined, 'hotel']);
  const short = restorePendingWorkout(running, dayAt(push, { equipment: 'hotel', minutes: 20 }), gym, []);
  const restored = restorePendingWorkout(short, full, gym, []);
  assert.deepEqual(segments(restored).map((segment) => [segment.setup, segment.performed.filter((set) => set.done).length]),
    [[undefined, 1], ['hotel', 1]], 'each set keeps the setup it ran on');
  assert.deepEqual(done(restored), done(running));
  const others = ids(restored).filter((id) => id !== shared.exerciseId);
  assert.equal(new Set(others).size, others.length, ids(restored).join(', '));
  assert.equal(pendingOf(restored, shared.exerciseId), full.exercises.find((item) => item.exerciseId === shared.exerciseId)!.sets - 2);
});

test('#250: a legacy swap with no stored split still restores by pattern, once', () => {
  const beginner: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
    equipment: ['Dumbbell'], support: [], exclusions: [], loads: {} };
  const original = adaptWorkout(FULL_BODY_A, defaultConstraints(beginner), [], beginner.goal);
  let active = createSession({ id: 'legacy', name: original.name, dayIndex: 0, now: NOW, durationMin: original.minutes,
    exercises: toWorkoutExercises(original) });
  active = logSet(active, 0, 0, at());
  active = swapPendingExercise(active, 0, { exerciseId: 'push-up', name: 'Push-Up', weight: 0, reps: 8 });
  active = logSet(active, 1, 0, at());
  // Before swaps stored the slot's requirement, neither half carried it.
  const legacy: WorkoutRecord = { ...active, exercises: active.exercises.map((exercise) => {
    const copy = { ...exercise };
    delete copy.originalPlannedSets;
    return copy;
  }) };
  const restored = restorePendingWorkout(legacy, original);
  assert.deepEqual(done(restored), done(legacy));
  assert.deepEqual(ids(restored).filter((id) => id === 'dumbbell-floor-press' || id === 'push-up'), ['dumbbell-floor-press', 'push-up']);
  assert.equal(pendingOf(restored, 'dumbbell-floor-press'), 1, 'the push-up still counts against the floor press slot');
  assert.equal(sessionProgress(restored).total, 11);
});

test('#250: a described day (#193) shortened mid-session and lengthened back lists each exercise once', () => {
  const constraints = talkConstraints({ equipment: 'home', minutes: 60, train: ['Chest'], skip: [], sore: [], pain: false, notices: [] },
    undefined, push.focus);
  const described = (minutes: number) => adaptWorkout(todayProgram(gym, push, [], { ...constraints, minutes }),
    { ...constraints, minutes }, gym.exclusions, gym.goal);
  const full = described(60);
  const presses = full.exercises.filter((exercise) => exerciseById(exercise.exerciseId)?.pattern === 'horizontal_push');
  assert.ok(presses.length >= 2, `a chest day holds two horizontal pushes: ${full.exercises.map((exercise) => exercise.exerciseId).join(', ')}`);
  const running = log(createSession({ id: 'described', name: full.name, dayIndex: push.index, planRevision: 1, now: NOW,
    durationMin: full.minutes, exercises: liveExercises(full, gym, []) }), presses[0].exerciseId, 50);
  for (const minutes of [20, 30, 45]) {
    const shortened = restorePendingWorkout(running, described(minutes), gym, []);
    assertRestored(shortened, running, described(minutes), `described ${minutes}`);
    assertRestored(restorePendingWorkout(shortened, full, gym, []), running, full, `described back from ${minutes}`);
  }
});
