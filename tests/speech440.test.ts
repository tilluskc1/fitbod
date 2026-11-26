import assert from 'node:assert/strict';
import test from 'node:test';
import { armRecognition, newRecognition, voiceSupported } from '../src/lib/speech.ts';

/** No real browser in this process (#203's SSR case) — the no-support path, every call. */
test('no window: unsupported everywhere, nothing thrown', () => {
  assert.equal(voiceSupported(), false);
  assert.equal(newRecognition(), null);
  assert.equal(armRecognition(), null);
});

/** A fake constructor stood in for `window.SpeechRecognition`/`webkitSpeechRecognition`, torn down
 * after each test so it never leaks into another file sharing this process's `globalThis`. */
function withFakeWindow(ctorName: 'SpeechRecognition' | 'webkitSpeechRecognition', run: (startCalls: number[]) => void) {
  const startCalls: number[] = [];
  class FakeRecognition {
    lang = '';
    continuous = true;
    interimResults = false;
    start() { startCalls.push(1); }
    stop() {}
    abort() {}
    onresult = null;
    onerror = null;
    onend = null;
  }
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { [ctorName]: FakeRecognition };
  try {
    run(startCalls);
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
}

test('armRecognition: configures for one phrase and starts synchronously, from either constructor name', () => {
  for (const ctorName of ['SpeechRecognition', 'webkitSpeechRecognition'] as const) {
    withFakeWindow(ctorName, (startCalls) => {
      const recognition = armRecognition();
      assert.ok(recognition, `${ctorName}: armRecognition returned null`);
      assert.equal(recognition!.continuous, false, `${ctorName}: continuous should stop at one phrase, not keep listening`);
      assert.equal(recognition!.interimResults, true, `${ctorName}: interimResults should drive the live transcript`);
      assert.equal(startCalls.length, 1, `${ctorName}: start() should run inside armRecognition, in the caller's own gesture`);
    });
  }
});

test('armRecognition: a start() failure (e.g. already running) throws instead of returning a half-armed recognizer', () => {
  withFakeWindow('SpeechRecognition', () => {
    const w = globalThis as unknown as { window: { SpeechRecognition: new () => { start(): void } } };
    const Original = w.window.SpeechRecognition;
    w.window.SpeechRecognition = class extends Original {
      start() { throw new Error('already started'); }
    };
    assert.throws(() => armRecognition());
  });
});
