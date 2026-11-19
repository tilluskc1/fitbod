// (#395) Restore and Start fresh on Recovery replace the unreadable original only once a copy of it is
// kept. When the safety copy cannot be written (storage full), nothing is overwritten and Recovery says
// "Couldn't keep a copy of your old data. Tap Download original first."; once the lifter has downloaded
// the original, that file is the copy and the action goes ahead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CORRUPT_BACKUP_KEY, COPY_FAILED, EMPTY_STATE, STORAGE_KEY, keepSafetyCopy, loadState, mayReplaceOriginal, saveState,
} from '../src/lib/storage.ts';

const ORIGINAL = '{not json: the lifter\'s only data';

class QuotaError extends Error {
  name = 'QuotaExceededError';
}

/** A storage whose setItem throws for the safety-copy key only, as a nearly full phone does for a big copy. */
function installStorage(seed: Record<string, string>, { full = false } = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return data.size; },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => { data.delete(key); },
      setItem: (key: string, value: string) => {
        if (full && key === CORRUPT_BACKUP_KEY) throw new QuotaError('The quota has been exceeded.');
        data.set(key, String(value));
      },
    },
    configurable: true,
    writable: true,
  });
  return data;
}

test('the line and the key are the ones product named', () => {
  assert.equal(COPY_FAILED, "Couldn't keep a copy of your old data. Tap Download original first.");
  assert.equal(CORRUPT_BACKUP_KEY, 'fitbod-clone-v1:corrupt-backup');
});

test('storage full: the copy reports failure and leaves the original byte-identical', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL }, { full: true });
  assert.equal(keepSafetyCopy(ORIGINAL), false);
  assert.equal(mayReplaceOriginal(ORIGINAL, false), false, 'Restore and Start fresh stop');
  assert.equal(data.get(STORAGE_KEY), ORIGINAL);
  assert.equal(data.has(CORRUPT_BACKUP_KEY), false);
});

test('storage full with an older copy already kept: that older copy is not this one, so they stop', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL, [CORRUPT_BACKUP_KEY]: '{older copy' }, { full: true });
  assert.equal(mayReplaceOriginal(ORIGINAL, false), false);
  assert.equal(data.get(STORAGE_KEY), ORIGINAL);
  assert.equal(data.get(CORRUPT_BACKUP_KEY), '{older copy', 'the older copy is left as it was');
});

test('storage full but the copy key already holds this exact original: it is kept, they go ahead', () => {
  installStorage({ [STORAGE_KEY]: ORIGINAL, [CORRUPT_BACKUP_KEY]: ORIGINAL }, { full: true });
  assert.equal(keepSafetyCopy(ORIGINAL), true);
  assert.equal(mayReplaceOriginal(ORIGINAL, false), true);
});

test('the copy works: an older copy is replaced by this original, and they go ahead', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL, [CORRUPT_BACKUP_KEY]: '{older copy' });
  assert.equal(mayReplaceOriginal(ORIGINAL, false), true);
  assert.equal(data.get(CORRUPT_BACKUP_KEY), ORIGINAL);
  assert.equal(data.get(STORAGE_KEY), ORIGINAL, 'the copy itself never touches the original');
});

test('after Download original the downloaded file is the copy: a failed copy no longer stops them', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL, [CORRUPT_BACKUP_KEY]: '{older copy' }, { full: true });
  assert.equal(mayReplaceOriginal(ORIGINAL, true), true);
  assert.equal(data.get(CORRUPT_BACKUP_KEY), '{older copy', 'the copy was still tried and still failed');
});

test('a setItem that does not throw but does not store either counts as failed', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL });
  (globalThis.localStorage as Storage).setItem = () => {};
  assert.equal(mayReplaceOriginal(ORIGINAL, false), false);
  assert.equal(data.get(STORAGE_KEY), ORIGINAL);
});

test('no storage at all: no copy is claimed', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  assert.equal(keepSafetyCopy(ORIGINAL), false);
  assert.equal(mayReplaceOriginal(ORIGINAL, false), false);
});

test('nothing stored under the key: there is nothing to keep, so they go ahead', () => {
  installStorage({}, { full: true });
  assert.equal(mayReplaceOriginal('', false), true);
});

test('Start fresh after a kept copy writes empty data; the copy still holds the original', () => {
  const data = installStorage({ [STORAGE_KEY]: ORIGINAL });
  assert.equal(mayReplaceOriginal(ORIGINAL, false), true);
  assert.ok(saveState({ ...EMPTY_STATE }, 0, { force: true }).ok);
  assert.equal(loadState().status, 'ok');
  assert.equal(data.get(CORRUPT_BACKUP_KEY), ORIGINAL);
});

test('App: both Recovery handlers ask mayReplaceOriginal before anything replaces the original', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const [name, pattern, write] of [
    ['onRestore', /onRestore=\{\(next: AppState, summary: ImportSummary\) => \{([\s\S]*?)\n {10}\}\}\n/, 'setState(next)'],
    ['onStartFresh', /onStartFresh=\{\(\) => \{([\s\S]*?)\n {10}\}\}\n/, 'setState({ ...EMPTY_STATE })'],
  ] as const) {
    const handler = source.match(pattern);
    assert.ok(handler, `${name} is found`);
    const body = handler[1];
    const guard = body.indexOf('if (!mayReplaceOriginal(recovery.raw, originalDownloaded.current)) return false;');
    assert.ok(guard >= 0, `${name} stops when no copy is kept`);
    assert.ok(guard < body.indexOf(write), `${name} checks before it replaces the original`);
    assert.ok(guard < body.indexOf('forceSaveRef') || !body.includes('forceSaveRef'), `${name} checks before it arms a forced save`);
  }
  assert.doesNotMatch(source, /fitbod-clone-v1:corrupt-backup/, 'the key lives in lib/storage.ts only');
  const all = ['App.tsx', 'lib/storage.ts', 'components/Recovery.tsx']
    .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((all.match(/corrupt-backup/g) ?? []).length, 1, 'no new stored key: one corrupt-backup key');
});
