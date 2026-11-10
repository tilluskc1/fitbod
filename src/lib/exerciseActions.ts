import type { WorkoutExercise, WorkoutRecord } from '../types';

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
  | 'set-all'
  | 'replace'
  | 'more'
  | 'less'
  | 'dont-recommend'
  | 'remove-today'
  | 'return';

export interface ExerciseAction {
  id: ExerciseActionId;
  label: string;
  /** Present when the control cannot act right now; the sheet shows it. */
  blockedReason?: string;
}

const NOTHING_PENDING_DONE = 'Every set here is logged, so there is no remaining work to change.';
const NOTHING_PENDING_EMPTY = 'This exercise has no sets to change.';
// Today's preview has no session to edit; acting on it would be a silent no-op.
const NO_SESSION = "Start the workout to change today's sets.";

export function exerciseActions(pending: number, done: number, inSession: boolean, skipped: boolean): ExerciseAction[] {
  const blocked = !inSession
    ? NO_SESSION
    : pending > 0
      ? undefined
      : done > 0
        ? NOTHING_PENDING_DONE
        : NOTHING_PENDING_EMPTY;
  const today: ExerciseAction[] = skipped
    ? [{ id: 'return', label: 'Return to exercise' }]
    : [
        // #306: change your mind before set 1; every set not yet logged takes the new values.
        { id: 'set-all', label: 'Set all remaining sets to…', blockedReason: blocked },
        { id: 'replace', label: 'Replace for the remaining sets', blockedReason: blocked },
        { id: 'remove-today', label: "Remove today's remaining work", blockedReason: blocked },
      ];
  return [
    { id: 'instructions', label: 'Instructions and demo' },
    { id: 'history', label: 'History for this exercise' },
    ...today.slice(0, skipped ? 1 : 2),
    { id: 'more', label: 'Recommend more often' },
    { id: 'less', label: 'Recommend less often' },
    { id: 'dont-recommend', label: "Don't recommend again" },
    ...today.slice(skipped ? 1 : 2),
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

/** The toast after "Remove today's remaining work": logged sets stay, so it never says nothing was recorded (#105). */
export function removeTodayNotice(exercise: Pick<WorkoutExercise, 'name' | 'performed'> | undefined): string {
  const name = exercise?.name ?? 'That exercise';
  const done = exercise?.performed.filter((set) => set.done).length ?? 0;
  return done === 0
    ? `${name} skipped for today. Nothing was recorded for it.`
    : `${name}: the remaining sets are removed for today. ${done} logged ${done === 1 ? 'set is' : 'sets are'} kept.`;
}
