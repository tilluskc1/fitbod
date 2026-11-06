import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseActions, exerciseHistory } from '../src/lib/exerciseActions.ts';
import { conflicts, exclusionChange, preferenceChange } from '../src/lib/preferences.ts';
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
  const actions = exerciseActions(0, 3, true, false);
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
  const actions = exerciseActions(3, 0, true, false);
  assert.deepEqual(
    actions.map((action) => action.id),
    ['instructions', 'history', 'replace', 'more', 'less', 'dont-recommend', 'remove-today'],
  );
  // With pending work nothing is blocked: no placeholder row is left.
  assert.deepEqual(actions.filter((action) => action.blockedReason), []);
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
        profile,
        inSession: true,
        skipped: false,
        onReturn: () => {},
        onReplace: () => {},
        onSaveProfile: () => {},
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
    assert.match(text, /Recommend more often/);
    assert.match(text, /Recommend less often/);
    assert.match(text, /Don(?:'|&#x27;)t recommend again/);
    // React escapes the apostrophe in static markup; match the escaped form.
    assert.match(text, /Remove today(?:'|&#x27;)s remaining work/);
    assert.doesNotMatch(html, /disabled=""/, 'pending work leaves no disabled row');
    assert.doesNotMatch(text, /not stored yet/i);
    assert.doesNotMatch(text, /bestseller/i);
  } finally {
    await server.close();
  }
});

const press = { id: 'dumbbell-floor-press', name: 'Dumbbell floor press' };

type El = { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
function buttonByText(node: unknown, text: string): El | null {
  if (Array.isArray(node)) return node.map((child) => buttonByText(child, text)).find(Boolean) ?? null;
  const element = node as El;
  if (!element?.props) return null;
  if (element.type === 'button' && JSON.stringify(element.props.children ?? '').includes(text)) return element;
  return buttonByText(element.props.children, text);
}

async function withSheets(run: (mod: Record<string, any>) => void) {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    run(await server.ssrLoadModule('/src/screens/Sheets.tsx'));
  } finally {
    await server.close();
  }
}

const sheetProps = (overrides: Partial<Profile>) => ({
  exerciseId: press.id,
  exerciseName: press.name,
  exerciseIndex: 0,
  exerciseCount: 4,
  planned: [{ weight: 15, reps: 9 }],
  pending: 3,
  done: 0,
  history: [],
  unit: 'kg',
  profile: { ...profile, ...overrides },
  inSession: true,
  skipped: false,
  onReplace: () => {},
  onSaveProfile: () => {},
  onRemoveToday: () => {},
  onReturn: () => {},
  onClose: () => {},
});

test('more often from the sheet is previewed for future workouts and saved only on Confirm', async () => {
  await withSheets(({ ConfirmChange }) => {
    const change = preferenceChange(profile, press, 'more');
    assert.match(change.title, /More often: Dumbbell floor press/);
    assert.match(change.detail, /future workouts only/i);
    const saved: unknown[] = [];
    let cancelled = 0;
    const tree = ConfirmChange({ change, onConfirm: (patch: unknown) => saved.push(patch), onCancel: () => { cancelled += 1; } });
    buttonByText(tree, 'Cancel')?.props?.onClick?.();
    assert.deepEqual(saved, [], 'Cancel saves nothing');
    assert.equal(cancelled, 1);
    buttonByText(tree, 'Confirm')?.props?.onClick?.();
    assert.deepEqual(saved, [{ preferences: { 'dumbbell-floor-press': 'more' } }]);
  });
});

test('more and less are exclusive in the sheet, and the active one returns to neutral', async () => {
  await withSheets(({ ExerciseActionsSheet }) => {
    let next: Profile = { ...profile, ...preferenceChange(profile, press, 'more').patch };
    next = { ...next, ...preferenceChange(next, press, 'less').patch };
    assert.deepEqual(next.preferences, { 'dumbbell-floor-press': 'less' });
    assert.match(preferenceChange(next, press, null).title, /Neutral/);

    const html = renderToStaticMarkup(createElement(ExerciseActionsSheet, sheetProps({ preferences: next.preferences })));
    assert.equal(html.match(/aria-pressed="true"/g)?.length, 1, 'only one of more/less is on');
    assert.match(html, /aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Recommend less often/s);
  });
});

test('an excluded exercise with a preference shows the conflict, and exclusion wins', async () => {
  await withSheets(({ ExerciseActionsSheet }) => {
    const both = { exclusions: [press.id], preferences: { [press.id]: 'more' as const } };
    assert.deepEqual(conflicts({ ...profile, ...both }), [press.id]);
    const text = plain(renderToStaticMarkup(createElement(ExerciseActionsSheet, sheetProps(both))));
    assert.match(text, /exclusion wins until you pick one/i);
    assert.match(text, /Keep exclusion/);
    assert.match(text, /Keep more often/);
    assert.match(text, /Allow in workouts again/);
    // Asking for a preference on an excluded exercise says the exclusion stays.
    const excluded = { ...profile, exclusions: [press.id] };
    assert.match(preferenceChange(excluded, press, 'less').detail, /stays excluded/i);
  });
});

test("don't recommend again uses the Library's confirmation and the exclusion list", () => {
  const change = exclusionChange(profile, press, true);
  assert.match(change.title, /Don't recommend Dumbbell floor press again\?/);
  assert.match(change.detail, /future workouts only/i);
  assert.deepEqual(change.patch, { exclusions: [press.id] });
  assert.deepEqual(exclusionChange({ ...profile, exclusions: [press.id] }, press, false).patch, { exclusions: [] });
});

test('a completed exercise states its one reason once and keeps reading actions open', async () => {
  await withSheets(({ ExerciseActionsSheet }) => {
    const html = renderToStaticMarkup(createElement(ExerciseActionsSheet, { ...sheetProps({}), pending: 0, done: 3 }));
    assert.equal(plain(html).match(/Every set here is logged/g)?.length, 1);
    assert.equal(html.match(/disabled=""/g)?.length, 2, 'only replace and remove are blocked');
  });
});

test('before Start, replace and remove are stated as unavailable instead of doing nothing', async () => {
  const actions = exerciseActions(3, 0, false, false);
  for (const id of ['replace', 'remove-today'] as const)
    assert.equal(actions.find((action) => action.id === id)?.blockedReason, "Start the workout to change today's sets.");
  await withSheets(({ ExerciseActionsSheet }) => {
    const html = renderToStaticMarkup(createElement(ExerciseActionsSheet, { ...sheetProps({}), inSession: false }));
    assert.match(plain(html), /Start the workout to change today(?:'|&#x27;)s sets/);
    assert.equal(html.match(/disabled=""/g)?.length, 2);
  });
});

test('a segment removed for today offers Return to exercise in place of replace and remove', async () => {
  const actions = exerciseActions(3, 1, true, true);
  const ids = actions.map((action) => action.id);
  assert.ok(ids.includes('return'));
  assert.ok(!ids.includes('replace') && !ids.includes('remove-today'));
  assert.equal(actions.find((action) => action.id === 'return')?.label, 'Return to exercise');
  await withSheets(({ ExerciseActionsSheet }) => {
    const text = plain(renderToStaticMarkup(createElement(ExerciseActionsSheet, { ...sheetProps({}), skipped: true })));
    assert.match(text, /Return to exercise/);
    assert.doesNotMatch(text, /Replace for the remaining sets|remaining work/);
  });
});
