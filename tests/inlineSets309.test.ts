import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { firstTimeLoaded, needsCalibration } from '../src/lib/liveProgression.ts';
import { createSession, editSet, logSet, undoCarry, updatePerformedSet } from '../src/lib/session.ts';
import { toKg } from '../src/lib/units.ts';
import type { WorkoutRecord } from '../src/types.ts';

// (#309) The weight and reps cells are the inputs; the separate editor and the first-weight block are gone.
const noop = () => {};
const at = (minute: number) => `2026-11-09T10:${String(minute).padStart(2, '0')}:00.000Z`;
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const cell = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];

function bench(weight = 0): WorkoutRecord {
  return createSession({ id: 'b309', name: 'Upper', dayIndex: 0, now: at(0), exercises: [{
    exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press',
    planned: Array.from({ length: 4 }, () => ({ weight, reps: 8 })),
    performed: Array.from({ length: 4 }, () => ({ weight, reps: 8, done: false, completedAt: null })),
  }] });
}

type Render = (session: WorkoutRecord, extra?: Record<string, unknown>) => string;
async function withTrain(run: (render: Render) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    run((session, extra = {}) => renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at(1)),
      loadOptions: [], calibrationLoads: [], unit: 'lb', experience: 'Beginner', onMinimize: noop, onFinish: noop,
      onUpdateSet: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop, ...extra })));
  } finally { await server.close(); }
}

test('a first-time Bench: no weight field above the table; every set shows the suggested start and logs in one tap', async () => {
  await withTrain((render) => {
    const html = render(bench());
    const text = plain(html);
    const hint = text.match(/Suggested start (\d+) lb\. Do 5 easy reps with it, then adjust set 1\./);
    assert.ok(hint, text);
    const [table] = html.match(/<table[\s\S]*<\/table>/) ?? [''];
    assert.equal(html.split('<input').length, table.split('<input').length, 'every input is a set cell');
    for (const n of [1, 2, 3, 4]) {
      assert.equal(cell(html, `Set ${n} weight, pounds`), hint[1]);
      assert.equal(cell(html, `Set ${n} reps`), '8');
      assert.match(html, new RegExp(`aria-label="Log set ${n}">`), `set ${n} is one tap`);
    }
    assert.match(html, /<th scope="col">lb total<\/th>/, 'the unit is in the column header (uppercased by CSS)');
    assert.match(html, /inputMode="decimal" enterKeyHint="next"[^>]*aria-label="Set 1 weight, pounds"/);
    assert.match(html, /inputMode="numeric" enterKeyHint="done"[^>]*aria-label="Set 1 reps"/);
  });
});

test('no Save set, Done, Cancel, Confirm, Skip or reps stepper remains in the logger', async () => {
  await withTrain((render) => {
    for (const session of [bench(), logSet(bench(toKg(135, 'lb')), 0, 0, at(1))]) {
      const html = render(session);
      for (const word of ['Save set', 'Done', 'Cancel', 'Confirm', 'Skip']) assert.doesNotMatch(html, new RegExp(`>${word}<`), word);
      assert.doesNotMatch(html, /class="stepper"|Increase reps|Decrease reps/);
    }
  });
  const source = readFileSync(new URL('../src/screens/TrainScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Save set|className="stepper"|CalibrationStep|SaveSetRow/);
});

test('an empty weight cannot be logged for a loaded lift, without a suggestion or once it is cleared', async () => {
  await withTrain((render) => {
    const html = render(bench(), { experience: undefined });
    assert.doesNotMatch(plain(html), /Suggested start/);
    for (const n of [1, 2, 3, 4]) {
      assert.equal(cell(html, `Set ${n} weight, pounds`), '');
      assert.match(html, new RegExp(`aria-label="Log set ${n}" disabled=""`));
    }
    const typed = render(updatePerformedSet(bench(), 0, 0, { weight: toKg(135, 'lb') }, at(1)), { experience: undefined });
    assert.equal(cell(typed, 'Set 1 weight, pounds'), '135');
    assert.match(typed, /aria-label="Log set 1">/);
  });
});

test('logging at the suggestion writes it to that set and carries it to later empty sets only', () => {
  // App.logOneSet: the suggested start is written to the tapped set, then logSet carries it (#182).
  const start = editSet(bench(), 0, 2, { weight: toKg(95, 'lb') }, at(1)).session;
  const filled = updatePerformedSet(start, 0, 0, { weight: toKg(45, 'lb') }, at(2));
  const logged = logSet(filled, 0, 0, at(2));
  const weights = logged.exercises[0].performed.map((set) => Math.round(set.weight / toKg(1, 'lb')));
  assert.deepEqual(weights, [45, 45, 95, 95], 'set 3 keeps its typed 95 and set 4 followed it');
  assert.equal(logged.exercises[0].performed[0].done, true);
  assert.deepEqual(logged.exercises[0].planned, bench().exercises[0].planned, 'prescriptions are never changed');
});

test('set 1 typed to 135 carries to sets 2 to 4; logging it leaves them at 135', () => {
  const typed = editSet(bench(), 0, 0, { weight: toKg(135, 'lb') }, at(1));
  assert.deepEqual(typed.carried, [1, 2, 3]);
  const logged = logSet(typed.session, 0, 0, at(2));
  assert.ok(logged.exercises[0].performed.every((set) => Math.abs(set.weight - toKg(135, 'lb')) < 1e-9));
  assert.deepEqual(logged.exercises[0].performed.map((set) => set.done), [true, false, false, false]);
});

test('Undo of a logged-set edit puts that set and its carried sets back', () => {
  const kg = (lb: number) => toKg(lb, 'lb');
  const logged = logSet(bench(kg(135)), 0, 0, at(1));
  const edit = editSet(logged, 0, 0, { weight: kg(140) }, at(2));
  assert.deepEqual(edit.carried, [1, 2, 3]);
  const before = logged.exercises[0].performed[0];
  const undone = undoCarry(edit.session, 0, 'barbell-bench-press', edit.previous, at(3), { index: 0, weight: before.weight, reps: before.reps });
  assert.deepEqual(undone.exercises[0].performed.map((set) => set.weight), logged.exercises[0].performed.map((set) => set.weight));
  assert.equal(undone.exercises[0].performed[0].done, true, 'still logged');
  // Without `edited`, the logged set itself is not touched (the #306 rule).
  assert.equal(undoCarry(edit.session, 0, 'barbell-bench-press', edit.previous, at(3)).exercises[0].performed[0].weight, kg(140));
});

test('firstTimeLoaded keeps the hint while set 1 is typed; needsCalibration still needs an empty set 1', () => {
  const typed = updatePerformedSet(bench(), 0, 0, { weight: toKg(135, 'lb') }, at(1)).exercises[0];
  assert.equal(firstTimeLoaded(typed, []), true);
  assert.equal(needsCalibration(typed, []), false);
  assert.equal(firstTimeLoaded(logSet(bench(toKg(135, 'lb')), 0, 0, at(1)).exercises[0], []), false, 'a logged set ends it');
});
