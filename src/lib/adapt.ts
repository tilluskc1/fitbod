import type { Program, ProgramExercise } from '../data/flagship.ts';
import { FULL_BODY_A, HOME_DUMBBELLS, HOTEL_DUMBBELLS } from '../data/flagship.ts';
import type { WorkoutExercise } from '../types.ts';

/**
 * The deterministic plan engine.
 *
 * It takes the programmed workout plus today's constraints and returns the
 * version that fits. It is a plain function: no model call, no randomness, and
 * no new numbers. Exercises, loads and per-set rep targets only ever come from
 * the program; the engine's whole job is deciding what to leave out.
 */

export type EquipmentChoice = 'home' | 'hotel' | 'bodyweight' | 'bands';

export interface EquipmentOption {
  label: string;
  /** Short chip label, sentence case. */
  chip: string;
  /** Compact label for the Today hero line. */
  short: string;
  detail: string;
  /** Loads the user can actually select with this setup. */
  loads: number[];
  /** Whether the setup has any external load at all. */
  allowsLoads: boolean;
}

export const EQUIPMENT_OPTIONS: Record<EquipmentChoice, EquipmentOption> = {
  home: {
    label: 'Home dumbbells',
    chip: 'Home dumbbells',
    short: 'Home',
    detail: 'Pairs: 10 kg, 15 kg, 18 kg',
    loads: HOME_DUMBBELLS,
    allowsLoads: true,
  },
  hotel: {
    label: 'Hotel gym',
    chip: 'Hotel gym',
    short: 'Hotel gym',
    detail: 'Dumbbells up to 25 kg',
    loads: HOTEL_DUMBBELLS,
    allowsLoads: true,
  },
  bodyweight: {
    label: 'Bodyweight only',
    chip: 'Bodyweight',
    short: 'Bodyweight',
    detail: 'No external load',
    loads: [],
    allowsLoads: false,
  },
  bands: {
    label: 'Resistance bands',
    chip: 'Resistance bands',
    short: 'Bands',
    detail: 'Bands only',
    loads: [],
    allowsLoads: false,
  },
};

export interface Constraints {
  minutes: number;
  equipment: EquipmentChoice;
}

export const DEFAULT_CONSTRAINTS: Constraints = { minutes: FULL_BODY_A.minutes, equipment: 'home' };

export interface AdaptedExercise extends ProgramExercise {
  /** Sets left after fitting the time budget. */
  sets: number;
  /** Per-set rep targets for the kept sets. */
  targetReps?: number[];
  originalSets: number;
}

export interface SkippedExercise {
  exerciseId: string;
  name: string;
  /** Sets that were in the program. */
  sets: number;
  reason: 'time' | 'equipment' | 'excluded';
}

export interface AdaptedWorkout {
  programId: string;
  name: string;
  minutes: number;
  originalMinutes: number;
  exercises: AdaptedExercise[];
  skipped: SkippedExercise[];
  totalSets: number;
  originalSets: number;
  /** Factual sentence shown under "Coach note". No readiness scores. */
  note: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Sets that fit the available minutes, derived from the program's own density
 * (11 sets in 35 minutes). 20 minutes therefore fits 6 sets, 30 fits 9, and 35
 * leaves the program untouched.
 */
export function setBudget(program: Program, minutes: number): number {
  const total = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  if (total === 0) return 0;
  return clamp(Math.round((total * minutes) / program.minutes), 1, total);
}

/**
 * Inverse of setBudget: what the work that survived the constraints takes.
 * Two sets left of an 35-minute program is not a 35-minute session.
 */
export function estimatedMinutes(program: Program, sets: number): number {
  const total = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  if (total === 0 || sets === 0) return 0;
  return Math.max(1, Math.round((program.minutes * sets) / total));
}

export function adaptWorkout(
  program: Program = FULL_BODY_A,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  excluded: string[] = [],
): AdaptedWorkout {
  const minutes = clamp(Math.round(constraints.minutes), 10, 120);
  const setup = EQUIPMENT_OPTIONS[constraints.equipment] ?? EQUIPMENT_OPTIONS.home;
  const skipped: SkippedExercise[] = [];
  const exercises: AdaptedExercise[] = [];
  const originalSets = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);

  // 1. Equipment first: a movement that needs a load the user does not have is
  //    dropped, never re-loaded with a number from somewhere else.
  for (const exercise of program.exercises) {
    if (excluded.includes(exercise.exerciseId)) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.sets,
        reason: 'excluded',
      });
      continue;
    }
    const unusable =
      (exercise.requires === 'dumbbell' && !setup.allowsLoads) ||
      (exercise.weight > 0 && !setup.loads.includes(exercise.weight));
    if (unusable) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.sets,
        reason: 'equipment',
      });
      continue;
    }
    exercises.push({
      ...exercise,
      sets: exercise.sets,
      targetReps: exercise.targetReps?.slice(0, exercise.sets),
      originalSets: exercise.sets,
    });
  }

  let total = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const budget = setBudget(program, minutes);

  // 2. Trim from the end of the session, keeping at least two working sets on
  //    a lift and one on a hold. Volume comes off the last movement first.
  for (let i = exercises.length - 1; i >= 0 && total > budget; i -= 1) {
    const floor = exercises[i].holdSeconds ? 1 : 2;
    while (exercises[i].sets > floor && total > budget) {
      exercises[i].sets -= 1;
      total -= 1;
    }
  }

  // 3. Still over: drop whole movements from the end, never the last one.
  while (total > budget) {
    const active = exercises.filter((exercise) => exercise.sets > 0);
    if (active.length <= 1) break;
    const last = active[active.length - 1];
    total -= last.sets;
    last.sets = 0;
  }

  for (const exercise of exercises) {
    exercise.targetReps = exercise.targetReps?.slice(0, exercise.sets);
  }

  // 4. Anything reduced to nothing was dropped to fit the time, so the review
  //    screen can say what went and why.
  const kept = exercises.filter((exercise) => exercise.sets > 0);
  for (const exercise of exercises) {
    if (exercise.sets === 0) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.originalSets,
        reason: 'time',
      });
    }
  }

  const totalSets = kept.reduce((sum, exercise) => sum + exercise.sets, 0);
  const trimmedSets = kept.some((exercise) => exercise.sets < exercise.originalSets);
  const forTime = skipped.filter((item) => item.reason === 'time');
  const forEquipment = skipped.filter((item) => item.reason === 'equipment');
  const timeTrimmed = trimmedSets || forTime.length > 0;

  let note: string;
  if (kept.length === 0) {
    note = `None of this workout can be done with ${setup.chip.toLowerCase()}.`;
  } else if (!timeTrimmed) {
    note = 'Same exercises, weights and sets as your program.';
  } else {
    note = `Volume trimmed to ${totalSets} ${totalSets === 1 ? 'set' : 'sets'} to fit ${minutes} min.`;
    if (forTime.length > 0) {
      note += ` ${listOf(forTime.map((item) => item.name))} skipped to fit ${minutes} min.`;
    }
  }
  if (forEquipment.length > 0) {
    note += ` ${listOf(forEquipment.map((item) => item.name))} need${forEquipment.length === 1 ? 's' : ''} a load that is not available today.`;
  }
  const forExcluded = skipped.filter((item) => item.reason === 'excluded');
  if (forExcluded.length > 0) {
    note += ` ${listOf(forExcluded.map((item) => item.name))} excluded in your library.`;
  }

  return {
    programId: program.id,
    name: program.name,
    minutes,
    originalMinutes: program.minutes,
    exercises: kept,
    skipped,
    totalSets,
    originalSets,
    note,
  };
}

/**
 * The adapted version expressed as the session model the logger already uses.
 * Per-set weights and rep targets are copied straight from the program.
 */
export function toWorkoutExercises(adapted: AdaptedWorkout): WorkoutExercise[] {
  return adapted.exercises.map((exercise) => {
    const planned = Array.from({ length: exercise.sets }, (_, index) => ({
      weight: exercise.weight,
      reps: exercise.targetReps?.[index] ?? exercise.holdSeconds ?? exercise.repRange[0],
    }));
    return {
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      planned,
      performed: planned.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        done: false,
        completedAt: null,
      })),
    };
  });
}

/** Weights the logger may offer, for the chosen setup only. */
export function loadOptions(equipment: EquipmentChoice): number[] {
  return EQUIPMENT_OPTIONS[equipment]?.loads ?? [];
}

