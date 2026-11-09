import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { splashAfterAdopt } from '../src/lib/firstScreen.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

const onboarded: AppState = { ...EMPTY_STATE, profile: { name: 'Sam' } as unknown as Profile };

test('adopting another tab\'s profile lifts the splash; nothing else changes it (#288)', () => {
  assert.equal(splashAfterAdopt(true, onboarded), false, 'splash tab moves to Today');
  assert.equal(splashAfterAdopt(true, EMPTY_STATE), true, 'still no profile: the splash stays');
  assert.equal(splashAfterAdopt(false, EMPTY_STATE), false, 'an adoption never raises the splash (a start over lands on onboarding)');
  assert.equal(splashAfterAdopt(false, onboarded), false, 'a tab past the splash stays put');
});

test('the storage listener sets the splash from what it adopted (#288)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const onStorage =');
  const listener = app.slice(start, app.indexOf("window.addEventListener('storage'", start));
  assert.ok(start > 0, 'the storage listener is found');
  assert.match(listener, /splashAfterAdopt\(/, 'the listener updates the splash with splashAfterAdopt');
  assert.ok(listener.indexOf('splashAfterAdopt(') > listener.indexOf('setState(loaded.state)'), 'after it adopts the state');
});
