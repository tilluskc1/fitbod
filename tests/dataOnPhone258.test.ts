import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DATA_ON_PHONE, INSTALLED_FRESH, offerFirstBackup } from '../src/lib/dataHome.ts';

// #258: three moments say the data lives on this phone; each is "once" by its own condition, so
// nothing new is stored. Browser proof: scripts/e2e/data-on-phone.mjs.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const done = { status: 'completed' };

test('the first recap offers a backup only for the first completed workout, before any backup', () => {
  assert.equal(offerFirstBackup({ history: [] }), false);
  assert.equal(offerFirstBackup({ history: [done] }), true);
  assert.equal(offerFirstBackup({ history: [done, { status: 'discarded' }] }), true);
  assert.equal(offerFirstBackup({ history: [done, done] }), false);
  assert.equal(offerFirstBackup({ history: [done], lastBackupAt: '2026-11-02T09:00:00.000Z' }), false);
});

test('the wording is the product default', () => {
  assert.equal(DATA_ON_PHONE, 'Your workouts stay on this phone. Back up from Settings now and then.');
  assert.equal(INSTALLED_FRESH, 'Starting fresh? If you used the browser before, restore your backup here.');
});

test('the installed-app restore uses the same validated restore as Settings', () => {
  const app = read('src/App.tsx');
  assert.match(app, /installed=\{typeof window !== 'undefined' && currentDevice\(\)\.standalone\}\n\s*onRestore=\{\(file\) => void restoreFile\(file\)/);
  assert.match(app, /const restoreFile = async[\s\S]*?parseState\(text\)/);
});

test('no new stored fields', () => {
  assert.ok(!read('src/types.ts').match(/dismiss|seenRestore|backupOffer/i));
});
