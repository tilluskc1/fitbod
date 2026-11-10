import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { backupDue, backupReminder, shareBackup } from '../src/lib/backup.ts';
import { completeSession, createSession, logSet } from '../src/lib/session.ts';
import { EMPTY_STATE, mergeImport, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, Profile } from '../src/types.ts';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function finished(id = 'w1'): AppState['history'][number] {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined);
  const open = logSet(
    createSession({ id, name: adapted.name, dayIndex: 0, exercises: toWorkoutExercises(adapted), now: '2026-11-01T10:00:00.000Z' }),
    0,
    0,
    '2026-11-01T10:05:00.000Z',
  );
  return completeSession(open, { early: true, now: '2026-11-01T10:30:00.000Z' });
}

const trained = (lastBackupAt?: string): AppState => ({
  ...EMPTY_STATE,
  history: [finished()],
  ...(lastBackupAt === undefined ? {} : { lastBackupAt }),
});

/* ---------- stored field (#225) ---------- */

test('validate accepts state without lastBackupAt and leaves it absent', () => {
  const result = validateState(trained());
  assert.ok(result.ok);
  assert.equal('lastBackupAt' in result.state, false);
});

test('validate keeps a valid lastBackupAt and rejects a bad one', () => {
  const ok = validateState(trained('2026-11-01T09:00:00.000Z'));
  assert.ok(ok.ok);
  assert.equal(ok.state.lastBackupAt, '2026-11-01T09:00:00.000Z');
  for (const bad of ['yesterday', 42, null, '']) {
    const result = validateState({ ...trained(), lastBackupAt: bad });
    assert.equal(result.ok, false, `rejects ${JSON.stringify(bad)}`);
    if (!result.ok) assert.match(result.error, /state\.lastBackupAt/);
  }
});

test('export and parse round-trip lastBackupAt', () => {
  const parsed = parseState(serializeExport(trained('2026-11-01T09:00:00.000Z')));
  assert.ok(parsed.ok);
  assert.equal(parsed.state.lastBackupAt, '2026-11-01T09:00:00.000Z');
});

test('restoring a file keeps this browser’s lastBackupAt, never the file’s', () => {
  const file = trained('2026-11-06T09:00:00.000Z');
  // Restore is not a backup of this browser: a fresh browser stays "not backed up".
  assert.equal('lastBackupAt' in mergeImport(EMPTY_STATE, file).state, false);
  const local = trained('2026-10-01T09:00:00.000Z');
  assert.equal(mergeImport(local, file).state.lastBackupAt, '2026-10-01T09:00:00.000Z');
});

/* ---------- reminder rule ---------- */

test('backupDue: no history means no reminder', () => {
  assert.equal(backupDue(EMPTY_STATE, NOW), false);
  assert.equal(backupReminder(EMPTY_STATE, NOW), null);
});

test('backupDue: history and never backed up is due', () => {
  assert.equal(backupDue(trained(), NOW), true);
  assert.equal(backupReminder(trained(), NOW), 'Not backed up yet.');
});

test('backupDue: 6 days is not due, 8 days is due', () => {
  assert.equal(backupDue(trained(daysAgo(6)), NOW), false);
  assert.equal(backupReminder(trained(daysAgo(6)), NOW), null);
  assert.equal(backupDue(trained(daysAgo(8)), NOW), true);
  assert.equal(backupReminder(trained(daysAgo(8)), NOW), 'Last backup: 8 days ago.');
});

/* ---------- share flow ---------- */

function fakeDownload() {
  const calls: Array<{ text: string; filename: string }> = [];
  return { calls, download: (text: string, filename: string) => void calls.push({ text, filename }) };
}

test('share resolves: recorded, no download', async () => {
  const { calls, download } = fakeDownload();
  let shared: ShareData | undefined;
  const result = await shareBackup('{"a":1}', 'strength-backup-x.json', {
    nav: { canShare: () => true, share: async (data) => { shared = data; } },
    download,
  });
  assert.deepEqual(result, { ok: true, via: 'share' });
  assert.equal(calls.length, 0);
  assert.equal(shared?.title, undefined, 'files only: some iOS share targets save a title as a separate text file');
  const file = shared?.files?.[0];
  assert.ok(file);
  assert.equal(file.name, 'strength-backup-x.json');
  assert.equal(file.type, 'application/json');
  assert.equal(await file.text(), '{"a":1}');
});

test('share cancelled (AbortError): not recorded, no message', async () => {
  const { calls, download } = fakeDownload();
  const result = await shareBackup('{}', 'f.json', {
    nav: { canShare: () => true, share: async () => { throw new DOMException('cancel', 'AbortError'); } },
    download,
  });
  assert.deepEqual(result, { ok: false });
  assert.equal(calls.length, 0);
});

test('file sharing unsupported: download fallback is recorded', async () => {
  for (const nav of [{}, { canShare: () => false, share: async () => {} }, undefined]) {
    const { calls, download } = fakeDownload();
    const result = await shareBackup('{"b":2}', 'f.json', { nav, download });
    assert.deepEqual(result, { ok: true, via: 'download' });
    assert.deepEqual(calls, [{ text: '{"b":2}', filename: 'f.json' }]);
  }
});

test('share fails with another error: not recorded, short message', async () => {
  const { calls, download } = fakeDownload();
  const result = await shareBackup('{}', 'f.json', {
    nav: { canShare: () => true, share: async () => { throw new DOMException('no gesture', 'NotAllowedError'); } },
    download,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.message);
  assert.match(result.ok ? '' : result.message ?? '', /^Backup not shared, nothing recorded\. .*Export in Settings/);
  assert.equal(calls.length, 0);
});

/* ---------- Today line ---------- */

test('Today shows the backup line only when one is due', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
      equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Backup' };
    const noop = () => {};
    const render = (backup: string | null) => renderToStaticMarkup(createElement(TodayScreen, {
      profile, program: FULL_BODY_A, adapted: adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined),
      equipment: 'home', adjusted: false, history: [finished()], current: null, now: NOW,
      onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop,
      backup, onBackup: noop,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const due = render(backupReminder(trained(daysAgo(9)), NOW));
    assert.match(due, /Last backup: 9 days ago\. Back up now/);
    const fresh = render(backupReminder(trained(daysAgo(2)), NOW));
    assert.doesNotMatch(fresh, /Last backup|Not backed up|Back up now/);
  } finally {
    await server.close();
  }
});

test('Settings offers Back up now beside Export and the only-copy note names backups', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { SettingsSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
      equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Backup' };
    const noop = () => {};
    const text = renderToStaticMarkup(createElement(SettingsSheet, {
      profile, onChange: noop, onExport: noop, onBackup: noop, onRestore: noop, onClose: noop, storageNote: 'Saved',
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /Back up now .*Export JSON backup .*Restore from backup/);
    assert.match(text, /This browser is the only copy\. .*Back up now/);
  } finally {
    await server.close();
  }
});

test('a download that throws records nothing and says so; the share carries only the file (#225 review)', async () => {
  const { shareBackup } = await import('../src/lib/backup.ts');
  const failed = await shareBackup('{}', 'b.json', { download: () => { throw new Error('blocked'); } });
  assert.equal(failed.ok, false);
  assert.match(failed.message ?? '', /nothing was recorded/);
  let shared: unknown;
  await shareBackup('{}', 'b.json', { nav: { canShare: () => true, share: async (data: unknown) => { shared = data; } }, download: () => {} });
  assert.deepEqual(Object.keys(shared as object), ['files']);
});
