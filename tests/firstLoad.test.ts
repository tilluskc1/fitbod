import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { nearestLoad, suggestedFirstLoad } from '../src/lib/firstLoad.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { createSession } from '../src/lib/session.ts';
import { calibrationInputValue } from '../src/lib/units.ts';
import { MAX_WEIGHT } from '../src/lib/validate.ts';
import type { Experience, Profile, Unit } from '../src/types.ts';

const shown = (id: string, experience: Experience, unit: Unit) =>
  calibrationInputValue(suggestedFirstLoad(exerciseById(id)!, experience, unit), unit);

test('a first-time load comes from the starting table: experience × role × equipment, in the user unit', () => {
  // Small-muscle and other isolation work, per hand.
  assert.equal(shown('rear-delt-fly', 'Beginner', 'lb'), '5');
  assert.equal(shown('lateral-raise', 'Intermediate', 'lb'), '10');
  assert.equal(shown('dumbbell-curl', 'Advanced', 'kg'), '6');
  // Upper and lower compounds, per hand.
  assert.equal(shown('dumbbell-bench-press', 'Beginner', 'kg'), '6');
  assert.equal(shown('dumbbell-floor-press', 'Intermediate', 'lb'), '25');
  assert.equal(shown('goblet-squat', 'Advanced', 'lb'), '50');
  assert.equal(shown('goblet-squat', 'Intermediate', 'kg'), '16');
  // A barbell starts at the empty bar; a machine or cable stack at both hands' worth.
  assert.equal(shown('barbell-bench-press', 'Advanced', 'lb'), '45');
  assert.equal(shown('barbell-bench-press', 'Beginner', 'kg'), '20');
  assert.equal(shown('machine-chest-press', 'Intermediate', 'lb'), '50');
  assert.equal(shown('leg-extension', 'Beginner', 'kg'), '4');
  assert.equal(suggestedFirstLoad(exerciseById('push-up')!, 'Advanced', 'kg'), 0, 'bodyweight gets no number');
  // A face pull is rear-delt work, not a compound pull: a light stack.
  assert.equal(shown('face-pull', 'Beginner', 'lb'), '10');
  // Kettlebells come in 4 kg steps.
  assert.equal(shown('kettlebell-goblet-squat', 'Advanced', 'kg'), '24');
});

test('every suggestion is stored in kg at the precision a typed load gets, under the load limit', () => {
  assert.equal(suggestedFirstLoad(exerciseById('rear-delt-fly')!, 'Intermediate', 'lb'), 4.536);
  for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as const) {
    for (const unit of ['kg', 'lb'] as const) {
      for (const id of ['rear-delt-fly', 'goblet-squat', 'barbell-bench-press', 'machine-chest-press']) {
        const kg = suggestedFirstLoad(exerciseById(id)!, experience, unit);
        assert.ok(kg > 0 && kg <= MAX_WEIGHT, `${id} ${experience} ${unit}`);
      }
    }
  }
});

test('with owned loads, the suggestion is the nearest one owned, the lighter on a tie', () => {
  assert.equal(nearestLoad([4, 8, 12], 6), 4);
  assert.equal(nearestLoad([4, 8, 12], 7), 8);
  assert.equal(nearestLoad([10, 15, 18], 2), 10);
  assert.equal(nearestLoad([], 6), null);
});

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'New', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, unit: 'kg',
};
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
const noop = () => {};

async function renderTrain(extra: Record<string, unknown>) {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [] }, [], undefined);
  const session = createSession({ id: 's0', name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, []), now: at(0) });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    return renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at(1)),
      loadOptions: [], calibrationLoads: [], ...extra, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop,
      onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onReturn: noop }));
  } finally { await server.close(); }
}

test('a typed first load is prefilled from the profile, says why, and Confirm is ready', async () => {
  const html = await renderTrain({ experience: 'Beginner' });
  const input = html.match(/<input[^>]*aria-label="Enter dumbbell load[^"]*"[^>]*>/)?.[0] ?? '';
  assert.match(input, /value="6"/, 'floor press, Beginner, kg: 6 per hand');
  assert.match(html, /Suggested: 6 kg each, from your Beginner setup\. Change it if it feels off\./);
  assert.match(html, /<button class="pill-primary"[^>]*>Confirm<\/button>/);
  assert.doesNotMatch(html, /<button class="pill-primary" disabled=""[^>]*>Confirm/);
});

test('owned loads mark the nearest one as suggested without choosing it', async () => {
  const html = await renderTrain({ experience: 'Beginner', calibrationLoads: RACK, loadOptions: RACK });
  assert.match(html, /<button type="button" aria-pressed="false" class="is-suggested" aria-label="10, suggested">10<\/button>/);
  assert.doesNotMatch(html, /aria-pressed="true"/, 'nothing is chosen until a tap');
});

test('without a profile level the step stays as it was: blank and nothing suggested', async () => {
  const html = await renderTrain({});
  assert.doesNotMatch(html, /Suggested:/);
  assert.match(html, /<input[^>]*aria-label="Enter dumbbell load[^"]*" value=""/);
});
