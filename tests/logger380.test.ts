import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, logSet } from '../src/lib/session.ts';
import { toKg } from '../src/lib/units.ts';
import type { WorkoutRecord } from '../src/types.ts';
import { focusedSet, isLogged, rowLine } from './loggerView380.ts';

// (#380) Logger option B: the focus card, the set list, the chips, and the More sheet's Later row.
const noop = () => {};
const at = (minute: number) => `2026-11-14T10:${String(minute).padStart(2, '0')}:00.000Z`;
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const sets = (weight: number, reps: number, count = 3) => ({
  planned: Array.from({ length: count }, () => ({ weight, reps })),
  performed: Array.from({ length: count }, () => ({ weight, reps, done: false, completedAt: null })),
});

function day(exercises: { exerciseId: string; name: string; weight: number; reps: number; count?: number }[]): WorkoutRecord {
  return createSession({ id: 'l380', name: 'Push', dayIndex: 0, now: at(0), exercises: exercises.map(({ exerciseId, name, weight, reps, count }) =>
    ({ exerciseId, name, ...sets(weight, reps, count) })) });
}

type Render = (session: WorkoutRecord, extra?: Record<string, unknown>) => string;
async function withTrain(run: (render: Render) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    run((session, extra = {}) => renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at(1)),
      rampLoads: [], calibrationLoads: [], unit: 'lb', onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop, ...extra })));
  } finally { await server.close(); }
}

test('the top shows sets done and a tick per set grouped by exercise; no bottom bar or caption', async () => {
  const session = logSet(day([
    { exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: toKg(135, 'lb'), reps: 5 },
    { exerciseId: 'overhead-press', name: 'Overhead Press', weight: toKg(65, 'lb'), reps: 8, count: 2 },
  ]), 0, 0, at(1));
  await withTrain((render) => {
    const html = render(session);
    assert.match(html, /<b class="lg-count">1 of 5 sets<\/b>/);
    const ticks = html.match(/<div class="lg-ticks"[\s\S]*?<\/div>/)?.[0] ?? '';
    const groups = ticks.match(/<span class="lg-ticks__group">([\s\S]*?)<\/span><\/span>/g) ?? [];
    assert.equal(groups.length, 2, `one group per exercise: ${ticks}`);
    assert.equal((groups[0].match(/lg-tick--done/g) ?? []).length, 1, 'the logged set fills');
    assert.equal((groups[1].match(/class="lg-tick[" ]/g) ?? []).length, 2);
    assert.doesNotMatch(html, /lg-cap|lg-bar/, 'the bottom bar and its caption are gone');
  });
});

test('the card reads "lb · bar" only at the empty barbell; kg reads "kg · bar"; dumbbells never', async () => {
  await withTrain((render) => {
    const bench = (lb: number) => day([{ exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: toKg(lb, 'lb'), reps: 5 }]);
    assert.match(render(bench(45)), /<small>lb · bar<\/small>/);
    assert.match(render(bench(135)), /<small>lb<\/small>/);
    const kg = day([{ exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: 20, reps: 5 }]);
    assert.match(render(kg, { unit: 'kg' }), /<small>kg · bar<\/small>/);
    const press = day([{ exerciseId: 'dumbbell-floor-press', name: 'Dumbbell Floor Press', weight: toKg(45, 'lb'), reps: 8 }]);
    assert.match(render(press), /<small>lb each<\/small>/);
    assert.doesNotMatch(render(press), /· bar/);
  });
});

test('one Log button for the next set; every set is a row button into the card; − and + sit in the weight box', async () => {
  const session = logSet(day([{ exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: toKg(135, 'lb'), reps: 5, count: 4 }]), 0, 0, at(1));
  await withTrain((render) => {
    const html = render(session);
    assert.equal(focusedSet(html), 2);
    assert.equal(html.match(/aria-label="Log set \d"/g)?.join(), 'aria-label="Log set 2"');
    assert.match(html, /<button type="button" class="lg-log" aria-label="Log set 2">/);
    for (const n of [1, 2, 3, 4]) assert.equal(rowLine(html, n), '135 lb × 5', `set ${n}'s row`);
    assert.ok(isLogged(html, 1) && !isLogged(html, 2));
    assert.match(html, /aria-label="Set 2, 135 lb × 5, edit" aria-current="true"/, 'the card\'s set is marked');
    assert.match(plain(html), /Set 2, 135 lb × 5|2 135 lb × 5 Now/);
    const box = html.match(/<div class="lg-field lg-field--w"[\s\S]*?<\/button><\/div>/)?.[0] ?? '';
    assert.match(box, /aria-label="− 5 lb"[\s\S]*aria-label="Set 2 weight, pounds"[\s\S]*aria-label="\+ 5 lb"/, '− input + in one box');
  });
});

test('chips are History, Replace, More; How-to, Later and the ⋮ button are gone from the screen', async () => {
  const session = day([
    { exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', weight: toKg(135, 'lb'), reps: 5 },
    { exerciseId: 'overhead-press', name: 'Overhead Press', weight: toKg(65, 'lb'), reps: 8 },
  ]);
  await withTrain((render) => {
    const chips = (html: string) => [...(html.match(/<div class="lg-acts"[\s\S]*?<\/div>/)?.[0] ?? '').matchAll(/<\/(?:span|svg)>(?:<\/span>)?([A-Za-z-]+)<\/button>/g)].map((m) => m[1]);
    assert.deepEqual(chips(render(session, { onReplace: noop, onLater: noop })), ['History', 'Replace', 'More']);
    assert.deepEqual(chips(render(session, { onLater: noop })), ['History', 'More'], 'Replace only with its handler');
    assert.doesNotMatch(render(session, { onReplace: noop, onLater: noop }), /More actions for|class="lg-more"/);
  });
});

test('Q2: a superset lists the pair round by round; the card names the half; the partner rows are display-only', async () => {
  const session = day([
    { exerciseId: 'dumbbell-row', name: 'Dumbbell Row', weight: toKg(50, 'lb'), reps: 10 },
    { exerciseId: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', weight: toKg(40, 'lb'), reps: 10 },
  ]);
  await withTrain((render) => {
    const first = render(session, { pairs: [[0, 1]] });
    assert.match(first, /<h3 class="lg-focus__set">A1 <span>· set 1 of 3<\/span><\/h3>/);
    const order = [...first.matchAll(/<span class="lg-li__n">([AB]\d)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(order, ['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    assert.equal((first.match(/<button type="button" class="lg-li/g) ?? []).length, 3, 'only the shown exercise\'s rows are buttons');
    assert.equal((first.match(/<div class="lg-li lg-li--partner/g) ?? []).length, 3, 'the partner rows are plain, muted');
    // Logging A1 moves the card to B1, labelled B1 (pairedPendingIndex, unchanged).
    const second = render(logSet(session, 0, 0, at(1)), { pairs: [[0, 1]] });
    assert.match(second, /<h3 class="lg-focus__set">B1 <span>· set 1 of 3<\/span><\/h3>/);
    assert.match(second, /aria-label="Log set 1"/);
    assert.match(plain(second), /Incline Dumbbell Press/);
  });
});

test('More opens the actions sheet with Later first, only when the exercise can move', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { ExerciseActionsSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const profile = { name: 'Sam', unit: 'lb', goal: 'muscle', experience: 'Beginner', days: 3, minutes: 60, equipment: ['Barbell'],
      exclusions: [], loads: {} };
    const props = { exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', exerciseIndex: 0, exerciseCount: 2,
      planned: [{ weight: 60, reps: 5 }], pending: 1, done: 0, history: [], unit: 'lb', profile, inSession: true, skipped: false,
      onReplace: noop, onSaveProfile: noop, onRemoveToday: noop, onReturn: noop, onClose: noop };
    const rows = (html: string) => [...html.matchAll(/class="context-row sheet-menu__row"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1]);
    const withLater = rows(renderToStaticMarkup(createElement(ExerciseActionsSheet, { ...props, onLater: noop })));
    assert.equal(withLater[0], 'Later', `rows: ${withLater.join(', ')}`);
    const without = rows(renderToStaticMarkup(createElement(ExerciseActionsSheet, props)));
    assert.ok(!without.includes('Later'), 'no Later without its handler');
    assert.deepEqual(withLater.slice(1), without, 'the rest of the menu is unchanged');
  } finally { await server.close(); }
});
