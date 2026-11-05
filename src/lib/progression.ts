import type {
  Equipment,
  Exercise,
  MovementPattern,
  Profile,
  Unit,
  WorkoutRecord,
} from '../types.ts';
import { loadValue, unitLabel } from './units.ts';
import { exerciseInWorkout } from './plan.ts';
import { programExercise } from '../data/flagship.ts';

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
export function availableLoads(profile: Pick<Profile, 'loads'>, equipment: Equipment): number[] {
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
 * The next load above `weight`. With an inventory it is the next owned load up;
 * otherwise it rounds up to the step grid.
 */
export function nextLoad(weight: number, increment: number, available: number[]): number {
  if (increment <= 0) return weight;
  if (available.length > 0) {
    // The next owned load, not weight + a rounded gap: 2.268 kg (5 lb) rounds to 2.27 and skipped 20 lb.
    const reachable = available.find((value) => value > weight + 0.01);
    return reachable ?? available[available.length - 1];
  }
  const target = weight + increment;
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
  | 'mixed-load'
  | 'hold'
  | 'go-heavier';

export interface Prescription {
  equipment: Equipment;
  weight: number;
  reps: number;
  sets: number;
  basis: ProgressionBasis;
  range: RepRange;
  increment: number;
  /** Selectable loads for this equipment; a logged load outside it was typed by the user. */
  available: number[];
  /** Loads the user typed for this exercise (see `typedLoads`): they read exactly as typed. */
  typed: number[];
  last: ExercisePerformance | null;
}

/** Loads the user chose themselves: a done set whose weight differs from what the app planned for it. */
export function typedLoads(history: WorkoutRecord[], exerciseId: string): number[] {
  return history.flatMap((workout) =>
    workout.exercises
      .filter((exercise) => exercise.exerciseId === exerciseId)
      .flatMap((exercise) =>
        exercise.performed
          .filter((set, index) => set.done && Math.abs(set.weight - (exercise.planned[index]?.weight ?? -1)) > 0.001)
          .map((set) => set.weight),
      ),
  );
}

export function prescribeExercise(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
): Prescription {
  const catalog = repRangeFor(exercise.pattern);
  // The program's own range wins, so the next target matches the recap's "3 × 8–10".
  const programmed = programExercise(exercise.id)?.repRange;
  const range = programmed ? { min: programmed[0], max: programmed[1] } : catalog;
  const sets = setCountFor(exercise);
  const available = availableLoads(profile, exercise.equipment);
  const increment = incrementFor(exercise.equipment, available);
  const last = lastExercisePerformance(history, exercise.id);
  const base = {
    equipment: exercise.equipment,
    range,
    sets,
    increment,
    available,
    typed: typedLoads(history, exercise.id),
    last,
  };

  if (!last) {
    return { ...base, weight: 0, reps: clamp(catalog.min + 2, range.min, range.max), basis: 'first-time' };
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

  // Working sets at different loads are not one qualifying load: the load
  // holds at the lowest one used until every set qualifies at one load.
  const distinctLoads = new Set(last.done.map((set) => round(set.weight)));
  if (distinctLoads.size > 1) {
    return {
      ...base,
      weight: Math.min(...last.done.map((set) => set.weight)),
      reps: clamp(lowestReps, range.min, range.max),
      basis: 'mixed-load',
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

  // A fixed weight with no confirmed rack: the next one up is the lifter's to name, not a default step.
  if (available.length === 0 && (exercise.equipment === 'Dumbbell' || exercise.equipment === 'Kettlebell')) {
    return { ...base, weight: workingWeight, reps: range.min, basis: 'go-heavier' };
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

/**
 * Every load, planned or logged, reads by one rule: rack and app-prescribed
 * loads like the target line, a load the user typed exactly as typed.
 */
function fmtLoad(weight: number, equipment: Equipment, unit: Unit, available: number[], typed: number[]): string {
  if (weight <= 0) return equipment === 'Bodyweight' ? 'bodyweight' : 'no added load';
  return `${loadValue(weight, unit, available, typed)} ${unitLabel(unit)}`;
}

function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'last time';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One line explaining why today's numbers are what they are. Loads read in the display unit; records stay kilograms. */
export function describePrescription(prescription: Prescription, unit: Unit): string {
  const { basis, last, range, equipment, weight, available, typed } = prescription;
  const logged = (kg: number) => fmtLoad(kg, equipment, unit, available, typed);
  if (!last) {
    return 'First time — no history. Start light and log what you actually lift.';
  }
  const when = fmtDate(last.date);
  const count = last.done.length;
  const workWeight = last.done.length ? Math.max(...last.done.map((set) => set.weight)) : 0;
  const lowestReps = last.done.length ? Math.min(...last.done.map((set) => set.reps)) : 0;
  const setsLabel = `${count} set${count === 1 ? '' : 's'}`;

  switch (basis) {
    case 'load-increase': {
      // Next shown load minus the current load, both exactly as `logged` prints them.
      const shown = (kg: number) => Number(loadValue(kg, unit, available, typed));
      const step = Math.round((shown(weight) - shown(workWeight)) * 100) / 100;
      const stepText = step > 0 ? `One step up (+${step} ${unitLabel(unit)})` : 'Next load';
      return `${when}: ${setsLabel} at ${range.max} reps, ${logged(workWeight)}. ${stepText}; reps restart at ${range.min}.`;
    }
    case 'rep-increase':
      return `${when}: ${logged(workWeight)}, lowest set ${lowestReps} reps. Add a rep before adding load.`;
    case 'go-heavier':
      return `${when}: ${setsLabel} at ${range.max} reps, ${logged(workWeight)}. Ready to go heavier: use your next ${equipment.toLowerCase()} up; reps restart at ${range.min}.`;
    case 'mixed-load':
      // `weight` is the planned load: it reads exactly as the target line does.
      return `${when}: ${setsLabel} at different loads (heaviest ${logged(workWeight)}). The load holds at ${logged(weight)} — use one working load for every set to earn the next step.`;
    case 'repeat':
      return last.done.length === 0
        ? `${when} was not logged. Repeating the same prescription.`
        : `${when} was unfinished, so the load stays at ${logged(workWeight)}. Finish every set to earn the next step.`;
    case 'hold':
      return equipment === 'Bodyweight'
        ? `Bodyweight movement at the top of the rep range (${range.max}). Add external load manually to keep progressing.`
        : `Top of your available loads at ${range.max} reps — add heavier ${equipment.toLowerCase()} loads to progress further.`;
    case 'first-time':
    default:
      return 'First time — no history yet.';
  }
}

/**
 * Today's coach line: the same prescription as the target, in about a dozen
 * words. Today's load reads exactly as the target line; only last time's
 * logged load keeps its stored precision off the rack.
 */
export function coachLine(prescription: Prescription, unit: Unit): string {
  const { basis, last, equipment, weight, reps, available, typed } = prescription;
  const first =
    equipment === 'Bodyweight'
      ? 'First time on this one. Log the reps you do.'
      : 'First time on this one. Start light, log what you lift.';
  if (!last) return first;
  const today = weight > 0 ? `${fmtLoad(weight, equipment, unit, available, typed)} for ${reps}` : `${reps} reps`;
  const owned = last.done.length ? Math.max(...last.done.map((set) => set.weight)) : 0;
  switch (basis) {
    case 'load-increase':
      return `You owned ${fmtLoad(owned, equipment, unit, available, typed)}. Today: ${today}.`;
    case 'rep-increase':
      return `Add a rep: ${today}.`;
    case 'go-heavier':
      return `Ready to go heavier: use your next ${equipment.toLowerCase()} up.`;
    case 'mixed-load':
      return `One load for every set: ${today}.`;
    case 'hold':
      return equipment === 'Bodyweight' ? `Top of the range — own ${today}.` : `Top of your rack — own ${today}.`;
    case 'repeat':
      return last.done.length === 0 ? `Last time wasn't logged. Same plan: ${today}.` : `Finish every set: ${today}.`;
    case 'first-time':
    default:
      return first;
  }
}
