import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { START_OVER_BLOCKED } from '../src/lib/storage.ts';

// #406 named an old unfinished workout by its day on every surface. #430 retired that variant: an old
// workout closes itself (saved if it has sets) after 6 idle hours, so no surface needs the day any more.
// What stays is the start-over block, which reads the same for any open workout.

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

test('#406 (after #430): the start-over block is one line for any open workout, with no day in it', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const sheets = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const html = plain(renderToStaticMarkup(createElement(sheets.StartOverSheet, { sessionOpen: true,
      onBackup: async () => ({ ok: false, message: null }), onErase: () => ({ ok: true }), onClose: noop })));
    assert.ok(html.includes(START_OVER_BLOCKED), html);
    assert.doesNotMatch(html, /from \w{3}, \w{3} \d+/);
    assert.equal('DiscardSessionSheet' in sheets, false, 'the replace sheet is retired; StartConflictSheet asks instead');
  } finally {
    await server.close();
  }
});
