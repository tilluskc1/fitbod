import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { backupCount } from '../src/lib/backup.ts';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import type { AppState } from '../src/types.ts';

const START = '2026-11-08T10:00:00.000Z';
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
    const render = (history: AppState['history']) => renderToStaticMarkup(createElement(ProgressScreen, {
      history, unit: 'kg', onBackup: noop, onCorrect: noop, onDelete: noop, onFeedback: noop, onGoTrain: noop,
    }));
    let session = createSession({
      id: 'w1', name: 'Upper A', dayIndex: 0, now: START,
      exercises: [{
        exerciseId: 'goblet-squat', name: 'Goblet squat',
        planned: [{ weight: 20, reps: 10 }], performed: [{ weight: 20, reps: 10, done: false, completedAt: null }],
      }],
    });
    session = updatePerformedSet(session, 0, 0, { done: true }, START);
    const html = render([completeSession(session, { early: true, now: '2026-11-08T10:20:00.000Z' })]);
    assert.match(html, /aria-label="Back up workouts"/);
    assert.doesNotMatch(html, /Export backup/);
    // (#430) With no finished workout there is nothing to back up: the empty page shows no icon.
    assert.doesNotMatch(render([]), /Back up workouts/);
  } finally {
    await server.close();
  }
});
