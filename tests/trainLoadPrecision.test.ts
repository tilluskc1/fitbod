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
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogNext() {}, onToggleRestPause() {},
        onExtendRest() {}, onSwap() {}, onSkip() {}, onReturn() {} };
      const before = renderToStaticMarkup(createElement(TrainScreen, { ...props, session }));
      assert.match(before, new RegExp(`Log set 1 · 8 reps @ ${entered} ${unit}`));
      const after = renderToStaticMarkup(createElement(TrainScreen, { ...props, session: logSet(session, 0, 0) }));
      assert.match(after, new RegExp(`Set 1: 8 reps @ ${entered} ${unit} total`));
      assert.equal(session.exercises[0].performed[0].weight, stored);
    }
  } finally { await server.close(); }
});
