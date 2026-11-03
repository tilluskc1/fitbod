import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exclusionPatch, exerciseActions, exerciseHistory } from '../src/lib/exerciseActions.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const profile: Profile = {
  goal: 'Build Muscle',
  experience: 'Beginner',
  daysPerWeek: 3,
  equipment: ['Dumbbell'],
  support: [],
  exclusions: [],
  loads: {},
  unit: 'kg',
};

function workout(
  id: string,
  finishedAt: string,
  exercises: { exerciseId: string; name: string; sets: { reps: number; weight: number }[] }[],
  completedEarly = false,
): WorkoutRecord {
  return {
    id,
    date: finishedAt,
    name: 'Full body A',
    dayIndex: 0,
    status: 'completed',
    endedAt: finishedAt,
    completedEarly,
    exercises: exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      planned: exercise.sets.map((set) => ({ ...set })),
      performed: exercise.sets.map((set) => ({
        ...set,
        done: true,
        completedAt: finishedAt,
      })),
    })),
  } as WorkoutRecord;
}

test('a completed exercise offers no replacement or removal, and says why', () => {
  const actions = exerciseActions(0, 3);
  const replace = actions.find((action) => action.id === 'replace');
  const remove = actions.find((action) => action.id === 'remove-today');
  assert.ok(replace?.blockedReason, 'replace is blocked once every set is logged');
  assert.match(replace!.blockedReason!, /every set here is logged/i);
  assert.equal(remove?.blockedReason, replace?.blockedReason);
  // Instructions and history stay available: the desire to read never depends
  // on remaining work.
  assert.equal(actions.find((action) => action.id === 'instructions')?.blockedReason, undefined);
  assert.equal(actions.find((action) => action.id === 'history')?.blockedReason, undefined);
});

test('pending work unlocks replace and removal, and every promised capability has a row', () => {
  const actions = exerciseActions(3, 0);
  assert.deepEqual(
    actions.map((action) => action.id),
    ['instructions', 'history', 'replace', 'prefer', 'dont-recommend', 'remove-today'],
  );
  assert.equal(actions.find((action) => action.id === 'replace')?.blockedReason, undefined);
  assert.equal(actions.find((action) => action.id === 'remove-today')?.blockedReason, undefined);
  // The one capability with no store behind it is named instead of pretending.
  assert.match(actions.find((action) => action.id === 'prefer')!.blockedReason!, /not stored yet/i);
});

test('history lists only that exact variant, newest first, and never invents a session', () => {
  const history = [
    workout('w2', '2026-02-02T10:00:00.000Z', [
      { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell floor press', sets: [{ reps: 10, weight: 15 }] },
      { exerciseId: 'push-up', name: 'Push-up', sets: [{ reps: 8, weight: 0 }] },
    ]),
    workout('w1', '2026-02-01T10:00:00.000Z', [
      { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell floor press', sets: [{ reps: 9, weight: 15 }] },
    ], true),
  ];

  const press = exerciseHistory(history, 'dumbbell-floor-press');
  assert.deepEqual(press.map((entry) => entry.workoutId), ['w2', 'w1']);
  assert.deepEqual(press[0].sets, [{ reps: 10, weight: 15 }]);
  assert.equal(press[1].completedEarly, true);

  // The other variant keeps its own history; nothing is copied between them.
  assert.deepEqual(exerciseHistory(history, 'goblet-squat'), []);
  assert.deepEqual(exerciseHistory([], 'dumbbell-floor-press'), []);
});

test('a session with nothing logged for the variant is not history', () => {
  const empty = workout('w3', '2026-02-03T10:00:00.000Z', [
    { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell floor press', sets: [] },
  ]);
  assert.deepEqual(exerciseHistory([empty], 'dumbbell-floor-press'), []);
});

test('removing from recommendations writes the exclusion list the plan already honours', () => {
  const added = exclusionPatch(profile, 'dumbbell-floor-press', true);
  assert.deepEqual(added.exclusions, ['dumbbell-floor-press']);
  // Repeated confirmation is idempotent, and reversing it removes one entry.
  assert.deepEqual(exclusionPatch({ ...profile, ...added }, 'dumbbell-floor-press', true), {});
  const removed = exclusionPatch({ ...profile, ...added }, 'dumbbell-floor-press', false);
  assert.deepEqual(removed.exclusions, []);
  // No other exclusion is touched.
  const withOthers = { ...profile, exclusions: ['push-up', 'dumbbell-floor-press'] };
  assert.deepEqual(exclusionPatch(withOthers, 'dumbbell-floor-press', false).exclusions, ['push-up']);
});

test('the action sheet renders its named rows and a real dialog', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { ExerciseActionsSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const html = renderToStaticMarkup(
      createElement(ExerciseActionsSheet, {
        exerciseId: 'dumbbell-floor-press',
        exerciseName: 'Dumbbell floor press',
        exerciseIndex: 1,
        exerciseCount: 5,
        planned: [{ weight: 15, reps: 9 }],
        pending: 3,
        done: 0,
        history: [],
        unit: 'kg',
        excluded: false,
        onReplace: () => {},
        onToggleExclusion: () => {},
        onRemoveToday: () => {},
        onClose: () => {},
      }),
    );
    const text = plain(html);
    assert.match(html, /role="dialog"/);
    assert.match(text, /Dumbbell floor press/);
    assert.match(text, /Exercise 2 of 5/);
    assert.match(text, /Instructions and demo/);
    assert.match(text, /History for this exercise/);
    assert.match(text, /Replace for the remaining sets/);
    assert.match(text, /Remove from recommendations/);
    // React escapes the apostrophe in static markup; match the escaped form.
    assert.match(text, /Remove today(?:'|&#x27;)s remaining work/);
    // No dead CTA: the capability without a store is stated, not clickable.
    assert.match(text, /Prefer this exercise more often/);
    assert.doesNotMatch(text, /bestseller/i);
  } finally {
    await server.close();
  }
});
