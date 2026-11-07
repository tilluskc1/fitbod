import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';

test('review explains an empty adapted workout and disables Start', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const adapted = { ...adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'bands' }), exercises: [], totalSets: 0 };
    const html = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: adapted.originalSets,
      adapted,
      constraints: { minutes: 20, equipment: 'bands' },
      before: { minutes: 33 },
      after: { minutes: 0, approx: false },
      notices: [],
      onStart: () => {},
      onKeep: () => {},
      onEdit: () => {},
    }));
    assert.match(html, /No movement in this workout can be done with resistance bands/);
    // #203: Start names what the work takes; an empty day takes nothing, so it names no minutes.
    assert.match(html, /<button[^>]*disabled=""[^>]*>Start workout/);
  } finally {
    await server.close();
  }
});
