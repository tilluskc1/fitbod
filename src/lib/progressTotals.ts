import type { WorkoutRecord } from '../types.ts';
import { hasWork } from './plan.ts';

/**
 * (#294) Time actually trained: finish minus start, the same figure as the recap. A legacy record
 * with no times falls back to the minutes it was planned at, and says so.
 */
export function trainedMinutes(workout: WorkoutRecord): { minutes: number; planned: boolean } {
  if (workout.endedAt) {
    const span = (Date.parse(workout.endedAt) - Date.parse(workout.date)) / 60000;
    if (Number.isFinite(span) && span > 0) return { minutes: Math.max(1, Math.round(span)), planned: false };
  }
  return { minutes: workout.durationMin ?? 0, planned: true };
}

export function doneSets(workout: WorkoutRecord): number {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.performed.filter((set) => set.done).length,
    0,
  );
}

/** Finished workouts with at least one logged set; empty or all-skipped records count as none. */
export function finishedWorkouts(history: WorkoutRecord[]): WorkoutRecord[] {
  return history.filter(hasWork);
}

export interface ProgressTotals {
  workouts: number;
  sets: number;
  minutes: number;
  /** True when any counted workout used its planned minutes (no recorded times). */
  approx: boolean;
}

export function progressTotals(history: WorkoutRecord[]): ProgressTotals {
  const worked = finishedWorkouts(history);
  let minutes = 0;
  let approx = false;
  for (const workout of worked) {
    const trained = trainedMinutes(workout);
    minutes += trained.minutes;
    if (trained.planned) approx = true;
  }
  return {
    workouts: worked.length,
    sets: worked.reduce((sum, workout) => sum + doneSets(workout), 0),
    minutes,
    approx,
  };
}
