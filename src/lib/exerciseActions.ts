import type { Profile, WorkoutRecord } from '../types';

/**
 * What the exercise action sheet can offer, and why a control cannot run.
 *
 * The menu is derived from the exercise's own state rather than from which
 * screen opened it, so a completed movement cannot offer a replacement or a
 * removal, and no capability silently disappears.
 */
export type ExerciseActionId =
  | 'instructions'
  | 'history'
  | 'replace'
  | 'prefer'
  | 'dont-recommend'
  | 'remove-today';

export interface ExerciseAction {
  id: ExerciseActionId;
  label: string;
  /** Present when the control cannot act right now; the sheet shows it. */
  blockedReason?: string;
}

const NOTHING_PENDING_DONE = 'Every set here is logged, so there is no remaining work to change.';
const NOTHING_PENDING_EMPTY = 'This exercise has no sets to change.';
/** Confirmed preferences (#8) have no store yet, so this cannot be promised. */
const NO_PREFERENCE_STORE =
  'Confirmed preferences are not stored yet, so this cannot be remembered or undone.';

export function exerciseActions(pending: number, done: number): ExerciseAction[] {
  const blocked = pending > 0 ? undefined : done > 0 ? NOTHING_PENDING_DONE : NOTHING_PENDING_EMPTY;
  return [
    { id: 'instructions', label: 'Instructions and demo' },
    { id: 'history', label: 'History for this exercise' },
    { id: 'replace', label: 'Replace for the remaining sets', blockedReason: blocked },
    {
      id: 'prefer',
      label: 'Prefer this exercise more often',
      blockedReason: NO_PREFERENCE_STORE,
    },
    {
      id: 'dont-recommend',
      label: 'Remove from recommendations',
      blockedReason: undefined,
    },
    { id: 'remove-today', label: "Remove today's remaining work", blockedReason: blocked },
  ];
}

export interface ExerciseHistoryEntry {
  workoutId: string;
  /** When the session that produced these sets ended, or started. */
  date: string;
  completedEarly: boolean;
  sets: { reps: number; weight: number }[];
}

/**
 * History for one exact variant, newest first: another variant of the same
 * pattern never appears here, and a session with nothing logged for it is not
 * history at all.
 */
export function exerciseHistory(
  history: WorkoutRecord[],
  exerciseId: string,
): ExerciseHistoryEntry[] {
  const entries: ExerciseHistoryEntry[] = [];
  for (const workout of history) {
    for (const entry of workout.exercises) {
      if (entry.exerciseId !== exerciseId) continue;
      const done = entry.performed.filter((set) => set.done);
      if (done.length === 0) continue;
      entries.push({
        workoutId: workout.id,
        date: workout.endedAt ?? workout.date,
        completedEarly: Boolean(workout.completedEarly),
        sets: done.map((set) => ({ reps: set.reps, weight: set.weight })),
      });
    }
  }
  return entries;
}

/**
 * The single patch that records "remove from recommendations". It writes the
 * same `profile.exclusions` list the rest of the app already honours, so a
 * preference cannot defeat an exclusion by living in a second store.
 */
export function exclusionPatch(
  profile: Profile,
  exerciseId: string,
  excluded: boolean,
): Partial<Profile> {
  const has = profile.exclusions.includes(exerciseId);
  if (has === excluded) return {};
  return {
    exclusions: excluded
      ? [...profile.exclusions, exerciseId]
      : profile.exclusions.filter((value) => value !== exerciseId),
  };
}
