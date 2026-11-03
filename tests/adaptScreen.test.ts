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
      notices: [],
      onStart: () => {},
      onKeep: () => {},
      onEdit: () => {},
    }));
    assert.match(html, /No movement in this workout can be done with resistance bands/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Start 20-min workout/);
  } finally {
    await server.close();
  }
});
