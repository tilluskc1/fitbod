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
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'New', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'kg',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
const RULE = /Pick a weight you could lift about 12 times with good form/;

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
      loadOptions: RACK, calibrationLoads: RACK, ...extra, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogNext: noop,
      onToggleRestPause: noop, onExtendRest: noop, onSwap: noop, onSkip: noop, onReturn: noop })));
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
  assert.equal(needsCalibration(logSet(session, 0, 0, at(1)).exercises[0], []), false, 'a logged set ends it');
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
    assert.doesNotMatch(plain(render(liveSession([]), [], { calibrationLoads: [] })), RULE, 'unconfirmed rack');
    assert.match(plain(render(liveSession([]), [])), RULE, 'confirmed rack');
  });
});

test('a skipped step stays skipped for the open session, and Skip has its own name', async () => {
  const session = liveSession([]);
  await withTrain((render) => {
    assert.match(render(session, []), /aria-label="Skip first-weight help"/);
    const key = `${session.id}:0:${session.exercises[0].exerciseId}`;
    assert.doesNotMatch(plain(render(session, [], { skippedCalibrations: [key] })), RULE);
  });
});

test('the logger shows the calibration step with nothing pre-selected, only for an uncalibrated loaded variant', async () => {
  await withTrain((render) => {
    const html = render(liveSession([]), []);
    const text = plain(html);
    assert.match(text, RULE);
    assert.match(text, /Do 5 easy reps with it, then confirm or change/);
    assert.match(html, />Confirm</);
    assert.match(html, />Skip</);
    for (const weight of RACK) assert.match(html, new RegExp(`aria-pressed="false"[^>]*>${weight}<`));
    assert.doesNotMatch(html, /aria-pressed="true"/, 'no load pre-selected or suggested');
    assert.match(html, /<button[^>]*class="pill-primary"[^>]*disabled=""[^>]*>Confirm</, 'confirm waits for a choice');

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
    assert.doesNotMatch(plain(html), RULE);
    assert.match(html, /aria-pressed="true"[^>]*>15</);
    assert.match(plain(html), /Log set 1 · 8 reps @ 15 kg/);
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

test('calibration step: Skip and Confirm call only their own handlers', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { CalibrationStep } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const calls: unknown[][] = [];
    const tree = CalibrationStep({ selected: 15, children: null,
      onConfirm: (...args: unknown[]) => calls.push(['confirm', ...args]),
      onSkip: (...args: unknown[]) => calls.push(['skip', ...args]) });
    const buttons: any[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'button') buttons.push(node);
      for (const child of [node.props?.children].flat(Infinity)) visit(child);
    };
    visit(tree);
    const byText = (text: string) => buttons.find((button) => [button.props.children].flat().join('') === text);
    byText('Skip').props.onClick();
    assert.deepEqual(calls, [['skip']], 'skip writes nothing');
    byText('Confirm').props.onClick();
    assert.deepEqual(calls.at(-1), ['confirm', 15]);
  } finally { await server.close(); }
});
