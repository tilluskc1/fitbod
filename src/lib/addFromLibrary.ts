import { libraryFamily, type LibraryExercise, type LibraryFamily } from '../data/library.ts';
import type { PlannedSet, WorkoutExercise, WorkoutRecord } from '../types.ts';

/**
 * (#432) Add from library: a library row joins the open workout, and only that workout. The plan, the
 * history and every other session stay as they are; the entry has the same stored shape as any other
 * (id, name, planned and performed sets), so save, restore and export treat it like a built-in.
 *
 * Defaults picked by product (the owner can override): three sets; 15 reps for a reps-only row, 30 seconds
 * held for a Stretching row, 10 reps otherwise, with no weight; appended after the workout's last exercise,
 * so no index another exercise is known by moves.
 */

export const ADDED_SETS = 3;

/** The first prescription an added row gets: its family's reps (or seconds), never a weight. */
export function addedPrescription(family: LibraryFamily | undefined): PlannedSet {
  if (family === 'timed') return { weight: 0, reps: 30 };
  if (family === 'none') return { weight: 0, reps: 15 };
  return { weight: 0, reps: 10 };
}

/** The open workout with `row` after its last exercise; the session itself when it is finished. */
export function addLibraryExercise(session: WorkoutRecord, row: Pick<LibraryExercise, 'id' | 'name'>): WorkoutRecord {
  if (session.status !== 'active') return session;
  const set = addedPrescription(libraryFamily(row.id));
  const entry: WorkoutExercise = {
    exerciseId: row.id,
    name: row.name,
    planned: Array.from({ length: ADDED_SETS }, () => ({ ...set })),
    performed: Array.from({ length: ADDED_SETS }, () => ({ ...set, done: false, completedAt: null })),
  };
  return { ...session, exercises: [...session.exercises, entry] };
}

/** The logger's line under a reps-only row: there is nothing to weigh. Bands are the approved wording. */
export function noWeightLine(equipment: string): string {
  return equipment === 'Bands' ? 'Bands have no weight to log.' : 'No weight to log for this one.';
}
