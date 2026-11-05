import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { toKg } from '../src/lib/units.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'lb',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = () => liveExercises(adapted, profile, []);
const id = base()[0].exerciseId;

function sessionAt(weight: number, planned: number) {
  const ex = base()[0];
  const sets = [0, 1, 2].map(() => ({ weight, reps: 10, done: false }));
  return createSession({ id: 's', name: 'A', dayIndex: 0, now: '2026-11-04T10:00:00.000Z',
    exercises: [{ ...ex, planned: sets.map((s) => ({ weight: planned, reps: s.reps })), performed: sets }] });
}

function historyAt(weight: number): WorkoutRecord[] {
  let session = sessionAt(weight, weight);
  for (let i = 0; i < 3; i += 1) {
    session = logSet(updatePerformedSet(session, 0, i, { weight, reps: 10 }), 0, i, `2026-11-02T10:0${i + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

test('lb loads read one way on every surface; typed off-rack loads stay exact', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { ExerciseSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const props = { now: Date.parse('2026-11-04T10:01:00.000Z'), loadOptions: RACK, unit: 'lb',
      onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogNext() {}, onToggleRestPause() {},
      onExtendRest() {}, onSwap() {}, onSkip() {}, onReturn() {} };
    const train = (history: WorkoutRecord[], weight: number, planned: number) =>
      plain(renderToStaticMarkup(createElement(TrainScreen, { ...props, history, session: sessionAt(weight, planned) })));
    const sheetOf = (history: WorkoutRecord[]) => plain(renderToStaticMarkup(createElement(ExerciseSheet,
      { exerciseId: id, planned: [{ weight: 18, reps: 10 }], history, unit: 'lb', rack: RACK, onClose() {} })));

    const rack = train(historyAt(15), 18, 18);
    assert.match(rack, /Today’s target: .*39\.5 lb/);
    assert.match(rack, /10 reps @ 39\.5 lb each/, 'planned rows');
    assert.match(rack, /Last session: .*@ 33 lb each/, 'last-session line');
    assert.match(train(historyAt(15), 15, 15), /Log set 1 · .*@ 33 lb/, 'Log button');
    assert.doesNotMatch(rack, /39\.68|33\.07/);
    assert.match(sheetOf(historyAt(15)), /Last recorded 33 lb/, 'exercise sheet');

    const typed = toKg(25, 'lb');
    const off = train(historyAt(typed), typed, 18);
    assert.match(off, /Last session: .*@ 25 lb each/);
    assert.match(train(historyAt(typed), typed, 18), /Log set 1 · .*@ 25 lb/);
    assert.match(sheetOf(historyAt(typed)), /Last recorded 25 lb/);
  } finally { await server.close(); }
});
