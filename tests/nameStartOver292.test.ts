import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { lastBackupLine, startOverBackupNote } from '../src/lib/backup.ts';
import type { Profile } from '../src/types.ts';

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = () => {};
const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Sam' };

async function sheets() {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  return { server, mod: await server.ssrLoadModule('/src/screens/Sheets.tsx') };
}

const settingsText = async (mod: Record<string, unknown>, p: Profile) =>
  plain(renderToStaticMarkup(createElement(mod.SettingsSheet as never, {
    profile: p, onChange: noop, onExport: noop, onBackup: noop, onRestore: noop, onStartOver: noop, onClose: noop, storageNote: 'Saved',
  })));

test('a cancelled or failed backup says nothing was erased; a backup that left the app shows its message', () => {
  assert.equal(startOverBackupNote({ ok: false, message: null }), 'Backup cancelled. Nothing was erased.');
  assert.equal(
    startOverBackupNote({ ok: false, message: 'Backup not saved, so nothing was recorded. Try again.' }),
    'Backup not saved, so nothing was recorded. Try again. Nothing was erased.',
  );
  assert.equal(startOverBackupNote({ ok: true, message: 'Backup shared.' }), 'Backup shared.');
});

test('the last backup line reads never, or the day it happened', () => {
  assert.equal(lastBackupLine(undefined), 'Last backup: never');
  assert.match(lastBackupLine('2026-11-02T09:00:00.000Z'), /^Last backup: (2 Nov|Nov 2)$/);
});

test('Settings leads with the name, then Profile; Start over sits last under Danger zone (#324); a nameless profile reads "You"', async () => {
  const { server, mod } = await sheets();
  try {
    assert.match(await settingsText(mod, profile), /^Training settings .*?Sam Profile Name/);
    assert.match(await settingsText(mod, profile), /About .* Danger zone Start over on this device No account to log out of: this erases this phone.s workouts\. Back up first\. Done$/);
    for (const name of [undefined, '', '   ']) {
      assert.match(await settingsText(mod, { ...profile, name }), /^Training settings .*?You Profile Name/, `name ${JSON.stringify(name)}`);
    }
  } finally {
    await server.close();
  }
});

test('Start over never offers to log out or sign out as an action', async () => {
  const { server, mod } = await sheets();
  try {
    const settings = (await settingsText(mod, profile)).replace('No account to log out of', '');
    const sheet = plain(renderToStaticMarkup(createElement(mod.StartOverSheet as never, {
      sessionOpen: false, onBackup: async () => ({ ok: true, message: null }), onErase: () => ({ ok: true }), onClose: noop,
    })));
    for (const text of [settings, sheet]) assert.doesNotMatch(text, /\b(log|sign) ?out\b/i);
  } finally {
    await server.close();
  }
});

test('the sheet leads with saving: the lime Back up now first, the red erase second', async () => {
  const { server, mod } = await sheets();
  try {
    const html = renderToStaticMarkup(createElement(mod.StartOverSheet as never, {
      sessionOpen: false, lastBackupAt: '2026-11-02T09:00:00.000Z', onBackup: async () => ({ ok: true, message: null }), onErase: () => ({ ok: true }), onClose: noop,
    }));
    const text = plain(html);
    assert.match(text, /^Save your progress first\?/);
    assert.match(text, /Last backup: (2 Nov|Nov 2)/);
    assert.match(html, /class="primary"[^>]*>Back up now<\/button><button class="danger"[^>]*>Erase without saving</);
  } finally {
    await server.close();
  }
});
