import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A, exerciseMeta, repsTarget } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, currentWorkout, swapCandidateFor, toWorkoutExercises } from '../src/lib/adapt.ts';
import { createSession, logSet, swapPendingExercise, updatePerformedSet } from '../src/lib/session.ts';

const profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell', 'Barbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Targets', unit: 'kg' };
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' });
const session = () => createSession({ id: 'accepted', name: adapted.name, dayIndex: 0,
  durationMin: 20, exercises: toWorkoutExercises(adapted), now: '2026-10-31T10:00:00.000Z' });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

test('swap-back segments keep their own accepted targets in Today, details, Why, day and logger', async () => {
  let current = logSet(updatePerformedSet(session(), 0, 0, { weight: 20, reps: 10 }), 0, 0);
  current = swapPendingExercise(current, 0, swapCandidateFor(exerciseById('push-up')!, profile, [], current));
  current = swapPendingExercise(current, 1, swapCandidateFor(exerciseById('dumbbell-floor-press')!, profile, [], current));
  assert.deepEqual(current.exercises.slice(0, 2).map(e => e.planned[0]), [{ weight: 15, reps: 9 }, { weight: 20, reps: 10 }]);
  const pending = current.exercises[1];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const { ExerciseActionsSheet, WhySheet, DaySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const todayProps = { profile, program: FULL_BODY_A, adapted,
      equipment: 'home', adjusted: true, history: [], current, now: new Date(), onPreview: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop };
    const today = plain(renderToStaticMarkup(createElement(Today, todayProps)));
    let clicked: unknown[] = [];
    const tree = Today({ ...todayProps, onOpenExercise: (...args: unknown[]) => { clicked = args; } });
    const rows: any[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.props?.className === 'workout-row') rows.push(node);
      for (const child of [node.props?.children].flat(Infinity)) visit(child);
    };
    visit(tree);
    rows[1].props.onClick();
    assert.deepEqual(clicked, ['dumbbell-floor-press', 1], 'pending row supplies its segment, not just exercise ID');
    assert.match(today, /1 set · 9 @ 15 kg each/);
    assert.match(today, /1 set · 10 @ 20 kg each/);
    const sheetProps = { exerciseId: pending.exerciseId, exerciseName: pending.name, planned: pending.planned,
      history: [], unit: 'kg', onClose: noop };
    assert.match(plain(renderToStaticMarkup(createElement(WhySheet, sheetProps))), /Today(?:’s target)? 10 @ 20 kg each/);
    const actions = plain(renderToStaticMarkup(createElement(ExerciseActionsSheet, { ...sheetProps, exerciseIndex: 1,
      exerciseCount: 2, pending: 1, done: 0, profile, inSession: true, skipped: false, onReplace: noop,
      onSaveProfile: noop, onRemoveToday: noop, onReturn: noop })));
    assert.match(actions, /Exercise 2 of 2 · 1 set · 10 @ 20 kg each/);
    const day = plain(renderToStaticMarkup(createElement(DaySheet, { name: current.name, minutes: 20,
      exercises: current.exercises, unit: 'kg', onClose: noop })));
    assert.match(day, /10 @ 20 kg each/);
    const trainHtml = renderToStaticMarkup(createElement(Train, { session: current, history: [], now: Date.now(),
      loadOptions: [15, 20], unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop }));
    const train = plain(trainHtml);
    assert.match(trainHtml, /<h2 class="aw-exercise__name"><button/, 'the exercise name stays a heading');
    assert.match(train, /Exercise 2 of \d+ · Target 1 × 10/);
    assert.match(train, /Set Previous kg each Reps/);
    assert.match(trainHtml, /aria-label="Edit weight for set 1"[^>]*>20</, "the segment's own 20 kg, not the press-up's");
    assert.match(trainHtml, /aria-label="Edit reps for set 1"[^>]*>10</);
  } finally { await server.close(); }
});

test('accepted weighted catalog swaps keep their saved load and equipment in Today', () => {
  for (const [id, load, detail] of [
    ['barbell-bench-press', 'total', 'Barbell'], ['machine-chest-press', 'total', 'Machine'],
    ['cable-fly', 'total', 'Cable'], ['kettlebell-goblet-squat', 'total', 'Kettlebell'],
    ['dumbbell-bench-press', 'each', 'Dumbbell'],
  ]) {
    const current = session();
    current.exercises[0] = { exerciseId: id, name: exerciseById(id)!.name,
      planned: [{ weight: 40, reps: 10 }], performed: [{ weight: 40, reps: 10, done: false }] };
    const projected = currentWorkout(adapted, current).exercises[0];
    assert.equal(projected.weight, 40);
    assert.equal(projected.load, load, id);
    assert.match(projected.detail, new RegExp(detail), id);
  }
});

test('barbell logger offers calibration without fixture dumbbell weights', async () => {
  const current = session();
  current.exercises = [{ exerciseId: 'barbell-row', name: 'Barbell Row', planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false }] }];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const html = renderToStaticMarkup(createElement(Train, { session: current, history: [], now: Date.now(),
      loadOptions: [10, 15, 18], unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onReturn: noop }));
    assert.match(html, /Weight \(kg total\)/);
    assert.match(html, /Enter barbell load \(kg total\)/);
    assert.doesNotMatch(html, /lg-quick|weight-pills/);
    assert.doesNotMatch(html, /Dumbbell/);
    assert.match(html, /aria-label="Edit weight for set 1"[^>]*>—</, 'load not set');
    assert.doesNotMatch(html, />BW</, 'a barbell is not bodyweight');
  } finally { await server.close(); }
});

test('a barbell set opens with precise saved kilograms', async () => {
  const current = session();
  current.exercises = [{ exerciseId: 'barbell-row', name: 'Barbell Row',
    planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 42.3, reps: 8, done: false }] }];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const html = renderToStaticMarkup(createElement(Train, { session: current, history: [], now: Date.now(),
      loadOptions: [], unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onReturn: noop }));
    assert.match(html, /aria-label="Edit weight for set 1"[^>]*>42\.3</);
  } finally { await server.close(); }
});


test('accepted target formatting shows prescribed reps and hold units', () => {
  assert.equal(repsTarget('goblet-squat', 2, [{ reps: 8 }, { reps: 8 }]), '8 · 8');
  assert.equal(repsTarget('goblet-squat', 2), '8–10 reps', 'the program range without a prescription');
  assert.equal(repsTarget('goblet-squat', 2, [{ reps: 10 }, { reps: 9 }]), '10 · 9');
  assert.equal(repsTarget('plank', 2, [{ reps: 45 }, { reps: 45 }]), '45 · 45s');
  assert.equal(repsTarget('plank', 1, [{ reps: 60 }]), '60s');
});

test('Today preserves the accepted hold seconds instead of the static program duration', () => {
  const current = session();
  current.exercises = [{ exerciseId: 'plank', name: 'Plank', planned: [{ weight: 0, reps: 60 }],
    performed: [{ weight: 0, reps: 60, done: false }] }];
  assert.equal(exerciseMeta(currentWorkout(adapted, current).exercises[0]), '1 set · 60s hold');
});

test('Today shows the open session\'s prescribed reps, not the program range', () => {
  const current = session();
  current.exercises = [{ exerciseId: 'goblet-squat', name: 'Goblet Squat',
    planned: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }, { weight: 0, reps: 8 }],
    performed: [0, 1, 2].map(() => ({ weight: 0, reps: 8, done: false })) }];
  assert.doesNotMatch(exerciseMeta(currentWorkout(adapted, current).exercises[0]), /8–10/);
});
