import { useEffect } from 'react';

// #370 Keep the screen awake while the logger is open. Silent by design: no setting, no copy, no errors.

interface Sentinel { release: () => Promise<void> | void }
interface WakeNav { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }
interface WakeDoc {
  visibilityState: string;
  addEventListener: (type: 'visibilitychange', fn: () => void) => void;
  removeEventListener: (type: 'visibilitychange', fn: () => void) => void;
}

export function createWakeLock({ nav, doc }: { nav: WakeNav; doc: WakeDoc }) {
  let running = false;
  let pending = false;
  let sentinel: Sentinel | null = null;

  const drop = (s: Sentinel | null) => {
    try { void Promise.resolve(s?.release()).catch(() => {}); } catch { /* nothing to release */ }
  };
  const release = () => {
    const s = sentinel;
    sentinel = null;
    drop(s);
  };
  const acquire = () => {
    if (!running || sentinel || pending || doc.visibilityState !== 'visible' || !nav.wakeLock) return;
    pending = true;
    let request: Promise<Sentinel>;
    try { request = nav.wakeLock.request('screen'); } catch { pending = false; return; }
    request.then(
      (s) => {
        pending = false;
        // Stopped or hidden before it arrived: hand it straight back.
        if (!running || doc.visibilityState !== 'visible') drop(s);
        else sentinel = s;
      },
      () => { pending = false; },
    );
  };
  const onVisibility = () => (doc.visibilityState === 'visible' ? acquire() : release());

  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener('visibilitychange', onVisibility);
      acquire();
    },
    stop() {
      if (!running) return;
      running = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      release();
    },
  };
}

/** Holds the lock while the calling component is mounted. */
export function useWakeLock() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const lock = createWakeLock({ nav: navigator as WakeNav, doc: document });
    lock.start();
    return () => lock.stop();
  }, []);
}
