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
import type { AppState, WorkoutRecord } from '../src/types.ts';

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

test('legacy backups can also be restored through the import path', () => {
  const parsed = parseState(FIXTURE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.migrated, true);
  assert.equal(parsed.state.history[0].id, 'nn7i3ndqmvr4zife');
  assert.equal(parsed.state.current?.status, 'active');
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
