import { EXERCISES } from '../data/exercises.ts';
import type { MuscleGroup, WorkoutRecord } from '../types.ts';
import { hasWork } from './plan.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_VOLUME_WINDOW_DAYS = 7;

/**
 * (#294) Time actually trained: finish minus start, the same figure as the recap. A legacy record
 * with no times falls back to the minutes it was planned at, and says so.
 */
export function trainedMinutes(workout: WorkoutRecord): { minutes: number; planned: boolean } {
  if (workout.endedAt) {
    // (#430) Time away from a resumed workout sits in pausedMs and does not count as trained.
    const span = (Date.parse(workout.endedAt) - Date.parse(workout.date)) / 60000;
    const away = (workout.pausedMs ?? 0) / 60000;
    if (Number.isFinite(span) && span > 0) {
      return { minutes: Math.max(1, Math.round(span - away)), planned: false };
    }
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

/**
 * (#446) Sets actually done, per muscle group, over the trailing 7 days ending at `now`. Counts
 * every logged set regardless of the session's overall status — an unfinished session's done sets
 * still trained the muscle. An exerciseId no longer in the catalog (a removed or renamed exercise)
 * contributes nothing rather than throwing.
 */
export function weeklySetsPerMuscle(
  history: WorkoutRecord[],
  now: Date = new Date(),
): Partial<Record<MuscleGroup, number>> {
  const windowStart = now.getTime() - WEEKLY_VOLUME_WINDOW_DAYS * DAY_MS;
  const totals: Partial<Record<MuscleGroup, number>> = {};
  for (const workout of history) {
    const at = Date.parse(workout.date);
    if (!Number.isFinite(at) || at < windowStart || at > now.getTime()) continue;
    for (const exercise of workout.exercises) {
      const done = exercise.performed.filter((set) => set.done).length;
      if (done === 0) continue;
      const meta = EXERCISES.find((item) => item.id === exercise.exerciseId);
      if (!meta) continue;
      for (const muscle of meta.muscles) {
        totals[muscle] = (totals[muscle] ?? 0) + done;
      }
    }
  }
  return totals;
}
