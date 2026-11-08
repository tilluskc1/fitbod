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
import mainFuzz from './fixtures/restoreFuzz250.main.json' with { type: 'json' };
import { fuzz } from './restoreFuzz250.ts';
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
/** Every logged set, in no particular order: an exercise a day leaves out keeps its sets at the end. */
const done = (session: WorkoutRecord) => session.exercises.flatMap((exercise) => exercise.performed.flatMap((set, index) =>
  set.done ? [JSON.stringify({ exerciseId: exercise.exerciseId, planned: exercise.planned[index], actual: set })] : [])).sort();
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
const replacementFor = (workout: AdaptedWorkout, exerciseId: string, profile = gym) => rankedReplacements(exerciseById(exerciseId)!, profile, inDay(workout))[0];
const swap = (session: WorkoutRecord, exerciseId: string, workout: AdaptedWorkout) => {
  const candidate = replacementFor(workout, exerciseId);
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId && exercise.performed.some((set) => !set.done));
  return swapPendingExercise(session, index, { exerciseId: candidate.id, name: candidate.name, weight: 30, reps: 8 });
};
const setsOf = (workout: AdaptedWorkout, exerciseId: string) => workout.exercises.find((exercise) => exercise.exerciseId === exerciseId)?.sets ?? 0;

test('#250: swap halves of a pattern\'s only exercise count once against it, swapped before or after the shorten', () => {
  const full = dayAt();
  const short = dayAt(push, { minutes: 30 });
  const replacement = replacementFor(full, 'overhead-press');
  assert.equal(replacement.pattern, 'vertical_push');
  assert.equal(full.exercises.filter((exercise) => exerciseById(exercise.exerciseId)?.pattern === 'vertical_push').length, 1);
  const cases: [string, WorkoutRecord][] = [];
  let before = log(start(full), 'barbell-bench-press', 60);
  before = log(before, 'overhead-press');
  before = swap(before, 'overhead-press', full);
  before = log(before, replacement.id);
  cases.push(['swap before the shorten', restorePendingWorkout(before, short, gym, [])]);
  let after = restorePendingWorkout(log(start(full), 'barbell-bench-press', 60), short, gym, []);
  after = log(after, 'overhead-press');
  after = swap(after, 'overhead-press', short);
  after = log(after, replacement.id);
  cases.push(['swap after the shorten', after]);
  for (const [label, shortened] of cases) {
    const restored = restorePendingWorkout(shortened, full, gym, []);
    const list = ids(restored);
    assert.equal(list[list.indexOf('overhead-press') + 1], replacement.id, `${label}: the halves stay together: ${list.join(', ')}`);
    assert.equal(new Set(list).size, list.length, `${label}: ${list.join(', ')}`);
    // The slot's 4 sets: 1 press + 1 replacement logged, 2 pending on the press (as on main).
    assert.equal(pendingOf(restored, 'overhead-press'), 2, label);
    assert.equal(pendingOf(restored, replacement.id), 0, label);
    assert.equal(pendingOf(restored, 'barbell-bench-press'), 4, `${label}: bench owes its own 5 minus its own 1`);
    assert.deepEqual(done(restored), done(shortened), `${label}: logged sets untouched`);
    assert.equal(sessionProgress(restored).total, full.totalSets, label);
  }
});

test('#250: swap, shorten, restore, shorten, restore keeps a pattern\'s only exercise and its replacement together', () => {
  const full = dayAt();
  const replacement = replacementFor(full, 'overhead-press');
  let running = log(start(full), 'barbell-bench-press', 60);
  running = log(running, 'overhead-press');
  running = swap(running, 'overhead-press', full);
  running = log(running, replacement.id);
  const logged = done(running);
  for (const [step, minutes] of [[1, 30], [2, 60], [3, 20], [4, 60]] as const) {
    const day = minutes === 60 ? full : dayAt(push, { minutes });
    running = restorePendingWorkout(running, day, gym, []);
    const list = ids(running);
    const label = `step ${step} (${minutes} min): ${list.join(', ')}`;
    assert.deepEqual(done(running), logged, `${label}: logged sets untouched`);
    assert.equal(new Set(list).size, list.length, label);
    assert.equal(list[list.indexOf('overhead-press') + 1], replacement.id, `${label}: the halves stay together`);
    assert.equal(pendingOf(running, 'overhead-press') + pendingOf(running, replacement.id), Math.max(0, setsOf(day, 'overhead-press') - 2), label);
    assert.equal(pendingOf(running, 'barbell-bench-press'), setsOf(day, 'barbell-bench-press') - 1, `${label}: bench owes only its own`);
  }
});

test('#250: a replacement swapped in before a set counts against the one same-pattern exercise missing from the session', () => {
  const dumbbells: Profile = { ...gym, daysPerWeek: 4, equipment: ['Dumbbell'], support: ['Bench'] };
  const beginner: Profile = { ...gym, experience: 'Beginner', daysPerWeek: 3 };
  let cases = 0;
  for (const profile of [gym, beginner, dumbbells]) {
    for (const slot of planSlots(buildPlan(profile))) {
      const full = adaptWorkout(todayProgram(profile, slot, [], {}), defaultConstraints(profile), profile.exclusions, profile.goal);
      const list = full.exercises.map((exercise) => exercise.exerciseId);
      const pattern = (id: string) => exerciseById(id)?.pattern;
      // A later exercise of a pattern the day already opened, swapped before a set; the first of it unlogged.
      const swapped = list.find((id, index) => list.slice(0, index).some((other) => pattern(other) === pattern(id)));
      if (!swapped) continue;
      const first = list.find((id) => pattern(id) === pattern(swapped))!;
      const other = list.find((id) => pattern(id) !== pattern(swapped))!;
      const candidate = replacementFor(full, swapped, profile);
      if (!candidate || candidate.pattern !== pattern(swapped)) continue;
      let running = createSession({ id: 'r2', name: full.name, dayIndex: slot.index, now: NOW, durationMin: full.minutes,
        exercises: liveExercises(full, profile, []) });
      running = log(running, other);
      running = swapPendingExercise(running, list.indexOf(swapped), { exerciseId: candidate.id, name: candidate.name, weight: 30, reps: 8 });
      running = log(running, candidate.id);
      const restored = restorePendingWorkout(running, full, profile, []);
      const label = `${profile.experience} ${profile.equipment.length} ${slot.name}: ${ids(restored).join(', ')}`;
      assert.deepEqual(done(restored), done(running), label);
      assert.equal(new Set(ids(restored)).size, ids(restored).length, `${label}: listed twice`);
      assert.equal(pendingOf(restored, first), setsOf(full, first), `${label}: ${first} owes all its own sets`);
      assert.equal(pendingOf(restored, other), setsOf(full, other) - 1, `${label}: ${other} owes its sets minus its own 1`);
      assert.equal(pendingOf(restored, swapped), setsOf(full, swapped) - 1, `${label}: ${swapped} owes its sets minus its replacement's 1`);
      cases += 1;
    }
  }
  assert.ok(cases >= 4, `${cases} cases across profiles`);
});

test('#250 (#247): an ambiguous replacement stands alone and owes nothing; every exercise owes only its own', () => {
  const full = dayAt();
  const replacement = replacementFor(full, 'incline-dumbbell-press');
  // Kept half and replacement of the incline while bench is also logged: both presses are in the session.
  let halves = log(start(full), 'barbell-bench-press', 60);
  halves = log(halves, 'incline-dumbbell-press');
  halves = swap(halves, 'incline-dumbbell-press', full);
  halves = log(halves, replacement.id);
  // Swapped before a set, then a shorten puts the incline back in the session before the restore.
  let early = log(start(full), 'barbell-bench-press', 60);
  early = swap(early, 'incline-dumbbell-press', full);
  early = log(early, replacement.id);
  early = restorePendingWorkout(early, dayAt(push, { minutes: 20 }), gym, []);
  for (const [label, running, incline] of [['kept half', halves, 3], ['swapped early, restored twice', early, 4]] as const) {
    const restored = restorePendingWorkout(running, full, gym, []);
    const list = ids(restored);
    assert.deepEqual(done(restored), done(running), label);
    assert.equal(new Set(list).size, list.length, `${label}: ${list.join(', ')}`);
    assert.equal(list.at(-1), replacement.id, `${label}: the replacement stands alone at the end`);
    assert.equal(pendingOf(restored, replacement.id), 0, label);
    assert.equal(pendingOf(restored, 'barbell-bench-press'), 4, `${label}: bench owes only its own`);
    assert.equal(pendingOf(restored, 'incline-dumbbell-press'), incline, `${label}: the incline owes its own`);
  }
});

test('#250 review 3: neighbours a shorten cut back to their logged sets are never paired', () => {
  let running = log(start(dayAt()), 'lateral-raise');
  running = log(running, 'overhead-triceps-extension');
  const fifteen = restorePendingWorkout(running, dayAt(push, { minutes: 15 }), gym, []);
  const twenty = dayAt(push, { minutes: 20 });
  const restored = restorePendingWorkout(fifteen, twenty, gym, []);
  assert.deepEqual(done(restored), done(running));
  assert.equal(new Set(ids(restored)).size, ids(restored).length, ids(restored).join(', '));
  assert.ok(setsOf(twenty, 'lateral-raise') > 1);
  assert.equal(pendingOf(restored, 'lateral-raise'), setsOf(twenty, 'lateral-raise') - 1, 'lateral raise owes its sets minus its own 1');
});

test('#250 review 3: a travel day and back never loses an exercise that was not swapped', () => {
  const pull = slots.find((slot) => slot.name === 'Pull')!;
  const full = dayAt(pull);
  let running = start(full, pull);
  running = log(running, 'seated-cable-row');
  running = restorePendingWorkout(running, dayAt(pull, { equipment: 'hotel' }), gym, []);
  const fifteen = dayAt(pull, { minutes: 15 });
  const restored = restorePendingWorkout(running, fifteen, gym, []);
  assert.deepEqual(done(restored), done(running));
  assert.equal(new Set(ids(restored)).size, ids(restored).length, ids(restored).join(', '));
  assert.ok(ids(restored).includes('barbell-row'), `barbell row is listed: ${ids(restored).join(', ')}`);
  // Main's result: the day's only horizontal pull counts the logged cable row against it.
  assert.equal(pendingOf(restored, 'barbell-row'), setsOf(fifteen, 'barbell-row') - 1);
});

test('#250 fuzz guard: never worse than main (3d9f3d1) on wrong pending, lost, changed or doubled', () => {
  const branch = fuzz(restorePendingWorkout);
  for (const kind of ['length', 'gear'] as const) {
    const ours = branch[kind];
    const main = mainFuzz.counts[kind];
    assert.ok(ours.restores > 400, `${kind}: ${ours.restores} restores`);
    for (const metric of ['wrongPending', 'lost', 'changed', 'doubled'] as const) {
      assert.ok(ours[metric] / ours.restores <= main[metric] / main.restores,
        `${kind} ${metric}: ${ours[metric]}/${ours.restores} against main's ${main[metric]}/${main.restores}`);
    }
    assert.equal(ours.changed, 0, `${kind}: no logged set ever changes`);
    assert.equal(ours.doubled, 0, `${kind}: no exercise is listed twice on one setup`);
  }
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

test('#250 review: a part-logged exercise is never read as the kept half of the next exercise\'s swap', () => {
  const full = dayAt();
  const replacement = replacementFor(full, 'incline-dumbbell-press');
  let running = log(start(full), 'barbell-bench-press', 60);
  running = log(running, 'overhead-press', 30);
  // The incline is swapped before it has a set: nothing of it is kept, so nothing splits.
  running = swap(running, 'incline-dumbbell-press', full);
  running = log(running, replacement.id);
  assert.deepEqual(ids(running).slice(0, 3), ['barbell-bench-press', 'overhead-press', replacement.id]);
  const restored = restorePendingWorkout(running, full, gym, []);
  assert.deepEqual(done(restored), done(running));
  assert.equal(pendingOf(restored, 'overhead-press'), 3, 'overhead press owes its 4 minus its own 1');
  assert.equal(pendingOf(restored, 'incline-dumbbell-press'), 3, 'the incline (swapped away, the only one missing) owes 4 minus its replacement\'s 1');
  assert.equal(pendingOf(restored, replacement.id), 0);
  const ohp = restored.exercises.find((exercise) => exercise.exerciseId === 'overhead-press')!;
  assert.equal(ohp.originalPlannedSets, 4, 'overhead press is not read as cut short');
});
