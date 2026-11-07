import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';

// #206: the review's new Time/Sets figures sat in white on a light card, and a gym
// profile's saved setup was called "Home setup" there.

test('the review names a gym profile\'s saved setup "Your gym"', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const constraints = { minutes: 20, equipment: 'home' as const };
    const adapted = adaptWorkout(FULL_BODY_A, constraints, [], undefined);
    const render = (equipment: string[]) => renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: adapted.originalSets, adapted, constraints, notices: [],
      // Required since #203: what Today shows now, and the change.
      before: { minutes: 30 }, after: { minutes: 20, approx: false },
      profile: { equipment }, onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    }));
    const gym = render(['Barbell', 'Dumbbell', 'Machine', 'Cable']);
    assert.match(gym, /Your gym/);
    assert.doesNotMatch(gym, /Home setup/);
    assert.match(render(['Dumbbell']), /Home setup/, 'a home kit keeps its name');
  } finally {
    await server.close();
  }
});

test('the review\'s new figures use the ink colour, not white on a light card', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const at = css.indexOf('.diff-cell__after {');
  assert.ok(at >= 0);
  const rule = css.slice(at, css.indexOf('}', at));
  assert.doesNotMatch(rule, /color:\s*#fff\b/i);
  assert.match(rule, /color:\s*var\(--on-surface\)/);
});
