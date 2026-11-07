import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { trapTarget } from '../src/lib/focusTrap.ts';

// UI7-11 (#153): Tab and Shift+Tab stay inside an open sheet.

test('Tab on the last control wraps to the first', () => {
  assert.equal(trapTarget(4, 5, false), 0);
});

test('Shift+Tab on the first control wraps to the last', () => {
  assert.equal(trapTarget(0, 5, true), 4);
});

test('moves between inner controls are left to the browser', () => {
  assert.equal(trapTarget(2, 5, false), null);
  assert.equal(trapTarget(2, 5, true), null);
});

test('focus outside the sheet is pulled back in', () => {
  assert.equal(trapTarget(-1, 5, false), 0);
  assert.equal(trapTarget(-1, 5, true), 4);
});

test('a sheet with nothing focusable leaves focus alone', () => {
  assert.equal(trapTarget(-1, 0, false), null);
});

test('Sheet traps Tab and makes the page behind inert', () => {
  const sheet = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /trapTarget\(/);
  assert.match(sheet, /setAttribute\('inert'/);
  assert.match(sheet, /removeAttribute\('inert'\)/);
});
