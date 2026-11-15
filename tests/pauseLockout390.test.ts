// (#390) An overnight rest-timer pause must never lock the lifter out of their data: the writer caps
// paused time at 24 h, and the loader drops a bad timer value instead of failing the whole record.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { GYM_ITEM_IDS } from '../src/data/gymItems.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { completeSession, createSession, logSet, toggleRestPause } from '../src/lib/session.ts';
import { STORAGE_KEY, loadState, saveState } from '../src/lib/storage.ts';
import { MAX_PAUSE_MS, SCHEMA_VERSION, APP_MARKER, validateState } from '../src/lib/validate.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

const OVERNIGHT = 89_910_000; // Pause 18:01, Resume 19:00 the next day (the issue's case).
const TIMER_FIELDS = ['pausedMs', 'restPausedMs', 'restSeconds'] as const;

function installStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return data.size; },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => { data.delete(key); },
      setItem: (key: string, value: string) => { data.set(key, String(value)); },
    },
    configurable: true,
    writable: true,
  });
  return data;
}

function open(id: string, now: string): WorkoutRecord {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 45, equipment: 'gym' }, [], undefined);
  return createSession({ id, name: adapted.name, dayIndex: 0, slotId: 'slot-a', slotSeq: 0, planRevision: 0, exercises: toWorkoutExercises(adapted), now, durationMin: 45 });
}

/** A session with every optional exercise field a lifter can produce: a superset, a note, a swap split, a skip, a today-only setup. */
function decorated(session: WorkoutRecord): WorkoutRecord {
  const [a, b, c, d] = session.exercises;
  return {
    ...session,
    exercises: [
      { ...a, pair: 1, note: 'seat 4' },
      { ...b, pair: 1 },
      { ...c, originalPlannedSets: c.planned.length + 1, setup: 'home' },
      { ...d, skipped: true },
      ...session.exercises.slice(4),
    ],
  };
}

function fullState(): AppState {
  const profile: Profile = {
    goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
    equipment: ['Barbell', 'Dumbbell', 'Cable'], support: ['Bench', 'Rack'], exclusions: ['burpee'],
    loads: { Dumbbell: [5, 10, 15, 20] }, name: 'Sam', unit: 'kg', sessionMinutes: 45,
    preferences: { 'push-up': 'less' }, pairExercises: true, gymItems: [GYM_ITEM_IDS[0]],
  };
  const done = completeSession(
    logSet(logSet(decorated(open('w1', '2026-11-10T18:00:00.000Z')), 0, 0, '2026-11-10T18:05:00.000Z'), 1, 0, '2026-11-10T18:07:00.000Z'),
    { early: true, now: '2026-11-10T19:00:00.000Z' },
  );
  // Mid-rest, paused, with paused time already banked.
  let current = logSet(decorated(open('w2', '2026-11-12T18:00:00.000Z')), 0, 0, '2026-11-12T18:05:00.000Z', 90);
  current = toggleRestPause(current, '2026-11-12T18:05:30.000Z');
  current = toggleRestPause(current, '2026-11-12T18:06:00.000Z');
  current = toggleRestPause(current, '2026-11-12T18:06:10.000Z');
  return {
    profile,
    plan: buildPlan(profile),
    history: [done],
    current,
    todayOverride: {
      date: '2026-11-12', minutes: 30, equipment: ['Dumbbell'], support: ['Bench'],
      appliedAt: '2026-11-12T17:55:00.000Z', choice: 'hotel',
    },
    planRevision: 0,
    programCursor: { revision: 0, seq: 1 },
    slotSkips: [{ id: 'skip:0:3', revision: 0, seq: 3, slotId: 'slot-d', at: '2026-11-11T08:00:00.000Z' }],
    lastBackupAt: '2026-11-09T09:00:00.000Z',
    installNoteDismissals: ['2026-11-08T09:00:00.000Z'],
  };
}

/** What a reader sees: undefined-valued keys are not part of a stored state. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function envelope(state: unknown): string {
  return JSON.stringify({ app: APP_MARKER, schemaVersion: SCHEMA_VERSION, revision: 3, savedAt: '2026-11-13T19:00:00.000Z', state });
}

test('the writer caps paused rest time at 24 h', () => {
  assert.equal(MAX_PAUSE_MS, 86_400_000);
  const resting = logSet(open('w', '2026-11-12T17:55:00.000Z'), 0, 0, '2026-11-12T18:00:00.000Z');
  const paused = toggleRestPause(resting, '2026-11-12T18:01:00.000Z');
  const resumed = toggleRestPause(paused, '2026-11-13T19:00:00.000Z'); // 25 h minus a minute
  assert.equal(resumed.restPausedMs, MAX_PAUSE_MS);
  assert.equal(resumed.restPausedAt, null);
  // A second long pause on top cannot push it past the cap either.
  const again = toggleRestPause(toggleRestPause(resumed, '2026-11-13T19:01:00.000Z'), '2026-11-14T20:00:00.000Z');
  assert.equal(again.restPausedMs, MAX_PAUSE_MS);
  // A short pause is untouched.
  const short = toggleRestPause(toggleRestPause(resting, '2026-11-12T18:01:00.000Z'), '2026-11-12T18:01:30.000Z');
  assert.equal(short.restPausedMs, 30_000);
});

test('pause 25 h, then resume: the saved state passes validateState and loads', () => {
  const state = fullState();
  const paused = toggleRestPause(logSet(state.current!, 1, 0, '2026-11-12T18:10:00.000Z'), '2026-11-12T18:11:00.000Z');
  const resumed = toggleRestPause(paused, '2026-11-13T19:11:00.000Z');
  const next: AppState = { ...state, current: resumed };
  const result = validateState(plain(next));
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.equal(result.state.current?.restPausedMs, MAX_PAUSE_MS);

  // Through the real save and load, and still loadable once the workout moves into history.
  installStorage();
  assert.ok(saveState(next, 0).ok);
  const loaded = loadState();
  assert.equal(loaded.status, 'ok', loaded.error);
  const finished: AppState = { ...next, history: [completeSession(resumed, { early: true, now: '2026-11-13T19:30:00.000Z' }), ...next.history], current: null };
  assert.ok(saveState(finished, loaded.revision).ok);
  assert.equal(loadState().status, 'ok');
});

test('a record already stored with restPausedMs 89,910,000 loads again, with only that field dropped', () => {
  const state = fullState();
  const stored = plain(state);
  stored.current.restPausedMs = OVERNIGHT;
  stored.history[0].restPausedMs = OVERNIGHT;
  installStorage({ [STORAGE_KEY]: envelope(stored) });
  const loaded = loadState();
  assert.equal(loaded.status, 'ok', loaded.error);
  assert.equal(loaded.state.current?.restPausedMs, undefined);
  assert.equal(loaded.state.history[0].restPausedMs, undefined);
  // Nothing else is lost: every workout, exercise and set reads back exactly.
  const expected = plain(state);
  delete expected.current.restPausedMs;
  delete expected.history[0].restPausedMs;
  assert.deepEqual(plain(loaded.state), expected);
});

test('a bad timer value is dropped on current and on every history entry, whatever its kind', () => {
  const bad: Record<(typeof TIMER_FIELDS)[number], unknown[]> = {
    pausedMs: [-1, Number.NaN, Number.POSITIVE_INFINITY, '5000', null, true, MAX_PAUSE_MS + 1, OVERNIGHT],
    restPausedMs: [-1, Number.NaN, Number.POSITIVE_INFINITY, '5000', null, true, MAX_PAUSE_MS + 1, OVERNIGHT],
    restSeconds: [-1, Number.NaN, '75', null, 75.5, 901, 1e9],
  };
  for (const field of TIMER_FIELDS) {
    for (const value of bad[field]) {
      const stored = plain(fullState());
      stored.current[field] = value;
      stored.history[0][field] = value;
      const result = validateState(stored);
      assert.ok(result.ok, `${field}=${String(value)}: ${result.ok ? '' : result.error}`);
      assert.equal(result.state.current?.[field], undefined, `${field}=${String(value)} dropped on current`);
      assert.equal(result.state.history[0][field], undefined, `${field}=${String(value)} dropped in history`);
      assert.equal(result.state.history[0].exercises.length, fullState().history[0].exercises.length);
    }
  }
});

test('a missing timer field still loads as absent, and the edges of the range are kept', () => {
  for (const field of TIMER_FIELDS) {
    const stored = plain(fullState());
    delete stored.current[field];
    delete stored.history[0][field];
    const result = validateState(stored);
    assert.ok(result.ok, result.ok ? '' : result.error);
    assert.equal(result.state.current?.[field], undefined);
  }
  const edges = plain(fullState());
  Object.assign(edges.current, { pausedMs: 0, restPausedMs: MAX_PAUSE_MS, restSeconds: 900 });
  Object.assign(edges.history[0], { pausedMs: MAX_PAUSE_MS, restPausedMs: 0, restSeconds: 0 });
  const result = validateState(edges);
  assert.ok(result.ok);
  assert.deepEqual(
    [result.state.current?.pausedMs, result.state.current?.restPausedMs, result.state.current?.restSeconds],
    [0, MAX_PAUSE_MS, 900],
  );
  assert.deepEqual(
    [result.state.history[0].pausedMs, result.state.history[0].restPausedMs, result.state.history[0].restSeconds],
    [MAX_PAUSE_MS, 0, 0],
  );
});

test('every other workout field keeps its strictness', () => {
  const cases: [string, (state: ReturnType<typeof plain>) => void][] = [
    ['durationMin', (s) => { s.current.durationMin = -1; }],
    ['pausedAt', (s) => { s.current.pausedAt = 'not a date'; }],
    ['restStartedAt', (s) => { s.history[0].restStartedAt = 42; }],
    ['restPausedAt', (s) => { s.current.restPausedAt = 'yesterday'; }],
    ['weight', (s) => { s.history[0].exercises[0].performed[0].weight = 99_999; }],
    ['status', (s) => { s.current.status = 'paused'; }],
  ];
  for (const [name, breakIt] of cases) {
    const stored = plain(fullState());
    breakIt(stored);
    assert.equal(validateState(stored).ok, false, `${name} still fails`);
  }
});

test('save, then load, over a fully populated state gives the same state back', () => {
  const state = fullState();
  // The fixture really is fully populated.
  assert.ok(state.current?.restStartedAt && state.current.restPausedAt && (state.current.restPausedMs ?? 0) > 0);
  assert.ok(state.history[0].exercises.some((e) => e.pair) && state.history[0].exercises.some((e) => e.note));
  assert.ok(state.history[0].exercises.some((e) => e.originalPlannedSets) && state.history[0].exercises.some((e) => e.skipped));
  const direct = validateState(plain(state));
  assert.ok(direct.ok, direct.ok ? '' : direct.error);
  assert.deepEqual(plain(direct.state), plain(state));

  installStorage();
  assert.ok(saveState(state, 0).ok);
  const loaded = loadState();
  assert.equal(loaded.status, 'ok', loaded.error);
  assert.deepEqual(plain(loaded.state), plain(state));
});

test('Restore on Recovery keeps the unreadable original first, like Start fresh (#390)', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const restore = source.match(/onRestore=\{\(next: AppState, summary: ImportSummary\) => \{([\s\S]*?)\}\}\n/);
  assert.ok(restore, 'the Recovery onRestore handler is found');
  const body = restore[1];
  const backup = body.indexOf('if (recovery.raw) backupRaw(recovery.raw);');
  assert.ok(backup >= 0, 'onRestore backs up the raw text, guarded for no raw');
  assert.ok(backup < body.indexOf('setState(next)'), 'the backup happens before the restored state replaces it');
  assert.equal((source.match(/fitbod-clone-v1:corrupt-backup/g) ?? []).length, 1, 'no new stored key: one corrupt-backup key');
});
