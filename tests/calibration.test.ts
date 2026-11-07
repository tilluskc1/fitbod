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
import { openDraft, applyDraft, saveDraft } from '../src/lib/editDraft.ts';
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
    assert.match(html, />Skip</);
    // A load pill still confirms with its own tap; Confirm is for a typed weight off the rack (#129).
    assert.match(html, /<button class="pill-primary" disabled=""[^>]*>Confirm</, 'nothing typed yet');
    assert.match(html, /aria-label="Enter dumbbell load \(kg each\)"/);
    assert.match(html, /role="group" aria-label="Your dumbbells \(kg each\)"/);
    for (const weight of RACK) assert.match(html, new RegExp(`aria-pressed="false"[^>]*>${weight}<`));
    assert.doesNotMatch(html, /aria-pressed="true"/, 'no load pre-selected or suggested');
    for (const n of [1, 2, 3]) {
      assert.match(html, new RegExp(`aria-label="Log set ${n}" disabled=""`), 'logging waits for a choice or Skip');
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
    assert.match(html, /aria-label="Edit weight for set 1"[^>]*>15</);
    assert.match(html, /aria-label="Edit reps for set 1"[^>]*>8</);
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

test('calibration step: Skip, Confirm and a load pill call only their own handlers', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { CalibrationStep, WeightRow } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const calls: unknown[][] = [];
    const buttonsOf = (tree: unknown) => {
      const buttons: any[] = [];
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'button') buttons.push(node);
        for (const child of [node.props?.children].flat(Infinity)) visit(child);
      };
      visit(tree);
      return (text: string) => buttons.find((button) => [button.props.children].flat().join('') === text);
    };
    const step = buttonsOf(CalibrationStep({ selected: 15,
      onConfirm: (...args: unknown[]) => calls.push(['confirm', ...args]),
      onSkip: (...args: unknown[]) => calls.push(['skip', ...args]) }));
    step('Skip').props.onClick();
    assert.deepEqual(calls, [['skip']], 'skip writes nothing');
    step('Confirm').props.onClick();
    assert.deepEqual(calls.at(-1), ['confirm', 15]);
    assert.equal(buttonsOf(CalibrationStep({ onSkip: noop }))('Confirm'), undefined, 'pills need no Confirm');

    // One tap on a load is the whole confirm: it hands that load to confirmWeight, nothing else.
    const row = buttonsOf(WeightRow({ label: 'Your dumbbells', unitText: 'kg each', loads: RACK, selected: null,
      show: String, onPick: (...args: unknown[]) => calls.push(['pick', ...args]) }));
    row('15').props.onClick();
    assert.deepEqual(calls.at(-1), ['pick', 15]);
    assert.equal(calls.length, 3);
  } finally { await server.close(); }
});

// #103: Skip only hides the help; a loaded set still needs a load before it can be logged.
test('after Skip a loaded set cannot be logged at 0; bodyweight and timed sets still log', async () => {
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
    const skipped = [`${session.id}:0:${session.exercises[0].exerciseId}`];
    const html = render(session, [], { skippedCalibrations: skipped });
    assert.doesNotMatch(plain(html), RULE, 'the help is gone');
    for (const n of [1, 2, 3]) assert.match(html, new RegExp(`aria-label="Log set ${n}"[^>]*disabled=""`), `set ${n} waits for a load`);
    assert.match(plain(html), /Enter a weight to log this set/);
    const ready = render(updatePerformedSet(session, 0, 0, { weight: 15 }, at(1)), [], { skippedCalibrations: skipped });
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
  const set = logged.exercises[0].performed[0];
  const zeroed = saveDraft(applyDraft(openDraft(0, 0, set), { weight: 0 }), set);
  assert.equal(updatePerformedSet(logged, 0, 0, zeroed, at(2)), logged, 'Save set at 0 writes nothing');
  assert.equal(updatePerformedSet(logged, 0, 0, saveDraft(applyDraft(openDraft(0, 0, set), { weight: 18 }), set), at(2))
    .exercises[0].performed[0].weight, 18, 'a real load still saves');
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

  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { SaveSetRow } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const html = (needsWeight: boolean) => renderToStaticMarkup(createElement(SaveSetRow, { needsWeight, onCancel: noop, onSave: noop }));
    assert.match(html(true), /disabled=""[^>]*>Save set</);
    assert.match(plain(html(true)), /Enter a weight to log this set/);
    assert.match(html(false), /class="pill-primary">Save set</);
    assert.doesNotMatch(plain(html(false)), /Enter a weight/);
  } finally { await server.close(); }
});
