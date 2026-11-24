import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession, logSet, skipExercise, updatePerformedSet } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #399: a workout left open from an earlier day led with its way out on Today. #430 retired that Today
// variant (an old workout now closes itself after 6 idle hours; tests/askFirst430.test.ts). What stays is
// the logger's own save bar: "End workout" with nothing logged, "Finish workout" once a set is.

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const home = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: { Dumbbell: [10, 15, 18] }, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), home, []);
const STARTED = local(2026, 11, 12, 18);
const empty = createSession({ id: 's', name: 'Push', dayIndex: 0, durationMin: 35, exercises: liveExercises(adapted, home, []), now: STARTED.toISOString() });
// Two sets logged: the first set of each of the first two exercises (a first-time lift needs its load typed).
const logFirst = (session: WorkoutRecord, exerciseIndex: number) =>
  logSet(updatePerformedSet(session, exerciseIndex, 0, { weight: 15 }), exerciseIndex, 0, STARTED.toISOString());
const twoDone = logFirst(logFirst(empty, 0), 1);

async function withScreens(run: (screens: { train: (session: WorkoutRecord) => string }) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const Train = (await server.ssrLoadModule('/src/screens/TrainScreen.tsx')).default;
    run({
      train: (session) => renderToStaticMarkup(createElement(Train, { session, history: [], now: STARTED.getTime(), rampLoads: [10, 15, 18],
        calibrationLoads: [10, 15, 18], profileLoads: { Dumbbell: [10, 15, 18] }, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop,
        onConfirmWeight: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop })),
    });
  } finally {
    await server.close();
  }
}

test('#399 logger save bar (nothing left to log): "End workout" with no set logged, "Finish workout" once one is', async () => {
  // The bar shows on the logger's review state, so skip whatever is still open.
  const skipRest = (session: WorkoutRecord) => session.exercises.reduce((next, _, index) => skipExercise(next, index), session);
  await withScreens(({ train }) => {
    const bar = (html: string) => /<button class="save-bar"[^>]*>([^<]*)<\/button>/.exec(html)?.[1].trim();
    assert.equal(bar(train(skipRest(empty))), 'End workout');
    assert.equal(bar(train(skipRest(twoDone))), 'Finish workout');
    assert.doesNotMatch(plain(train(skipRest(empty))), /Finish or discard/);
  });
});
