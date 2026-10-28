import type { AppState, Profile, TodayOverride, WorkoutRecord } from '../types.ts';

/** Local calendar day key, used to scope a one-day override. */
export function dayKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An override only counts on the day it was approved for. */
export function activeOverride(state: AppState, now: Date): TodayOverride | null {
  const override = state.todayOverride ?? null;
  if (!override) return null;
  return override.date === dayKey(now) ? override : null;
}

export function minutesOf(profile: Profile, override: TodayOverride | null): number {
  return override?.minutes ?? profile.sessionMinutes ?? 35;
}

/** A session only counts once at least one set was actually completed. */
export function hasWork(workout: WorkoutRecord): boolean {
  return workout.exercises.some((exercise) => exercise.performed.some((set) => set.done));
}

/** Completed sessions this calendar week (Sunday start, matching the week dots). */
export function workoutsThisWeek(history: WorkoutRecord[], now: Date): number {
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return history.filter((workout) => hasWork(workout) && new Date(workout.date) >= start).length;
}

export interface LastPerformance {
  workout: WorkoutRecord;
  /** Reps per set, completed sets only (falls back to the prescription). */
  reps: number[];
  weight: number;
}

/** Most recent completed session that actually trained an exercise. */
export function lastPerformance(
  history: WorkoutRecord[],
  exerciseId: string,
): LastPerformance | null {
  for (const workout of history) {
    const exercise = workout.exercises.find((item) => item.exerciseId === exerciseId);
    if (!exercise) continue;
    const done = exercise.performed.filter((set) => set.done);
    // A session whose sets were never completed is not a record of work.
    if (done.length === 0) continue;
    return {
      workout,
      reps: done.map((set) => set.reps),
      weight: done[0].weight,
    };
  }
  return null;
}

