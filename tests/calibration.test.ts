import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, confirmedLoads, loadOptions } from '../src/lib/adapt.ts';
import { HOME_DUMBBELLS } from '../src/data/flagship.ts';
import { liveExercises, needsCalibration } from '../src/lib/liveProgression.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { applyCorrection, applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'New', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'kg',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK }, [], undefined);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
/** A set cell's value (#309): the cells are inputs, read by their accessible name. */
const cell = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
// The calibration asks for the set's own target reps with headroom (the floor press starts at 8).
const RULE = /Pick a weight you could lift for 8 reps with 2–3 to spare/;

function liveSession(history: WorkoutRecord[]) {
  return createSession({ id: `s${history.length}`, name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, history), now: at(0) });
}

function finish(session: WorkoutRecord): WorkoutRecord[] {
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: at(30) }).history;
}

/** The press logged three working sets at 15 kg in a finished session. */
function pressHistory(): WorkoutRecord[] {
  let session = liveSession([]);
  for (let index = 0; index < 3; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight: 15, reps: 8 }, at(index + 1)), 0, index, at(index + 1));
  }
  return finish(session);
}

type Render = (session: WorkoutRecord, history: WorkoutRecord[], extra?: Record<string, unknown>) => string;
async function withTrain(run: (render: Render) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    run((session, history, extra = {}) => renderToStaticMarkup(createElement(Train, { session, history, now: Date.parse(at(1)),
      loadOptions: RACK, calibrationLoads: RACK, ...extra, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onReturn: noop })));
  } finally { await server.close(); }
}

test('needsCalibration: only an uncalibrated loaded variant before set 1 has a load', () => {
  const session = liveSession([]);
  const press = session.exercises[0];
  const plank = session.exercises.find((entry) => entry.exerciseId === 'plank');
  assert.ok(plank);
  assert.equal(needsCalibration(press, []), true, 'loaded, no history');
  assert.equal(needsCalibration(plank, []), false, 'holds never calibrate');
  const pushUp = { exerciseId: 'push-up', name: 'Push-Up', planned: [{ weight: 0, reps: 10 }],
    performed: [{ weight: 0, reps: 10, done: false, completedAt: null }] };
  assert.equal(exerciseById('push-up')?.equipment, 'Bodyweight');
  assert.equal(needsCalibration(pushUp, []), false, 'bodyweight never calibrates');
  assert.equal(needsCalibration(liveSession(pressHistory()).exercises[0], pressHistory()), false, 'history');
  assert.equal(needsCalibration(updatePerformedSet(session, 0, 0, { weight: 15 }, at(1)).exercises[0], []), false,
    'a chosen load is already calibrated');
  assert.equal(needsCalibration(logSet(session, 0, 0, at(1)).exercises[0], []), true, 'a ✓ at no load logs nothing (#103)');
});

test('an early finish that never reached an exercise leaves it uncalibrated', () => {
  const first = liveSession([]);
  const history = finish(logSet(updatePerformedSet(first, 0, 0, { weight: 15 }, at(1)), 0, 0, at(1)));
  const next = liveSession(history);
  const untouched = next.exercises.findIndex((entry, index) => index > 0 && entry.exerciseId !== 'plank');
  assert.ok(untouched > 0);
  assert.equal(needsCalibration(next.exercises[untouched], history), true, 'saved but never done');
  assert.equal(needsCalibration(next.exercises[0], history), false, 'a done set calibrates');
});

test('the step offers only confirmed loads, never the example rack', async () => {
  assert.deepEqual(loadOptions('home', undefined), [], 'the logger offers no example rack either');
  assert.ok(HOME_DUMBBELLS.length > 0);
  assert.deepEqual(confirmedLoads('home', undefined), []);
  assert.deepEqual(confirmedLoads('home', [18, 10]), [10, 18]);
  assert.deepEqual(confirmedLoads('hotel', [18, 10]), [], 'a home rack is not the hotel rack');
  await withTrain((render) => {
    // (#309) Every loaded lift types its first weight in set 1's cell; no rack is offered above the table.
    for (const calibrationLoads of [[], RACK]) {
      const html = render(liveSession([]), [], { calibrationLoads });
      assert.match(plain(html), RULE);
      assert.doesNotMatch(html, /role="group" aria-label="Your dumbbells/);
      assert.doesNotMatch(html, new RegExp(HOME_DUMBBELLS.map((kg) => `>${kg}<`).join('|')), 'no example rack');
    }
  });
});


test('#309: a first-time lift with no profile level types its weight in set 1; nothing is pre-filled', async () => {
  await withTrain((render) => {
    const html = render(liveSession([]), []);
    const text = plain(html);
    assert.match(text, RULE);
    assert.doesNotMatch(text, /Suggested start/, 'no level, no suggestion');
    for (const word of ['Confirm', 'Skip', 'Save set', 'Cancel', 'Done']) assert.doesNotMatch(html, new RegExp(`>${word}<`), word);
    assert.doesNotMatch(html, /<button(?![^>]*lg-wcheck)[^>]*aria-pressed/, 'no load pills');
    for (const n of [1, 2, 3]) {
      assert.equal(cell(html, `Set ${n} weight, kilograms each`), '', `set ${n} is empty`);
      assert.match(html, new RegExp(`aria-label="Log set ${n}" disabled=""`), 'an empty load cannot be logged');
    }

    const history = pressHistory();
    assert.doesNotMatch(plain(render(liveSession(history), history)), RULE, 'a variant with history');

    let atPlank = liveSession([]);
    const plankIndex = atPlank.exercises.findIndex((entry) => entry.exerciseId === 'plank');
    for (let index = 0; index < plankIndex; index += 1) {
      atPlank = { ...atPlank, exercises: atPlank.exercises.map((entry, i) => i === index ? { ...entry, skipped: true } : entry) };
    }
    assert.doesNotMatch(plain(render(atPlank, [])), RULE, 'a hold');
  });
});

test('#309: with a profile level, every empty weight cell shows the suggested start and the hint names it', async () => {
  await withTrain((render) => {
    const html = render(liveSession([]), [], { experience: 'Beginner' });
    const text = plain(html);
    const hint = text.match(/Suggested start (\d+(?:\.\d+)?) kg each\. Do 5 easy reps with it, then adjust set 1\./);
    assert.ok(hint, text);
    assert.ok(RACK.includes(Number(hint[1])), 'the suggestion is one of the lifter\'s own dumbbells');
    for (const n of [1, 2, 3]) {
      assert.equal(cell(html, `Set ${n} weight, kilograms each`), hint[1], `set ${n} shows the suggestion`);
      assert.match(html, new RegExp(`aria-label="Log set ${n}">`), `set ${n} logs in one tap`);
    }
    assert.doesNotMatch(text, /First time on this one/, 'one line, not two');
  });
});


test('confirm pre-fills set 1 only; the ramp set is never recorded and progression is unchanged', async () => {
  const start = liveSession([]);
  // Confirm is the same single patch a weight pill sends: set 1's pending weight.
  const confirmed = updatePerformedSet(start, 0, 0, { weight: 15 }, at(1));
  const expected = structuredClone(start);
  expected.exercises[0].performed[0].weight = 15;
  assert.deepEqual(confirmed, expected, 'nothing else reaches the session record');
  assert.equal(confirmed.exercises[0].performed.filter((set) => set.done).length, 0, 'no ramp set');

  await withTrain((render) => {
    const html = render(confirmed, []);
    assert.equal(cell(html, 'Set 1 weight, kilograms each'), '15');
    assert.equal(cell(html, 'Set 1 reps'), '8');
    assert.match(html, /aria-label="Log set 1">/, 'one tap logs it');
  });

  // Changing the load later still logs actuals exactly.
  const changed = logSet(updatePerformedSet(confirmed, 0, 0, { weight: 18 }, at(2)), 0, 0, at(2));
  assert.equal(changed.exercises[0].performed[0].weight, 18);
  const history = finish(changed);
  const press = history[0].exercises[0];
  assert.equal(press.performed.length, start.exercises[0].performed.length, 'no extra set stored');
  assert.deepEqual(press.performed.filter((set) => set.done).map((set) => set.weight), [18]);

  // The first-session target is the same with or without calibration.
  const definition = exerciseById('dumbbell-floor-press');
  assert.ok(definition);
  const skippedCalibration = finish(logSet(updatePerformedSet(start, 0, 0, { weight: 18 }, at(2)), 0, 0, at(2)));
  assert.deepEqual(prescribeExercise(definition, profile, history).weight,
    prescribeExercise(definition, profile, skippedCalibration).weight);
  assert.equal(prescribeExercise(definition, profile, []).basis, 'first-time');
});


// #103: a loaded set still needs a load before it can be logged.
test('a loaded set with no load cannot be logged at 0; bodyweight and timed sets still log', async () => {
  const session = liveSession([]);
  assert.equal(session.exercises[0].performed[0].weight, 0, 'first-time press has no load yet');
  assert.equal(logSet(session, 0, 0, at(1)), session, 'logSet stores nothing at weight 0');
  const loaded = logSet(updatePerformedSet(session, 0, 0, { weight: 15 }, at(1)), 0, 0, at(1));
  assert.equal(loaded.exercises[0].performed[0].done, true, 'a load lets it log');

  const plankIndex = session.exercises.findIndex((entry) => entry.exerciseId === 'plank');
  assert.equal(logSet(session, plankIndex, 0, at(1)).exercises[plankIndex].performed[0].done, true, 'a hold logs at 0');
  const pushUps = createSession({ id: 'bw', name: 'BW', dayIndex: 0, now: at(0), exercises: [{ exerciseId: 'push-up',
    name: 'Push-Up', planned: [{ weight: 0, reps: 10 }], performed: [{ weight: 0, reps: 10, done: false, completedAt: null }] }] });
  assert.equal(logSet(pushUps, 0, 0, at(1)).exercises[0].performed[0].done, true, 'bodyweight logs at 0');
  const bench = createSession({ id: 'bb', name: 'BB', dayIndex: 0, now: at(0), exercises: [{ exerciseId: 'barbell-bench-press',
    name: 'Barbell Bench Press', planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false, completedAt: null }] }] });
  assert.equal(logSet(bench, 0, 0, at(1)), bench, 'a barbell set needs a load too');

  await withTrain((render) => {
    const html = render(session, []);
    for (const n of [1, 2, 3]) assert.match(html, new RegExp(`aria-label="Log set ${n}"[^>]*disabled=""`), `set ${n} waits for a load`);
    assert.match(plain(html), /Enter a weight to log this set/);
    const ready = render(updatePerformedSet(session, 0, 0, { weight: 15 }, at(1)), []);
    assert.match(ready, /aria-label="Log set 1">/, 'a load enables the ✓');
    assert.doesNotMatch(plain(ready), /Enter a weight to log this set/);
    const atPlank = { ...session, exercises: session.exercises.map((entry, i) => i < plankIndex ? { ...entry, skipped: true } : entry) };
    const hold = render(atPlank, []);
    assert.match(hold, /aria-label="Log set 1">/, 'a hold logs with no load');
    assert.doesNotMatch(plain(hold), /Enter a weight to log this set/);
  });
});

// #103: no edit or correction turns a loaded set into a logged set at weight 0.
test('editing or correcting a logged loaded set cannot store weight 0', async () => {
  const start = liveSession([]);
  // Logging carries the load to every later set (#182); clear set 3 so the no-load case still exists.
  const logged = updatePerformedSet(logSet(updatePerformedSet(start, 0, 0, { weight: 15 }, at(1)), 0, 0, at(1)), 0, 2, { weight: 0 }, at(1));
  // (#309) A logged set is edited in its row; the record still refuses a logged loaded set at 0.
  assert.equal(updatePerformedSet(logged, 0, 0, { weight: 0 }, at(2)), logged, 'an edit to 0 writes nothing');
  assert.equal(updatePerformedSet(logged, 0, 0, { weight: 18 }, at(2)).exercises[0].performed[0].weight, 18,
    'a real load still saves');
  assert.equal(updatePerformedSet(start, 0, 1, { weight: 0 }, at(2)).exercises[0].performed[1].weight, 0,
    'a pending set may still be cleared');

  const state = { ...EMPTY_STATE, profile, history: finish(logged) };
  const id = state.history[0].id;
  assert.equal(applyCorrection(state, id, 0, 0, { weight: 0 }, at(40)), state, 'history correction to 0 is refused');
  assert.equal(state.history[0].exercises[0].performed[2].weight, 0, 'set 3 never got a load');
  assert.equal(applyCorrection(state, id, 0, 2, { done: true }, at(40)), state, 'marking a no-load set complete is refused');
  assert.equal(applyCorrection(state, id, 0, 0, { reps: 9 }, at(40)).history[0].exercises[0].performed[0].reps, 9,
    'other corrections still apply');
  const plankIndex = start.exercises.findIndex((entry) => entry.exerciseId === 'plank');
  assert.equal(applyCorrection(state, id, plankIndex, 0, { done: true }, at(40)).history[0].exercises[plankIndex].performed[0].done,
    true, 'a hold needs no load');

});
