import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, logSet, skipExercise, swapPendingExercise } from '../src/lib/session.ts';
import type { WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const noop = () => {};
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** A set cell's value (#309): the cells are inputs, read by their accessible name. */
const cell = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];

const sets = (weight: number, reps: number, count = 3) => ({
  planned: Array.from({ length: count }, () => ({ weight, reps })),
  performed: Array.from({ length: count }, () => ({ weight, reps, done: false, completedAt: null })),
});

function pressDay(): WorkoutRecord {
  return createSession({ id: 'fast', name: 'Push', dayIndex: 0, now: at(0), exercises: [
    { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell Floor Press', ...sets(15, 8) },
    { exerciseId: 'goblet-squat', name: 'Goblet Squat', ...sets(18, 10, 2) },
  ] });
}

type Render = (session: WorkoutRecord, extra?: Record<string, unknown>) => string;
async function withTrain(run: (render: Render) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    run((session, extra = {}) => renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at(1)),
      loadOptions: RACK, calibrationLoads: RACK, profileLoads: { Dumbbell: RACK }, unit: 'kg', onMinimize: noop,
      onFinish: noop, onUpdateSet: noop, onConfirmWeight: noop, onLogSet: noop, onToggleRestPause: noop,
      onExtendRest: noop, onOpenActions: noop, onReturn: noop, ...extra })));
  } finally { await server.close(); }
}

test('a ✓ logs exactly its own set through logSet; a logged set is never re-logged', () => {
  const start = pressDay();
  const third = logSet(start, 0, 2, at(2));
  assert.deepEqual(third.exercises[0].performed.map((set) => set.done), [false, false, true], 'that set, not the first pending');
  assert.equal(third.restStartedAt, at(2), 'rest starts as before');
  const again = logSet(third, 0, 2, at(5));
  assert.equal(again, third, 'a second tap on a logged set changes nothing, not even its time');
  assert.equal(logSet(start, 0, 9, at(2)), start, 'a missing set changes nothing');

  // Carry-forward is unchanged: the load just logged fills the next unweighted set.
  const blank = createSession({ id: 'carry', name: 'Push', dayIndex: 0, now: at(0), exercises: [
    { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell Floor Press', ...sets(0, 8, 2) }] });
  blank.exercises[0].performed[0].weight = 15;
  assert.equal(logSet(blank, 0, 0, at(1)).exercises[0].performed[1].weight, 15);
});

test('the logger is one row per set, pre-filled from the prescription, one ✓ each', async () => {
  await withTrain((render) => {
    const html = render(pressDay());
    const text = plain(html);
    assert.match(text, /Exercise 1 of 2 · Target 3 × 8/);
    assert.match(html, /<h2 class="aw-exercise__name"><button/, 'the exercise name stays a heading');
    assert.match(html, /aria-label="Dumbbell Floor Press demo and instructions"/);
    assert.match(text, /Set Previous kg each Reps/);
    for (const n of [1, 2, 3]) {
      assert.equal(cell(html, `Set ${n} weight, kilograms each`), '15', `set ${n} weight`);
      assert.equal(cell(html, `Set ${n} reps`), '8', `set ${n} reps`);
      assert.match(html, new RegExp(`aria-label="Log set ${n}"`), `one ✓ for set ${n}`);
    }
    assert.match(text, /Up next · Goblet Squat 2 × 10/);
    assert.match(text, /0 of 5 sets/);
    assert.doesNotMatch(html, /save-bar/, 'no separate Log button to scroll to');

    const logged = render(logSet(pressDay(), 0, 0, at(1)), { now: Date.parse(at(1)) });
    assert.match(logged, /<tr class="lg-row--done">/);
    assert.match(logged, /aria-label="Set 1 logged"/);
    assert.match(logged, /<tr class="lg-row--current"><td>2</);
    assert.match(plain(logged), /1 of 5 sets/);
    assert.match(logged, /role="timer" aria-label="Rest, 75 seconds remaining"/);
    for (const name of ['Add 30 seconds of rest', 'Mute rest cue']) assert.match(logged, new RegExp(`aria-label="${name}"`));
    assert.match(plain(logged), /\+30s Pause Mute/);
  });
});

test('holds show seconds and bodyweight shows BW', async () => {
  const day = createSession({ id: 'hold', name: 'Core', dayIndex: 0, now: at(0), exercises: [
    { exerciseId: 'plank', name: 'Plank', ...sets(0, 45, 2) },
    { exerciseId: 'push-up', name: 'Push-Up', ...sets(0, 10, 2) },
  ] });
  await withTrain((render) => {
    const plank = render(day);
    assert.match(plain(plank), /Target 2 × 45s/);
    assert.equal(cell(plank, 'Set 1 seconds'), '45');
    assert.match(plain(plank), /Set Previous Load Secs/);
    assert.match(plank, /<span class="lg-cell lg-cell--bw">BW</);
    const pushUp = render(skipExercise(day, 0));
    assert.equal(cell(pushUp, 'Set 1 reps'), '10');
    assert.match(pushUp, />BW</);
  });
});

test('#80: switching exercise through a skip or a swap never shows the previous exercise’s value', async () => {
  // Two typed-entry (barbell) exercises; the first holds a typed 42.3 kg over its planned 40.
  const day = createSession({ id: 'keys', name: 'Pull', dayIndex: 0, now: at(0), exercises: [
    { exerciseId: 'barbell-row', name: 'Barbell Row', ...sets(40, 8, 2) },
    { exerciseId: 'overhead-press', name: 'Overhead Press', ...sets(0, 8, 2) },
  ] });
  for (const set of day.exercises[0].performed) set.weight = 42.3;
  await withTrain((render) => {
    const row = render(day, { loadOptions: [], calibrationLoads: [], profileLoads: {} });
    assert.equal(cell(row, 'Set 1 weight, kilograms'), '42.3');
    assert.match(row, /id="barbell-row:0:0:weight"/, 'rows are keyed by exercise, segment and set');

    // Skip: the press is calibrating; its typed entry is its own, empty, and keyed to it.
    const skipped = skipExercise(day, 0);
    const press = render(skipped, { loadOptions: [], calibrationLoads: [], profileLoads: {} });
    // #309: the typed first-weight field is gone; the press's own set cells are empty and keyed to it.
    assert.match(press, /id="overhead-press:1:0:weight"/);
    assert.equal(cell(press, 'Set 1 weight, kilograms'), '');
    assert.doesNotMatch(press, /barbell-row:0|42\.3/, 'nothing of the skipped exercise is rendered');

    // Swap the press for a bench press with its own 30 kg: new key, its own value.
    const swapped = swapPendingExercise(skipped, 1,
      { exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: 30, reps: 8 });
    const bench = render(swapped, { loadOptions: [], calibrationLoads: [], profileLoads: {} });
    assert.match(bench, /id="barbell-bench-press:1:0:weight"/);
    assert.equal(cell(bench, 'Set 1 weight, kilograms'), '30');
    assert.doesNotMatch(bench, /overhead-press:1|42\.3/);
  });
});

test('Mute reads Muted while pressed, and Up next skips set-aside or finished work', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { setRestMuted } = await server.ssrLoadModule('/src/lib/restCue.ts');
    const render = (session: WorkoutRecord) => renderToStaticMarkup(createElement(Train, { session, history: [],
      now: Date.parse(at(1)), loadOptions: RACK, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop,
      onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop }));
    const rested = logSet(pressDay(), 0, 0, at(1));
    assert.match(render(rested), /<button aria-pressed="false" aria-label="Mute rest cue">Mute</);
    setRestMuted(rested.id, true);
    assert.match(render(rested), /<button aria-pressed="true" aria-label="Mute rest cue">Muted</);
    setRestMuted(rested.id, false);

    const day = createSession({ id: 'next', name: 'Push', dayIndex: 0, now: at(0), exercises: [
      { exerciseId: 'dumbbell-floor-press', name: 'Dumbbell Floor Press', ...sets(15, 8) },
      { exerciseId: 'goblet-squat', name: 'Goblet Squat', ...sets(18, 10, 2) },
      { exerciseId: 'push-up', name: 'Push-Up', ...sets(0, 10, 2) },
    ] });
    assert.match(plain(render(skipExercise(day, 1))), /Up next · Push-Up/, 'a skipped exercise is not next');
    assert.doesNotMatch(plain(render(skipExercise(skipExercise(day, 1), 2))), /Up next/, 'nothing pending after it');
  } finally { await server.close(); }
});
