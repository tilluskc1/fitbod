import type {
  AppState,
  PerformedSet,
  Profile,
  TodayOverride,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';
import { savedSetup } from './setup.ts';

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

/**
 * Today's override without its described day (#193): once that day is trained, Today goes back
 * to the planned day. Today's gear and time stay; an override left saying only the saved setup
 * at the saved length is no override at all.
 */
export function withoutCustomDay(state: AppState): AppState {
  const override = state.todayOverride;
  if (!override || (override.focus === undefined && override.skip === undefined)) return state;
  const { focus: _focus, skip: _skip, ...rest } = override;
  const saved = state.profile?.sessionMinutes ?? 35;
  // The saved setup is the profile's own (bodyweight for no gear, #188 follow-up), as todayProgram reads it.
  const choice = rest.choice ?? 'home';
  const plain = (choice === 'home' || (state.profile !== null && choice === savedSetup(state.profile))) && rest.minutes === saved;
  return { ...state, todayOverride: plain ? null : rest };
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
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return history.filter((workout) => {
    const date = new Date(workout.date);
    return workout.status === 'completed' && hasWork(workout) && date >= start && date < end;
  }).length;
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

/**
 * The one set a chart point may print: greatest load, then most reps, then the
 * earliest completion. Null when nothing was completed, so a prescription is
 * never charted as a performance.
 */
export function bestCompletedSet(sets: PerformedSet[]): PerformedSet | null {
  let best: PerformedSet | null = null;
  for (const set of sets) {
    if (!set.done) continue;
    if (best === null) {
      best = set;
      continue;
    }
    const at = set.completedAt ? Date.parse(set.completedAt) : Infinity;
    const bestAt = best.completedAt ? Date.parse(best.completedAt) : Infinity;
    if (
      set.weight > best.weight ||
      (set.weight === best.weight &&
        (set.reps > best.reps || (set.reps === best.reps && at < bestAt)))
    ) {
      best = set;
    }
  }
  return best;
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

