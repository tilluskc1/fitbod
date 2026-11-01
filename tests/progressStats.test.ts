import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { applyCorrection, completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { bestCompletedSet } from '../src/lib/plan.ts';
import { validateState } from '../src/lib/validate.ts';
import type { AppState, PerformedSet, WorkoutRecord } from '../src/types.ts';

function set(weight: number, reps: number, done: boolean, completedAt: string | null = null): PerformedSet {
  return { weight, reps, done, completedAt };
}

/* ---------- the selector itself ---------- */

test('the point is one real set: 10 kg × 15 and 18 kg × 5 show 18 kg × 5', () => {
  const best = bestCompletedSet([
    set(10, 15, true, '2026-01-01T10:10:00.000Z'),
    set(18, 5, true, '2026-01-01T10:20:00.000Z'),
  ]);
  assert.equal(best?.weight, 18);
  assert.equal(best?.reps, 5);
});

test('equal load breaks on reps, then the earliest completion, then record order', () => {
  assert.equal(
    bestCompletedSet([
      set(20, 8, true, '2026-01-01T10:00:00.000Z'),
      set(20, 12, true, '2026-01-01T10:30:00.000Z'),
    ])?.reps,
    12,
  );
  assert.equal(
    bestCompletedSet([
      set(20, 8, true, '2026-01-01T10:30:00.000Z'),
      set(20, 8, true, '2026-01-01T10:05:00.000Z'),
    ])?.completedAt,
    '2026-01-01T10:05:00.000Z',
  );
  // Same load, same reps, no timestamp: the first recorded set wins.
  const first = set(20, 8, true, null);
  assert.equal(bestCompletedSet([first, set(20, 8, true, null)]), first);
});

test('uncompleted and skipped rows never become a performance point', () => {
  assert.equal(bestCompletedSet([]), null);
  assert.equal(bestCompletedSet([set(15, 9, false, null), set(20, 5, false, null)]), null);
});

/* ---------- the real session path ---------- */

interface ExercisePlan {
  id: string;
  name: string;
  sets: { weight: number; reps: number }[];
  /** Indexes of the sets the user actually logged. */
  logged: number[];
}

/** A finished workout built the way the app builds one: log, then finish. */
function finished(id: string, date: string, exercises: ExercisePlan[]): WorkoutRecord {
  let session = createSession({
    id,
    name: 'Full body A',
    dayIndex: 0,
    now: date,
    exercises: exercises.map((exercise) => ({
      exerciseId: exercise.id,
      name: exercise.name,
      planned: exercise.sets,
      performed: exercise.sets.map((planned) => ({ ...planned, done: false, completedAt: null })),
    })),
  });
  for (const [index, exercise] of exercises.entries()) {
    for (const setIndex of exercise.logged) {
      session = updatePerformedSet(session, index, setIndex, { done: true }, date);
    }
  }
  return completeSession(session, { early: true, now: date });
}

const EMPTY: AppState = { profile: null, plan: [], history: [], current: null, todayOverride: null };

async function renderProgress(history: WorkoutRecord[]) {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: ProgressScreen } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(ProgressScreen, {
        history,
        unit: 'kg' as const,
        onExport: noop,
        onCorrect: noop,
        onDelete: noop,
        onGoTrain: noop,
      }),
    );
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  } finally {
    await server.close();
  }
}

/** The app's own validator must accept the fixture, or it proves nothing. */
function assertReal(workout: WorkoutRecord) {
  const result = validateState({ ...EMPTY, history: [workout] });
  assert.equal(result.ok, true, result.ok ? '' : result.error);
}

test('Progress prints the load and reps of one completed set, not a mix of two', async () => {
  const workout = finished('w1', '2026-01-01T10:00:00.000Z', [
    {
      id: 'dumbbell-floor-press',
      name: 'Dumbbell floor press',
      sets: [
        { weight: 10, reps: 15 },
        { weight: 18, reps: 5 },
        { weight: 20, reps: 5 },
      ],
      logged: [0, 1],
    },
  ]);
  assertReal(workout);

  const text = await renderProgress([workout]);
  // Per-hand load keeps its qualifier; the pair comes from the 18 kg set alone.
  assert.match(text, /18 kg each × 5/);
  assert.doesNotMatch(text, /18 kg each × 15|20 kg/);
  // The point names the session it came from.
  assert.match(text, /Latest best set · Jan 1 · Full body A/);
});

test('a total-load movement says total, not each', async () => {
  const workout = finished('w1', '2026-01-01T10:00:00.000Z', [
    { id: 'goblet-squat', name: 'Goblet squat', sets: [{ weight: 22, reps: 10 }], logged: [0] },
  ]);
  const text = await renderProgress([workout]);
  assert.match(text, /22 kg total × 10/);
});

test('an exercise that was never logged draws no point at all', async () => {
  const workout = finished('w1', '2026-01-01T10:00:00.000Z', [
    {
      id: 'goblet-squat',
      name: 'Goblet squat',
      sets: [
        { weight: 40, reps: 8 },
        { weight: 40, reps: 8 },
      ],
      logged: [],
    },
  ]);
  assertReal(workout);

  const text = await renderProgress([workout]);
  // Two untouched prescription rows are not a performance of 40 kg.
  assert.doesNotMatch(text, /40 kg/);
  assert.match(text, /No completed sets recorded/);
});

test('both segments after a swap and swap-back feed one point, not two', async () => {
  const text = await renderProgress([
    finished('w1', '2026-01-01T10:00:00.000Z', [
      { id: 'dumbbell-floor-press', name: 'Dumbbell floor press', sets: [{ weight: 15, reps: 10 }], logged: [0] },
      { id: 'dumbbell-floor-press', name: 'Dumbbell floor press', sets: [{ weight: 20, reps: 6 }], logged: [0] },
    ]),
  ]);
  assert.match(text, /20 kg each × 6/);
  assert.equal(text.match(/Latest best set/g)?.length, 1);
});

test('correcting a past set moves the point to the corrected evidence', async () => {
  const workout = finished('w1', '2026-01-01T10:00:00.000Z', [
    {
      id: 'dumbbell-floor-press',
      name: 'Dumbbell floor press',
      sets: [
        { weight: 18, reps: 5 },
        { weight: 10, reps: 15 },
      ],
      logged: [0, 1],
    },
  ]);
  assert.match(await renderProgress([workout]), /18 kg each × 5/);

  // Through the same correction the history editor calls.
  const corrected = applyCorrection({ ...EMPTY, history: [workout] }, 'w1', 0, 0, { weight: 14 }, workout.date);
  const text = await renderProgress(corrected.history);
  assert.match(text, /14 kg each × 5/);
  assert.doesNotMatch(text, /18 kg/);
});

test('a timed hold reads in seconds and a bodyweight movement in reps, never as a zero-kg set', async () => {
  const hold = await renderProgress([
    finished('w1', '2026-01-01T10:00:00.000Z', [
      {
        id: 'plank',
        name: 'Plank',
        sets: [
          { weight: 0, reps: 30 },
          { weight: 0, reps: 45 },
        ],
        logged: [0, 1],
      },
    ]),
  ]);
  assert.match(hold, /45s/);
  assert.doesNotMatch(hold, /Bodyweight ×/);

  const body = await renderProgress([
    finished('w1', '2026-01-01T10:00:00.000Z', [
      { id: 'push-up', name: 'Push-up', sets: [{ weight: 0, reps: 12 }], logged: [0] },
    ]),
  ]);
  assert.match(body, /12 reps/);
  assert.doesNotMatch(body, /Bodyweight ×/);
});
