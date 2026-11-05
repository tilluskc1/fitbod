import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { catalogRowMeta, liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'Krishna', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'kg',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

function liveSession(history: WorkoutRecord[]) {
  return createSession({ id: 's', name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, history), now: '2026-11-02T10:00:00.000Z' });
}

/** History in which the press earned the next rack load (3 × 10 at 15 kg). */
function earnedHistory(): WorkoutRecord[] {
  let session = liveSession([]);
  for (let index = 0; index < 3; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight: 15, reps: 10 }), 0, index,
      `2026-11-02T10:0${index + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

test('Today coach insight states the live reason instead of contradicting the earned step', async () => {
  const history = earnedHistory();
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const today = plain(renderToStaticMarkup(createElement(Today, { profile, program: FULL_BODY_A,
      adapted: liveAdapted(adapted, profile, history), equipment: 'home', adjusted: false, history,
      current: null, now: new Date('2026-11-04T10:00:00.000Z'), onStart: noop, onResume: noop, onAdjust: noop,
      onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop })));
    assert.doesNotMatch(today, /Repeat that/);
    assert.match(today, /One step up \(\+3 kg\)/);
  } finally { await server.close(); }
});

test('Plan available rows show the live prescription, not the fixture', () => {
  const press = exerciseById('dumbbell-floor-press');
  const plank = exerciseById('plank');
  assert.ok(press && plank);
  assert.equal(catalogRowMeta(press, profile, [], 'kg'), '3 sets · 8 reps', 'uncalibrated: no load');
  assert.equal(catalogRowMeta(press, profile, earnedHistory(), 'kg'), '3 sets · 8 reps · 18 kg each');
  assert.equal(catalogRowMeta(plank, profile, [], 'kg'), '2 sets · 45s', 'holds keep seconds');
});

test('the logger names the equipment, not bodyweight, and shows the prescribed reps', async () => {
  let session = liveSession([]);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const render = (current: WorkoutRecord) => plain(renderToStaticMarkup(createElement(Train, {
      session: current, history: [], now: Date.now(), loadOptions: RACK, unit: 'kg', onMinimize: noop,
      onFinish: noop, onUpdateSet: noop, onLogNext: noop, onToggleRestPause: noop, onExtendRest: noop,
      onSwap: noop, onSkip: noop, onReturn: noop })));
    const press = render(session);
    assert.doesNotMatch(press, /Bodyweight · Floor mat/);
    assert.match(press, /Dumbbell · Floor mat/);
    for (let index = 0; index < 3; index += 1) session = logSet(session, 0, index, `2026-11-02T10:0${index + 1}:00.000Z`);
    const squat = render(session);
    assert.match(squat, /Goblet squat/i);
    assert.match(squat, /Today’s target: 8 · 8 · 8/);
  } finally { await server.close(); }
});
