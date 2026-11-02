import assert from 'node:assert/strict';
import test from 'node:test';
import { latestFeedback, setWorkoutFeedback } from '../src/lib/feedback.ts';
import { completeSession, createSession } from '../src/lib/session.ts';
import { EMPTY_STATE, loadState, mergeImport, saveState, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const START = '2026-01-01T10:00:00.000Z';
const FINISH = '2026-01-01T11:00:00.000Z';
const NEXT_DAY = '2026-01-02T10:00:00.000Z';

const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {},
};

function workout(id: string, date: string): WorkoutRecord {
  const session = createSession({
    id,
    name: 'Full body A',
    dayIndex: 0,
    now: date,
    exercises: [
      {
        exerciseId: 'dumbbell-floor-press',
        name: 'Dumbbell floor press',
        planned: [{ weight: 15, reps: 9 }],
        performed: [{ weight: 15, reps: 9, done: true, completedAt: date }],
      },
    ],
  });
  return completeSession(session, { early: false, now: date === START ? FINISH : date });
}

function stateWith(history: WorkoutRecord[]) {
  return { ...EMPTY_STATE, profile, history, current: null };
}

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

test('feedback attaches to one workout only, and clearing leaves no value behind', () => {
  const first = workout('w-1', START);
  const second = workout('w-2', NEXT_DAY);
  const before = stateWith([first, second]);

  const after = setWorkoutFeedback(before, 'w-1', 'about-right');
  assert.equal(after.history[0].feedback, 'about-right');
  // The other workout stays independent.
  assert.equal(after.history[1].feedback, undefined);
  assert.equal(before.history[0].feedback, undefined);

  const changed = setWorkoutFeedback(after, 'w-1', 'too-much');
  assert.equal(changed.history[0].feedback, 'too-much');

  const cleared = setWorkoutFeedback(changed, 'w-1', null);
  // Absent means "no answer", so nothing stale is left to read.
  assert.equal('feedback' in cleared.history[0], false);
  assert.equal(cleared.history[0].sets === undefined, true);
  assert.deepEqual(cleared.history[0].exercises, first.exercises);

  // A stale id or a different workout cannot attach a value.
  const stale = setWorkoutFeedback(before, 'w-missing', 'too-little');
  assert.equal(stale, before);
});

test('feedback survives a validated save and reload, and older records stay valid', () => {
  const state = setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', 'too-little');

  withStorage(() => {
    assert.equal(saveState(state, 0).ok, true);
    const loaded = loadState();
    assert.equal(loaded.status, 'ok');
    assert.equal(loaded.state.history[0].feedback, 'too-little');
    assert.equal(loaded.state.history.length, 1);
  });

  const legacy = JSON.parse(JSON.stringify(state.history[0])) as WorkoutRecord;
  delete (legacy as { feedback?: string }).feedback;
  assert.equal(validateState(stateWith([legacy])).ok, true);

  const invalid = JSON.parse(JSON.stringify(state.history[0])) as WorkoutRecord;
  (invalid as unknown as { feedback: string }).feedback = 'amazing';
  const rejected = validateState(stateWith([invalid]));
  assert.equal(rejected.ok, false);
});

test('export and restore round-trip feedback by workout id without duplicating the workout', () => {
  const state = setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', 'about-right');
  const parsed = parseState(serializeExport(state));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.state.history.length, 1);
  assert.equal(parsed.state.history[0].id, 'w-1');
  assert.equal(parsed.state.history[0].feedback, 'about-right');

  const merged = mergeImport(parsed.state, parsed.state);
  assert.equal(merged.state.history.length, 1);
  assert.equal(merged.summary.duplicateWorkouts, 1);
  assert.equal(merged.state.history[0].feedback, 'about-right');
});

test('clearing then exporting removes the answer from the file that is restored', () => {
  const answered = setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', 'too-much');
  const cleared = setWorkoutFeedback(answered, 'w-1', null);
  // The exported file itself carries no answer at all.
  assert.equal(serializeExport(cleared).includes('"feedback"'), false);
  const exported = parseState(serializeExport(cleared));
  assert.equal(exported.ok, true);
  if (!exported.ok) return;
  assert.equal(exported.state.history[0].feedback, undefined);

  // Restoring that file onto the same cleared data cannot resurrect the answer
  // and cannot duplicate the workout.
  const merged = mergeImport(cleared, exported.state);
  assert.equal(merged.state.history.length, 1);
  assert.equal(merged.state.history[0].feedback, undefined);
  assert.equal(merged.summary.feedbackPreserved, 0);
});

test('an older backup cannot silently erase retained feedback', () => {
  const older = stateWith([workout('w-1', START)]);
  const current = setWorkoutFeedback(older, 'w-1', 'about-right');

  const merged = mergeImport(current, older);
  assert.equal(merged.state.history.length, 1);
  assert.equal(merged.state.history[0].feedback, 'about-right');
  // Not silent: the summary says a retained answer was kept.
  assert.equal(merged.summary.feedbackPreserved, 1);
});

test('Coach sees the latest dated feedback with its source workout, or nothing', () => {
  assert.equal(latestFeedback([]), null);

  const blank = stateWith([workout('w-1', START)]);
  assert.equal(latestFeedback(blank.history), null);

  const answered = setWorkoutFeedback(
    setWorkoutFeedback(blank, 'w-1', 'too-much'),
    'w-2',
    'about-right',
  );
  const withNewer = stateWith([...answered.history, workout('w-2', NEXT_DAY)]);
  const latest = latestFeedback(setWorkoutFeedback(withNewer, 'w-2', 'about-right').history);
  assert.ok(latest);
  assert.equal(latest.feedback, 'about-right');
  assert.equal(latest.workout.id, 'w-2');
  assert.equal(latest.workout.name, 'Full body A');
  assert.equal(latest.workout.date, NEXT_DAY);

  // Clearing the latest one falls back to the older retained answer, never to a guess.
  const clearedLatest = setWorkoutFeedback(withNewer, 'w-2', null);
  assert.equal(latestFeedback(clearedLatest.history)?.workout.id, 'w-1');
  assert.equal(setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', null).history[0].feedback, undefined);
});

test('deleting a workout takes its feedback with it', () => {
  const answered = setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', 'too-much');
  const deleted = { ...answered, history: answered.history.filter((item) => item.id !== 'w-1') };
  assert.equal(deleted.history.length, 0);
  assert.equal(latestFeedback(deleted.history), null);
});

test('feedback is the user s own answer, not a training signal', () => {
  const answered = setWorkoutFeedback(stateWith([workout('w-1', START)]), 'w-1', 'too-little');
  const record = answered.history[0];
  // Logged work is untouched by an assessment: no sets, no targets, no progression.
  assert.deepEqual(record.exercises, workout('w-1', START).exercises);
  assert.equal(record.completedEarly, false);
  assert.deepEqual(Object.keys(record).sort(), [
    'completedEarly', 'date', 'dayIndex', 'durationMin', 'endedAt', 'exercises', 'feedback', 'id',
    'name', 'pausedAt', 'pausedMs', 'restPausedAt', 'restPausedMs', 'restSeconds', 'restStartedAt', 'status',
  ].sort());
});
