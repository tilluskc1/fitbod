import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, editSet, logSet, revertBurst, undoCarry, type CarryResult, type Followers } from '../src/lib/session.ts';
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

test('after a reload, a cleared cell shows the muted suggestion again; nothing stores it (owner, #315 item 12)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    // A reload mounts the logger fresh on the stored record, where a cleared set 1 is stored as 0.
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(Train, { session: bench(), history: [], now: Date.parse(NOW), calibrationLoads: [],
      unit: 'lb', experience: 'Beginner', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop }));
    const hint = html.match(/Suggested start (\d+) lb/)?.[1];
    assert.ok(hint);
    const set1 = html.match(/<input[^>]*aria-label="Set 1 weight, pounds"[^>]*>/)?.[0] ?? '';
    assert.match(set1, new RegExp(`value="${hint}"`), 'set 1 shows the suggestion again');
    assert.match(set1, /lg-cell--empty/, 'in the muted style: it is a suggestion, not a typed load');
    assert.doesNotMatch(html, /aria-label="Log set 1" disabled/, 'and logs in one tap at the suggestion');
  } finally {
    await server.close();
  }
  // No second key outside the versioned record.
  for (const file of readdirSync('src', { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(file)) continue;
    assert.doesNotMatch(readFileSync(`src/${file}`, 'utf8'), /cleared-cells/, file);
  }
});
