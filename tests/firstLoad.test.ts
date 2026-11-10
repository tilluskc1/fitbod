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

const cell = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('a first load is prefilled from the profile in every pending set, says why, and the ✓ is ready', async () => {
  const html = await renderTrain({ experience: 'Beginner' });
  for (const n of [1, 2, 3]) {
    assert.equal(cell(html, `Set ${n} weight, kilograms each`), '6', `set ${n}: floor press, Beginner, kg: 6 per hand`);
    assert.match(html, new RegExp(`aria-label="Log set ${n}">`), `set ${n} logs in one tap`);
    assert.doesNotMatch(html, new RegExp(`aria-label="Log set ${n}"[^>]*disabled`));
  }
  assert.match(plain(html), /Suggested start 6 kg each\. Do 5 easy reps with it, then adjust set 1\./);
  // #309: the "Suggested: …" note, Confirm and Skip are gone; the hint and the prefilled cells replace them.
  assert.doesNotMatch(html, />Confirm<|>Skip<|Suggested: |Enter dumbbell load/);
});

test('owned loads: the suggestion is the nearest one owned, shown in the cells; no pills', async () => {
  const html = await renderTrain({ experience: 'Beginner', calibrationLoads: RACK, loadOptions: RACK });
  assert.equal(cell(html, 'Set 1 weight, kilograms each'), '10', '6 kg snaps to the nearest owned dumbbell');
  assert.match(plain(html), /Suggested start 10 kg each\./);
  // #309: the load-pill row (is-suggested / aria-pressed) is gone; the nearest owned load is the cell value.
  assert.doesNotMatch(html, /<button(?![^>]*lg-wcheck)[^>]*aria-pressed|is-suggested|Your dumbbells/);
});

test('without a profile level nothing is suggested: cells blank, ✓ waits for a weight', async () => {
  const html = await renderTrain({});
  assert.doesNotMatch(plain(html), /Suggested/);
  assert.equal(cell(html, 'Set 1 weight, kilograms each'), '');
  assert.match(html, /aria-label="Log set 1" disabled=""/);
});
