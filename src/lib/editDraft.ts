import type { PerformedSet } from '../types.ts';

/**
 * An edit in progress. The record is untouched until Save set, so Cancel can
 * always discard for free.
 */
export interface EditDraft {
  exerciseIndex: number;
  setIndex: number;
  reps: number;
  weight: number;
}

/** Opening an edit copies the saved values into the draft. */
export function openDraft(exerciseIndex: number, setIndex: number, set: PerformedSet): EditDraft {
  return { exerciseIndex, setIndex, reps: set.reps, weight: set.weight };
}

export function applyDraft(
  draft: EditDraft,
  patch: Partial<Pick<EditDraft, 'reps' | 'weight'>>,
): EditDraft {
  return { ...draft, ...patch };
}

/**
 * The only write an edit produces. Keeping the original `completedAt` means a
 * correction never rewrites when the set was actually done.
 */
export function saveDraft(draft: EditDraft, set: PerformedSet): Partial<PerformedSet> {
  return { reps: draft.reps, weight: draft.weight, done: true, completedAt: set.completedAt };
}
