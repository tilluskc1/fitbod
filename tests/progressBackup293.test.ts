import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { backupCount } from '../src/lib/backup.ts';
import type { AppState } from '../src/types.ts';

const plain = (html: string) => html.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const workout = (status: 'active' | 'completed') => ({ status }) as AppState['history'][number];

test('#293 the sheet counts completed workouts only', () => {
  assert.equal(backupCount([]), 0);
  assert.equal(backupCount([workout('completed'), workout('active'), workout('completed')]), 2);
});

test('#293 Progress backup sheet: product copy, one and many, nothing to back up', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { BackupSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const noop = () => {};
    const onBackup = async () => ({ ok: true, message: null });
    const render = (workouts: number) => plain(renderToStaticMarkup(createElement(BackupSheet, { workouts, onBackup, onClose: noop })));

    const many = render(3);
    assert.match(many, /^Back up your workouts\?/);
    assert.match(many, /Saves a file with your 3 workouts and settings\. Keep it somewhere safe: Files, iCloud, Drive or email\. You'll need it to restore on another phone\./);
    assert.match(many, /Back up now Not now$/);

    assert.match(render(1), /your 1 workout and settings/);

    const none = render(0);
    assert.match(none, /Nothing to back up yet/);
    assert.doesNotMatch(none, /Back up now|Not now|Saves a file/);
  } finally {
    await server.close();
  }
});

test('#293 the Progress icon opens the sheet instead of exporting', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: ProgressScreen } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ProgressScreen, {
      history: [], unit: 'kg', onBackup: noop, onCorrect: noop, onDelete: noop, onFeedback: noop, onGoTrain: noop,
    }));
    assert.match(html, /aria-label="Back up workouts"/);
    assert.doesNotMatch(html, /Export backup/);
  } finally {
    await server.close();
  }
});
