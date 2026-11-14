import { FIREBASE } from './firebase.ts';
import { appVersion, testerId } from './sendFeedback.ts';
import { STORAGE_KEY } from './storage.ts';

/**
 * (#359) Anonymous usage events. One small record per event, with exactly the fields in
 * EVENT_FIELDS and nothing else, ever: no names, loads, reps, notes, body data or pain answers.
 * Records wait in one stored queue (OUTBOX_KEY, capped) and go to Firestore in one batchWrite,
 * on open and when the phone comes back online. Nothing here ever throws into training.
 */
export const EVENT_NAMES = [
  'workout-started',
  'workout-finished',
  'workout-cut-short',
  'switch',
  'plan-today',
  'replace',
  'supersets-on',
  'supersets-off',
  'backup',
  'feedback',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const DAY_TYPES = ['push', 'pull', 'legs', 'upper', 'lower', 'full-body', 'picked'] as const;
export type DayType = (typeof DAY_TYPES)[number];

/** The only fields an event may carry, in this order. A test fails the build on anything else. */
export const EVENT_FIELDS = ['testerId', 'event', 'dayType', 'appVersion', 'date', 'createdAt'] as const;

export interface UsageEvent {
  testerId: string;
  event: EventName;
  dayType: DayType | null;
  appVersion: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** When it happened, ISO-8601 UTC. */
  createdAt: string;
}

/** The one stored key this story adds (owner-approved): unsent events, oldest first. */
export const OUTBOX_KEY = `${STORAGE_KEY}:events-outbox`;
export const OUTBOX_CAP = 500;

/** The day's type, read from its name: a planned split day or a Switch preset; anything else was picked. */
export function dayTypeOf(name: string): DayType {
  const match = /^(push|pull|legs|upper|lower|full body)\b/i.exec(name.trim());
  return match ? (match[1].toLowerCase().replace(' ', '-') as DayType) : 'picked';
}

/** The local calendar day of `when`, YYYY-MM-DD. */
export function localDay(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export function usageEvent(event: EventName, dayType: DayType | null, id: string, version: string, now: Date): UsageEvent {
  return { testerId: id, event, dayType, appVersion: version.slice(0, 40), date: localDay(now), createdAt: now.toISOString() };
}

const str = (stringValue: string) => ({ stringValue });

/** Firestore's typed-field JSON for one event: exactly EVENT_FIELDS. */
export function eventFields(event: UsageEvent) {
  return {
    testerId: str(event.testerId),
    event: str(event.event),
    dayType: event.dayType === null ? { nullValue: null } : str(event.dayType),
    appVersion: str(event.appVersion),
    date: str(event.date),
    createdAt: { timestampValue: event.createdAt },
  };
}

/** A queued event: a random document id (so a resend can never duplicate it) and the record. */
export interface Queued {
  id: string;
  event: UsageEvent;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const ID_SHAPE = /^[A-Za-z0-9]{16,40}$/;

function isQueued(value: unknown): value is Queued {
  if (!value || typeof value !== 'object') return false;
  const { id, event } = value as Queued;
  return typeof id === 'string' && ID_SHAPE.test(id) && !!event && typeof event === 'object'
    && EVENT_NAMES.includes(event.event) && typeof event.testerId === 'string' && typeof event.date === 'string'
    && typeof event.createdAt === 'string' && typeof event.appVersion === 'string'
    && (event.dayType === null || DAY_TYPES.includes(event.dayType));
}

/** The queue as stored; anything unreadable or malformed reads as empty, entry by entry. */
export function readOutbox(store: Store | null): Queued[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isQueued).map(({ id, event }) => ({ id, event: pick(event) })) : [];
  } catch {
    return [];
  }
}

/** Only the allowed fields survive a round trip through storage. */
function pick(event: UsageEvent): UsageEvent {
  const { testerId: id, event: name, dayType, appVersion: version, date, createdAt } = event;
  return { testerId: id, event: name, dayType, appVersion: version, date, createdAt };
}

function writeOutbox(store: Store | null, queue: Queued[]): void {
  try {
    store?.setItem(OUTBOX_KEY, JSON.stringify(queue.slice(-OUTBOX_CAP)));
  } catch {
    // Full or blocked storage: the event is lost, training is not.
  }
}

function docId(): string {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Add one event to the queue, dropping the oldest past the cap. */
export function enqueue(store: Store | null, event: UsageEvent, id = docId()): void {
  writeOutbox(store, [...readOutbox(store), { id, event }]);
}

const DB = `projects/${FIREBASE.projectId}/databases/(default)/documents`;
export const BATCH_URL = `https://firestore.googleapis.com/v1/${DB}:batchWrite?key=${FIREBASE.apiKey}`;

/** gRPC codes a resend can never fix: the rules or the shape refused it. ALREADY_EXISTS means it landed. */
const DROP = new Set([3, 6, 7, 9]);

interface FlushOptions {
  fetchFn?: typeof fetch;
  online?: boolean;
  timeoutMs?: number;
}

let flushing: Promise<number> | null = null;
let again = false;

/**
 * Send everything queued in one batchWrite. Offline never tries; a network error, a timeout or a
 * refused request keeps the queue. Per write: sent, already there, or refused for good leaves the
 * queue; anything else stays for the next try. Events queued during the send are kept. Resolves to
 * the number still queued.
 */
export function flushOutbox(store: Store | null, options: FlushOptions = {}): Promise<number> {
  if (flushing) {
    // Queued during a send: one more send once it ends, so the newest event never waits for the next tap.
    again = true;
    return flushing;
  }
  flushing = send(store, options).finally(() => {
    flushing = null;
    if (again) {
      again = false;
      void flushOutbox(store, options).catch(() => undefined);
    }
  });
  return flushing;
}

async function send(store: Store | null, { fetchFn = globalThis.fetch, online, timeoutMs = 15000 }: FlushOptions): Promise<number> {
  const queue = readOutbox(store);
  const isOnline = online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (queue.length === 0 || !isOnline) return queue.length;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let done: Set<string>;
  try {
    const response = await fetchFn(BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: queue.map(({ id, event }) => ({
          update: { name: `${DB}/events/${id}`, fields: eventFields(event) },
          currentDocument: { exists: false },
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return queue.length;
    const result = (await response.json()) as { status?: Array<{ code?: number }> };
    done = new Set(queue.filter((_, index) => {
      const code = result.status?.[index]?.code ?? 0;
      return code === 0 || DROP.has(code);
    }).map((item) => item.id));
  } catch {
    return queue.length;
  } finally {
    clearTimeout(timer);
  }
  const left = readOutbox(store).filter((item) => !done.has(item.id));
  writeOutbox(store, left);
  return left.length;
}

function localStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Real sends only from a deployed host; local runs and e2e queue but never reach production, unless a test opts in. */
function mayFlush(): boolean {
  if (typeof location === 'undefined') return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || (globalThis as { __eventsTest?: boolean }).__eventsTest === true;
}

/** The app's one call: queue the event and try to send. Never throws, never waits. */
export function track(event: EventName, dayType: DayType | null = null): void {
  try {
    const store = localStore();
    enqueue(store, usageEvent(event, dayType, testerId(store), appVersion(), new Date()));
    if (mayFlush()) void flushOutbox(store).catch(() => undefined);
  } catch {
    // Never in the lifter's way.
  }
}

/** On open and whenever the phone comes back online, send what waited. */
export function startEventSync(): void {
  try {
    if (!mayFlush()) return;
    const go = () => void flushOutbox(localStore()).catch(() => undefined);
    go();
    window.addEventListener('online', go);
  } catch {
    // Never in the lifter's way.
  }
}
