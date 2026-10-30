import type {
  Equipment,
  Exercise,
  MovementPattern,
  Profile,
  WorkoutRecord,
} from '../types.ts';
import { exerciseInWorkout } from './plan.ts';

/**
 * Phase 2 progression policy: double progression.
 *
 * A lift climbs reps inside a range; once every prescribed set is completed at
 * the top of the range, the load moves up one step and reps restart at the
 * bottom. The load is never invented: without a logged session the weight stays
 * at 0 and the user logs what they actually lifted. An exercise that was not
 * finished repeats its load instead of being rewarded with more weight.
 *
 * The load step comes from `Profile.loads` when the user has recorded real
 * available loads, and from a documented default otherwise.
 */

export interface RepRange {
  min: number;
  max: number;
}

const COMPOUND_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'squat',
  'lunge',
  'hinge',
  'hip_extension',
]);

const MID_RANGE_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'knee_extension',
  'knee_flexion',
]);

/** Rep ranges per movement class. Deliberately small: no rules engine. */
export const REP_RANGES: Record<'compound' | 'mid' | 'accessory', RepRange> = {
  compound: { min: 6, max: 10 },
  mid: { min: 8, max: 12 },
  accessory: { min: 10, max: 15 },
};

/**
 * Fallback steps when no load inventory exists. These are starting points, not
 * claims about every gym: a barbell moves in plate pairs, a kettlebell in whole
 * sizes, a machine stack in whatever the manufacturer chose.
 */
export const DEFAULT_INCREMENTS: Record<Equipment, number> = {
  Barbell: 2.5,
  Dumbbell: 2.5,
  Kettlebell: 4,
  Machine: 5,
  Cable: 2.5,
  Bodyweight: 0,
};

const DEFAULT_REPS = 10;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function repRangeFor(pattern: MovementPattern): RepRange {
  if (COMPOUND_PATTERNS.has(pattern)) return REP_RANGES.compound;
  if (MID_RANGE_PATTERNS.has(pattern)) return REP_RANGES.mid;
  return REP_RANGES.accessory;
}

/** Four sets for multi-muscle movements, three for isolation work. */
export function setCountFor(exercise: Exercise): number {
  return exercise.muscles.length >= 2 ? 4 : 3;
}

/** Loads the profile says are actually selectable for this equipment. */
export function availableLoads(profile: Profile, equipment: Equipment): number[] {
  const list = profile.loads[equipment] ?? [];
  return list.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
}

/**
 * One step for this equipment. With a real inventory the step is the smallest
 * gap between listed loads, so a fixed dumbbell rack progresses by rack steps.
 */
export function incrementFor(equipment: Equipment, available: number[]): number {
  if (equipment === 'Bodyweight') return 0;
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < available.length; index += 1) {
    const gap = available[index] - available[index - 1];
    if (gap > 0.001 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? round(step) : DEFAULT_INCREMENTS[equipment];
}

/**
 * The next load above `weight`. With an inventory the suggestion snaps up to a
 * load the user can actually select; otherwise it rounds up to the step grid.
 */
export function nextLoad(weight: number, increment: number, available: number[]): number {
  if (increment <= 0) return weight;
  const target = weight + increment;
  if (available.length > 0) {
    const reachable = available.find((value) => value >= target - 0.001);
    return reachable ?? available[available.length - 1];
  }
  return round(Math.ceil((target - 0.001) / increment) * increment);
}

export interface PerformanceSet {
  weight: number;
  reps: number;
}

export interface ExercisePerformance {
  workoutId: string;
  workoutName: string;
  date: string;
  plannedSets: number;
  plannedWeight: number;
  plannedReps: number;
  /** Sets actually marked done in that session. */
  done: PerformanceSet[];
}

/**
 * The most recent completed session that contains this exercise. Active
 * sessions are ignored: unfinished data must not drive the next prescription.
 */
export function lastExercisePerformance(
  history: WorkoutRecord[],
  exerciseId: string,
): ExercisePerformance | null {
  let latest: ExercisePerformance | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const workout of history) {
    if (workout.status !== 'completed') continue;
    const found = exerciseInWorkout(workout, exerciseId);
    if (!found) continue;
    const time = new Date(workout.date).getTime();
    if (!(time > latestTime)) continue;
    latestTime = time;
    latest = {
      workoutId: workout.id,
      workoutName: workout.name,
      date: workout.date,
      // The slot's original requirement, preserved across swaps; old records
      // without split markers fall back to their planned totals.
      plannedSets: found.requirement,
      plannedWeight: found.firstPlanned?.weight ?? 0,
      plannedReps: found.firstPlanned?.reps ?? 0,
      done: found.done.map((set) => ({ weight: set.weight, reps: set.reps })),
    };
  }
  return latest;
}

export type ProgressionBasis =
  | 'first-time'
  | 'load-increase'
  | 'rep-increase'
  | 'repeat'
  | 'hold';

export interface Prescription {
  equipment: Equipment;
  weight: number;
  reps: number;
  sets: number;
  basis: ProgressionBasis;
  range: RepRange;
  increment: number;
  last: ExercisePerformance | null;
}

export function prescribeExercise(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
): Prescription {
  const range = repRangeFor(exercise.pattern);
  const sets = setCountFor(exercise);
  const available = availableLoads(profile, exercise.equipment);
  const increment = incrementFor(exercise.equipment, available);
  const last = lastExercisePerformance(history, exercise.id);
  const base = {
    equipment: exercise.equipment,
    range,
    sets,
    increment,
    last,
  };

  if (!last) {
    return { ...base, weight: 0, reps: clamp(range.min + 2, range.min, range.max), basis: 'first-time' };
  }

  if (last.done.length === 0) {
    return {
      ...base,
      weight: last.plannedWeight,
      reps: clamp(last.plannedReps || DEFAULT_REPS, range.min, range.max),
      basis: 'repeat',
    };
  }

  const workingWeight = Math.max(...last.done.map((set) => set.weight));
  const lowestReps = Math.min(...last.done.map((set) => set.reps));
  const finished = last.done.length >= last.plannedSets;

  // An unfinished exercise is not a green light for more weight.
  if (!finished) {
    return {
      ...base,
      weight: workingWeight,
      reps: clamp(lowestReps, range.min, range.max),
      basis: 'repeat',
    };
  }

  if (lowestReps < range.max) {
    return {
      ...base,
      weight: workingWeight,
      reps: clamp(lowestReps + 1, range.min, range.max),
      basis: 'rep-increase',
    };
  }

  const next = increment > 0 ? nextLoad(workingWeight, increment, available) : workingWeight;
  if (next <= workingWeight + 0.001) {
    // No heavier load exists (bodyweight, or the top of the recorded rack).
    return {
      ...base,
      weight: workingWeight,
      reps: range.max,
      basis: 'hold',
    };
  }

  return { ...base, weight: next, reps: range.min, basis: 'load-increase' };
}

function fmtLoad(weight: number, equipment: Equipment): string {
  if (weight <= 0) return equipment === 'Bodyweight' ? 'bodyweight' : 'no added load';
  return `${weight} kg`;
}

function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'last time';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One line explaining why today's numbers are what they are. */
export function describePrescription(prescription: Prescription): string {
  const { basis, last, range, increment, equipment } = prescription;
  if (!last) {
    return 'First time — no history. Start light and log what you actually lift.';
  }
  const when = fmtDate(last.date);
  const count = last.done.length;
  const workWeight = last.done.length ? Math.max(...last.done.map((set) => set.weight)) : 0;
  const lowestReps = last.done.length ? Math.min(...last.done.map((set) => set.reps)) : 0;
  const setsLabel = `${count} set${count === 1 ? '' : 's'}`;

  switch (basis) {
    case 'load-increase':
      return `${when}: ${setsLabel} at ${range.max} reps, ${fmtLoad(workWeight, equipment)}. One step up (+${increment} kg); reps restart at ${range.min}.`;
    case 'rep-increase':
      return `${when}: ${fmtLoad(workWeight, equipment)}, lowest set ${lowestReps} reps. Add a rep before adding load.`;
    case 'repeat':
      return last.done.length === 0
        ? `${when} was not logged. Repeating the same prescription.`
        : `${when} was unfinished, so the load stays at ${fmtLoad(workWeight, equipment)}. Finish every set to earn the next step.`;
    case 'hold':
      return equipment === 'Bodyweight'
        ? `Bodyweight movement at the top of the rep range (${range.max}). Add external load manually to keep progressing.`
        : `Top of your available loads at ${range.max} reps — add heavier ${equipment.toLowerCase()} loads to progress further.`;
    case 'first-time':
    default:
      return 'First time — no history yet.';
  }
}
