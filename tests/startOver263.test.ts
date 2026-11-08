import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { revisePlan } from '../src/lib/sequence.ts';
import { completeSession, createSession, logSet } from '../src/lib/session.ts';
import {
  EMPTY_STATE,
  LEGACY_BACKUP_KEY,
  STORAGE_KEY,
  eraseLocalData,
  loadState,
  mergeImport,
  saveState,
  serializeExport,
} from '../src/lib/storage.ts';
import { parseState } from '../src/lib/validate.ts';
import type { AppState, Profile } from '../src/types.ts';

/** A Map-backed Storage; `fail` names the calls that throw. */
function memoryStore(entries: Record<string, string> = {}, fail: { remove?: string; get?: boolean } = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => {
      if (fail.get) throw new Error('blocked');
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => {
      if (fail.remove === key || fail.remove === '*') throw new Error('SecurityError');
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

/* ---------- T1: eraseLocalData ---------- */

test('erase removes exactly the app keys and leaves every other key alone', () => {
  const store = memoryStore({
    [STORAGE_KEY]: '{"saved":true}',
    [LEGACY_BACKUP_KEY]: '{"old":true}',
    'other-app': 'keep',
    'fitbod-clone-v1:corrupt-backup': 'keep too',
  });
  assert.deepEqual(eraseLocalData(store), { ok: true });
  assert.deepEqual([...store.map.entries()].sort(), [
    ['fitbod-clone-v1:corrupt-backup', 'keep too'],
    ['other-app', 'keep'],
  ]);
});

test('erase succeeds when the keys were never written (nothing to remove)', () => {
  const store = memoryStore({ 'other-app': 'keep' });
  assert.deepEqual(eraseLocalData(store), { ok: true });
  assert.equal(store.map.get('other-app'), 'keep');
});

test('storage that refuses the erase reports it, with a way forward, and keeps the plan and workouts', () => {
  for (const remove of [LEGACY_BACKUP_KEY, STORAGE_KEY, '*']) {
    const store = memoryStore({ [STORAGE_KEY]: 'data', [LEGACY_BACKUP_KEY]: 'old' }, { remove });
    const result = eraseLocalData(store);
    assert.equal(result.ok, false, `refused remove of ${remove}`);
    if (!result.ok) {
      assert.match(result.error, /still here/);
      assert.match(result.error, /Try again|site data/);
    }
    assert.equal(store.map.get(STORAGE_KEY), 'data', 'the main record is never the half that went');
  }
});

test('unreachable storage, a throwing read and a silent no-op all fail loudly', () => {
  assert.equal(eraseLocalData(null).ok, false);
  assert.equal(eraseLocalData(memoryStore({ [STORAGE_KEY]: 'data' }, { get: true })).ok, false);
  const stuck = { ...memoryStore({ [STORAGE_KEY]: 'data' }), removeItem: () => undefined };
  assert.equal(eraseLocalData(stuck).ok, false, 'a removal that did not happen is not a success');
});

/* ---------- round trip: back up, start over, restore ---------- */

const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Round trip' };

function trainedState(): AppState {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined);
  const open = logSet(
    createSession({ id: 'w1', name: adapted.name, dayIndex: 0, exercises: toWorkoutExercises(adapted), now: '2026-11-01T10:00:00.000Z' }),
    0, 0, '2026-11-01T10:05:00.000Z',
  );
  const done = completeSession(open, { early: true, now: '2026-11-01T10:30:00.000Z' });
  return { ...revisePlan(EMPTY_STATE, profile), history: [done], lastBackupAt: '2026-11-02T09:00:00.000Z' };
}

test('a backup file restores everything after starting over (from empty and after setting up again)', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = memoryStore();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  try {
    const before = trainedState();
    assert.ok(saveState(before, 0).ok);
    const file = serializeExport(before);

    assert.deepEqual(eraseLocalData(), { ok: true });
    const reloaded = loadState();
    assert.equal(reloaded.status, 'empty', 'a reload after erasing is a first launch');
    assert.deepEqual(reloaded.state, EMPTY_STATE);

    const parsed = parseState(file);
    assert.ok(parsed.ok);
    // Straight onto the empty state.
    const restored = mergeImport(reloaded.state, parsed.state).state;
    // Compared as stored text: validation adds absent optional keys as undefined.
    const json = (value: unknown) => JSON.parse(JSON.stringify(value));
    assert.deepEqual(json(restored.profile), json(before.profile));
    assert.deepEqual(json(restored.plan), json(before.plan));
    assert.deepEqual(json(restored.history), json(before.history));
    assert.equal(restored.lastBackupAt, undefined, 'the backup date is this browser’s, and it was erased');
    assert.ok(saveState(restored, 0).ok, 'the restored state saves on the erased storage');

    // The in-app path: onboarding again first, then Settings → Restore.
    const fresh = revisePlan(EMPTY_STATE, { ...profile, name: 'New' });
    const again = mergeImport(fresh, parsed.state).state;
    assert.deepEqual(json(again.history), json(before.history));
    assert.deepEqual(json(again.plan), json(before.plan));
    assert.equal(again.profile?.name, 'Round trip');
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

/* ---------- T2: Settings row and sheet ---------- */

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const noop = () => {};

async function sheets() {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  return { server, mod: await server.ssrLoadModule('/src/screens/Sheets.tsx') };
}

test('Settings → Data ends with Start over on this device and a one-line why', async () => {
  const { server, mod } = await sheets();
  try {
    const text = plain(renderToStaticMarkup(createElement(mod.SettingsSheet, {
      profile, onChange: noop, onExport: noop, onBackup: noop, onRestore: noop, onStartOver: noop, onClose: noop, storageNote: 'Saved',
    })));
    assert.match(text, /Restore from backup Start over on this device Erase this browser.s data and set up again\./);
  } finally {
    await server.close();
  }
});

test('the sheet names what goes, spares backup files, and puts Back up now before erasing', async () => {
  const { server, mod } = await sheets();
  try {
    const html = renderToStaticMarkup(createElement(mod.StartOverSheet, {
      sessionOpen: false, onBackup: async () => null, onErase: () => ({ ok: true }), onClose: noop,
    }));
    const text = plain(html);
    assert.match(text, /your plan, every logged workout, your preferences and your backup date/i);
    assert.match(text, /this browser/i);
    assert.match(text, /backup file .*isn.t affected/i);
    assert.match(text, /Not backed up yet\./);
    assert.match(text, /Back up now .*Erase without a backup/, 'backing up comes first');
    assert.match(html, /class="primary"[^>]*>Back up now/);
    assert.doesNotMatch(text, /log ?out|account/i, 'there is no account to leave');
  } finally {
    await server.close();
  }
});

test('an open workout blocks erasing and says why', async () => {
  const { server, mod } = await sheets();
  try {
    const text = plain(renderToStaticMarkup(createElement(mod.StartOverSheet, {
      sessionOpen: true, lastBackupAt: '2026-11-02T09:00:00.000Z', onBackup: async () => null, onErase: () => ({ ok: true }), onClose: noop,
    })));
    assert.match(text, /workout is in progress/i);
    assert.match(text, /Finish or discard it/);
    assert.doesNotMatch(text, /Erase without a backup/);
    assert.match(text, /Last backup: /);
  } finally {
    await server.close();
  }
});
