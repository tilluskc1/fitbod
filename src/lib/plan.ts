import type {
  AppState,
  PerformedSet,
  Profile,
  TodayOverride,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';

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

export interface ExerciseInWorkout {
  /** Every segment of this exercise in the workout, in record order. */
  segments: WorkoutExercise[];
  /** Completed sets across all segments, in record order. */
  done: PerformedSet[];
  /** Sum of prescribed set counts across segments. */
  plannedTotal: number;
  /**
   * What this session required: the original prescription kept through swaps,
   * never smaller than the segments that remain. Old records without markers
   * fall back to their planned totals.
   */
  requirement: number;
  /** First prescribed set of the first segment, or null. */
  firstPlanned: { weight: number; reps: number } | null;
}

/** All the work one exercise did in a workout, across repeated segments. */
export function exerciseInWorkout(
  workout: WorkoutRecord,
  exerciseId: string,
): ExerciseInWorkout | null {
  const segments = workout.exercises.filter((exercise) => exercise.exerciseId === exerciseId);
  if (segments.length === 0) return null;
  const done: PerformedSet[] = [];
  let plannedTotal = 0;
  let marked = 0;
  for (const segment of segments) {
    plannedTotal += segment.planned.length;
    marked = Math.max(marked, segment.originalPlannedSets ?? 0);
    for (const set of segment.performed) {
      if (set.done) done.push(set);
    }
  }
  return {
    segments,
    done,
    plannedTotal,
    requirement: Math.max(plannedTotal, marked),
    firstPlanned: segments[0].planned[0] ?? null,
  };
}

/** Most recent completed session that actually trained an exercise. */
export function lastPerformance(
  history: WorkoutRecord[],
  exerciseId: string,
): LastPerformance | null {
  for (const workout of history) {
    const found = exerciseInWorkout(workout, exerciseId);
    if (!found || found.done.length === 0) continue;
    return {
      workout,
      reps: found.done.map((set) => set.reps),
      weight: found.done[0].weight,
    };
  }
  return null;
}

