import type {
  AppState,
  Equipment,
  Feasibility,
  PlanDay,
  Profile,
  SupportEquipment,
  TodayOverride,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';
import { generateWorkout, targetCountFor } from './generator.ts';

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
 * Session length changes how much work fits, never the order of the split.
 * A 20-minute session is deliberately small; the full plan is unchanged.
 */
export function targetCountForMinutes(profile: Profile, minutes: number): number {
  const base = targetCountFor(profile);
  if (minutes <= 20) return Math.min(base, 3);
  if (minutes <= 30) return Math.min(base, 4);
  if (minutes <= 40) return Math.min(base, 5);
  return base;
}

export function minutesOf(profile: Profile, override: TodayOverride | null): number {
  return override?.minutes ?? profile.sessionMinutes ?? 35;
}

/** A session only counts once at least one set was actually completed. */
export function hasWork(workout: WorkoutRecord): boolean {
  return workout.exercises.some((exercise) => exercise.performed.some((set) => set.done));
}

export function setupLabel(equipment: Equipment[], support: SupportEquipment[]): string {
  if (equipment.length === 0) return 'Bodyweight';
  const base =
    equipment.length >= 3
      ? 'Full gym'
      : equipment.length === 1
        ? equipment[0]
        : equipment.slice(0, 2).join(' + ');
  return support.length > 0 ? `${base} + ${support.slice(0, 2).join(', ')}` : base;
}

export interface ResolvedWorkout {
  day: PlanDay;
  dayIndex: number;
  minutes: number;
  exercises: WorkoutExercise[];
  feasibility: Feasibility;
  targetCount: number;
  overridden: boolean;
  setup: string;
}

/**
 * The single resolved workout every surface reads: the Today preview, the
 * detail lists and the session that Start creates. Nothing regenerates with
 * different constraints between screens.
 */
export function resolveWorkout(
  profile: Profile,
  plan: PlanDay[],
  history: WorkoutRecord[],
  override: TodayOverride | null,
  minutes: number,
  dayIndexOverride?: number,
): ResolvedWorkout | null {
  if (plan.length === 0) return null;
  const dayIndex = dayIndexOverride ?? history.length % plan.length;
  const day = plan[dayIndex];
  if (!day) return null;
  const effective: Profile = override
    ? { ...profile, equipment: override.equipment, support: override.support }
    : profile;
  const targetCount = targetCountForMinutes(effective, minutes);
  const generated = generateWorkout(effective, day, dayIndex, history, targetCount);
  return {
    day,
    dayIndex,
    minutes,
    exercises: generated.exercises,
    feasibility: generated.feasibility,
    targetCount,
    overridden: override !== null,
    setup: setupLabel(effective.equipment, effective.support),
  };
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

