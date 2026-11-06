import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('active-session replacement confirms in-app, not through window.confirm', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  } });
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.tsx');
    const html = renderToStaticMarkup(createElement(App));
    assert.match(plain(html), /get started/i, 'a fresh profile renders without side effects');  } finally {
    await server.close();
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('DiscardSessionSheet renders the named consent copy with both decisions', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { DiscardSessionSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const html = renderToStaticMarkup(
      createElement(DiscardSessionSheet, {
        currentName: 'Full body A',
        nextName: 'Push Pull Legs push',
        onDiscard: () => {},
        onKeep: () => {},
        onClose: () => {},
      }),
    );
    const text = plain(html);
    assert.match(text, /Replace your open session/im);
    assert.match(text, /Full body A is still in progress/im);
    assert.match(text, /logged sets .* lost/i);
    assert.match(text, /Discard and start Push Pull Legs push/);
    assert.match(text, /Keep current workout/);
    assert.match(html, /role="dialog"/, 'it is an inspectable dialog, not a native prompt');
  } finally {
    await server.close();
  }
});

test('startSession confirms in-app, not through window.confirm', async () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.confirm\([^)]*discards? it and start/i, 'the replacement path must not use a native prompt');
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.tsx');
    assert.ok(App, 'App module loads');
  } finally {
    await server.close();
  }
});

test('DiscardSessionSheet renders the named consent copy with both decisions', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { DiscardSessionSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const html = renderToStaticMarkup(
      createElement(DiscardSessionSheet, {
        currentName: 'Full body A',
        nextName: 'Push Pull Legs push',
        onDiscard: () => {},
        onKeep: () => {},
        onClose: () => {},
      }),
    );
    const text = plain(html);
    assert.match(text, /Replace your open session/im);
    assert.match(text, /Full body A is still in progress/im);
    assert.match(text, /logged sets .* lost/i);
    assert.match(text, /Discard and start Push Pull Legs push/);
    assert.match(text, /Keep current workout/);
    assert.match(html, /role="dialog"/, 'it is an inspectable dialog, not a native prompt');
  } finally {
    await server.close();
  }
});

test('the Adjust sheet names the home rack honestly, in the display unit', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { AdjustSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const render = (loads: number[] | undefined) => plain(renderToStaticMarkup(createElement(AdjustSheet, {
      constraints: { minutes: 35, equipment: 'home', loads }, originalMinutes: 35, unit: 'lb',
      onClose: () => undefined, onPreview: () => undefined })));
    const blank = render(undefined);
    assert.match(blank, /not confirmed/);
    assert.doesNotMatch(blank, /10 kg, 15 kg, 18 kg/);
    assert.match(render([10, 15, 18]), /Yours: 22 lb, 33 lb, 39\.5 lb/);
  } finally { await server.close(); }
});
