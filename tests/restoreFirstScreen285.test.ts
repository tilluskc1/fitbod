import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { opensOnSplash } from '../src/lib/firstScreen.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

const profile = { name: 'Sam' } as unknown as Profile;

test('the splash shows only while there is no profile (#285)', () => {
  assert.equal(opensOnSplash(EMPTY_STATE), true, 'empty data: onboarding comes next');
  const restored: AppState = { ...EMPTY_STATE, profile };
  assert.equal(opensOnSplash(restored), false, 'a restored profile opens on Today');
});

test('both Recovery exits set the first screen from the data they leave behind (#285)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('<Recovery');
  const block = app.slice(start, app.indexOf('</PhoneFrame>', start));
  const restore = block.slice(block.indexOf('onRestore='), block.indexOf('onStartFresh='));
  const fresh = block.slice(block.indexOf('onStartFresh='));
  assert.match(restore, /setShowSplash\(opensOnSplash\(next\)\)/, 'a restore opens on Today when the backup has a profile');
  assert.match(fresh, /setShowSplash\(opensOnSplash\(EMPTY_STATE\)\)/, 'Start fresh opens on the splash');
  assert.match(app, /useState\(\(\) => opensOnSplash\(initial\.state\)\)/, 'a cold start uses the same rule');
});
