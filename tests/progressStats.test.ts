import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { bestCompletedSet } from '../src/lib/plan.ts';
import type { PerformedSet, WorkoutExercise, WorkoutRecord } from '../src/types.ts';

function set(weight: number, reps: number, done: boolean, completedAt: string | null = null): PerformedSet {
  return { weight, reps, done, completedAt };
}

function segment(exerciseId: string, name: string, performed: PerformedSet[]): WorkoutExercise {
  return {
    exerciseId,
    name,
    planned: [{ weight: 15, reps: 9 }],
    performed,
  };
}

function workout(id: string, date: string, exercises: WorkoutExercise[]): WorkoutRecord {
  return {
    id,
    date,
    name: 'Full Body A',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: date,
    exercises,
  };
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
  assert.equal(bestCompletedSet([set(20, 8, true, '2026-01-01T10:00:00.000Z'), set(20, 12, true, '2026-01-01T10:30:00.000Z')])?.reps, 12);
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

/* ---------- the screen that prints it ---------- */

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

test('Progress prints the load and reps of one completed set, not a mix of two', async () => {
  const text = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('floor-press', 'Floor press', [
        set(10, 15, true, '2026-01-01T10:10:00.000Z'),
        set(18, 5, true, '2026-01-01T10:20:00.000Z'),
        set(20, 5, false, null),
      ]),
    ]),
  ]);
  assert.match(text, /18 kg × 5/);
  assert.doesNotMatch(text, /18 kg × 15|20 kg/);
});

test('an exercise that was never logged draws no point at all', async () => {
  const text = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('squat', 'Back squat', [set(40, 8, false, null), set(40, 8, false, null)]),
    ]),
  ]);
  // Two untouched prescription rows are not a performance of 40 kg.
  assert.doesNotMatch(text, /40 kg/);
  assert.match(text, /No completed sets recorded/);
});

test('both segments after a swap and swap-back feed one point, not two', async () => {
  const text = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('floor-press', 'Floor press', [set(15, 10, true, '2026-01-01T10:10:00.000Z')]),
      segment('floor-press', 'Floor press', [set(20, 6, true, '2026-01-01T10:30:00.000Z')]),
    ]),
  ]);
  assert.match(text, /20 kg × 6/);
  assert.equal(text.match(/Latest best set/g)?.length, 1);
});

test('correcting a past set moves the point to the corrected evidence', async () => {
  const before = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('floor-press', 'Floor press', [
        set(18, 5, true, '2026-01-01T10:10:00.000Z'),
        set(10, 15, true, '2026-01-01T10:20:00.000Z'),
      ]),
    ]),
  ]);
  assert.match(before, /18 kg × 5/);

  const after = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('floor-press', 'Floor press', [
        set(14, 5, true, '2026-01-01T10:10:00.000Z'),
        set(10, 15, true, '2026-01-01T10:20:00.000Z'),
      ]),
    ]),
  ]);
  assert.match(after, /14 kg × 5/);
  assert.doesNotMatch(after, /18 kg/);
});

test('a timed hold reads in seconds and a bodyweight movement in reps, never as a zero-kg set', async () => {
  const hold = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('plank', 'Plank', [
        set(0, 30, true, '2026-01-01T10:10:00.000Z'),
        set(0, 45, true, '2026-01-01T10:20:00.000Z'),
      ]),
    ]),
  ]);
  assert.match(hold, /45s/);
  assert.doesNotMatch(hold, /Bodyweight ×/);

  const body = await renderProgress([
    workout('w1', '2026-01-01T10:00:00.000Z', [
      segment('push-up', 'Push-up', [set(0, 12, true, '2026-01-01T10:10:00.000Z')]),
    ]),
  ]);
  assert.match(body, /12 reps/);
  assert.doesNotMatch(body, /Bodyweight ×/);
});
