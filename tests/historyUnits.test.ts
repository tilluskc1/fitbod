import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession, logSet, applyFinish } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';

// Select the History tab and expand its record; keep the actual product template and controls.
test('history editor identifies recorded holds as seconds while ordinary kg/lb rep controls stay intact', async () => {
  const active = createSession({ id: 'history-units', name: 'Unit review', dayIndex: 0,
    now: '2026-10-31T10:00:00.000Z', exercises: [
      { exerciseId: 'plank', name: 'Plank', planned: [{ weight: 0, reps: 45 }], performed: [{ weight: 0, reps: 45, done: false }] },
      { exerciseId: 'dumbbell-floor-press', name: 'Floor Press', planned: [{ weight: 15, reps: 9 }], performed: [{ weight: 15, reps: 9, done: false }] },
    ] });
  const state = applyFinish({ ...EMPTY_STATE, current: logSet(logSet(active, 0, 0), 1, 0) }, active.id,
    { early: false, now: '2026-10-31T10:06:00.000Z' });
  const before = structuredClone(state);
  const server = await createServer({ plugins: [{ name: 'history-view-fixture', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/screens/ProgressScreen.tsx')) return code
      .replace("useState<'overview' | 'history'>('overview')", "useState<'overview' | 'history'>('history')")
      .replace('useState<string | null>(null)', "useState<string | null>('history-units')");
  } }], server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Progress } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    const noop = () => {};
    for (const unit of ['kg', 'lb']) {
      const html = renderToStaticMarkup(createElement(Progress, { history: state.history, unit,
        onExport: noop, onCorrect: noop, onDelete: noop, onGoTrain: noop }));
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      assert.match(html, /aria-label="Correct seconds for set 1 of Plank"[^>]*value="45"/);
      assert.doesNotMatch(html, /Correct (?:reps|weight) for set 1 of Plank/);
      assert.match(text, /45s prescribed/);
      assert.match(text, /seconds/);
      assert.match(html, /aria-label="Correct reps for set 1 of Floor Press"[^>]*value="9"/);
      assert.match(html, new RegExp(`aria-label="Correct weight for set 1 of Floor Press"[^>]*value="${unit === 'kg' ? '15' : '33.07'}"`));
      assert.match(text, new RegExp(`${unit} ×`));
    }
    assert.deepEqual(state, before, 'unit labels must not mutate canonical values');
  } finally { await server.close(); }
});
