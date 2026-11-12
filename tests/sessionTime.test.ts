import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import {
  REST_SECONDS,
  SHORT_REST_SECONDS,
  exerciseSeconds,
  restLabel,
  restSecondsFor,
  sessionRests,
  sessionSeconds,
  warmUpSeconds,
} from '../src/lib/sessionTime.ts';
import { createSession, logSet } from '../src/lib/session.ts';

// #132 / #155: one time model for the rest timer and every promised minute.

const ex = (id: string) => exerciseById(id)!;

test('rest follows the role in the day: lead 120–180 s, other compounds 90–120 s, isolation 60–90 s', () => {
  assert.equal(restSecondsFor(ex('barbell-bench-press'), true), 150);
  assert.equal(restSecondsFor(ex('barbell-bench-press'), true, 'Get Stronger'), 180);
  assert.equal(restSecondsFor(ex('overhead-press'), false), 120);
  assert.equal(restSecondsFor(ex('lateral-raise'), false), 75);
  assert.equal(restSecondsFor(ex('plank'), false), 60);
  for (const table of [REST_SECONDS, SHORT_REST_SECONDS]) {
    assert.ok(table.lead >= 120 && table.strengthLead <= 180);
    assert.ok(table.compound >= 90 && table.compound <= 120);
    assert.ok(table.isolation >= 60 && table.isolation <= 90);
  }
});

test('at 30 minutes or less every role rests at the short end of its range, with a shorter warm-up (#229)', () => {
  assert.equal(restSecondsFor(ex('barbell-bench-press'), true, 'Build Muscle', 20), 120);
  assert.equal(restSecondsFor(ex('overhead-press'), false, 'Build Muscle', 20), 90);
  assert.equal(restSecondsFor(ex('lateral-raise'), false, 'Build Muscle', 20), 60);
  assert.equal(warmUpSeconds(20), 180);
  assert.equal(warmUpSeconds(30), 180);
  assert.equal(restSecondsFor(ex('barbell-bench-press'), true, 'Build Muscle', 30), 120);
  assert.equal(restSecondsFor(ex('barbell-bench-press'), true, 'Build Muscle', 45), 150);
  assert.equal(warmUpSeconds(45), 300);
  assert.equal(warmUpSeconds(undefined), 300);
});

test('session rests read the lead from the session itself', () => {
  assert.deepEqual(sessionRests(['lateral-raise', 'barbell-bench-press', 'overhead-press', 'plank']), [75, 150, 120, 60]);
});

test('a session counts work, rest between sets, a move per exercise and one warm-up', () => {
  assert.equal(exerciseSeconds(3, 120), 3 * 35 + 2 * 120 + 90);
  assert.equal(exerciseSeconds(0, 120), 0);
  assert.equal(sessionSeconds([{ sets: 3, rest: 120 }, { sets: 2, rest: 75 }]), 300 + 435 + 235);
  assert.equal(sessionSeconds([]), 0, 'no work, no warm-up');
});

test('the rest timer starts with the seconds it is given', () => {
  const session = createSession({ id: 's', name: 'A', dayIndex: 0, now: '2026-11-07T10:00:00.000Z',
    exercises: [{ exerciseId: 'barbell-bench-press', name: 'Bench', planned: [{ weight: 60, reps: 5 }], performed: [{ weight: 60, reps: 5, done: false }] }] });
  assert.equal(logSet(session, 0, 0, '2026-11-07T10:01:00.000Z', 150).restSeconds, 150);
});

test('the app logs sets with the role rest and the logger shows it', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // (#88) The role rests go through the superset step: 30 s to a partner, the pair's rest after a round.
  assert.match(app, /const rest = restAfterLog\(session, exerciseIndex,\s+sessionRests\(/);
  // (#327) A held jump passes an options argument after the rest seconds.
  assert.match(app, /logSet\(filled, exerciseIndex, setIndex, stamp, rest[,)]/);
  const train = readFileSync(new URL('../src/screens/TrainScreen.tsx', import.meta.url), 'utf8');
  assert.match(train, /const restAfter = .*restAfterLog\(session, index, rests, pairs\)/);
  assert.match(train, /Rest \{restLabel\(restAfter\)\}/);
  assert.equal(restLabel(150), '2:30');
  assert.equal(restLabel(180), '3:00');
  assert.equal(restLabel(90), '90 s');
});

test('the countdown never reads above the rest it started with, even on a stale clock tick', async () => {
  const { restRemaining } = await import('../src/lib/session.ts');
  const session = createSession({ id: 's', name: 'A', dayIndex: 0, now: '2026-11-07T10:00:00.000Z',
    exercises: [{ exerciseId: 'barbell-bench-press', name: 'Bench', planned: [{ weight: 60, reps: 5 }], performed: [{ weight: 60, reps: 5, done: false }] }] });
  const logged = logSet(session, 0, 0, '2026-11-07T10:01:00.000Z', 150);
  assert.equal(restRemaining(logged, Date.parse('2026-11-07T10:00:56.000Z')), 150, 'tick 4 s before the log');
  assert.equal(restRemaining(logged, Date.parse('2026-11-07T10:01:30.000Z')), 120);
});
