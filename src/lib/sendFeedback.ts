import { FIREBASE } from './firebase.ts';
import { STORAGE_KEY } from './storage.ts';

/**
 * (#255) "Send feedback": one note to the Home Strength team, posted with plain `fetch` to
 * Firestore's REST API in its typed-field JSON. No SDK. The live rules accept exactly these
 * field names and sizes, so the builder trims and caps every value before it leaves the phone.
 */
export const FEEDBACK_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/feedback?key=${FIREBASE.apiKey}`;

export const FEEDBACK_NOTE = "Goes to the Home Strength team. Don't include anything private.";
export const NOT_SENT = "Not sent. You're offline. Your note is kept; tap Send again.";
export const SENT = 'Sent. Thanks.';

export const MESSAGE_MAX = 2000;
export const NAME_MAX = 80;
const TESTER_ID_MAX = 64;
const VERSION_MAX = 40;

/** The one local key #255 added: a random ID per phone, sent inside a note and (#359) inside each usage event. */
export const TESTER_ID_KEY = `${STORAGE_KEY}:tester-id`;

export type FeedbackScreen = 'settings' | 'recap';
export type FeedbackDevice = 'iphone' | 'android' | 'other';

/** The note being written. App keeps it for this visit, so closing the sheet never loses it. */
export interface FeedbackDraft {
  message: string;
  name: string;
}

export const EMPTY_DRAFT: FeedbackDraft = { message: '', name: '' };

export type FeedbackStatus = 'idle' | 'sending' | 'sent' | 'failed';

export interface FeedbackNote {
  message: string;
  name: string;
  appVersion: string;
  screen: FeedbackScreen;
  device: FeedbackDevice;
  workoutCount: number;
  testerId: string;
}

type StringField = { stringValue: string };
export interface FeedbackBody {
  fields: {
    message: StringField;
    name?: StringField;
    appVersion: StringField;
    screen: StringField;
    device: StringField;
    workoutCount: { integerValue: string };
    testerId: StringField;
  };
}

/** Trim, then keep at most `max` characters, counted by code point so an emoji is never split. */
function capped(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
}

const DEVICES: FeedbackDevice[] = ['iphone', 'android', 'other'];

/** The request body, or `null` when there is no message to send. */
export function feedbackBody(note: FeedbackNote): FeedbackBody | null {
  const message = capped(note.message, MESSAGE_MAX);
  if (!message) return null;
  const name = capped(note.name, NAME_MAX);
  const count = Number.isFinite(note.workoutCount) ? Math.max(0, Math.floor(note.workoutCount)) : 0;
  return {
    fields: {
      message: { stringValue: message },
      ...(name ? { name: { stringValue: name } } : {}),
      appVersion: { stringValue: capped(note.appVersion, VERSION_MAX) || 'dev' },
      screen: { stringValue: note.screen },
      device: { stringValue: DEVICES.includes(note.device) ? note.device : 'other' },
      workoutCount: { integerValue: String(count) },
      testerId: { stringValue: capped(note.testerId, TESTER_ID_MAX) },
    },
  };
}

/** iPhone (and iPadOS, which reports a Mac user agent with a touch screen), Android, or other. */
export function deviceKind({ userAgent, touchPoints }: { userAgent: string; touchPoints: number }): FeedbackDevice {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'iphone';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type IdStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * This phone's tester ID: read from its key, or made once and stored there. A malformed value is
 * replaced. When storage is blocked the note still goes, with an ID made for this send only.
 */
export function testerId(store: IdStore | null): string {
  try {
    const stored = store?.getItem(TESTER_ID_KEY);
    if (stored && ID_SHAPE.test(stored)) return stored;
  } catch {
    // Unreadable: make one below.
  }
  const id = randomId();
  try {
    store?.setItem(TESTER_ID_KEY, id);
  } catch {
    // Not stored: this note still carries an ID.
  }
  return id;
}

declare const __APP_VERSION__: string | undefined;

/** The deployed commit (short SHA), stamped at build; `dev` for local and test runs. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
}

export type SendResult = { ok: true } | { ok: false };

interface SendOptions {
  fetchFn?: typeof fetch;
  online?: boolean;
  timeoutMs?: number;
}

/**
 * Post one note. Offline never tries; a refusal, a network error or a request that hangs past
 * `timeoutMs` all report not sent, so the caller keeps the text for another tap.
 */
export async function sendFeedback(note: FeedbackNote, options: SendOptions = {}): Promise<SendResult> {
  const body = feedbackBody(note);
  if (!body) return { ok: false };
  const online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  if (!online) return { ok: false };
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const response = await fetchFn(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
