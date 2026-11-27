import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #462: comeback after a break. Threshold is twice the median of the last up-to-6 gaps between
// this lift's own sessions, never under 14 days (see progression.ts for the full justification).
// Every counterexample that sank the four earlier fixed-window attempts is covered below, plus the
// owner's 2026-11-26 call on the 3/3/3/12-day edge case (a short skip must not read as a comeback).

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Intermediate',
    daysPerWeek: 3,
    equipment: [],
    support: [],
    exclusions: [],
    loads: {},
    ...overrides,
  };
}

function meta(exerciseId: string) {
  const exercise = EXERCISES.find((item) => item.id === exerciseId);
  assert.ok(exercise, `unknown exercise ${exerciseId}`);
  return exercise;
}

function sets(weight: number, reps: number, count = 4) {
  return Array.from({ length: count }, () => ({ weight, reps }));
}

function finished(id: string, date: string, weight: number, reps = 8): WorkoutRecord {
  return {
    id,
    date,
    name: 'Push',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: [{
      exerciseId: 'barbell-bench-press',
      name: meta('barbell-bench-press').name,
      planned: sets(weight, reps, 4),
      performed: sets(weight, reps, 4).map((set) => ({ ...set, done: true, completedAt: null })),
    }],
  };
}

/** `count` sessions spaced `gapDays` apart, most recent first, ending exactly on `lastDate`. */
function steady(lastDate: string, gapDays: number, count: number, weight = 60): WorkoutRecord[] {
  const last = Date.parse(lastDate);
  const history: WorkoutRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = new Date(last - i * gapDays * 86_400_000).toISOString();
    history.push(finished(`s${i}`, at, weight));
  }
  return history;
}

function daysAfter(date: string, days: number): Date {
  return new Date(Date.parse(date) + days * 86_400_000);
}

const prescribe = (history: WorkoutRecord[], now: Date) =>
  prescribeExercise(meta('barbell-bench-press'), makeProfile(), history, false, true, 'home', now);

test('counterexample 1: a steady 12-day rhythm continuing on schedule is not a comeback', () => {
  const history = steady('2026-03-14T10:00:00.000Z', 12, 7);
  const prescription = prescribe(history, daysAfter('2026-03-14T10:00:00.000Z', 12));
  assert.notEqual(prescription.basis, 'comeback');
});

test('counterexample 2: an alternating 12/3-day rhythm continuing on schedule is not a comeback', () => {
  const dates = ['2026-01-01', '2026-01-13', '2026-01-16', '2026-01-28', '2026-01-31', '2026-02-12', '2026-02-15'];
  const history = dates.map((date, i) => finished(`a${i}`, `${date}T10:00:00.000Z`, 60));
  const prescription = prescribe(history, daysAfter('2026-02-15T10:00:00.000Z', 12));
  assert.notEqual(prescription.basis, 'comeback');
});

test('counterexample 3: an old stale heavy session buried past the median window does not poison the read', () => {
  const recent = steady('2026-06-01T10:00:00.000Z', 12, 7);
  const stale = finished('old', '2024-01-01T10:00:00.000Z', 120);
  const prescription = prescribe([...recent, stale], daysAfter('2026-06-01T10:00:00.000Z', 12));
  assert.notEqual(prescription.basis, 'comeback');
});

test('counterexample 4a: a repeating 7/7/7/7/7/10 pattern continuing on schedule is not a comeback', () => {
  const gaps = [10, 7, 7, 7, 7, 7]; // most-recent-first spacing back from the last session
  const last = Date.parse('2026-05-01T10:00:00.000Z');
  let at = last;
  const history = [finished('g0', new Date(last).toISOString(), 60)];
  gaps.forEach((gap, i) => {
    at -= gap * 86_400_000;
    history.push(finished(`g${i + 1}`, new Date(at).toISOString(), 60));
  });
  const prescription = prescribe(history, daysAfter('2026-05-01T10:00:00.000Z', 10));
  assert.notEqual(prescription.basis, 'comeback');
});

test('counterexample 4b: a genuine long layoff is still flagged even with an old unrelated 12-day gap further back', () => {
  const s0 = Date.parse('2025-01-01T10:00:00.000Z');
  const s1 = s0 + 12 * 86_400_000; // the old, unrelated 12-day gap — outside the 6-gap window by the time we're done
  const sevens = Array.from({ length: 7 }, (_, i) => s1 + (i + 1) * 7 * 86_400_000); // s2..s8
  const history = [s0, s1, ...sevens].map((t, i) => finished(`b${i}`, new Date(t).toISOString(), 60));
  const lastDate = new Date(sevens[sevens.length - 1]).toISOString();
  const prescription = prescribe(history, daysAfter(lastDate, 365));
  assert.equal(prescription.basis, 'comeback');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('a plain 2-week-plus layoff off a 4-day rhythm is flagged as a comeback', () => {
  const history = steady('2026-04-01T10:00:00.000Z', 4, 7);
  const prescription = prescribe(history, daysAfter('2026-04-01T10:00:00.000Z', 16));
  assert.equal(prescription.basis, 'comeback');
  assert.equal(prescription.weight, 57.5);
  assert.equal(prescription.reps, prescription.range.min);
});

test('exactly 14 days off a 4-day rhythm does not yet count as a comeback (floor is a hard "more than")', () => {
  const history = steady('2026-04-01T10:00:00.000Z', 4, 7);
  const prescription = prescribe(history, daysAfter('2026-04-01T10:00:00.000Z', 14));
  assert.notEqual(prescription.basis, 'comeback');
});

test('owner call 2026-11-26: a repeating 3/3/3/12-day pattern (a short deliberate skip) is never flagged, even on its 12-day beat', () => {
  const gaps = [12, 3, 3, 12, 3, 3]; // most-recent-first spacing back from the last session
  const last = Date.parse('2026-06-01T10:00:00.000Z');
  let at = last;
  const history = [finished('p0', new Date(last).toISOString(), 60)];
  gaps.forEach((gap, i) => {
    at -= gap * 86_400_000;
    history.push(finished(`p${i + 1}`, new Date(at).toISOString(), 60));
  });
  // The next beat is the 12-day one, right on schedule — not a comeback.
  const prescription = prescribe(history, daysAfter('2026-06-01T10:00:00.000Z', 12));
  assert.notEqual(prescription.basis, 'comeback');
});

test('a steady weekly cadence, right on schedule, is never flagged', () => {
  const history = steady('2026-04-01T10:00:00.000Z', 7, 7);
  const prescription = prescribe(history, daysAfter('2026-04-01T10:00:00.000Z', 7));
  assert.notEqual(prescription.basis, 'comeback');
});

test('review finding: a comeback never prescribes heavier than a miss already corrected to', () => {
  // Two clean 60x8 sessions a week apart set the rhythm, then a mixed-load miss (two sets failed down
  // at 50) already reads the next session as mixed-load 50 — a long layoff after that must not undo
  // the correction by stepping down from the raw 60 instead.
  const clean = (id: string, date: string) =>
    finished(id, date, 60);
  const missed: WorkoutRecord = {
    id: 'm1', date: '2026-01-15T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId: 'barbell-bench-press', name: meta('barbell-bench-press').name,
      planned: sets(60, 8, 4),
      performed: [
        { weight: 60, reps: 8, done: true, completedAt: null },
        { weight: 60, reps: 8, done: true, completedAt: null },
        { weight: 50, reps: 8, done: true, completedAt: null },
        { weight: 50, reps: 8, done: true, completedAt: null },
      ],
    }],
  };
  const history = [missed, clean('c1', '2026-01-08T10:00:00.000Z'), clean('c0', '2026-01-01T10:00:00.000Z')];
  const onSchedule = prescribe(history, daysAfter('2026-01-15T10:00:00.000Z', 7));
  assert.equal(onSchedule.basis, 'mixed-load');
  assert.equal(onSchedule.weight, 50, 'sanity: the miss alone already corrects to 50');
  const afterLayoff = prescribe(history, daysAfter('2026-01-15T10:00:00.000Z', 30));
  assert.equal(afterLayoff.basis, 'comeback');
  assert.ok(afterLayoff.weight <= 50, `comeback must not exceed the already-corrected 50, got ${afterLayoff.weight}`);
});

test('review finding: the 14-day floor holds on whole calendar days, not raw hours (time-of-day / DST safe)', () => {
  // A steady 4-day rhythm ending at 07:00, checked 14 calendar days later but at 19:00 — 12 hours
  // past the raw millisecond mark. A millisecond-based day count would read this as 14.5 days and
  // fire; counting whole UTC calendar days must not.
  const history = steady('2026-04-01T07:00:00.000Z', 4, 7);
  const now = new Date('2026-04-15T19:00:00.000Z');
  const prescription = prescribe(history, now);
  assert.notEqual(prescription.basis, 'comeback');
});
