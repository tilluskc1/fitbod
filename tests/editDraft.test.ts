import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDraft, openDraft, saveDraft } from '../src/lib/editDraft.ts';
import type { PerformedSet } from '../src/types.ts';

const SAVED: PerformedSet = {
  reps: 9,
  weight: 15,
  done: true,
  completedAt: '2026-01-01T10:00:00.000Z',
};

test('opening an edit copies the saved values', () => {
  assert.deepEqual(openDraft(2, 1, SAVED), {
    exerciseIndex: 2,
    setIndex: 1,
    reps: 9,
    weight: 15,
  });
});

test('changing a draft leaves the saved record untouched, which is what Cancel relies on', () => {
  const before = { ...SAVED };
  const draft = applyDraft(openDraft(0, 0, SAVED), { reps: 10, weight: 18 });
  assert.equal(draft.reps, 10);
  assert.equal(draft.weight, 18);
  assert.deepEqual(SAVED, before);
});

test('saving applies the draft and keeps the original completion time', () => {
  const draft = applyDraft(openDraft(0, 0, SAVED), { reps: 10, weight: 18 });
  assert.deepEqual(saveDraft(draft, SAVED), {
    reps: 10,
    weight: 18,
    done: true,
    completedAt: SAVED.completedAt,
  });
});
