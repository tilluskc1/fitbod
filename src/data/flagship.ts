/**
 * The programmed workout the flagship flow runs on.
 *
 * One module, one source of truth: Today, Adjust, Review and the active
 * workout all read these exact values, so no screen can invent its own
 * exercises, sets, reps or loads. Records live in `AppState`; nothing here is
 * ever overwritten by logging.
 */

import { exerciseById } from './exercises.ts';
import { displayValue, unitLabel } from '../lib/units.ts';
import type { Feasibility, Unit } from '../types.ts';

export type LoadMode = 'each' | 'total' | 'none';

export interface ProgramExercise {
  exerciseId: string;
  /** Display name used on every screen. */
  name: string;
  /** Prescribed working sets in the unadapted program. */
  sets: number;
  /** Target range shown as "8–10". */
  repRange: [number, number];
  /**
   * Per-set rep targets when the program has them (from the last completed
   * session). Displayed as "9 · 9 · 9"; the n-th set keeps the n-th target.
   */
  targetReps?: number[];
  /** Hold length in seconds for isometric work. */
  holdSeconds?: number;
  /** Working load in kilograms. Never copied from another exercise. */
  weight: number;
  /** "kg each" for a dumbbell pair, "kg total" for one dumbbell at the chest. */
  load: LoadMode;
  /** What the load is plus any surface the movement needs. */
  detail: string;
  /** Equipment family this movement needs; drives the adaptation engine. */
  requires: 'dumbbell' | 'bodyweight' | 'configured';
}

export interface Program {
  id: string;
  name: string;
  minutes: number;
  exercises: ProgramExercise[];
  /** The generated slot's honest status: Ready, Limited or Not enough equipment. */
  feasibility?: Feasibility;
  /** A today-only setup the day was rebuilt for (#188); its gear is already checked. Absent: the saved setup. */
  setup?: 'hotel' | 'bodyweight' | 'bands';
  /**
   * Built at a today-only length under 45 minutes and under the saved one (#229): the saved length,
   * and the saved day's movements this day does not have, so the review can name what went.
   */
  shortenedFrom?: { minutes: number; dropped: { exerciseId: string; name: string; sets: number }[] };
}

export const FULL_BODY_A: Program = {
  id: 'full-body-a',
  name: 'Full body A',
  minutes: 35,
  exercises: [
    {
      exerciseId: 'dumbbell-floor-press',
      name: 'Dumbbell floor press',
      sets: 3,
      repRange: [8, 10],
      targetReps: [9, 9, 9],
      weight: 15,
      load: 'each',
      detail: 'Floor mat',
      requires: 'dumbbell',
    },
    {
      exerciseId: 'goblet-squat',
      name: 'Goblet squat',
      sets: 3,
      repRange: [8, 10],
      weight: 18,
      load: 'total',
      detail: 'One dumbbell',
      requires: 'dumbbell',
    },
    {
      exerciseId: 'dumbbell-row',
      name: 'Dumbbell row',
      sets: 3,
      repRange: [8, 10],
      weight: 15,
      load: 'each',
      detail: 'Dumbbell',
      requires: 'dumbbell',
    },
    {
      exerciseId: 'plank',
      name: 'Plank',
      sets: 2,
      repRange: [45, 45],
      holdSeconds: 45,
      weight: 0,
      load: 'none',
      detail: 'Floor mat',
      requires: 'bodyweight',
    },
  ],
};

/** Owned home loadout. Every suggested weight must come from this list. */
export const HOME_DUMBBELLS = [10, 15, 18];
/** A hotel rack goes a little heavier; the program's loads are still inside it. */
export const HOTEL_DUMBBELLS = [10, 15, 18, 22, 25];

/**
 * A hold's seconds are stored in the existing rep field, so the unit of a
 * printed count comes from the movement.
 * shortcut: no stored unit field, so add one before a movement mixes reps and
 * holds in the same set.
 */
export function setUnit(exerciseId: string): 'reps' | 'seconds' {
  return programExercise(exerciseId)?.holdSeconds ? 'seconds' : 'reps';
}

/** "9 reps", "45s", or "45 · 45s" for a list — the movement's own unit. */
export function setText(exerciseId: string, value: number | number[]): string {
  const text = Array.isArray(value) ? value.join(' · ') : String(value);
  return setUnit(exerciseId) === 'seconds' ? `${text}s` : `${text} reps`;
}

export function programSetCount(program: Program): number {
  return program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
}

/** "15 kg each" / "33 lb each" / "Bodyweight". Stored loads stay kilograms. */
export function loadLabel(
  exercise: Pick<ProgramExercise, 'weight' | 'load'>,
  unit: Unit = 'kg',
  format?: (kg: number) => string,
): string {
  if (exercise.load === 'none' || exercise.weight <= 0) return 'Bodyweight';
  const value = displayValue(exercise.weight, unit);
  const text = format ? format(exercise.weight) : Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} ${unitLabel(unit)}${exercise.load === 'each' ? ' each' : ' total'}`;
}

/** "9 · 9 · 9" or "8–10" when the program has no per-set targets. */
export function repLabel(
  exercise: Pick<ProgramExercise, 'targetReps' | 'repRange' | 'holdSeconds'>,
  count?: number,
): string {
  if (exercise.targetReps && exercise.targetReps.length > 0) {
    const targets = count ? exercise.targetReps.slice(0, count) : exercise.targetReps;
    return targets.join(' · ');
  }
  if (exercise.holdSeconds) return `${exercise.holdSeconds}s`;
  return `${exercise.repRange[0]}–${exercise.repRange[1]}`;
}

/**
 * "9 · 9 @ 15 kg each" for a target line. Ranges keep the word "reps" so the
 * line cannot be mistaken for a set count.
 */
export function targetSummary(
  exercise: Pick<ProgramExercise, 'targetReps' | 'repRange' | 'holdSeconds' | 'weight' | 'load'>,
  count?: number,
  unit: Unit = 'kg',
  format?: (kg: number) => string,
): string {
  const reps = exercise.holdSeconds
    ? `${exercise.holdSeconds}s`
    : exercise.targetReps
      ? repLabel(exercise, count)
      : `${repLabel(exercise, count)} reps`;
  return exercise.weight > 0 ? `${reps} @ ${loadLabel(exercise, unit, format)}` : reps;
}

/**
 * "6 · 6 · 6 @ 60 kg total" for a last-session line, in the target line's format so a load step up
 * cannot read as a rep drop (#245). Sets at different loads read per set, as the logger does:
 * "60 × 6 · 62.5 × 5 kg total". Bodyweight and holds keep reps or seconds only.
 */
export function lastSummary(
  exercise: Pick<ProgramExercise, 'exerciseId' | 'load'>,
  sets: { weight: number; reps: number }[],
  unit: Unit = 'kg',
  format?: (kg: number) => string,
): string {
  const reps = sets.map((set) => set.reps);
  if (exercise.load === 'none' || !sets.some((set) => set.weight > 0)) return setText(exercise.exerciseId, reps);
  const load = (weight: number) => loadLabel({ weight, load: exercise.load }, unit, format);
  // Same as displayed, not as stored: two kg values that show the same read as one load.
  if (sets.every((set) => load(set.weight) === load(sets[0].weight))) return `${reps.join(' · ')} @ ${load(sets[0].weight)}`;
  const suffix = load(sets.find((set) => set.weight > 0)!.weight).replace(/^\S+ /, '');
  const number = (weight: number) => load(weight).split(' ')[0];
  return `${sets.map((set) => `${set.weight > 0 ? number(set.weight) : 'BW'} × ${set.reps}`).join(' · ')} ${suffix}`;
}

export function programExercise(exerciseId: string): ProgramExercise | undefined {
  return FULL_BODY_A.exercises.find((exercise) => exercise.exerciseId === exerciseId);
}

/** Catalog swaps keep their own equipment; only the program defines special load modes. */
export function loadModeOf(exerciseId: string): LoadMode {
  const program = programExercise(exerciseId);
  if (program) return program.load;
  const equipment = exerciseById(exerciseId)?.equipment;
  return equipment === 'Dumbbell' ? 'each' : equipment && equipment !== 'Bodyweight' ? 'total' : 'none';
}

/** Why a loaded set cannot be logged yet; one wording for logger and history (#103). */
export const NEEDS_LOAD_REASON = 'Enter a weight to log this set';

/** A loaded, counted set: it cannot be logged until it carries a load (#103). */
export function needsLoad(exerciseId: string): boolean {
  return loadModeOf(exerciseId) !== 'none' && setUnit(exerciseId) !== 'seconds';
}

export function detailOf(exerciseId: string): string {
  return programExercise(exerciseId)?.detail ?? exerciseById(exerciseId)?.equipment ?? 'Bodyweight';
}

/**
 * "9 · 9 · 9" when the program carries per-set targets, "8–10 reps" when it
 * prescribes a range. A range must never collapse to its low bound on screen.
 */
export function repsTarget(exerciseId: string, count: number, planned?: { reps: number }[]): string | null {
  const program = programExercise(exerciseId);
  if (planned) {
    const reps = planned.map((set) => set.reps);
    return setUnit(exerciseId) === 'seconds' ? `${reps.join(' · ')}s` : reps.join(' · ');
  }
  if (!program) return null;
  if (program.holdSeconds) return `${program.holdSeconds}s`;
  if (program.targetReps) return program.targetReps.slice(0, count).join(' · ');
  return `${program.repRange[0]}–${program.repRange[1]} reps`;
}

/** "3 sets · 8–10 reps · 15 kg each", "3 × 9 @ 15 kg each" or "3 sets · 9 · 8 · 8 @ 15 kg each" for a workout row. */
export function exerciseMeta(
  exercise: ProgramExercise,
  count = exercise.sets,
  includeSets = true,
  unit: Unit = 'kg',
  format?: (kg: number) => string,
): string {
  const sets = `${count} ${count === 1 ? 'set' : 'sets'}`;
  const reps = exercise.holdSeconds
    ? `${exercise.holdSeconds}s hold`
    : exercise.targetReps
      ? repLabel(exercise, count)
      : `${repLabel(exercise, count)} reps`;
  // Targets read "9 · 9 @ 15 kg each"; ranges read "8–10 reps · 18 kg total".
  const load =
    exercise.weight > 0 ? `${exercise.targetReps ? ' @ ' : ' · '}${loadLabel(exercise, unit, format)}` : '';
  // Same reps on every set reads "5 × 4 @ 20 lb each", short enough for a 360 px row.
  const targets = exercise.holdSeconds ? [] : exercise.targetReps?.slice(0, count) ?? [];
  if (includeSets && count > 1 && targets.length === count && targets.every((value) => value === targets[0])) {
    return `${count} × ${targets[0]}${load}`;
  }
  return includeSets ? `${sets} · ${reps}${load}` : `${reps}${load}`;
}
