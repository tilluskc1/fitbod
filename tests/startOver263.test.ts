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
  START_OVER_BLOCKED,
  eraseLocalData,
  startOverErase,
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

test('erase removes every key the app owns and leaves other apps alone', () => {
  const store = memoryStore({
    [STORAGE_KEY]: '{"saved":true}',
    [LEGACY_BACKUP_KEY]: '{"old":true}',
    'fitbod-clone-v1:corrupt-backup': '{"profile":{"name":"Old"}}',
    'fitbod-clone-v1:anything-later': 'x',
    'other-app': 'keep',
    'fitbod-clone-v2': 'keep too',
    'fitbod-clone-v1-extra': 'not ours either',
  });
  assert.deepEqual(eraseLocalData(store), { ok: true });
  assert.deepEqual([...store.map.keys()].sort(), ['fitbod-clone-v1-extra', 'fitbod-clone-v2', 'other-app']);
});

test('erase succeeds when the keys were never written (nothing to remove)', () => {
  const store = memoryStore({ 'other-app': 'keep' });
  assert.deepEqual(eraseLocalData(store), { ok: true });
  assert.equal(store.map.get('other-app'), 'keep');
});

test('storage that throws mid-way says so, names what is left, and the main record goes last', () => {
  const entries = { [STORAGE_KEY]: 'data', [LEGACY_BACKUP_KEY]: 'old', 'fitbod-clone-v1:corrupt-backup': 'older' };
  for (const remove of [LEGACY_BACKUP_KEY, 'fitbod-clone-v1:corrupt-backup', STORAGE_KEY, '*']) {
    const store = memoryStore(entries, { remove });
    const result = eraseLocalData(store);
    assert.equal(result.ok, false, `refused remove of ${remove}`);
    if (!result.ok) {
      assert.deepEqual(result.left, [...store.map.keys()].sort(), 'left names exactly what is still stored');
      assert.ok(result.left.includes(STORAGE_KEY));
      assert.match(result.error, /plan and workouts are still here/);
      assert.match(result.error, /Try again|site data/);
    }
    assert.equal(store.map.get(STORAGE_KEY), 'data', 'the main record is never the half that went');
  }
});

test('unreachable storage, a throwing listing and a silent no-op all fail loudly', () => {
  assert.equal(eraseLocalData(null).ok, false);
  const unlisted = { ...memoryStore({ [STORAGE_KEY]: 'data' }), key: () => { throw new Error('blocked'); }, length: 1 };
  assert.equal(eraseLocalData(unlisted).ok, false, 'storage that cannot be listed is not erased');
  const stuck = { ...memoryStore({ [STORAGE_KEY]: 'data' }), removeItem: () => undefined };
  assert.equal(eraseLocalData(stuck).ok, false, 'a removal that did not happen is not a success');
});

test('an open workout refuses start over before anything is erased, with the sheet message', () => {
  const store = memoryStore({ [STORAGE_KEY]: 'data', [LEGACY_BACKUP_KEY]: 'old' });
  const open = { current: trainedState().history[0] };
  const result = startOverErase(open, store);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, START_OVER_BLOCKED);
  assert.deepEqual([...store.map.keys()].sort(), [STORAGE_KEY, LEGACY_BACKUP_KEY].sort(), 'nothing was touched');
  assert.deepEqual(startOverErase({ current: null }, store), { ok: true }, 'with no workout open it erases');
  assert.equal(store.map.size, 0);
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

test('Start over is the last block, under Danger zone, with a one-line why (#292 moved it from Data, #324 to the bottom)', async () => {
  const { server, mod } = await sheets();
  try {
    const text = plain(renderToStaticMarkup(createElement(mod.SettingsSheet, {
      profile, onChange: noop, onExport: noop, onBackup: noop, onRestore: noop, onStartOver: noop, onClose: noop, storageNote: 'Saved',
    })));
    assert.match(text, /^\s*Training settings .*Round trip Profile .* About .* Danger zone Start over on this device No account to log out of: this erases this phone.s workouts\. Back up first\. Done\s*$/);
    assert.equal(text.match(/Start over on this device/g)?.length, 1, 'one way in, not two');
  } finally {
    await server.close();
  }
});

test('the sheet names what goes, spares backup files, and puts Back up now before erasing', async () => {
  const { server, mod } = await sheets();
  try {
    const html = renderToStaticMarkup(createElement(mod.StartOverSheet, {
      sessionOpen: false, onBackup: async () => ({ ok: false, message: null }), onErase: () => ({ ok: true }), onClose: noop,
    }));
    const text = plain(html);
    assert.match(text, /your plan, every logged workout, your preferences, your backup date and any older copies/i);
    assert.match(text, /this browser/i);
    assert.match(text, /backup file .*isn.t affected/i);
    assert.match(text, /Last backup: never/);
    assert.match(text, /Back up now .*Erase without saving/, 'backing up comes first');
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
      sessionOpen: true, lastBackupAt: '2026-11-02T09:00:00.000Z', onBackup: async () => ({ ok: false, message: null }), onErase: () => ({ ok: true }), onClose: noop,
    })));
    assert.ok(text.includes(START_OVER_BLOCKED), 'the sheet shows the same message the guard returns');
    assert.doesNotMatch(text, /Erase without saving|Erase this phone/);
    assert.match(text, /Last backup: /);
  } finally {
    await server.close();
  }
});
