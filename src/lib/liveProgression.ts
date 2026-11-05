import { exerciseById } from '../data/exercises.ts';
import { loadModeOf, programExercise, setText } from '../data/flagship.ts';
import type { AdaptedExercise, AdaptedWorkout } from './adapt.ts';
import { coachLine, describePrescription, lastExercisePerformance, prescribeExercise } from './progression.ts';
import { exerciseInWorkout } from './plan.ts';
import { displayValue, unitLabel } from './units.ts';
import type { Exercise, Profile, Unit, WorkoutExercise, WorkoutRecord } from '../types.ts';

/**
 * The bridge between the program and the progression rules.
 *
 * `adaptWorkout` decides what survives today's time, equipment and exclusions;
 * it copies the program's fixture numbers. This module asks the history what
 * the next numbers should be, so Today, the preview, the logger and the recap
 * all read the same computed prescription. Nothing here writes state: the
 * record keeps whatever the user actually logged.
 */

function loadText(kg: number, exerciseId: string, unit: Unit): string {
  // No recorded load is not the same claim as a movement that has no load.
  if (kg <= 0) return loadModeOf(exerciseId) === 'none' ? 'bodyweight' : 'no load yet';
  const value = displayValue(kg, unit);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return loadModeOf(exerciseId) === 'total'
    ? `${text} ${unitLabel(unit)} total`
    : `${text} ${unitLabel(unit)} each`;
}

/** A hold's seconds live in the rep field, so it never grows a load. */
function holdSeconds(exerciseId: string): number | null {
  return programExercise(exerciseId)?.holdSeconds ?? null;
}

interface Numbers {
  weight: number;
  reps: number;
}

/**
 * What this exercise should show today. A hold keeps its programmed seconds; a
 * movement with no catalog definition keeps the program's own numbers rather
 * than guessing; everything else comes from the recorded history.
 */
function numbersFor(
  exercise: AdaptedExercise,
  profile: Profile,
  history: WorkoutRecord[],
): Numbers {
  const hold = holdSeconds(exercise.exerciseId);
  if (hold !== null) return { weight: 0, reps: hold };
  const definition = exerciseById(exercise.exerciseId);
  if (!definition) {
    return {
      weight: exercise.weight,
      reps: exercise.targetReps?.[0] ?? exercise.holdSeconds ?? exercise.repRange[0],
    };
  }
  const prescription = prescribeExercise(definition, profile, history);
  return { weight: prescription.weight, reps: prescription.reps };
}

/**
 * The adapted program with every number computed from history. The set budget,
 * the note, the skipped work and the minutes are untouched: progression changes
 * numbers, never the shape of the session the user approved.
 */
export function liveAdapted(
  adapted: AdaptedWorkout,
  profile: Profile,
  history: WorkoutRecord[],
): AdaptedWorkout {
  return {
    ...adapted,
    exercises: adapted.exercises.map((exercise) => {
      const hold = holdSeconds(exercise.exerciseId);
      if (hold !== null) return { ...exercise, weight: 0, targetReps: undefined };
      const numbers = numbersFor(exercise, profile, history);
      return {
        ...exercise,
        weight: numbers.weight,
        targetReps: Array.from({ length: exercise.sets }, () => numbers.reps),
      };
    }),
  };
}

/**
 * The session model the logger uses, with the same computed numbers. The slot
 * keeps its original required set count so a shortened session can advance the
 * program without earning a load increase.
 */
export function liveExercises(
  adapted: AdaptedWorkout,
  profile: Profile,
  history: WorkoutRecord[],
): WorkoutExercise[] {
  return adapted.exercises.map((exercise) => {
    const numbers = numbersFor(exercise, profile, history);
    const planned = Array.from({ length: exercise.sets }, () => ({ ...numbers }));
    return {
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      originalPlannedSets: exercise.originalSets,
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

/**
 * A loaded variant with no done set in completed history (a saved session that
 * never reached it does not calibrate it) whose first set has no load yet and nothing logged. Holds and bodyweight never ask.
 */
export function needsCalibration(exercise: WorkoutExercise, history: WorkoutRecord[]): boolean {
  const first = exercise.performed[0];
  return loadModeOf(exercise.exerciseId) !== 'none' && holdSeconds(exercise.exerciseId) === null
    && !lastExercisePerformance(history, exercise.exerciseId)?.done.length
    && first !== undefined && first.weight === 0 && !exercise.performed.some((set) => set.done);
}

function livePrescription(exerciseId: string, profile: Profile, history: WorkoutRecord[]) {
  if (holdSeconds(exerciseId) !== null) return null;
  const definition = exerciseById(exerciseId);
  return definition ? prescribeExercise(definition, profile, history) : null;
}

/** One line of the "why this number" explanation, or null where none applies. */
export function targetReason(
  exerciseId: string,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
): string | null {
  const prescription = livePrescription(exerciseId, profile, history);
  return prescription && describePrescription(prescription, unit);
}

/** Today's short coach line from the same prescription, or null where none applies. */
export function targetCoachLine(
  exerciseId: string,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
): string | null {
  const prescription = livePrescription(exerciseId, profile, history);
  return prescription && coachLine(prescription, unit);
}

/** "3 sets · 8 reps · 18 kg each" for a catalog row: Today's numbers, no load until calibrated. */
export function catalogRowMeta(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
): string {
  const hold = holdSeconds(exercise.id);
  const prescription = prescribeExercise(exercise, profile, history);
  const sets = programExercise(exercise.id)?.sets ?? prescription.sets;
  const load =
    hold === null && prescription.weight > 0 ? ` · ${loadText(prescription.weight, exercise.id, unit)}` : '';
  return `${sets} ${sets === 1 ? 'set' : 'sets'} · ${setText(exercise.id, hold ?? prescription.reps)}${load}`;
}

export interface ProgressionLine {
  exerciseId: string;
  name: string;
  /** What the program requires of this slot, independent of today's budget. */
  original: string;
  /** How much of it today's session carried. */
  adapted: string;
  /** What was actually completed, or null when nothing was. */
  performed: string | null;
  /** What the next same-variant session will ask for. */
  next: string;
  /** One factual sentence from the recorded evidence. */
  reason: string;
}

function programTarget(exerciseId: string, presentedSets: number): string {
  const program = programExercise(exerciseId);
  if (!program) return `${presentedSets} sets`;
  if (program.holdSeconds) return `${program.sets} × ${program.holdSeconds}s`;
  return `${program.sets} × ${program.repRange[0]}–${program.repRange[1]}`;
}

/**
 * The recap's per-exercise record: the original program target, the adapted
 * workload, the work actually completed, the next computed target and one
 * reason. `history` is the state after the workout was recorded, so the next
 * target includes this session's own evidence.
 */
export function progressionLines(
  workout: WorkoutRecord,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
): ProgressionLine[] {
  const order: string[] = [];
  const segmentsById = new Map<string, WorkoutRecord['exercises']>();
  for (const segment of workout.exercises) {
    if (!segmentsById.has(segment.exerciseId)) {
      order.push(segment.exerciseId);
      segmentsById.set(segment.exerciseId, []);
    }
    segmentsById.get(segment.exerciseId)?.push(segment);
  }

  return order.map((exerciseId) => {
    const segments = segmentsById.get(exerciseId) ?? [];
    const name = segments[0]?.name ?? exerciseId;
    const presentedSets = segments.reduce((sum, segment) => sum + segment.planned.length, 0);
    const done = segments.flatMap((segment) => segment.performed.filter((set) => set.done));
    const best = done.reduce<null | { weight: number; reps: number }>((current, set) => {
      if (!current) return { weight: set.weight, reps: set.reps };
      if (set.weight > current.weight) return { weight: set.weight, reps: set.reps };
      if (set.weight === current.weight && set.reps > current.reps) {
        return { weight: set.weight, reps: set.reps };
      }
      return current;
    }, null);
    const hold = holdSeconds(exerciseId);
    const required = exerciseInWorkout(workout, exerciseId)?.requirement ?? presentedSets;
    const performed = best
      ? `${done.length}/${required} sets · best ${setText(exerciseId, best.reps)} @ ${loadText(best.weight, exerciseId, unit)}`
      : null;

    const definition = exerciseById(exerciseId);
    if (hold !== null || !definition) {
      return {
        exerciseId,
        name,
        original: programTarget(exerciseId, presentedSets),
        adapted: `${presentedSets} ${presentedSets === 1 ? 'set' : 'sets'}`,
        performed,
        next: hold !== null ? `${hold}s hold` : 'Same as today',
        reason:
          hold !== null
            ? 'A hold has no load to progress — the seconds are the target.'
            : 'No programmed target for this movement.',
      };
    }

    const prescription = prescribeExercise(definition, profile, history);
    return {
      exerciseId,
      name,
      original: programTarget(exerciseId, presentedSets),
      adapted: `${presentedSets} ${presentedSets === 1 ? 'set' : 'sets'}`,
      performed,
      next: `${setText(exerciseId, prescription.reps)} @ ${loadText(
        prescription.weight,
        exerciseId,
        unit,
      )}`,
      reason: describePrescription(prescription, unit),
    };
  });
}
