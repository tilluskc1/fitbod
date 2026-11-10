import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, logSet } from '../src/lib/session.ts';
import { toKg } from '../src/lib/units.ts';

test('calibrated barbell actuals retain fractional kg and lb in the CTA and completed row', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    for (const [unit, entered, stored] of [
      ['kg', 42.3, 42.3],
      ['lb', 95.3, toKg(95.3, 'lb')],
    ] as const) {
      const session = createSession({ id: `precision-${unit}`, name: 'Pull', dayIndex: 0,
        now: '2026-11-03T10:00:00.000Z', exercises: [{ exerciseId: 'barbell-row', name: 'Barbell Row',
          planned: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }],
          performed: [{ weight: stored, reps: 8, done: false }, { weight: stored, reps: 8, done: false }] }] });
      const props = { history: [], now: Date.parse('2026-11-03T10:01:00.000Z'), loadOptions: [], unit,
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogSet() {}, onToggleRestPause() {},
        onExtendRest() {}, onReturn() {} };
      const label = `Set 1 weight, ${unit === 'kg' ? 'kilograms' : 'pounds'}`;
      const weightOf = (html: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];
      const before = renderToStaticMarkup(createElement(TrainScreen, { ...props, session }));
      assert.equal(weightOf(before), String(entered), 'the row the ✓ logs');
      assert.match(before, new RegExp(`>${unit} total<`));
      const after = renderToStaticMarkup(createElement(TrainScreen, { ...props, session: logSet(session, 0, 0) }));
      assert.match(after, /<tr class="lg-row--done">/);
      assert.equal(weightOf(after), String(entered), 'the completed row');
      assert.equal(session.exercises[0].performed[0].weight, stored);
    }
  } finally { await server.close(); }
});

test('a dumbbell set takes typed entry in its cell, with or without a confirmed rack; no pills (#309)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const session = createSession({ id: 'dumbbell-typed', name: 'Press', dayIndex: 0,
      now: '2026-11-03T10:00:00.000Z', exercises: [{ exerciseId: 'dumbbell-floor-press', name: 'Dumbbell Floor Press',
        planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false }] }] });
    for (const unit of ['kg', 'lb'] as const) {
      const props = { session, history: [], now: Date.parse('2026-11-03T10:01:00.000Z'), unit,
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogSet() {}, onToggleRestPause() {},
        onExtendRest() {}, onReturn() {} };
      const word = unit === 'kg' ? 'kilograms' : 'pounds';
      const blank = renderToStaticMarkup(createElement(TrainScreen, { ...props, loadOptions: [] }));
      assert.match(blank, new RegExp(`aria-label="Set 1 weight, ${word} each"[^>]*value=""`));
      // #309: the confirmed rack's pill row (lg-quick) is gone; a rack changes nothing in the cell.
      assert.doesNotMatch(blank, /lg-quick|<button(?![^>]*lg-wcheck)[^>]*aria-pressed|Enter dumbbell load/);
      const rack = renderToStaticMarkup(createElement(TrainScreen, { ...props, loadOptions: [10, 15, 18] }));
      assert.match(rack, new RegExp(`aria-label="Set 1 weight, ${word} each"[^>]*value=""`));
      assert.doesNotMatch(rack, /lg-quick|<button(?![^>]*lg-wcheck)[^>]*aria-pressed|Enter dumbbell load/);
    }
  } finally { await server.close(); }
});
