import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ABOUT_USAGE, USAGE_SENT } from '../src/lib/about.ts';
import {
  BATCH_URL,
  DAY_TYPES,
  EVENT_FIELDS,
  EVENT_NAMES,
  OUTBOX_CAP,
  OUTBOX_KEY,
  dayTypeOf,
  enqueue,
  eventFields,
  flushOutbox,
  localDay,
  readOutbox,
  usageEvent,
  type UsageEvent,
} from '../src/lib/events.ts';
import { EMPTY_STATE, STORAGE_KEY, serializeExport } from '../src/lib/storage.ts';

// #359 anonymous usage events: an allowlist of six fields, a capped outbox, and a send that never
// blocks or breaks training.

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const at = new Date(2026, 10, 14, 9, 30);
const sample = (event: UsageEvent['event'] = 'workout-finished', dayType: UsageEvent['dayType'] = 'push') =>
  usageEvent(event, dayType, '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3', 'dfae102', at);

test('#359 every event payload carries exactly the allowed fields, nothing else', () => {
  const allowed = [...EVENT_FIELDS].sort();
  for (const name of EVENT_NAMES) {
    for (const dayType of [null, ...DAY_TYPES]) {
      const event = usageEvent(name, dayType, 'abcdefgh-1234', 'v1', at);
      assert.deepEqual(Object.keys(event).sort(), allowed, `record ${name}/${dayType}`);
      assert.deepEqual(Object.keys(eventFields(event)).sort(), allowed, `payload ${name}/${dayType}`);
    }
  }
});

test('#359 the payload is typed for Firestore: strings, a null day type, a timestamp', () => {
  assert.deepEqual(eventFields(sample()), {
    testerId: { stringValue: '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3' },
    event: { stringValue: 'workout-finished' },
    dayType: { stringValue: 'push' },
    appVersion: { stringValue: 'dfae102' },
    date: { stringValue: '2026-11-14' },
    createdAt: { timestampValue: at.toISOString() },
  });
  assert.deepEqual(eventFields(sample('backup', null)).dayType, { nullValue: null });
});

test('#359 the sent batch carries only allowlisted fields, even from a tampered outbox', async () => {
  const tampered = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', event: { ...sample(), weight: 100, reps: 8, note: 'knee hurts', name: 'Sam' } };
  const store = memoryStore({ [OUTBOX_KEY]: JSON.stringify([tampered]) });
  let sent: { writes: Array<{ update: { fields: Record<string, unknown> } }> } | null = null;
  await flushOutbox(store, {
    online: true,
    fetchFn: (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ status: [{}] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.ok(sent);
  for (const write of sent!.writes) assert.deepEqual(Object.keys(write.update.fields).sort(), [...EVENT_FIELDS].sort());
  assert.doesNotMatch(JSON.stringify(sent), /weight|reps|knee|Sam/);
});

test('#359 the app source never builds an event outside usageEvent (no extra fields can sneak in)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const calls = [...app.matchAll(/track\(([^;]*?)\);/g)].map((match) => match[1]);
  assert.ok(calls.length >= 9, `found ${calls.length} track calls`);
  for (const args of calls) assert.doesNotMatch(args, /\{/, `track(${args}) passes only a name and a day type`);
});

test('#359 day type comes from the day name; anything else is a picked day', () => {
  const cases: Array<[string, string]> = [
    ['Push', 'push'], ['Push A', 'push'], ['Pull B', 'pull'], ['Legs', 'legs'], ['Legs A', 'legs'],
    ['Upper A', 'upper'], ['Upper', 'upper'], ['Lower B', 'lower'], ['Full Body A', 'full-body'], ['Full body', 'full-body'],
    ['Arms + Legs', 'picked'], ['Chest + Back', 'picked'], ['Today', 'picked'], ['Pushover', 'picked'],
  ];
  for (const [name, type] of cases) assert.equal(dayTypeOf(name), type, name);
});

test('#359 the date is the local calendar day, across midnight', () => {
  assert.equal(localDay(new Date(2026, 10, 15, 23, 59)), '2026-11-15');
  assert.equal(localDay(new Date(2026, 10, 16, 0, 1)), '2026-11-16');
});

test('#359 the outbox keeps 500, dropping the oldest; 500 plus one drops exactly one', () => {
  const store = memoryStore();
  for (let i = 0; i < OUTBOX_CAP + 1; i += 1) enqueue(store, sample(), `id${String(i).padStart(20, '0')}`);
  const queue = readOutbox(store);
  assert.equal(queue.length, OUTBOX_CAP);
  assert.equal(queue[0].id, `id${String(1).padStart(20, '0')}`);
  assert.equal(queue.at(-1)!.id, `id${String(OUTBOX_CAP).padStart(20, '0')}`);
  assert.deepEqual([...store.map.keys()], [OUTBOX_KEY]);
  assert.equal(OUTBOX_KEY, `${STORAGE_KEY}:events-outbox`);
});

test('#359 a corrupt or blocked outbox never throws', () => {
  assert.deepEqual(readOutbox(memoryStore({ [OUTBOX_KEY]: '{not json' })), []);
  assert.deepEqual(readOutbox(memoryStore({ [OUTBOX_KEY]: JSON.stringify([{ id: 'x' }, 7, null]) })), []);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readOutbox(blocked), []);
  assert.doesNotThrow(() => enqueue(blocked, sample()));
  assert.doesNotThrow(() => enqueue(null, sample()));
});

const okBatch = (statuses: Array<{ code?: number }>) =>
  (async () => new Response(JSON.stringify({ status: statuses }), { status: 200 })) as unknown as typeof fetch;

test('#359 offline never sends and keeps everything', async () => {
  const store = memoryStore();
  enqueue(store, sample());
  let called = false;
  const left = await flushOutbox(store, { online: false, fetchFn: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
  assert.equal(called, false);
  assert.equal(left, 1);
});

test('#359 a network error, a timeout or a refused request keeps the whole queue', async () => {
  for (const fetchFn of [
    (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch,
    (async () => new Response('', { status: 503 })) as typeof fetch,
    ((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch,
  ]) {
    const store = memoryStore();
    enqueue(store, sample());
    enqueue(store, sample('backup', null));
    assert.equal(await flushOutbox(store, { online: true, fetchFn, timeoutMs: 20 }), 2);
    assert.equal(readOutbox(store).length, 2);
  }
});

test('#359 per write: sent, already there and refused-for-good leave; a transient failure stays', async () => {
  const store = memoryStore();
  for (const id of ['a', 'b', 'c', 'd', 'e']) enqueue(store, sample(), id.repeat(24));
  // ok, ALREADY_EXISTS, PERMISSION_DENIED, UNAVAILABLE, INVALID_ARGUMENT
  const left = await flushOutbox(store, { online: true, fetchFn: okBatch([{}, { code: 6 }, { code: 7 }, { code: 14 }, { code: 3 }]) });
  assert.equal(left, 1);
  assert.deepEqual(readOutbox(store).map((item) => item.id), ['d'.repeat(24)]);
});

test('#359 events queued while a send is in flight are kept', async () => {
  const store = memoryStore();
  enqueue(store, sample(), 'a'.repeat(24));
  const left = await flushOutbox(store, {
    online: true,
    fetchFn: (async () => {
      enqueue(store, sample('switch', null), 'b'.repeat(24));
      return new Response(JSON.stringify({ status: [{}] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(left, 1);
  assert.deepEqual(readOutbox(store).map((item) => item.id), ['b'.repeat(24)]);
});

test('#359 each write is a create of a fresh document (a resend cannot duplicate)', async () => {
  const store = memoryStore();
  enqueue(store, sample(), 'c'.repeat(24));
  let url = '';
  let body: { writes: Array<{ update: { name: string }; currentDocument: { exists: boolean } }> } | null = null;
  await flushOutbox(store, {
    online: true,
    fetchFn: (async (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ status: [{}] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(url, BATCH_URL);
  assert.match(body!.writes[0].update.name, /\/documents\/events\/c{24}$/);
  assert.deepEqual(body!.writes[0].currentDocument, { exists: false });
});

test('#359 a backup file neither carries nor needs the outbox', () => {
  const file = serializeExport(EMPTY_STATE);
  assert.doesNotMatch(file, /events-outbox|workout-started/);
});

test('#359 About names every field a usage count carries, and what it never holds', () => {
  assert.deepEqual(USAGE_SENT.map((item) => item.field).sort(), [...EVENT_FIELDS].sort());
  for (const { says } of USAGE_SENT) assert.ok(ABOUT_USAGE.includes(says), `About names "${says}"`);
  assert.match(ABOUT_USAGE, /Never your name, weights, reps, notes, body details or pain answers\./);
});
