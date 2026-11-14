import assert from 'node:assert/strict';
import test from 'node:test';
import { createWakeLock } from '../src/lib/wakeLock.ts';

// #370 keep the screen awake while the logger is open. Pure controller, fake navigator and document.

function rig(opts: { missing?: boolean; reject?: boolean; manual?: boolean } = {}) {
  const log = { requests: 0, releases: 0 };
  const pending: Array<(s: unknown) => void> = [];
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  const dropped: Array<() => void> = [];
  const sentinel = () => ({
    release: () => { log.releases += 1; return Promise.resolve(); },
    addEventListener: (_: string, fn: () => void) => void dropped.push(fn),
  });
  const nav = opts.missing
    ? {}
    : {
        wakeLock: {
          request: (type: string) => {
            assert.equal(type, 'screen');
            log.requests += 1;
            if (opts.reject) return Promise.reject(new Error('NotAllowedError'));
            if (opts.manual) return new Promise((resolve) => pending.push(resolve as (s: unknown) => void));
            return Promise.resolve(sentinel());
          },
        },
      };
  const setVisible = (v: 'visible' | 'hidden') => { doc.visibilityState = v; [...listeners].forEach((fn) => fn()); };
  return { log, doc, nav, pending, sentinel, setVisible, listeners, dropped };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('#370 requests on start and releases on stop', async () => {
  const r = rig();
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  await tick();
  assert.equal(r.log.requests, 1);
  w.stop();
  assert.equal(r.log.releases, 1);
  assert.equal(r.listeners.size, 0);
});

test('#370 hidden releases, visible requests again, a doubled visible event requests once', async () => {
  const r = rig();
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  await tick();
  r.setVisible('hidden');
  assert.equal(r.log.releases, 1);
  r.setVisible('visible');
  r.setVisible('visible');
  await tick();
  assert.equal(r.log.requests, 2);
  w.stop();
  assert.equal(r.log.releases, 2);
});

test('#370 no wakeLock: no throw, no request', async () => {
  const r = rig({ missing: true });
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  r.setVisible('hidden');
  r.setVisible('visible');
  w.stop();
  await tick();
  assert.equal(r.log.requests, 0);
});

test('#370 a rejected request is swallowed', async () => {
  const r = rig({ reject: true });
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  await tick();
  assert.equal(r.log.requests, 1);
  assert.doesNotThrow(() => w.stop());
});

test('#370 stop before the request resolves releases the late sentinel once', async () => {
  const r = rig({ manual: true });
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  w.stop();
  assert.equal(r.log.releases, 0);
  r.pending[0](r.sentinel());
  await tick();
  assert.equal(r.log.releases, 1);
});

test('#370 hidden then visible before the first request resolves keeps one live lock', async () => {
  const r = rig({ manual: true });
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  r.setVisible('hidden');
  r.setVisible('visible');
  await tick();
  assert.equal(r.log.requests, 1, 'no second request while one is pending');
  r.pending[0](r.sentinel());
  await tick();
  assert.equal(r.log.releases, 0);
  w.stop();
  assert.equal(r.log.releases, 1);
});

test('#370 start while hidden requests nothing until visible', async () => {
  const r = rig();
  r.doc.visibilityState = 'hidden';
  const w = createWakeLock({ nav: r.nav as never, doc: r.doc as never });
  w.start();
  await tick();
  assert.equal(r.log.requests, 0);
  r.setVisible('visible');
  await tick();
  assert.equal(r.log.requests, 1);
  w.stop();
});

test('#370 a lock the browser drops itself is requested again on the next visible', async () => {
  const r = rig();
  const lock = createWakeLock({ nav: r.nav, doc: r.doc });
  lock.start();
  await tick();
  assert.equal(r.log.requests, 1);
  r.dropped.forEach((fn) => fn()); // the browser released it without a hidden event
  r.setVisible('visible');
  await tick();
  assert.equal(r.log.requests, 2);
  lock.stop();
});
