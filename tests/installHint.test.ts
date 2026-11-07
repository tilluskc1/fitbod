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

test('iPhone is told to export first: a Home Screen app starts with its own storage', () => {
  const how = installHint({ userAgent: IPHONE, touchPoints: 5, standalone: false })!.how;
  assert.match(how, /^Export JSON backup first\..*Restore from backup/);
});

test('Android names the browser it is in, and falls back to a generic menu', () => {
  const samsung = ANDROID.replace('Chrome/131.0.0.0 Mobile', 'SamsungBrowser/27.0 Chrome/131.0.0.0 Mobile');
  const firefox = 'Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0';
  const other = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36';
  const how = (userAgent: string) => installHint({ userAgent, touchPoints: 5, standalone: false })!.how;
  assert.match(how(ANDROID), /^In Chrome/);
  assert.match(how(samsung), /^In Samsung Internet/);
  assert.match(how(firefox), /^In Firefox/);
  assert.match(how(other), /^Open your browser’s menu/);
});

test('no hint once installed, or on a desktop', () => {
  assert.equal(installHint({ userAgent: IPHONE, touchPoints: 5, standalone: true }), null);
  assert.equal(installHint({ userAgent: ANDROID, touchPoints: 5, standalone: true }), null);
  assert.equal(installHint({ userAgent: DESKTOP, touchPoints: 0, standalone: false }), null);
  assert.equal(installHint({ userAgent: IPAD, touchPoints: 0, standalone: false }), null, 'a real Mac has no touch points');
});
