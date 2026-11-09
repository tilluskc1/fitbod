import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, editSet, logSet, revertBurst, undoCarry, type CarryResult, type Followers } from '../src/lib/session.ts';
import { readCleared, writeCleared } from '../src/lib/clearedCells.ts';
import { toKg } from '../src/lib/units.ts';
import type { WorkoutRecord } from '../src/types.ts';

// #309 review 2: a refused or emptied keystroke undoes its whole burst, not just its own cell.
const NOW = '2026-11-09T10:00:00.000Z';
const ID = 'barbell-bench-press';

function bench(weight = 0, reps = 8): WorkoutRecord {
  return createSession({ id: 'b309r2', name: 'Upper', dayIndex: 0, now: NOW, exercises: [{
    exerciseId: ID, name: 'Barbell Bench Press',
    planned: Array.from({ length: 4 }, () => ({ weight, reps })),
    performed: Array.from({ length: 4 }, () => ({ weight, reps, done: false, completedAt: null })),
  }] });
}
const weights = (s: WorkoutRecord) => s.exercises[0].performed.map((set) => set.weight);
const repsOf = (s: WorkoutRecord) => s.exercises[0].performed.map((set) => set.reps);

/** A keystroke burst as App runs it: followers fixed by the first keystroke, Undo's values merged by set. */
function burst(s: WorkoutRecord, set: number, patches: { weight?: number; reps?: number }[]) {
  let followers: Followers | undefined;
  const previous: CarryResult['previous'] = [];
  for (const patch of patches) {
    const result = editSet(s, 0, set, patch, NOW, followers);
    followers = result.followers;
    for (const p of result.previous) if (!previous.some((q) => q.index === p.index)) previous.push(p);
    s = result.session;
  }
  return { session: s, previous, followers };
}

test('the review-2 blocker: 1, 13, 135, 1359 then a refused paste leaves no set holding a load (lb and kg)', () => {
  for (const [unit, typed] of [['lb', [1, 13, 135, 1359]], ['kg', [2, 20, 200, 2000]]] as const) {
    const start = bench();
    const typing = burst(start, 0, typed.map((value) => ({ weight: toKg(value, unit) })));
    assert.ok(weights(typing.session).every((kg) => kg > 0), `${unit}: the burst carried to every set`);
    // The refusal puts set 1 back to its value when the burst began, the rest to what Undo restores.
    const refused = revertBurst(typing.session, 0, ID, 0, { weight: 0 }, typing.previous, NOW);
    assert.deepEqual(weights(refused), [0, 0, 0, 0], `${unit}: nothing holds the refused burst's load`);
    const undone = undoCarry(typing.session, 0, ID, typing.previous, NOW);
    assert.deepEqual(weights(refused).slice(1), weights(undone).slice(1), `${unit}: the same values Undo restores`);
  }
});

test('an emptied set 1 puts back every set its burst carried; an empty first keystroke carries nothing', () => {
  const LB45 = toKg(45, 'lb');
  const typing = burst(bench(LB45), 0, [{ weight: toKg(1, 'lb') }, { weight: toKg(13, 'lb') }, { weight: toKg(135, 'lb') }]);
  const emptied = revertBurst(typing.session, 0, ID, 0, { weight: 0 }, typing.previous, NOW);
  assert.deepEqual(weights(emptied), [0, LB45, LB45, LB45]);
  // Typing again in the same burst carries to the same sets.
  const again = editSet(emptied, 0, 0, { weight: toKg(115, 'lb') }, NOW, typing.followers).session;
  assert.deepEqual(weights(again), Array(4).fill(toKg(115, 'lb')));
});

test('an emptied or refused logged set goes back to its burst-start value with its carried sets', () => {
  const logged = logSet(bench(toKg(135, 'lb')), 0, 0, NOW);
  const typing = burst(logged, 0, [{ reps: 1 }, { reps: 12 }]);
  assert.deepEqual(repsOf(typing.session), [12, 12, 12, 12]);
  const back = revertBurst(typing.session, 0, ID, 0, { reps: 8 }, typing.previous, NOW);
  assert.deepEqual(repsOf(back), [8, 8, 8, 8]);
  assert.ok(back.exercises[0].performed[0].done, 'still logged');
});

test('a logged set never takes 0 reps; an unlogged one may be emptied (its ✓ is then disabled)', () => {
  const logged = logSet(bench(toKg(135, 'lb')), 0, 0, NOW);
  const edit = editSet(logged, 0, 0, { reps: 0 }, NOW);
  assert.equal(edit.session.exercises[0].performed[0].reps, 8);
  assert.deepEqual(edit.carried, []);
  assert.equal(editSet(bench(), 0, 1, { reps: 0 }, NOW).session.exercises[0].performed[1].reps, 0);
});

/** A Storage stand-in for node. */
function fakeStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; } };
}

test('cleared cells are remembered for the running workout only, and a broken store reads as none', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true });
    writeCleared('a', ['a:0:x:1']);
    assert.deepEqual(readCleared('a'), ['a:0:x:1']);
    assert.deepEqual(readCleared('b'), [], 'another workout sees none');
    writeCleared('b', ['b:0:x:0']);
    assert.deepEqual(readCleared('a'), [], 'one workout at a time: the store never grows');
    globalThis.localStorage.setItem('fitbod-clone-v1:cleared-cells', '{not json');
    assert.deepEqual(readCleared('b'), []);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('after a reload, a cell the lifter cleared stays empty; the others keep the suggestion', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true });
    const session = bench();
    writeCleared(session.id, [`${session.id}:0:${ID}:0`]);
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(NOW), calibrationLoads: [],
      unit: 'lb', experience: 'Beginner', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop }));
    const cell = (n: number) => html.match(new RegExp(`aria-label="Set ${n} weight, pounds"[^>]*value="([^"]*)"`))?.[1];
    assert.equal(cell(1), '', 'the cleared cell stays empty');
    const hint = html.match(/Suggested start (\d+) lb/)?.[1];
    assert.ok(hint);
    for (const n of [2, 3, 4]) assert.equal(cell(n), hint, `set ${n} keeps the suggestion`);
    assert.match(html, /aria-label="Log set 1" disabled=""/, 'the cleared set cannot log an empty load');
  } finally {
    await server.close();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
