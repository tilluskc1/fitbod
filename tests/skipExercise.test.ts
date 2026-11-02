import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import {
  applyFinish,
  completeSession,
  createSession,
  logSet,
  pendingExerciseIndex,
  sessionProgress,
  skipExercise,
  unskipExercise,
} from '../src/lib/session.ts';
import { EMPTY_STATE, loadState, saveState } from '../src/lib/storage.ts';
import { validateState } from '../src/lib/validate.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const START = '2026-01-01T10:00:00.000Z';
const FINISH = '2026-01-01T12:00:00.000Z';

const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {},
};

/** Three sets of press, then two of squat: the flagship two-exercise shape. */
function session(): WorkoutRecord {
  return createSession({
    id: 'skip-session',
    name: 'Full body A',
    dayIndex: 0,
    now: START,
    exercises: [
      {
        exerciseId: 'dumbbell-floor-press',
        name: 'Dumbbell floor press',
        planned: [
          { weight: 15, reps: 9 },
          { weight: 15, reps: 9 },
          { weight: 15, reps: 9 },
        ],
        performed: [
          { weight: 15, reps: 9, done: false, completedAt: null },
          { weight: 15, reps: 9, done: false, completedAt: null },
          { weight: 15, reps: 9, done: false, completedAt: null },
        ],
      },
      {
        exerciseId: 'goblet-squat',
        name: 'Goblet squat',
        planned: [
          { weight: 18, reps: 9 },
          { weight: 18, reps: 9 },
        ],
        performed: [
          { weight: 18, reps: 9, done: false, completedAt: null },
          { weight: 18, reps: 9, done: false, completedAt: null },
        ],
      },
    ],
  });
}

const doneSets = (workout: WorkoutRecord) =>
  workout.exercises.reduce(
    (total, exercise) => total + exercise.performed.filter((set) => set.done).length,
    0,
  );

/** localStorage the way the app uses it, so save/load runs the real path. */
function withStorage<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    },
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('skipping an unstarted exercise records no set and moves to the next exercise', () => {
  const before = session();
  const after = skipExercise(before, 0);

  assert.equal(after.exercises[0].skipped, true);
  // No fake logged set, no training credit, no target reduction.
  assert.equal(doneSets(after), 0);
  assert.equal(after.exercises[0].performed.every((set) => !set.done), true);
  assert.deepEqual(after.exercises[0].planned, before.exercises[0].planned);
  const progress = sessionProgress(after);
  assert.equal(progress.done, 0);
  assert.equal(progress.skipped, 3);
  assert.equal(progress.volume, 0);
  // The remaining work is what advances, not the plan.
  assert.equal(pendingExerciseIndex(after), 1);
});

test('logging one set then skipping keeps that actual exactly once and skips only the rest', () => {
  const logged = logSet(session(), 0, 0, START);
  const skipped = skipExercise(logged, 0);

  assert.equal(doneSets(skipped), 1);
  assert.deepEqual(
    skipped.exercises[0].performed.map((set) => set.done),
    [true, false, false],
  );
  assert.equal(sessionProgress(skipped).skipped, 2);

  const returned = unskipExercise(skipped, 0);
  // Exactly the pending budget comes back; nothing is re-prescribed. Absent
  // means not skipped, so older records and this one agree.
  assert.equal(returned.exercises[0].skipped, undefined);
  assert.equal(pendingExerciseIndex(returned), 0);
  assert.deepEqual(returned.exercises[0].planned, logged.exercises[0].planned);
  assert.deepEqual(
    returned.exercises[0].performed.map((set) => set.done),
    [true, false, false],
  );
  assert.equal(pendingExerciseIndex(returned), 0);
});

test('repeated skips apply once, and a session with nothing pending is never re-skipped', () => {
  const once = skipExercise(session(), 0);
  const twice = skipExercise(once, 0);
  assert.deepEqual(twice, once);

  const allDone = [0, 1, 2].reduce(
    (workout, setIndex) => logSet(workout, 0, setIndex, START),
    session(),
  );
  const untouched = allDone;
  assert.equal(skipExercise(untouched, 0), untouched);
  assert.equal(unskipExercise(untouched, 0), untouched);

  // An out-of-range or stale index changes nothing at all.
  const stale = session();
  assert.equal(skipExercise(stale, 9), stale);
  assert.equal(skipExercise(stale, -1), stale);
});

test('skip state survives a validated save and reload, and an old record without it stays valid', () => {
  const skipped = completeSession(skipExercise(logSet(session(), 0, 0, START), 0), {
    early: true,
    now: FINISH,
  });
  const state = { ...EMPTY_STATE, profile, history: [skipped], current: null };

  withStorage(() => {
    assert.equal(saveState(state, 0).ok, true);
    const loaded = loadState();
    assert.equal(loaded.status, 'ok');
    const [saved] = loaded.state.history;
    assert.equal(saved.exercises[0].skipped, true);
    assert.equal(saved.exercises[1].skipped, undefined);
    assert.deepEqual(saved.exercises[0].performed, skipped.exercises[0].performed);
    assert.deepEqual(saved.exercises[0].planned, skipped.exercises[0].planned);
    assert.equal(saved.status, 'completed');
  });

  // Records and backups written before this field existed remain valid.
  const legacy = JSON.parse(JSON.stringify(state.history[0])) as WorkoutRecord;
  delete (legacy.exercises[0] as { skipped?: boolean }).skipped;
  assert.equal(validateState({ ...EMPTY_STATE, profile, history: [legacy], current: null }).ok, true);

  const invalid = JSON.parse(JSON.stringify(state.history[0])) as WorkoutRecord;
  (invalid.exercises[0] as unknown as { skipped: string }).skipped = 'yes';
  assert.equal(
    validateState({ ...EMPTY_STATE, profile, history: [invalid], current: null }).ok,
    false,
  );
});

test('finishing an all-skipped remainder is recorded as early with honest counts', () => {
  const skipped = skipExercise(session(), 0);
  const state = applyFinish({ ...EMPTY_STATE, profile, current: skipped }, skipped.id, {
    early: true,
    now: FINISH,
  });
  assert.equal(state.current, null);
  const record = state.history[0];
  assert.equal(record.status, 'completed');
  assert.equal(record.completedEarly, true);
  assert.equal(doneSets(record), 0);
  assert.equal(record.exercises[0].skipped, true);
  assert.equal(sessionProgress(record).skipped, 3);
  assert.equal(sessionProgress(record).complete, false);
});

test('a skipped or partly logged session cannot earn a load increase', () => {
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  const history = (workout: WorkoutRecord) => [workout];

  const allSkipped = completeSession(skipExercise(session(), 0), { early: true, now: FINISH });
  const partlyLogged = completeSession(skipExercise(logSet(session(), 0, 0, START), 0), {
    early: true,
    now: FINISH,
  });
  const finished = completeSession(
    [0, 1, 2].reduce((workout, setIndex) => logSet(workout, 0, setIndex, START), session()),
    { early: false, now: FINISH },
  );

  // Nothing logged: the same prescription comes back, never more load.
  const afterSkip = prescribeExercise(press, profile, history(allSkipped));
  assert.equal(afterSkip.basis, 'repeat');
  assert.equal(afterSkip.weight, 15);

  // One of three sets logged is unfinished, so the load repeats as well.
  const afterPartial = prescribeExercise(press, profile, history(partlyLogged));
  assert.equal(afterPartial.basis, 'repeat');
  assert.equal(afterPartial.weight, 15);

  // The same three sets completed is a real reason to progress, which is why
  // the two results above mean something.
  const afterFull = prescribeExercise(press, profile, history(finished));
  assert.notEqual(afterFull.basis, 'repeat');
});
