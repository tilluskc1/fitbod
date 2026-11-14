import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addDays,
  eventOf,
  feedbackInbox,
  readSince,
  testerCounts,
  weekOf,
  weekUsage,
  weeksTo,
  type FirestoreDoc,
} from '../src/lib/adminData.ts';
import { usageEvent, type DayType, type EventName } from '../src/lib/events.ts';
import { DAY_TYPES, EVENT_NAMES } from '../src/lib/eventSchema.ts';

// #359 admin pages: counts computed in the browser from the documents read. Weeks run Monday to Sunday,
// local time. Run under several TZ values (see the e2e) and the answers must not move.

const ev = (event: EventName, when: Date, dayType: DayType | null = null, tester = 'tester-aaaa') =>
  usageEvent(event, dayType, tester, 'v1', when);

test('#359 a week runs Monday to Sunday: Sunday 23:59 and Monday 00:01 land in different weeks', () => {
  assert.equal(weekOf('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(weekOf('2026-11-16'), '2026-11-16'); // Monday
  assert.equal(weekOf('2026-11-09'), '2026-11-09');
  assert.equal(weekOf('2026-01-01'), '2025-12-29'); // across a year
  assert.equal(weekOf('2026-03-29'), '2026-03-23'); // a clock-change Sunday in Europe
  const late = ev('workout-finished', new Date(2026, 10, 15, 23, 59), 'legs');
  const early = ev('workout-finished', new Date(2026, 10, 16, 0, 1), 'legs');
  assert.equal(weekUsage([late, early], '2026-11-09').finished, 1);
  assert.equal(weekUsage([late, early], '2026-11-16').finished, 1);
});

test('#359 eight weeks are read, ending with this week; the read starts on a Monday', () => {
  const now = new Date(2026, 10, 14, 10); // Saturday
  const weeks = weeksTo(now);
  assert.equal(weeks.length, 8);
  assert.equal(weeks.at(-1), '2026-11-09');
  assert.equal(weeks[0], '2026-09-21');
  assert.equal(readSince(now), '2026-09-21');
  for (const week of weeks) assert.equal(weekOf(week), week);
  assert.equal(addDays('2026-10-25', 1), '2026-10-26'); // across a clock change
});

test('#359 started, finished and cut short count apart; finished by day type counts finished only', () => {
  const day = new Date(2026, 10, 12, 18);
  const events = [
    ev('workout-started', day, 'push'), ev('workout-finished', day, 'push'),
    ev('workout-started', day, 'picked'), ev('workout-finished', day, 'picked'),
    ev('workout-started', day, 'legs'), ev('workout-cut-short', day, 'legs'),
    ev('workout-started', day, 'full-body'),
    ev('switch', day), ev('switch', day), ev('plan-today', day), ev('replace', day),
    ev('supersets-on', day), ev('supersets-off', day), ev('backup', day), ev('feedback', day),
  ];
  const usage = weekUsage(events, '2026-11-09');
  assert.equal(usage.started, 4);
  assert.equal(usage.finished, 2);
  assert.equal(usage.cutShort, 1);
  assert.deepEqual(usage.byDay, { push: 1, pull: 0, legs: 0, upper: 0, lower: 0, 'full-body': 0, picked: 1 });
  assert.deepEqual(usage.taps, [2, 1, 1, 1, 1, 1, 1]);
});

test('#359 empty data: every count is zero, nothing throws', () => {
  const usage = weekUsage([], '2026-11-09');
  assert.equal(usage.started + usage.finished + usage.cutShort, 0);
  assert.ok(usage.taps.every((count) => count === 0));
  assert.deepEqual(testerCounts([], [], new Date(2026, 10, 14)), { total: 0, newThisWeek: 0, activeThisWeek: 0, activeFourWeeks: 0 });
  assert.deepEqual(feedbackInbox([]), []);
});

const note = (id: string, createTime: string, extra: Record<string, unknown> = {}): FirestoreDoc => ({
  name: `projects/home-strength/databases/(default)/documents/feedback/${id}`,
  createTime,
  fields: {
    message: { stringValue: `note ${id}` },
    appVersion: { stringValue: 'abc1234' },
    screen: { stringValue: 'recap' },
    device: { stringValue: 'iphone' },
    workoutCount: { integerValue: '3' },
    testerId: { stringValue: `tester-${id}` },
    ...extra,
  } as FirestoreDoc['fields'],
});

test('#359 feedback: newest first; notes from before #359 (no done field) read as open', () => {
  const inbox = feedbackInbox([
    note('old', '2026-11-01T10:00:00Z'),
    note('new', '2026-11-13T10:00:00Z', { done: { booleanValue: true } }),
    note('mid', '2026-11-05T10:00:00Z', { name: { stringValue: 'Sam' } }),
  ]);
  assert.deepEqual(inbox.map((item) => item.testerId), ['tester-new', 'tester-mid', 'tester-old']);
  assert.equal(inbox[0].done, true);
  assert.equal(inbox[2].done, false);
  assert.equal(inbox[1].from, 'Sam');
  assert.equal(inbox[2].from, null);
});

test('#359 testers: total, new this week, active this week and in the last 4 weeks', () => {
  const now = new Date(2026, 10, 14, 10); // week of Mon 9 Nov
  const events = [
    ev('workout-started', new Date(2026, 10, 10), 'push', 'tester-new'), // first seen this week
    ev('workout-started', new Date(2026, 9, 20), 'push', 'tester-back'), // seen 4 weeks ago...
    ev('switch', new Date(2026, 10, 11), null, 'tester-back'), // ...and this week
    ev('backup', new Date(2026, 9, 26), null, 'tester-recent'), // 3rd week back: active in 4 weeks
    ev('backup', new Date(2026, 9, 1), null, 'tester-gone'), // 6 weeks back
  ];
  const notes = feedbackInbox([note('x', '2026-11-12T10:00:00Z')]).map((item) => ({ ...item, testerId: 'tester-note' }));
  assert.deepEqual(testerCounts(events, notes, now), { total: 5, newThisWeek: 2, activeThisWeek: 3, activeFourWeeks: 4 });
});

test('#359 a malformed event document is left out of every count', () => {
  const bad: FirestoreDoc[] = [
    { name: 'a', fields: { event: { stringValue: 'unknown' }, date: { stringValue: '2026-11-10' }, testerId: { stringValue: 't' } } },
    { name: 'b', fields: { event: { stringValue: 'switch' }, date: { stringValue: 'Nov 10' }, testerId: { stringValue: 't' } } },
    { name: 'c', fields: { event: { stringValue: 'switch' }, date: { stringValue: '2026-11-10' }, testerId: { stringValue: 't' }, dayType: { stringValue: 'arms' } } },
    { name: 'd' },
  ];
  assert.deepEqual(bad.map(eventOf), [null, null, null, null]);
  const good = eventOf({ name: 'e', fields: { event: { stringValue: 'workout-finished' }, date: { stringValue: '2026-11-10' }, testerId: { stringValue: 't' }, dayType: { stringValue: 'pull' }, appVersion: { stringValue: 'v' }, createdAt: { timestampValue: '2026-11-10T08:00:00Z' } } });
  assert.equal(good?.dayType, 'pull');
});

test('#359 rules: placeholder only, create-only events with the same allowlist, admin reads, done-only update', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /request\.auth\.token\.email == 'ADMIN_EMAIL'/);
  assert.match(rules, /email_verified == true/);
  assert.doesNotMatch(rules, /@[a-z0-9-]+\.[a-z]/i, 'no real address committed');
  assert.match(rules, /match \/events\/\{eventId\} \{[^}]*allow create:[\s\S]*?allow read: if isAdmin\(\);\s*\}/);
  assert.doesNotMatch(rules, /allow (delete|write)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['done'\]\)/);
  assert.match(rules, /hasOnly\(\['testerId', 'event', 'dayType', 'appVersion', 'date', 'createdAt'\]\)/);
  const list = (values: readonly string[]) => `[${values.map((value) => `'${value}'`).join(', ')}]`;
  assert.ok(rules.includes(`request.resource.data.event in ${list(EVENT_NAMES)}`), 'rules list every event name, and only those');
  assert.ok(rules.includes(`request.resource.data.dayType in ${list(DAY_TYPES)}`), 'rules list every day type, and only those');
});
