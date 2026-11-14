import { localDay, type DayType, type EventName, type UsageEvent } from './events.ts';
import { DAY_TYPES, EVENT_NAMES } from './eventSchema.ts';

/**
 * (#359) What the admin pages show, computed in the browser from the documents Firestore returns.
 * Weeks run Monday to Sunday in local time. Pure functions: the page passes `now`.
 */

export const WEEKS_READ = 8;

type Value = { stringValue?: string; integerValue?: string; booleanValue?: boolean; nullValue?: null; timestampValue?: string };
export interface FirestoreDoc {
  name: string;
  fields?: Record<string, Value>;
  createTime?: string;
}

export interface FeedbackItem {
  /** Full document name, for Mark done. */
  name: string;
  message: string;
  from: string | null;
  testerId: string;
  appVersion: string;
  screen: string;
  device: string;
  /** Firestore's own create time; the note has no date field of its own. */
  createdAt: string;
  /** Notes written before #359 have no `done` field: they read as open. */
  done: boolean;
}

const text = (doc: FirestoreDoc, field: string) => doc.fields?.[field]?.stringValue ?? '';

export function feedbackItem(doc: FirestoreDoc): FeedbackItem {
  return {
    name: doc.name,
    message: text(doc, 'message'),
    from: text(doc, 'name') || null,
    testerId: text(doc, 'testerId'),
    appVersion: text(doc, 'appVersion'),
    screen: text(doc, 'screen'),
    device: text(doc, 'device'),
    createdAt: doc.createTime ?? '',
    done: doc.fields?.done?.booleanValue === true,
  };
}

/** Newest first; a note without a create time sorts last. */
export function feedbackInbox(docs: FirestoreDoc[]): FeedbackItem[] {
  return docs.map(feedbackItem).sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An event document read back; anything that is not a well-formed event is left out of every count. */
export function eventOf(doc: FirestoreDoc): UsageEvent | null {
  const event = text(doc, 'event') as EventName;
  const dayType = (doc.fields?.dayType?.stringValue ?? null) as DayType | null;
  const date = text(doc, 'date');
  const testerId = text(doc, 'testerId');
  if (!EVENT_NAMES.includes(event) || !DAY.test(date) || !testerId) return null;
  if (dayType !== null && !DAY_TYPES.includes(dayType)) return null;
  return { testerId, event, dayType, appVersion: text(doc, 'appVersion'), date, createdAt: doc.fields?.createdAt?.timestampValue ?? '' };
}

/** A local calendar day at noon, so adding days never trips over a clock change. */
function noonOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The Monday (YYYY-MM-DD) of the local week holding `day`. */
export function weekOf(day: string): string {
  const at = noonOf(day);
  at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  return localDay(at);
}

export function addDays(day: string, days: number): string {
  const at = noonOf(day);
  at.setDate(at.getDate() + days);
  return localDay(at);
}

/** The weeks shown, oldest first, ending with the week of `now`. */
export function weeksTo(now: Date, count = WEEKS_READ): string[] {
  const last = weekOf(localDay(now));
  return Array.from({ length: count }, (_, index) => addDays(last, (index - count + 1) * 7));
}

/** The first day read: the Monday seven weeks before this one. */
export function readSince(now: Date): string {
  return weeksTo(now)[0];
}

export const TAPS: Array<{ label: string; events: EventName[] }> = [
  { label: 'Switch', events: ['switch'] },
  { label: 'Plan today with me', events: ['plan-today'] },
  { label: 'Replace', events: ['replace'] },
  { label: 'Supersets on', events: ['supersets-on'] },
  { label: 'Supersets off', events: ['supersets-off'] },
  { label: 'Backup', events: ['backup'] },
  { label: 'Feedback', events: ['feedback'] },
];

export const DAY_LABELS: Record<DayType, string> = {
  push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower', 'full-body': 'Full body', picked: 'Picked day',
};

export interface WeekUsage {
  week: string;
  started: number;
  finished: number;
  cutShort: number;
  byDay: Record<DayType, number>;
  taps: number[];
}

export function weekUsage(events: UsageEvent[], week: string): WeekUsage {
  const inWeek = events.filter((event) => weekOf(event.date) === week);
  const count = (name: EventName) => inWeek.filter((event) => event.event === name).length;
  const byDay = Object.fromEntries(DAY_TYPES.map((type) => [type, 0])) as Record<DayType, number>;
  for (const event of inWeek) if (event.event === 'workout-finished' && event.dayType) byDay[event.dayType] += 1;
  return {
    week,
    started: count('workout-started'),
    finished: count('workout-finished'),
    cutShort: count('workout-cut-short'),
    byDay,
    taps: TAPS.map((tap) => tap.events.reduce((sum, name) => sum + count(name), 0)),
  };
}

export interface Testers {
  total: number;
  newThisWeek: number;
  activeThisWeek: number;
  activeFourWeeks: number;
}

/**
 * Tester IDs seen in the events read (last 8 weeks) and in every feedback note. New = first seen this
 * week; active = any event or note in the window. An ID first seen before the read window and back this
 * week can read as new: the page says the counts come from the last 8 weeks.
 */
export function testerCounts(events: UsageEvent[], feedback: FeedbackItem[], now: Date): Testers {
  const seen = new Map<string, string[]>();
  const add = (id: string, day: string) => {
    if (!id || !DAY.test(day)) return;
    seen.set(id, [...(seen.get(id) ?? []), day]);
  };
  for (const event of events) add(event.testerId, event.date);
  for (const note of feedback) if (note.createdAt) add(note.testerId, localDay(new Date(note.createdAt)));
  const thisWeek = weekOf(localDay(now));
  const fourWeeks = addDays(thisWeek, -21);
  let newThisWeek = 0;
  let activeThisWeek = 0;
  let activeFourWeeks = 0;
  for (const days of seen.values()) {
    const first = days.reduce((a, b) => (a < b ? a : b));
    if (first >= thisWeek) newThisWeek += 1;
    if (days.some((day) => day >= thisWeek)) activeThisWeek += 1;
    if (days.some((day) => day >= fourWeeks)) activeFourWeeks += 1;
  }
  return { total: seen.size, newThisWeek, activeThisWeek, activeFourWeeks };
}
