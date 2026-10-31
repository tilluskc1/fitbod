import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EMPTY_STATE,
  LEGACY_BACKUP_KEY,
  STORAGE_KEY,
  loadState,
  mergeImport,
  saveState,
  serializeExport,
} from '../src/lib/storage.ts';
import { parseState } from '../src/lib/validate.ts';
import {
  applyFinish,
  createSession,
  logSet,
  swapPendingExercise,
} from '../src/lib/session.ts';
import type { AppState, WorkoutExercise, WorkoutRecord } from '../src/types.ts';

const FIXTURE = readFileSync(new URL('./fixtures/v1-state.json', import.meta.url), 'utf8');

function installStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  let failure: Error | null = null;

  const fake = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (failure) throw failure;
      data.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  });

  return {
    data,
    failWrites: () => {
      failure = new Error('quota');
      failure.name = 'QuotaExceededError';
    },
    allowWrites: () => {
      failure = null;
    },
    removeStorage: () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    },
  };
}

function record(id: string, name = 'Push'): WorkoutRecord {
  return {
    id,
    date: '2026-01-01T10:00:00.000Z',
    name,
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: '2026-01-01T11:00:00.000Z',
    exercises: [
      {
        exerciseId: 'push-up',
        name: 'Push-Up',
        planned: [{ weight: 0, reps: 10 }],
        performed: [{ weight: 0, reps: 10, done: true, completedAt: '2026-01-01T11:00:00.000Z' }],
      },
    ],
  };
}

function activeRecord(id: string): WorkoutRecord {
  return { ...record(id, 'Pull'), status: 'active', endedAt: null };
}

test('v1 data migrates in place, preserving history identity and set values', () => {
  const storage = installStorage({ [STORAGE_KEY]: FIXTURE });
  const loaded = loadState();

  assert.equal(loaded.status, 'migrated');
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.state.history.length, 1);
  assert.equal(loaded.state.history[0].id, 'nn7i3ndqmvr4zife');
  assert.equal(loaded.state.history[0].date, '2026-10-27T20:27:04.586Z');
  assert.equal(loaded.state.history[0].exercises[0].performed[0].done, false);
  assert.deepEqual(loaded.state.history[0].exercises[0].planned[0], { weight: 0, reps: 10 });
  assert.equal(loaded.state.current?.id, 'dq9aetd6mvr59g6m');
  assert.equal(loaded.state.current?.dayIndex, 1);
  assert.equal(loaded.state.current?.status, 'active');
  assert.deepEqual(loaded.state.profile?.support, []);
  assert.deepEqual(loaded.state.profile?.exclusions, []);
  assert.deepEqual(loaded.state.profile?.loads, {});
  assert.equal(loaded.state.history[0].completedEarly, true);

  const stored = JSON.parse(storage.data.get(STORAGE_KEY) ?? '{}');
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.revision, 1);
  assert.equal(storage.data.get(LEGACY_BACKUP_KEY), FIXTURE);
});

test('unreadable or invalid stored data is reported and never overwritten on load', () => {
  const broken = installStorage({ [STORAGE_KEY]: '{not json' });
  const first = loadState();
  assert.equal(first.status, 'corrupt');
  assert.equal(broken.data.get(STORAGE_KEY), '{not json');
  assert.equal(first.raw, '{not json');

  const invalid = installStorage({
    [STORAGE_KEY]: JSON.stringify({ profile: null, history: [], current: null }),
  });
  const second = loadState();
  assert.equal(second.status, 'corrupt');
  assert.match(second.error ?? '', /plan/);
  assert.equal(invalid.data.get(STORAGE_KEY), JSON.stringify({ profile: null, history: [], current: null }));
});

test('saves are revision-checked, verified, and refuse to clobber newer data', () => {
  const storage = installStorage();

  const first = saveState(EMPTY_STATE, 0);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.revision, 1);

  const stale = saveState({ ...EMPTY_STATE, history: [record('local')] }, 0);
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.reason, 'stale');
  assert.equal(stale.remoteRevision, 1);

  const stored = JSON.parse(storage.data.get(STORAGE_KEY) ?? '{}');
  assert.equal(stored.revision, 1);
  assert.equal(stored.state.history.length, 0);

  const second = saveState(EMPTY_STATE, 1);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.revision, 2);
});

test('a failed write is reported honestly and leaves storage unchanged', () => {
  const storage = installStorage();
  storage.failWrites();

  const failed = saveState(EMPTY_STATE, 0);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.reason, 'quota');
  assert.equal(storage.data.size, 0);

  storage.allowWrites();
  const retried = saveState(EMPTY_STATE, 0);
  assert.equal(retried.ok, true);
});

test('a throwing verification read stays unsaved and Retry verifies the existing write once', () => {
  installStorage();
  const store = globalThis.localStorage;
  const read = store.getItem;
  let reads = 0;
  store.getItem = (key) => {
    if (++reads === 2) throw new Error('read-back unavailable');
    return read(key);
  };
  const state = { ...EMPTY_STATE, history: [record('saved-once')] };
  const failed = saveState(state, 0);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.reason, 'verify');
  store.getItem = read;
  const retried = saveState(state, 0, { pendingWrite: failed.pendingWrite });
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.revision, 1);
  const loaded = loadState();
  assert.equal(loaded.status, 'ok');
  assert.deepEqual(loaded.state.history.map((workout) => workout.id), ['saved-once']);
});

test('an unverified write allows later edits but never authorizes another tab’s state', () => {
  installStorage();
  const store = globalThis.localStorage;
  const read = store.getItem;
  let failRead = false;
  const write = store.setItem;
  store.setItem = (key, value) => { write(key, value); failRead = true; };
  store.getItem = (key) => {
    if (failRead) throw new Error('read-back unavailable');
    return read(key);
  };
  const first = saveState(EMPTY_STATE, 0);
  assert.equal(first.ok, false);
  if (first.ok) return;
  store.getItem = read;
  store.setItem = write;
  const state = { ...EMPTY_STATE, history: [record('edited-after-failure')] };
  const edited = saveState(state, 0, { pendingWrite: first.pendingWrite });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.revision, 2);
  assert.deepEqual(loadState().state.history.map((workout) => workout.id), ['edited-after-failure']);

  // Even a competing write at the same revision must not match our receipt.
  const other = JSON.parse(first.pendingWrite ?? '{}');
  other.state.history = [record('other-tab')];
  write(STORAGE_KEY, JSON.stringify(other));
  const stale = saveState(state, 0, { pendingWrite: first.pendingWrite });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.reason, 'stale');
  assert.deepEqual(loadState().state.history.map((workout) => workout.id), ['other-tab']);
});

test('repeated verification-read failures retain edits until a readable Retry', () => {
  installStorage();
  const store = globalThis.localStorage;
  const read = store.getItem;
  const write = store.setItem;
  let failRead = false;
  store.getItem = (key) => {
    if (failRead) throw new Error('read-back unavailable');
    return read(key);
  };
  store.setItem = (key, value) => { write(key, value); failRead = true; };
  const first = saveState(EMPTY_STATE, 0);
  assert.equal(first.ok, false);
  if (first.ok) return;
  failRead = false;
  const state = { ...EMPTY_STATE, history: [record('latest-edit')] };
  const second = saveState(state, 0, { pendingWrite: first.pendingWrite });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.reason, 'verify');
  failRead = false;
  const retry = saveState(state, 0, { pendingWrite: second.pendingWrite });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.revision, 2);
  assert.deepEqual(loadState().state.history.map((workout) => workout.id), ['latest-edit']);
});

test('storage unavailability is surfaced instead of pretending to save', () => {
  const storage = installStorage();
  storage.removeStorage();

  assert.equal(loadState().status, 'unavailable');
  const saved = saveState(EMPTY_STATE, 0);
  assert.equal(saved.ok, false);
  if (saved.ok) return;
  assert.equal(saved.reason, 'unavailable');
});

test('a swap split preserves its original requirement through export and restore', () => {
  const state: AppState = {
    ...EMPTY_STATE,
    history: [
      {
        id: 'w-seg',
        date: '2026-02-01T10:00:00.000Z',
        name: 'Full body A',
        dayIndex: 0,
        status: 'completed',
        completedEarly: true,
        endedAt: '2026-02-01T11:00:00.000Z',
        exercises: [
          {
            exerciseId: 'dumbbell-floor-press',
            name: 'Dumbbell floor press',
            originalPlannedSets: 3,
            planned: [{ weight: 10, reps: 10 }],
            performed: [
              { weight: 10, reps: 10, done: true, completedAt: '2026-02-01T10:05:00.000Z' },
            ],
          },
          {
            exerciseId: 'dumbbell-floor-press',
            name: 'Dumbbell floor press',
            originalPlannedSets: 3,
            planned: [{ weight: 10, reps: 10 }],
            performed: [
              { weight: 10, reps: 10, done: false, completedAt: null },
            ],
          },
        ],
      },
    ],
  };

  const parsed = parseState(serializeExport(state, '2026-02-02T10:00:00.000Z'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const exercises = parsed.state.history[0].exercises;
  assert.deepEqual(
    exercises.map((exercise) => exercise.originalPlannedSets),
    [3, 3],
  );
});

test('export round-trips performed values and restore is idempotent', () => {
  installStorage({ [STORAGE_KEY]: FIXTURE });
  const loaded = loadState();
  assert.equal(loaded.status, 'migrated');

  const state: AppState = {
    ...loaded.state,
    history: loaded.state.history.map((workout) => ({
      ...workout,
      exercises: workout.exercises.map((exercise) => ({
        ...exercise,
        performed: exercise.performed.map((set, index) =>
          index === 0
            ? { weight: 22.5, reps: 8, done: true, completedAt: '2026-02-01T10:00:00.000Z' }
            : set,
        ),
      })),
    })),
  };

  const text = serializeExport(state, '2026-02-02T10:00:00.000Z');
  const parsed = parseState(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const workout = parsed.state.history[0];
  assert.equal(workout.id, state.history[0].id);
  assert.equal(workout.exercises[0].performed[0].weight, 22.5);
  assert.equal(workout.exercises[0].performed[0].reps, 8);
  assert.deepEqual(workout.exercises[0].planned[0], { weight: 0, reps: 10 });

  const first = mergeImport(EMPTY_STATE, parsed.state);
  assert.equal(first.summary.newWorkouts, 1);
  assert.equal(first.summary.duplicateWorkouts, 0);
  assert.equal(first.state.history.length, 1);

  const second = mergeImport(first.state, parsed.state);
  assert.equal(second.summary.newWorkouts, 0);
  assert.equal(second.summary.duplicateWorkouts, 1);
  assert.equal(second.state.history.length, 1);
});

test('malformed and incompatible restore files are rejected', () => {
  assert.equal(parseState('not json').ok, false);
  assert.equal(parseState('{"foo":1}').ok, false);
  assert.equal(
    parseState(
      JSON.stringify({
        app: 'fitbod-clone',
        schemaVersion: 2,
        exportedAt: '2026-01-01T00:00:00.000Z',
        state: { profile: null, history: [], current: null },
      }),
    ).ok,
    false,
  );

  const mismatched = JSON.parse(JSON.stringify({ ...EMPTY_STATE, plan: [], history: [record('x')] })) as {
    history: { exercises: { planned: unknown[]; performed: unknown[] }[] }[];
  };
  mismatched.history[0].exercises[0].performed = [];
  assert.equal(parseState(JSON.stringify(mismatched)).ok, false);
});

test('incompatible backup wrappers cannot change good saved data', () => {
  for (const metadata of [
    { app: 'some-other-app', schemaVersion: 2 },
    { app: 'fitbod-clone', schemaVersion: 99 },
    { schemaVersion: 2 },
    { app: 'fitbod-clone' },
    {},
  ]) {
    const storage = installStorage({ [STORAGE_KEY]: FIXTURE });
    const local = loadState();
    const before = storage.data.get(STORAGE_KEY);
    const incoming = { ...local.state, history: [record('incompatible-workout')] };
    const parsed = parseState(JSON.stringify({ ...metadata, state: incoming }));
    // Exercise the same accepted-import chain as the App restore handler.
    if (parsed.ok) saveState(mergeImport(local.state, parsed.state).state, local.revision);
    assert.equal(parsed.ok, false);
    assert.equal(storage.data.get(STORAGE_KEY), before);
    assert.equal(loadState().revision, local.revision);
    assert.equal(loadState().state.history[0].id, 'nn7i3ndqmvr4zife');
  }
});

test('legacy backups can also be restored through the import path', () => {
  const parsed = parseState(FIXTURE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.migrated, true);
  assert.equal(parsed.state.history[0].id, 'nn7i3ndqmvr4zife');
  assert.equal(parsed.state.current?.status, 'active');
});

test('restoring an older active backup after finish keeps one completed workout on reload', () => {
  installStorage();
  const active = { ...EMPTY_STATE, current: activeRecord('finished-A') };
  const backup = parseState(serializeExport(active));
  assert.equal(backup.ok, true);
  if (!backup.ok) return;
  const finished = applyFinish(active, 'finished-A', { early: false, now: '2026-01-01T11:00:00.000Z' });
  let state = finished;
  let revision = 0;
  for (let restore = 0; restore < 2; restore++) {
    state = mergeImport(state, backup.state).state;
    const saved = saveState(state, revision);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    revision = saved.revision;
    const reopened = loadState();
    assert.equal(reopened.status, 'ok');
    assert.equal(reopened.state.current, null);
    assert.equal(reopened.state.history.length, 1);
    assert.equal(reopened.state.history[0].id, 'finished-A');
    assert.equal(reopened.state.history[0].endedAt, '2026-01-01T11:00:00.000Z');
    assert.deepEqual(reopened.state.history[0].exercises[0].performed, [
      { weight: 0, reps: 10, done: true, completedAt: '2026-01-01T11:00:00.000Z' },
    ]);
    state = reopened.state;
  }
});

test('restore chooses the surviving active session when completed history replaces the other candidate', () => {
  for (const localFinished of [false, true]) {
    installStorage();
    const activeA = { ...EMPTY_STATE, current: activeRecord('workout-A') };
    const completedA = { ...EMPTY_STATE, history: [record('workout-A')], current: activeRecord('workout-B') };
    const local = localFinished ? completedA : activeA;
    const backup = parseState(serializeExport(localFinished ? activeA : completedA));
    assert.equal(backup.ok, true);
    if (!backup.ok) return;
    const merged = mergeImport(local, backup.state);
    assert.equal(merged.state.current?.id, 'workout-B');
    const saved = saveState(merged.state, 0);
    assert.equal(saved.ok, true);
    const reopened = loadState();
    assert.equal(reopened.status, 'ok');
    assert.equal(reopened.state.current?.id, 'workout-B');
    assert.equal(reopened.state.current?.exercises[0].performed[0].reps, 10);
    assert.deepEqual(reopened.state.history.map((workout) => workout.id), ['workout-A']);
  }
});

test('restore keeps local-only workouts and an unrelated active session', () => {
  const profile = {
    goal: 'Build Muscle' as const,
    experience: 'Intermediate' as const,
    daysPerWeek: 3,
    equipment: [],
    support: [],
    exclusions: [],
    loads: {},
  };
  const current = activeRecord('local-active');
  const local: AppState = {
    profile,
    plan: [],
    history: [record('shared'), record('local-only')],
    current,
  };
  const imported: AppState = {
    profile: null,
    plan: [{ name: 'Full Body A', focus: ['Chest', 'Back'] }],
    history: [record('shared'), record('import-only')],
    current: activeRecord('import-active'),
  };

  const merged = mergeImport(local, imported);
  assert.deepEqual(
    merged.state.history.map((workout) => workout.id),
    ['shared', 'import-only', 'local-only'],
  );
  assert.equal(merged.summary.newWorkouts, 1);
  assert.equal(merged.summary.duplicateWorkouts, 1);
  assert.equal(merged.summary.localOnlyWorkouts, 1);
  assert.equal(merged.summary.activeSessionKept, true);
  assert.equal(merged.state.current?.id, 'local-active');
  assert.equal(merged.state.profile?.goal, 'Build Muscle');
});

test('an integrated log, swap, reload, resume and finish keeps each set once', () => {
  installStorage();
  const exercises: WorkoutExercise[] = [
    {
      exerciseId: 'dumbbell-floor-press',
      name: 'Dumbbell floor press',
      originalPlannedSets: 3,
      planned: [
        { weight: 15, reps: 9 },
        { weight: 15, reps: 9 },
        { weight: 15, reps: 9 },
      ],
      performed: [0, 1, 2].map(() => ({ weight: 15, reps: 9, done: false, completedAt: null })),
    },
  ];
  let state: AppState = {
    ...EMPTY_STATE,
    current: createSession({
      id: 's1',
      name: 'Full body A',
      dayIndex: 0,
      exercises,
      now: '2026-02-01T10:00:00.000Z',
    }),
  };
  state = { ...state, current: logSet(state.current!, 0, 0, '2026-02-01T10:05:00.000Z') };
  state = {
    ...state,
    current: swapPendingExercise(state.current!, 0, {
      exerciseId: 'push-up',
      name: 'Push-Up',
      weight: 0,
      reps: 8,
    }),
  };
  state = { ...state, current: logSet(state.current!, 1, 0, '2026-02-01T10:10:00.000Z') };

  const saved = saveState(state, 0);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  // Reopen: the browser is gone, only the stored envelope survives.
  const reopened = loadState();
  assert.equal(reopened.status, 'ok');
  assert.equal(reopened.state.current?.id, 's1');
  assert.deepEqual(
    reopened.state.current?.exercises.map((exercise) => exercise.exerciseId),
    ['dumbbell-floor-press', 'push-up'],
  );
  assert.equal(
    reopened.state.current?.exercises[0].performed[0].completedAt,
    '2026-02-01T10:05:00.000Z',
  );

  const finished = applyFinish(reopened.state, 's1', { early: true, now: '2026-02-01T10:20:00.000Z' });
  const repeated = applyFinish(finished, 's1', { early: true, now: '2026-02-01T10:21:00.000Z' });
  assert.equal(repeated.history.length, 1);
  assert.equal(repeated.current, null);
  assert.deepEqual(
    repeated.history[0].exercises.map((exercise) => exercise.exerciseId),
    ['dumbbell-floor-press', 'push-up'],
  );

  assert.equal(saveState(repeated, saved.revision).ok, true);
  const afterFinish = loadState();
  assert.equal(afterFinish.state.history.length, 1);
  assert.equal(afterFinish.state.current, null);
});

test('explicit recovery save overwrites an unsupported schema with a forward revision', () => {
  const storage = installStorage({
    [STORAGE_KEY]: JSON.stringify({
      app: 'fitbod-clone',
      schemaVersion: 99,
      revision: 7,
      savedAt: '2026-01-01T00:00:00.000Z',
      state: {},
    }),
  });
  assert.equal(loadState().status, 'corrupt');

  const saved = saveState(EMPTY_STATE, 0, { force: true });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.revision, 8);

  const stored = JSON.parse(storage.data.get(STORAGE_KEY) ?? '{}');
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.revision, 8);
});
