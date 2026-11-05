import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('the splash hero is a muted, looping, inline video with a poster and no controls', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Splash } = await server.ssrLoadModule('/src/screens/SplashScreen.tsx');
    const html = renderToStaticMarkup(createElement(Splash, { onStart: () => {} }));
    const video = html.match(/<video[^>]*>/)?.[0] ?? '';
    assert.ok(video, 'renders a video');
    assert.match(video, /src="\/hero\/splash\.mp4"/);
    assert.match(video, /poster="\/hero\/splash-poster\.jpg"/);
    for (const attr of ['autoPlay', 'muted', 'loop', 'playsInline']) {
      assert.match(video, new RegExp(`${attr}=""|${attr.toLowerCase()}=""`, 'i'), attr);
    }
    assert.doesNotMatch(video, /controls/);
    assert.match(video, /aria-hidden="true"/, 'decorative');
    assert.match(html, /Every set, accounted for\./, 'copy unchanged');
  } finally {
    await server.close();
  }
});

test('with reduced motion the splash shows only the still poster', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { SplashHero } = await server.ssrLoadModule('/src/screens/SplashScreen.tsx');
    const html = renderToStaticMarkup(createElement(SplashHero, { reduceMotion: true }));
    assert.doesNotMatch(html, /<video/);
    assert.match(html, /<img[^>]*src="\/hero\/splash-poster\.jpg"[^>]*alt=""/);
  } finally {
    await server.close();
  }
});
