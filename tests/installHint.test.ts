import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissInstallNote,
  installGuide,
  installSteps,
  INSTALL_NOTE,
  showInstallNote,
  type DeviceInfo,
} from '../src/lib/install.ts';

// #214 Settings hint; #307 per-browser steps, the Today note and its dismissal.
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15';
const EDGE_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.0.2903.68 Mobile/15E148 Safari/605.1.15';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 355.0.0.0 (iPhone15,2; iOS 18_0; en_US; en; scale=3.00; 1179x2556; 0)';
const FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0]';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UNKNOWN_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SomeBrowser/2.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const SAMSUNG = ANDROID.replace('Chrome/131.0.0.0 Mobile', 'SamsungBrowser/27.0 Chrome/131.0.0.0 Mobile');
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const device = (userAgent: string, extra: Partial<DeviceInfo> = {}): DeviceInfo => ({ userAgent, touchPoints: 5, standalone: false, ...extra });
const add = (userAgent: string) => installGuide(device(userAgent))!.add;

test('#307 each iOS browser gets its own Add to Home Screen steps', () => {
  assert.equal(add(SAFARI), 'Tap Share at the bottom, then Add to Home Screen, then Add.');
  assert.equal(add(CHROME_IOS), 'Tap Share in the address bar, then Add to Home Screen. Not there? Open this page in Safari and add it from there.');
  // Firefox and Edge menus are not verified on a device yet, so they get the Safari route (#307).
  assert.equal(add(FIREFOX_IOS), 'Open this page in Safari, then tap Share, then Add to Home Screen.');
  assert.equal(add(EDGE_IOS), 'Open this page in Safari, then tap Share, then Add to Home Screen.');
  assert.equal(add(INSTAGRAM), 'Open this page in Safari first. Then tap Share at the bottom, then Add to Home Screen, then Add.');
  assert.equal(add(FACEBOOK), add(INSTAGRAM), 'any in-app webview');
  assert.equal(add(UNKNOWN_IOS), add(SAFARI), 'unknown iOS browser takes the Safari route');
  assert.equal(add(IPAD), add(SAFARI), 'iPadOS reports a Mac user agent; touch points tell them apart');
});

test('#307 iPhone carries data across (own storage); Android does not need to', () => {
  assert.equal(installGuide(device(SAFARI))!.carryData, true);
  assert.equal(installGuide(device(CHROME_IOS))!.carryData, true);
  assert.equal(installGuide(device(ANDROID))!.carryData, false);
});

test('Android names the browser it is in, and falls back to a generic menu', () => {
  const firefox = 'Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0';
  const other = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36';
  assert.match(add(ANDROID), /^In Chrome, open the ⋮ menu, then Install app/);
  assert.match(add(SAMSUNG), /^In Samsung Internet/);
  assert.match(add(firefox), /^In Firefox/);
  assert.match(add(other), /^Open your browser’s menu/);
});

test('no guide once installed, or on a desktop', () => {
  for (const ua of [SAFARI, CHROME_IOS, INSTAGRAM, ANDROID]) assert.equal(installGuide(device(ua, { standalone: true })), null, ua);
  assert.equal(installGuide(device(DESKTOP, { touchPoints: 0 })), null);
  assert.equal(installGuide(device(IPAD, { touchPoints: 0 })), null, 'a real Mac has no touch points');
});

test('#307 the sheet: back up, add, restore; only the add step with no workouts or on Android', () => {
  const guide = installGuide(device(CHROME_IOS))!;
  const steps = installSteps(guide, 2);
  assert.deepEqual(steps.map((step) => step.key), ['backup', 'add', 'restore']);
  assert.equal(steps[1].text, guide.add);
  assert.equal(steps[2].text, 'Open the new app and tap Restore backup on the first screen.');
  assert.deepEqual(installSteps(guide, 0).map((step) => step.key), ['add']);
  assert.deepEqual(installSteps(installGuide(device(ANDROID))!, 3).map((step) => step.key), ['add']);
});

const NOW = new Date('2026-11-10T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const note = (overrides: Partial<Parameters<typeof showInstallNote>[0]> = {}) =>
  showInstallNote({ device: device(SAFARI), completedWorkouts: 1, sessionOpen: false, dismissals: undefined, now: NOW, ...overrides });

test('#307 Today shows the note after the first finished workout, not before', () => {
  assert.match(INSTALL_NOTE, /^Keep Home Strength on your Home Screen\. It keeps your workouts safe and opens like an app\.$/);
  assert.equal(note({ completedWorkouts: 0 }), false);
  assert.equal(note(), true);
  assert.equal(note({ device: device(CHROME_IOS) }), true);
  assert.equal(note({ device: device(ANDROID) }), true, 'Android: same rule');
});

test('#307 never in a running session, once installed, or on a desktop', () => {
  assert.equal(note({ sessionOpen: true }), false);
  assert.equal(note({ device: device(SAFARI, { standalone: true }) }), false);
  assert.equal(note({ device: device(DESKTOP, { touchPoints: 0 }) }), false);
});

test('#307 × hides it for 7 days; after 2 dismissals it lives only in Settings', () => {
  const once = dismissInstallNote(undefined, NOW);
  assert.deepEqual(once, [NOW.toISOString()]);
  assert.equal(note({ dismissals: once }), false, 'just dismissed');
  assert.equal(note({ dismissals: [daysAgo(6.9)] }), false, 'inside 7 days');
  assert.equal(note({ dismissals: [daysAgo(7.1)] }), true, 'back after 7 days');
  const twice = dismissInstallNote([daysAgo(8)], NOW);
  assert.equal(twice.length, 2);
  assert.equal(note({ dismissals: [daysAgo(30), daysAgo(20)] }), false, 'two dismissals: gone from Today for good');
  assert.equal(dismissInstallNote(twice, NOW).length, 2, 'the record never grows past two');
});
