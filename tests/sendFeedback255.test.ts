import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEEDBACK_URL,
  NOT_SENT,
  TESTER_ID_KEY,
  deviceKind,
  feedbackBody,
  sendFeedback,
  testerId,
} from '../src/lib/sendFeedback.ts';
import { FIREBASE } from '../src/lib/firebase.ts';
import { STORAGE_KEY, eraseLocalData } from '../src/lib/storage.ts';

const base = {
  message: 'Rest timer is too quiet',
  name: '',
  appVersion: 'abc1234',
  screen: 'settings' as const,
  device: 'iphone' as const,
  workoutCount: 3,
  testerId: '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3',
};

test('#255 endpoint: one constant file, the feedback collection, the public key', () => {
  assert.equal(FIREBASE.projectId, 'home-strength');
  assert.equal(
    FEEDBACK_URL,
    'https://firestore.googleapis.com/v1/projects/home-strength/databases/(default)/documents/feedback?key=AIzaSyA2efM2HsT1n1GpIiTrk4eFCkwREdFhUvo',
  );
});

test('#255 body: exactly the rule field names, typed; workoutCount is an integerValue string', () => {
  const body = feedbackBody({ ...base, name: 'Sam' });
  assert.ok(body);
  assert.deepEqual(body, {
    fields: {
      message: { stringValue: 'Rest timer is too quiet' },
      name: { stringValue: 'Sam' },
      appVersion: { stringValue: 'abc1234' },
      screen: { stringValue: 'settings' },
      device: { stringValue: 'iphone' },
      workoutCount: { integerValue: '3' },
      testerId: { stringValue: base.testerId },
    },
  });
});

test('#255 body: trims; a blank name is left out; a blank message builds nothing', () => {
  const body = feedbackBody({ ...base, message: '  hi \n', name: '   ' });
  assert.ok(body);
  assert.equal(body.fields.message.stringValue, 'hi');
  assert.equal('name' in body.fields, false);
  assert.equal(feedbackBody({ ...base, message: ' \n\t ' }), null);
});

test('#255 body: limits hold, counted in characters, never splitting an emoji', () => {
  const long = feedbackBody({ ...base, message: 'x'.repeat(2500), name: 'n'.repeat(120) });
  assert.ok(long);
  assert.equal(long.fields.message.stringValue.length, 2000);
  assert.equal(long.fields.name?.stringValue.length, 80);
  const emoji = feedbackBody({ ...base, message: '💪'.repeat(2100) });
  assert.ok(emoji);
  assert.equal(Array.from(emoji.fields.message.stringValue).length, 2000);
  assert.ok(emoji.fields.message.stringValue.endsWith('💪'));
  const id = feedbackBody({ ...base, testerId: 'a'.repeat(100), appVersion: 'v'.repeat(100) });
  assert.ok(id);
  assert.equal(id.fields.testerId.stringValue.length, 64);
  assert.ok(id.fields.appVersion.stringValue.length <= 40);
});

test('#255 body: workoutCount is a whole number ≥ 0; device outside the list is other', () => {
  for (const [count, sent] of [[-2, '0'], [2.7, '2'], [Number.NaN, '0'], [12, '12']] as const) {
    assert.equal(feedbackBody({ ...base, workoutCount: count })?.fields.workoutCount.integerValue, sent);
  }
  assert.equal(
    feedbackBody({ ...base, device: 'windows' as never })?.fields.device.stringValue,
    'other',
  );
});

test('#255 device: iPhone, iPad (desktop UA + touch), Android, else other', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131 Mobile';
  assert.equal(deviceKind({ userAgent: iphone, touchPoints: 5 }), 'iphone');
  assert.equal(deviceKind({ userAgent: mac, touchPoints: 5 }), 'iphone');
  assert.equal(deviceKind({ userAgent: mac, touchPoints: 0 }), 'other');
  assert.equal(deviceKind({ userAgent: android, touchPoints: 5 }), 'android');
  assert.equal(deviceKind({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', touchPoints: 0 }), 'other');
});

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

test('#255 tester ID: made once, stored under one app key, then reused', () => {
  assert.equal(TESTER_ID_KEY, `${STORAGE_KEY}:tester-id`);
  const store = memoryStore();
  const first = testerId(store);
  assert.match(first, /^[A-Za-z0-9-]{8,64}$/);
  assert.deepEqual([...store.map.keys()], [TESTER_ID_KEY]);
  assert.equal(testerId(store), first);
  assert.equal(testerId(memoryStore()) === first, false, 'a new phone gets a new ID');
});

test('#255 tester ID: a malformed stored value is replaced; no storage still sends an ID', () => {
  const store = memoryStore({ [TESTER_ID_KEY]: '<script>'.repeat(20) });
  const fresh = testerId(store);
  assert.match(fresh, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(store.map.get(TESTER_ID_KEY), fresh);
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.match(testerId(throwing), /^[A-Za-z0-9-]{8,64}$/);
  assert.match(testerId(null), /^[A-Za-z0-9-]{8,64}$/);
});

type FetchCall = { url: string; init: RequestInit };
function fakeFetch(respond: () => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

test('#255 send: one JSON POST to the endpoint with the built body; 200 is sent', async () => {
  const { calls, fetchFn } = fakeFetch(async () => new Response('{}', { status: 200 }));
  const result = await sendFeedback({ ...base, name: 'Sam' }, { fetchFn, online: true });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, FEEDBACK_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), feedbackBody({ ...base, name: 'Sam' }));
});

test('#255 send: offline never calls fetch; a refusal or network error is not sent', async () => {
  const offline = fakeFetch(async () => new Response('{}', { status: 200 }));
  assert.deepEqual(await sendFeedback(base, { fetchFn: offline.fetchFn, online: false }), { ok: false });
  assert.equal(offline.calls.length, 0);

  for (const respond of [
    async () => new Response('denied', { status: 403 }),
    async () => new Response('oops', { status: 500 }),
    async () => {
      throw new TypeError('Failed to fetch');
    },
  ]) {
    const { fetchFn } = fakeFetch(respond);
    assert.deepEqual(await sendFeedback(base, { fetchFn, online: true }), { ok: false });
  }
});

test('#255 send: a blank message sends nothing', async () => {
  const { calls, fetchFn } = fakeFetch(async () => new Response('{}', { status: 200 }));
  assert.deepEqual(await sendFeedback({ ...base, message: '   ' }, { fetchFn, online: true }), { ok: false });
  assert.equal(calls.length, 0);
});

test('#255 send: a request that hangs gives up and reports not sent', async () => {
  const fetchFn = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
  assert.deepEqual(await sendFeedback(base, { fetchFn, online: true, timeoutMs: 20 }), { ok: false });
});

test('#255 the not-sent copy is the story’s, word for word', () => {
  assert.equal(NOT_SENT, "Not sent. You're offline. Your note is kept; tap Send again.");
});

test('#255 Start over erases the tester ID with the rest of the app’s keys', () => {
  const map = new Map<string, string>([
    [STORAGE_KEY, '{}'],
    [TESTER_ID_KEY, '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'],
    ['someone-else', 'keep'],
  ]);
  const store = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
  };
  assert.deepEqual(eraseLocalData(store), { ok: true });
  assert.deepEqual([...map.keys()], ['someone-else']);
});
