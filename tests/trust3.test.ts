import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_BODY_A, loadLabel, targetSummary } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, swapCandidateFor, toWorkoutExercises } from '../src/lib/adapt.ts';
import { createProposal, decideProposalApproval, isProposalStale } from '../src/lib/proposal.ts';
import { createSession, swapPendingExercise } from '../src/lib/session.ts';
import type { Profile } from '../src/types.ts';

function testProfile(): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Beginner',
    daysPerWeek: 3,
    equipment: ['Dumbbell'],
    support: [],
    exclusions: [],
    loads: {},
  };
}

// Units: Today/Review must honor the display unit; canonical kg is untouched.
test('target labels honor lb display with each/total intact', () => {
  const each = { weight: 15, load: 'each' as const };
  const total = { weight: 18, load: 'total' as const };
  assert.equal(loadLabel(each, 'lb'), '33 lb each');
  assert.equal(loadLabel(total, 'lb'), '39.5 lb total');
  assert.equal(
    targetSummary({ targetReps: [9, 9], weight: 15, load: 'each' }, 2, 'lb'),
    '9 · 9 @ 33 lb each',
  );
  // Stored actuals stay canonical kg; only the readout converts.
  assert.equal(loadLabel(each, 'kg'), '15 kg each');
});

// Stale proposal: logging or changing equipment after preview must invalidate approval.
test('proposal goes stale after a logged set', () => {
  const proposal = createProposal(
    { minutes: 20, equipment: 'home' },
    { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Dumbbell' },
  );
  const afterLog = { sessionId: null, done: 1, historyLength: 0, equipmentKey: 'Dumbbell' };
  assert.equal(isProposalStale(proposal, afterLog), true);
});

test('proposal goes stale after an equipment change', () => {
  const proposal = createProposal(
    { minutes: 20, equipment: 'home' },
    { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Dumbbell' },
  );
  const afterSettings = { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Bodyweight' };
  assert.equal(isProposalStale(proposal, afterSettings), true);
});

// Approval wiring, not just the predicate: the handler refuses stale previews
// and ignores a repeat tap of the preview it already applied.
test('approve handler refuses a stale proposal and ignores a repeat tap', () => {
  const base = { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Dumbbell' };
  const proposal = createProposal({ minutes: 20, equipment: 'home' }, base);
  assert.equal(decideProposalApproval(proposal, base, null), 'accept');
  assert.equal(
    decideProposalApproval(proposal, { ...base, done: 1 }, null),
    'stale',
  );
  assert.equal(
    decideProposalApproval(proposal, { ...base, equipmentKey: 'Bodyweight' }, null),
    'stale',
  );
  assert.equal(decideProposalApproval(proposal, base, proposal.id), 'already-applied');
});

// Box 1: after a 3-to-2 adaptation and swap-back, the segment keeps the
// program's own load and rep target — never a first-time 0 kg x 8.
test('swap-back after a 3-to-2 adaptation keeps the program load and target', () => {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' }, []);
  assert.equal(adapted.exercises[0].sets, 2);
  const press = exerciseById('dumbbell-floor-press');
  const pushup = exerciseById('push-up');
  assert.ok(press && pushup);
  // No history and nothing logged: the old path prescribed 0 kg x 8 here.
  const candidate = swapCandidateFor(press, testProfile(), [], null);
  assert.deepEqual(
    { weight: candidate.weight, reps: candidate.reps },
    { weight: 15, reps: 9 },
  );
  const session = createSession({
    id: 'box1',
    name: adapted.name,
    dayIndex: 0,
    exercises: toWorkoutExercises(adapted),
    now: '2026-10-30T10:00:00.000Z',
  });
  const away = swapPendingExercise(
    session,
    0,
    swapCandidateFor(pushup, testProfile(), [], session),
  );
  const awayIndex = away.exercises.findIndex((exercise) => exercise.exerciseId === 'push-up');
  assert.ok(awayIndex >= 0);
  const back = swapPendingExercise(
    away,
    awayIndex,
    swapCandidateFor(press, testProfile(), [], away),
  );
  const restored = back.exercises.find((exercise) => exercise.exerciseId === 'dumbbell-floor-press');
  assert.equal(restored?.planned.length, 2);
  assert.deepEqual(
    restored?.planned.map((set) => set.weight),
    [15, 15],
  );
  assert.deepEqual(
    restored?.planned.map((set) => set.reps),
    [9, 9],
  );
});

// Box 1, second half: current surfaces read the two adapted targets while a
// completed three-set session keeps all three sets as history.
test('adapted surfaces read two current targets beside a three-set history', () => {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' }, []);
  assert.equal(targetSummary(adapted.exercises[0], adapted.exercises[0].sets), '9 · 9 @ 15 kg each');
  const history = createSession({
    id: 'hist',
    name: adapted.name,
    dayIndex: 0,
    exercises: toWorkoutExercises(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [])),
    now: '2026-10-29T10:00:00.000Z',
  });
  const done = history.exercises[0].performed.map((set) => ({ ...set, done: true }));
  assert.equal(done.length, 3);
});

test('untouched proposal stays fresh', () => {
  const proposal = createProposal(
    { minutes: 20, equipment: 'home' },
    { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Dumbbell' },
  );
  assert.equal(
    isProposalStale(proposal, { sessionId: null, done: 0, historyLength: 0, equipmentKey: 'Dumbbell' }),
    false,
  );
});
