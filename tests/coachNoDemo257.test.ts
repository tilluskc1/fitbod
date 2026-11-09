import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createServer } from 'vite';

// #257: the scripted "Talk to coach" demo is gone. Coach opens to Your review, keeps What I know,
// and no "demo", "scripted" or "server-side" copy is reachable. Browser pass: scripts/e2e/coach-tabs.mjs.
const profile = {
  name: 'Sam', goal: 'muscle', experience: 'intermediate', daysPerWeek: 4, sessionMinutes: 60,
  equipment: ['Barbell', 'Dumbbell'], support: ['Bench', 'Rack'], unit: 'lb', loads: {},
};

test('Coach renders two tabs, opens to Your review, and says nothing about a demo', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Coach } = await server.ssrLoadModule('/src/screens/CoachScreen.tsx');
    const html = renderToStaticMarkup(createElement(Coach, {
      profile, history: [], program: { name: 'Upper A', minutes: 60 }, onWhy: () => {}, onEdit: () => {},
    }));
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    assert.deepEqual(tabs, ['Your review', 'What I know']);
    assert.match(html, /aria-selected="true"[^>]*>Your review/);
    for (const word of [/demo/i, /scripted/i, /server-side/i, /Talk to coach/]) assert.doesNotMatch(html, word);
  } finally {
    await server.close();
  }
});
