import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { watchOnScreen } from '../src/lib/onScreen.ts';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
};

test('#231: the end frame crossfades over a still start frame, ~1 s per pose', () => {
  const alt = rule('.demo-frame-alt').join('\n');
  assert.match(alt, /animation: demo-crossfade 2s ease-in-out infinite;/);
  assert.doesNotMatch(css, /step-end/, 'no hard cut left');
  const base = rule('.demo-frame-base').join('\n');
  assert.doesNotMatch(base, /animation|opacity/, 'the start frame never fades, so the page never shows through');
  const keyframes = css.slice(css.indexOf('@keyframes demo-crossfade'));
  assert.match(keyframes, /0%,\s*37\.5% \{\s*opacity: 0;\s*\}\s*50%,\s*87\.5% \{\s*opacity: 1;\s*\}\s*100% \{\s*opacity: 0;\s*\}/);
});

test('#231: reduced motion shows the first frame only, and an off-screen demo is paused', () => {
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduced, /\.demo-frame-alt \{\s*animation: none;\s*opacity: 0;\s*\}/);
  assert.match(rule('.demo--paused .demo-frame-alt').join('\n'), /animation-play-state: paused;/);
});

test('#231: watchOnScreen follows the observer and disconnects; with no observer it never pauses', () => {
  const seen: boolean[] = [];
  let callback: IntersectionObserverCallback | undefined;
  let observed = 0;
  let disconnected = 0;
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe() { observed += 1; }
    disconnect() { disconnected += 1; }
  }
  const stop = watchOnScreen({} as Element, (value) => seen.push(value), FakeObserver);
  assert.equal(observed, 1);
  const fire = (isIntersecting: boolean) =>
    callback!([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  fire(false);
  fire(true);
  assert.deepEqual(seen, [false, true]);
  stop();
  assert.equal(disconnected, 1);

  const fallback: boolean[] = [];
  watchOnScreen({} as Element, (value) => fallback.push(value), undefined);
  assert.deepEqual(fallback, [true]);
});

test('#231: both frames render stacked from the existing catalog, no new assets, nothing paused at first paint', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { default: Demo } = await server.ssrLoadModule('/src/components/ui/Demo.tsx');
    const html = renderToStaticMarkup(createElement(Demo, { exerciseId: 'barbell-bench-press', name: 'Bench Press' }));
    assert.match(html, /src="\/exercises\/barbell-bench-press\/0\.jpg"[^>]*class="demo-frame demo-frame-base"/);
    assert.match(html, /src="\/exercises\/barbell-bench-press\/1\.jpg"[^>]*class="demo-frame demo-frame-alt"/);
    assert.doesNotMatch(html, /demo--paused/);
    assert.doesNotMatch(html, /<video/);
  } finally {
    await server.close();
  }
});
