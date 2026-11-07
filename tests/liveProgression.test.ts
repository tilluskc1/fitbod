import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_BODY_A, targetSummary } from '../src/data/flagship.ts';
import { adaptWorkout, currentWorkout, restorePendingWorkout, swapCandidateFor } from '../src/lib/adapt.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import {
  liveAdapted,
  liveExercises,
  progressionLines,
  targetReason,
} from '../src/lib/liveProgression.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];

const profile: Profile = {
  name: 'Krishna',
  goal: 'Build Muscle',
  experience: 'Beginner',
  daysPerWeek: 3,
  equipment: ['Dumbbell'],
  support: [],
  exclusions: [],
  loads: { Dumbbell: RACK },
  unit: 'kg',
};

const constraints = { minutes: 35, equipment: 'home' as const, loads: RACK };

/** The real start path: adapted program → live prescription → session. */
function startLiveSession(history: WorkoutRecord[] = [], minutes = 35) {
  const adapted = adaptWorkout(FULL_BODY_A, { ...constraints, minutes });
  return createSession({
    id: 'live-1',
    name: adapted.name,
    dayIndex: 0,
    durationMin: minutes,
    exercises: liveExercises(adapted, profile, history),
    now: '2026-11-02T10:00:00.000Z',
  });
}

/** Log every planned set of one exercise at one load and rep count. */
function logAll(session: WorkoutRecord, index: number, weight: number, reps: number) {
  let next = session;
  const count = next.exercises[index].planned.length;
  for (let setIndex = 0; setIndex < count; setIndex += 1) {
    next = updatePerformedSet(next, index, setIndex, { weight, reps });
    next = logSet(next, index, setIndex, `2026-11-02T10:0${setIndex + 1}:00.000Z`);
  }
  return next;
}

function finish(session: WorkoutRecord): { state: AppState; workout: WorkoutRecord } {
  const state = applyFinish(
    { ...EMPTY, profile, current: session },
    session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' },
  );
  const workout = state.history[0];
  assert.ok(workout);
  return { state, workout };
}

const EMPTY: AppState = {
  profile: null,
  plan: [],
  history: [],
  current: null,
  todayOverride: null,
};

test('a logged full target earns the next selectable rack load through the real start path', () => {
  const first = startLiveSession([]);
  const pressBefore = first.exercises[0];
  // First time: no history, so no invented load.
  assert.equal(pressBefore.planned[0].weight, 0);

  const logged = logAll(first, 0, 15, 10);
  const { state } = finish(logged);

  // The next real session — the same path Today and Start use — asks history.
  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, state.history)[0];
  assert.equal(next.planned[0].weight, 18, 'all three sets at the ceiling move to the next owned load');
  assert.equal(next.planned[0].reps, 8, "reps restart at the bottom of the program's 8–10 range");
  assert.equal(next.originalPlannedSets, 3, 'the original 3-set target is preserved');
});

test('a shortened session at the same load does not earn the step', () => {
  const short = startLiveSession([], 20);
  const press = short.exercises[0];
  assert.equal(press.originalPlannedSets, 3);
  assert.equal(press.planned.length, 2, 'the session carried two of the three required sets');

  const logged = logAll(short, 0, 15, 10);
  const { state } = finish(logged);

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, state.history)[0];
  assert.equal(next.planned[0].weight, 15, 'two of three required sets is unfinished work');
  assert.equal(next.planned[0].reps, 10);
});

test('mixed loads hold instead of rewarding the heaviest set', () => {
  const session = startLiveSession([]);
  let logged = updatePerformedSet(session, 0, 0, { weight: 15, reps: 10 });
  logged = logSet(logged, 0, 0, '2026-11-02T10:01:00.000Z');
  logged = updatePerformedSet(logged, 0, 1, { weight: 15, reps: 10 });
  logged = logSet(logged, 0, 1, '2026-11-02T10:02:00.000Z');
  logged = updatePerformedSet(logged, 0, 2, { weight: 18, reps: 10 });
  logged = logSet(logged, 0, 2, '2026-11-02T10:03:00.000Z');
  const { state } = finish(logged);

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, state.history)[0];
  assert.equal(next.planned[0].weight, 15, 'mixed work holds at the lowest working load used');
  assert.equal(next.planned[0].reps, 10);
  assert.match(
    targetReason('dumbbell-floor-press', profile, state.history, 'kg') ?? '',
    /different loads.*holds at 15 kg/,
  );
});

test('an unlogged or warm-up set is not qualifying evidence', () => {
  const session = startLiveSession([]);
  let logged = updatePerformedSet(session, 0, 0, { weight: 15, reps: 4 }); // warm-up left unmarked
  logged = updatePerformedSet(logged, 0, 1, { weight: 15, reps: 10 });
  logged = logSet(logged, 0, 1, '2026-11-02T10:02:00.000Z');
  logged = updatePerformedSet(logged, 0, 2, { weight: 15, reps: 10 });
  logged = logSet(logged, 0, 2, '2026-11-02T10:03:00.000Z');
  const { state } = finish(logged);

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, state.history)[0];
  assert.equal(next.planned[0].weight, 15, 'two marked sets cannot complete a three-set target');
});

test('a new variant calibrates instead of inheriting a load from another exercise', () => {
  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const squat = liveExercises(adapted, profile, []).find(
    (exercise) => exercise.exerciseId === 'goblet-squat',
  );
  assert.ok(squat);
  assert.equal(squat.planned[0].weight, 0, 'no history for this variant means no invented load');
  assert.equal(squat.planned[0].reps, 8);
});

test('the top of the owned rack holds instead of inventing a heavier load', () => {
  const session = startLiveSession([]);
  const logged = logAll(session, 0, 18, 10);
  const { state } = finish(logged);

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, state.history)[0];
  assert.equal(next.planned[0].weight, 18);
  assert.equal(next.planned[0].reps, 10);
  assert.match(targetReason('dumbbell-floor-press', profile, state.history, 'kg') ?? '', /available loads/);
});

test('correcting a logged set changes the next target without rewriting the record', () => {
  const session = startLiveSession([]);
  const logged = logAll(session, 0, 15, 10);
  const { state } = finish(logged);
  const recorded = state.history[0];
  assert.equal(recorded.exercises[0].performed[0].reps, 10);

  const corrected: AppState = {
    ...state,
    history: [
      {
        ...recorded,
        exercises: recorded.exercises.map((exercise, index) =>
          index === 0
            ? {
                ...exercise,
                performed: exercise.performed.map((set, setIndex) =>
                  setIndex === 0 ? { ...set, reps: 8 } : set,
                ),
              }
            : exercise,
        ),
      },
    ],
  };

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const next = liveExercises(adapted, profile, corrected.history)[0];
  assert.equal(next.planned[0].weight, 15, 'a corrected set removes the earned load step');
  assert.equal(next.planned[0].reps, 9, 'the lowest completed set drives the next rep target');
});

test('Today shows the computed target, not the program fixture', () => {
  const session = startLiveSession([]);
  const logged = logAll(session, 0, 15, 10);
  const { state } = finish(logged);

  const adapted = adaptWorkout(FULL_BODY_A, constraints);
  const live = liveAdapted(adapted, profile, state.history);
  const press = live.exercises[0];
  assert.equal(press.weight, 18);
  assert.deepEqual(press.targetReps?.slice(0, press.sets), [8, 8, 8]);
  // Nothing else about the adaptation changes.
  assert.equal(live.totalSets, adapted.totalSets);
  assert.equal(live.note, adapted.note);
  assert.equal(live.minutes, adapted.minutes);
});

test('recap lines state original, adapted, actual, next and one factual reason', () => {
  const session = startLiveSession([]);
  const logged = logAll(session, 0, 15, 10);
  const { state, workout } = finish(logged);

  const lines = progressionLines(workout, profile, state.history, 'kg');
  const press = lines.find((line) => line.exerciseId === 'dumbbell-floor-press');
  assert.ok(press);

  assert.match(press.original, /3 × 8–10/);
  assert.match(press.adapted, /3 sets/);
  assert.match(press.performed, /10 reps/);
  assert.match(press.performed, /15 kg each/);
  assert.match(press.performed, /3\/3 sets/);
  assert.match(press.next, /8 reps/);
  assert.match(press.next, /18 kg each/);
  assert.match(press.reason, /One step up/);
  // A hold keeps its seconds and never grows a load.
  const plank = lines.find((line) => line.exerciseId === 'plank');
  assert.ok(plank);
  assert.match(plank.original, /2 × 45s/);
  assert.equal(plank.performed, null, 'nothing logged is stated, not invented');
});

test('a first session recap says there is no history instead of inventing a comparison', () => {
  const session = startLiveSession([]);
  const logged = logAll(session, 0, 15, 9);
  const { state, workout } = finish(logged);
  // Fresh history: drop the finished record's own contribution for this check.
  const lines = progressionLines(workout, profile, [], 'kg');
  const press = lines.find((line) => line.exerciseId === 'dumbbell-floor-press');
  assert.ok(press);
  assert.match(press.reason, /First time/);
  assert.deepEqual(state.history.length, 1);

  const pressDefinition = exerciseById('dumbbell-floor-press');
  assert.ok(pressDefinition);
  assert.equal(prescribeExercise(pressDefinition, profile, []).weight, 0);
});

test('a recap with one of three sets done says so instead of reading as the full target', () => {
  const session = startLiveSession([]);
  let logged = updatePerformedSet(session, 0, 0, { weight: 15, reps: 10 });
  logged = logSet(logged, 0, 0, '2026-11-02T10:01:00.000Z');
  const { state, workout } = finish(logged);
  const press = progressionLines(workout, profile, state.history, 'kg').find(
    (line) => line.exerciseId === 'dumbbell-floor-press',
  );
  assert.ok(press);
  assert.match(press.performed ?? '', /1\/3 sets/);
});

test('explanation lines read in the display unit', () => {
  const session = startLiveSession([]);
  const { state, workout } = finish(logAll(session, 0, 15, 10));
  const lb = { ...profile, unit: 'lb' as const };
  const press = progressionLines(workout, lb, state.history, 'lb').find(
    (line) => line.exerciseId === 'dumbbell-floor-press',
  );
  assert.ok(press);
  assert.match(press.reason, / lb/);
  assert.doesNotMatch(press.reason, / kg/);
  assert.doesNotMatch(targetReason('dumbbell-floor-press', lb, state.history, 'lb') ?? '', / kg/);
});

test('mid-session adjust, restore and swap-back keep the history-derived numbers, not the fixture', () => {
  // History: the press earned 18 kg; nothing else has been logged yet.
  const { state } = finish(logAll(startLiveSession([]), 0, 15, 10));
  const history = state.history;
  const original = adaptWorkout(FULL_BODY_A, constraints);
  const live = liveExercises(original, profile, history);

  // A shortened live session with one squat set logged, then the original restored.
  let short = startLiveSession(history, 20);
  short = logSet(updatePerformedSet(short, 1, 0, { weight: 10, reps: 8 }), 1, 0, '2026-11-02T10:01:00.000Z');
  const restored = restorePendingWorkout(short, original, profile, history);
  for (const expected of live) {
    const pending = restored.exercises
      .filter((exercise) => exercise.exerciseId === expected.exerciseId)
      .flatMap((exercise) => exercise.planned.filter((_, index) => !exercise.performed[index].done));
    assert.ok(pending.length > 0);
    for (const set of pending) assert.deepEqual(set, expected.planned[0], expected.exerciseId);
  }

  // Swapping back to a program movement asks the same history.
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  const candidate = swapCandidateFor(press, profile, history, null);
  assert.deepEqual({ weight: candidate.weight, reps: candidate.reps }, live[0].planned[0]);
});

test('in lb, the reason and the target name a rack load with the same number', () => {
  // 15 kg is on the rack; 3 × 9 holds the load and asks for a rep.
  const { state } = finish(logAll(startLiveSession([]), 0, 15, 9));
  const lb = { ...profile, unit: 'lb' as const };
  const press = liveAdapted(adaptWorkout(FULL_BODY_A, constraints), lb, state.history).exercises[0];
  const target = targetSummary(press, press.sets, 'lb').match(/@ ([\d.]+) lb/)?.[1];
  const reason = targetReason(press.exerciseId, lb, state.history, 'lb')?.match(/([\d.]+) lb/)?.[1];
  assert.ok(target);
  assert.equal(reason, target);
});

test('a user-typed non-rack load keeps its stored precision in the reason', () => {
  const { state } = finish(logAll(startLiveSession([]), 0, 42.3, 9));
  assert.match(targetReason('dumbbell-floor-press', profile, state.history, 'kg') ?? '', /42\.3 kg/);
});

test('an open slot session gives a non-flagship movement its own rep range, not its planned reps', () => {
  const other = ['dumbbell-romanian-deadlift', 'dumbbell-lunge', 'dumbbell-shoulder-press']
    .map((id) => exerciseById(id)).find((exercise) => exercise && !FULL_BODY_A.exercises.some((entry) => entry.exerciseId === exercise.id));
  assert.ok(other, 'a catalog movement outside the flagship');
  const session = createSession({ id: 'slot', name: 'Slot B', dayIndex: 1, durationMin: 35, now: '2026-11-02T10:00:00.000Z',
    exercises: [{ exerciseId: other.id, name: other.name, planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false }] }] });
  const shown = currentWorkout(adaptWorkout(FULL_BODY_A, constraints), session).exercises[0];
  const expected = prescribeExercise(other, profile, []).range;
  assert.deepEqual(shown.repRange, [expected.min, expected.max]);
});

// UI7-12 (#154): every recap line names the next target, and unfinished work says it repeats.
test('recap: finished exercise names its next target; unfinished ones say the target repeats', () => {
  const session = startLiveSession([]);
  let logged = logAll(session, 0, 15, 10);
  // Second exercise: one set only, so it is cut short.
  logged = updatePerformedSet(logged, 1, 0, { weight: 10, reps: 8 });
  logged = logSet(logged, 1, 0, '2026-11-02T10:20:00.000Z');
  const { state, workout } = finish(logged);
  const lines = progressionLines(workout, profile, state.history, 'kg');
  assert.ok(lines.length >= 3);
  for (const line of lines) assert.ok(line.next.length > 0, `${line.name} names a next target`);

  const [done, partial, ...untouched] = lines;
  assert.match(done.reason, /One step up|Add a rep|go heavier/);
  assert.match(partial.reason, /^Repeat .+ was cut short\./);
  const unlogged = untouched.filter((item) => item.performed === null && !/hold/.test(item.next));
  assert.ok(unlogged.length > 0, 'at least one loaded exercise was left unlogged');
  for (const line of unlogged) {
    assert.match(line.reason, /was not logged\. Repeating the same prescription\./);
  }
});
