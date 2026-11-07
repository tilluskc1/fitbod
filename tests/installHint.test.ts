import assert from 'node:assert/strict';
import test from 'node:test';
import { installHint } from '../src/lib/install.ts';

// #214: one line in Settings telling the lifter how to keep the app (and its data) on the phone.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('iPhone and iPad get Share → Add to Home Screen; Android gets Install app', () => {
  assert.match(installHint({ userAgent: IPHONE, touchPoints: 5, standalone: false })!.how, /Share.*Add to Home Screen/);
  assert.match(installHint({ userAgent: IPAD, touchPoints: 5, standalone: false })!.how, /Share.*Add to Home Screen/, 'iPadOS reports a Mac user agent');
  assert.match(installHint({ userAgent: ANDROID, touchPoints: 5, standalone: false })!.how, /Install app/);
});

test('no hint once installed, or on a desktop', () => {
  assert.equal(installHint({ userAgent: IPHONE, touchPoints: 5, standalone: true }), null);
  assert.equal(installHint({ userAgent: ANDROID, touchPoints: 5, standalone: true }), null);
  assert.equal(installHint({ userAgent: DESKTOP, touchPoints: 0, standalone: false }), null);
  assert.equal(installHint({ userAgent: IPAD, touchPoints: 0, standalone: false }), null, 'a real Mac has no touch points');
});
