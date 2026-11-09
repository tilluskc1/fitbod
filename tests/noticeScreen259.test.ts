import assert from 'node:assert/strict';
import test from 'node:test';
import { noticeHome, screenKey } from '../src/lib/noticeScreen.ts';

test('the screen is the full-screen view, or the tab when the tab bar shows (#259)', () => {
  assert.equal(screenKey('tabs', 'today'), 'tabs:today');
  assert.equal(screenKey('tabs', 'coach'), 'tabs:coach');
  assert.equal(screenKey('train', 'today'), 'train', 'the logger is one screen whatever tab sits behind it');
  assert.equal(screenKey('recap', 'progress'), 'recap');
});

test('a message stays on the screen it was raised on and clears anywhere else (#259)', () => {
  assert.equal(noticeHome('tabs:today', 'tabs:today'), 'tabs:today');
  assert.equal(noticeHome('tabs:today', 'train'), null, 'a Today banner never follows into the logger');
  assert.equal(noticeHome('tabs:today', 'tabs:plan'), null, 'a tab change clears it too');
  assert.equal(noticeHome('train', 'tabs:today'), null, 'a logger message stays in the logger');
  assert.equal(noticeHome(null, 'train'), null, 'no message: nothing to keep');
});

test('the recap message follows the recap to Today only (#276, #259)', () => {
  assert.equal(noticeHome('recap', 'tabs:today'), 'tabs:today', '"Session saved to history" lands on Today');
  assert.equal(noticeHome('recap', 'tabs:coach'), null, 'never into Coach');
  assert.equal(noticeHome('recap', 'tabs:progress'), null, 'never into Progress');
  // Once on Today it belongs to Today: the next move clears it.
  assert.equal(noticeHome(noticeHome('recap', 'tabs:today'), 'tabs:coach'), null);
});
