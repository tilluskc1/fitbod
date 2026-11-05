import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parseLoads } from '../src/lib/units.ts';

test('owned loads typed in lb are stored as canonical kg', () => {
  assert.deepEqual(parseLoads('25, 35', 'lb'), [11.34, 15.876]);
  assert.deepEqual(parseLoads('35 25 25', 'lb'), [11.34, 15.876], 'deduplicated and sorted');
});

test('owned loads typed in kg are stored unchanged', () => {
  assert.deepEqual(parseLoads('10, 15, 18', 'kg'), [10, 15, 18]);
  assert.deepEqual(parseLoads('abc, -5, 0, 7.5', 'kg'), [7.5], 'non-numbers and non-positive values dropped');
});

test('a fresh onboarding pre-selects lb', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Onboarding } = await server.ssrLoadModule('/src/components/Onboarding.tsx');
    const html = renderToStaticMarkup(createElement(Onboarding, { onComplete: () => {} }));
    assert.match(html, /<button[^>]*class="on"[^>]*aria-pressed="true"[^>]*>lb<\/button>/);
    assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>kg<\/button>/);
  } finally {
    await server.close();
  }
});
