import assert from 'node:assert/strict';
import test from 'node:test';
import { restEnded, shouldCue } from '../src/lib/restCue.ts';

const tick = (prev: number, remaining: number, extra = {}) =>
  ({ prev, remaining, active: true, paused: false, muted: false, ...extra });

test('fires exactly once, when the countdown reaches zero', () => {
  const seq = [3, 2, 1, 0, 0, 0];
  const fired = seq.slice(1).filter((remaining, i) => shouldCue(tick(seq[i], remaining)));
  assert.equal(fired.length, 1);
});

test('does not fire while time remains or when idle', () => {
  assert.equal(shouldCue(tick(5, 4)), false);
  assert.equal(shouldCue(tick(0, 0)), false);
});

test('never fires while paused', () => {
  assert.equal(shouldCue(tick(1, 0, { paused: true })), false);
});

test('never fires when the rest was skipped or the session finished (inactive)', () => {
  assert.equal(shouldCue(tick(1, 0, { active: false })), false);
});

test('muted silences the cue but the rest still ends', () => {
  assert.equal(shouldCue(tick(1, 0, { muted: true })), false);
  assert.equal(restEnded(tick(1, 0, { muted: true })), true);
});

test('+30 s before zero postpones the cue to the new zero', () => {
  // 2 -> 1, extend by 30 -> 31, then counts down to zero.
  assert.equal(shouldCue(tick(2, 1)), false);
  assert.equal(shouldCue(tick(1, 31)), false);
  assert.equal(shouldCue(tick(1, 0)), true);
});

import { createSession, logSet, restRemaining, skipExercise } from '../src/lib/session.ts';
import { isRestMuted, setRestMuted } from '../src/lib/restCue.ts';

test('skipping the exercise through the real skip path ends the rest, so no cue', () => {
  const set = (done: boolean) => ({ weight: 0, reps: 8, done, completedAt: null });
  const base = createSession({
    id: 's1', name: 'Push', dayIndex: 0, now: '2026-01-01T10:00:00.000Z',
    exercises: [{ exerciseId: 'push-up', name: 'Push-Up', planned: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }], performed: [set(false), set(false)] }],
  });
  const rested = logSet(base, 0, 0, '2026-01-01T10:01:00.000Z');
  const before = restRemaining(rested, Date.parse('2026-01-01T10:01:30.000Z'));
  const skipped = skipExercise(rested, 0);
  const after = restRemaining(skipped, Date.parse('2026-01-01T10:01:30.000Z'));
  assert.ok(before > 0);
  assert.equal(skipped.restStartedAt, null);
  assert.equal(shouldCue({ prev: before, remaining: after, active: Boolean(skipped.restStartedAt), paused: false, muted: false }), false);
});

test('mute belongs to the open workout and resets for a new session id', () => {
  setRestMuted('a', true);
  assert.equal(isRestMuted('a'), true);
  assert.equal(isRestMuted('b'), false);
});
