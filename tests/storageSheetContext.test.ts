import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adaptWorkout, toWorkoutExercises, swapCandidateFor, restorePendingWorkout } from '../src/lib/adapt.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { createSession, logSet, swapPendingExercise, updatePerformedSet, sessionProgress } from '../src/lib/session.ts';
import { createProposal, decideProposalApproval } from '../src/lib/proposal.ts';
import { EMPTY_STATE, STORAGE_KEY, saveState, loadState } from '../src/lib/storage.ts';

// Exercise the actual storage event boundary with the real persisted revision/Undo flow.
// App currently owns this event callback; extracting its body keeps this regression on its real path.
test('adopting another tab closes prescription sheets even when duplicate IDs survive at the same index', () => {
  const profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
    equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, unit: 'kg' };
  const short = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' });
  let current = createSession({ id: 'active', name: short.name, dayIndex: 0, durationMin: 20,
    exercises: toWorkoutExercises(short), now: '2026-10-31T10:00:00.000Z' });
  current = logSet(updatePerformedSet(current, 0, 0, { weight: 20, reps: 10 }), 0, 0);
  current = swapPendingExercise(current, 0, swapCandidateFor(exerciseById('push-up')!, profile, [], current));
  current = swapPendingExercise(current, 1, swapCandidateFor(exerciseById('dumbbell-floor-press')!, profile, [], current));
  const state = { ...EMPTY_STATE, profile, current };
  const undo = { ...state, current: restorePendingWorkout(current,
    adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' })) };
  assert.equal(state.current.exercises[1].exerciseId, 'dumbbell-floor-press');
  assert.equal(undo.current.exercises[1].exerciseId, 'goblet-squat');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; },
  } });
  try {
    assert.equal(saveState(state, 0).ok, true);
    assert.equal(saveState(undo, 1).ok, true);
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const body = source.match(/const onStorage = \(event: StorageEvent\) => \{([\s\S]*?)\n    \};/)![1];
    const noop = () => {};
    for (const kind of ['actions', 'why', 'day', 'swap', 'settings', 'adjust', 'none']) {
      for (const exerciseIndex of [0, 1]) {
        let sheet = { kind, exerciseId: 'dumbbell-floor-press', exerciseIndex };
        let adopted = state;
        const revisionRef = { current: 1 }, adoptingRef = { current: false };
        const onStorage = new Function('STORAGE_KEY', 'recovery', 'loadState', 'revisionRef', 'saveUi',
          'setConflict', 'adoptingRef', 'setState', 'setSaveUi', 'setSheet', 'proposalRevisionRef', 'return (event)=>{' + body + '}')(
          STORAGE_KEY, null, loadState, revisionRef, { kind: 'saved' }, noop, adoptingRef,
          (next: typeof state) => { adopted = next; }, noop,
          (update: (open: typeof sheet) => typeof sheet) => { sheet = update(sheet); }, { current: 0 });
        onStorage({ key: 'unrelated' });
        assert.equal(sheet.kind, kind, 'unrelated storage changes preserve open UI');
        onStorage({ key: STORAGE_KEY });
        assert.equal(revisionRef.current, 2);
        assert.equal(adoptingRef.current, true);
        assert.equal(adopted.current?.durationMin, 35);
        assert.equal(adopted.current?.exercises[1].exerciseId, 'goblet-squat');
        assert.equal(adopted.current?.exercises[0].performed[0].weight, 20);
        assert.equal(adopted.current?.exercises[0].performed[0].reps, 10);
        assert.equal(sheet.kind, ['actions', 'why', 'day', 'swap'].includes(kind) ? 'none' : kind,
          `${kind} at index${exerciseIndex} must not retain a stale prescription context`);
      }
    }
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});


test('accepted cross-tab pending-work adoption invalidates old previews but ignored updates preserve them', () => {
  const profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
    equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, unit: 'kg' };
  const short = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' });
  const current = logSet(updatePerformedSet(createSession({ id: 'preview-session', name: short.name,
    dayIndex: 0, durationMin: 20, exercises: toWorkoutExercises(short), now: '2026-10-31T10:00:00.000Z' }),
    0, 0, { weight: 20, reps: 10 }), 0, 0);
  const before = { ...EMPTY_STATE, profile, current };
  const after = { ...before, current: restorePendingWorkout(current,
    adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' })) };
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; },
  } });
  try {
    assert.equal(saveState(before, 0).ok, true);
    assert.equal(saveState(after, 1).ok, true);
    const savedRaw = raw;
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const body = source.match(/const onStorage = \(event: StorageEvent\) => \{([\s\S]*?)\n    \};/)![1];
    const contextBody = source.match(/const proposalBase = \(\): ProposalContext => \(\{([\s\S]*?)\n  \}\);/)![1];
    for (const scenario of ['accepted', 'wrong-key', 'old-revision', 'corrupt', 'conflict']) {
      raw = scenario === 'corrupt' ? '{invalid' : savedRaw;
      let state = before;
      let sheet = { kind: 'adjust' };
      const proposalRevisionRef = { current: 0 };
      const revisionRef = { current: scenario === 'old-revision' ? 2 : 1 };
      const adoptingRef = { current: false };
      const context = () => new Function('current', 'proposalRevisionRef', 'state', 'profile', 'sessionProgress',
        'return ({' + contextBody + '})')(state.current, proposalRevisionRef, state, state.profile, sessionProgress);
      const oldPreview = createProposal({ minutes: 20, equipment: 'home' }, context(), 'before-adoption');
      const noop = () => {};
      const onStorage = new Function('STORAGE_KEY', 'recovery', 'loadState', 'revisionRef', 'saveUi', 'setConflict',
        'adoptingRef', 'setState', 'setSaveUi', 'setSheet', 'proposalRevisionRef', 'return(event)=>{' + body + '}')(
        STORAGE_KEY, null, loadState, revisionRef, { kind: scenario === 'conflict' ? 'error' : 'saved' }, noop,
        adoptingRef, (next: typeof before) => { state = next; }, noop,
        (update: (open: typeof sheet) => typeof sheet) => { sheet = update(sheet); }, proposalRevisionRef);
      onStorage({ key: scenario === 'wrong-key' ? 'unrelated' : STORAGE_KEY });
      const accepted = scenario === 'accepted';
      assert.equal(sessionProgress(state.current).total, accepted ? 11 : 7, scenario); // 20 min: 7 sets by the timer (#203)
      assert.equal(decideProposalApproval(oldPreview, context(), null), accepted ? 'stale' : 'accept', scenario);
      assert.equal(proposalRevisionRef.current, accepted ? 1 : 0, scenario);
      assert.equal(adoptingRef.current, accepted, scenario);
      assert.equal(sheet.kind, 'adjust', 'retain the draft UI while requiring a fresh preview');
      assert.equal(state.current.exercises[0].performed[0].weight, 20);
      assert.equal(state.current.exercises[0].performed[0].reps, 10);
      const fresh = createProposal({ minutes: 20, equipment: 'home' }, context(), 'fresh-after-update');
      assert.equal(decideProposalApproval(fresh, context(), null), 'accept', scenario);
    }
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
