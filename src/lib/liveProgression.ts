import { exerciseById } from '../data/exercises.ts';
import { loadModeOf, programExercise, setText } from '../data/flagship.ts';
import type { AdaptedExercise, AdaptedWorkout } from './adapt.ts';
import { availableLoads, typedLoads, coachLine, describePrescription, lastExercisePerformance, leadCompoundId, leadSlotIds, prescribeExercise } from './progression.ts';
import { bestCompletedSet, exerciseInWorkout, hasWork } from './plan.ts';
import { loadValue, unitLabel } from './units.ts';
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

/** The user's confirmed loads for this movement's equipment: the one "on the rack" rule. */
export function rackOf(profile: Pick<Profile, 'loads'>, exerciseId: string): number[] {
  const equipment = exerciseById(exerciseId)?.equipment;
  return equipment ? availableLoads(profile, equipment) : [];
}

/**
 * The one load formatter for planned and logged loads alike: rack loads like
 * the rack, a load the user typed exactly as typed (even when held), an
 * app-prescribed off-rack load at half-unit, before and after it is logged.
 * `history` must hold the record a logged load comes from.
 */
export function plannedLoad(
  loads: Profile['loads'],
  history: WorkoutRecord[],
  exerciseId: string,
  unit: Unit,
): (kg: number) => string {
  const rack = rackOf({ loads }, exerciseId);
  const typed = typedLoads(history, exerciseId);
  return (kg) => loadValue(kg, unit, rack, typed);
}

function loadText(kg: number, exerciseId: string, unit: Unit, text: string): string {
  // No recorded load is not the same claim as a movement that has no load.
  if (kg <= 0) return loadModeOf(exerciseId) === 'none' ? 'bodyweight' : 'no load yet';
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
  lead: boolean,
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
  const prescription = prescribeExercise(definition, profile, history, lead);
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
  const lead = leadCompoundId(adapted.exercises.map((exercise) => exercise.exerciseId));
  return {
    ...adapted,
    exercises: adapted.exercises.map((exercise) => {
      const hold = holdSeconds(exercise.exerciseId);
      if (hold !== null) return { ...exercise, weight: 0, targetReps: undefined };
      const numbers = numbersFor(exercise, profile, history, exercise.exerciseId === lead);
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
  const lead = leadCompoundId(adapted.exercises.map((exercise) => exercise.exerciseId));
  return adapted.exercises.map((exercise) => {
    const numbers = numbersFor(exercise, profile, history, exercise.exerciseId === lead);
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

function livePrescription(exerciseId: string, profile: Profile, history: WorkoutRecord[], lead: boolean) {
  if (holdSeconds(exerciseId) !== null) return null;
  const definition = exerciseById(exerciseId);
  return definition ? prescribeExercise(definition, profile, history, lead) : null;
}

/** One line of the "why this number" explanation, or null where none applies. `lead`: the day's first compound. */
export function targetReason(
  exerciseId: string,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
  lead = false,
): string | null {
  const prescription = livePrescription(exerciseId, profile, history, lead);
  return prescription && describePrescription(prescription, unit);
}

/** Today's short coach line from the same prescription, or null where none applies. */
export function targetCoachLine(
  exerciseId: string,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
  lead = false,
): string | null {
  const prescription = livePrescription(exerciseId, profile, history, lead);
  return prescription && coachLine(prescription, unit);
}

/** "3 sets · 8 reps · 18 kg each" for a catalog row: Today's numbers, no load until calibrated. */
export function catalogRowMeta(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
  unit: Unit,
  /** The day the row is read against (Plan passes the up-next slot), so the lead and its neighbours match Today. */
  dayIds: string[] = [],
): string {
  const hold = holdSeconds(exercise.id);
  const lead = leadCompoundId(dayIds);
  const prescription = prescribeExercise(exercise, profile, history, exercise.id === lead, lead !== undefined);
  const sets = exercise.id === lead ? prescription.sets : programExercise(exercise.id)?.sets ?? prescription.sets;
  const load =
    hold === null && prescription.weight > 0 ? ` · ${loadText(prescription.weight, exercise.id, unit, plannedLoad(profile.loads, history, exercise.id, unit)(prescription.weight))}` : '';
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
  /** The next load, when this very workout earned a load step; otherwise null. */
  earnedLoad: string | null;
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

  const lead = leadSlotIds(workout.exercises);
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
      ? `${done.length}/${required} sets · best ${setText(exerciseId, best.reps)} @ ${loadText(best.weight, exerciseId, unit, plannedLoad(profile.loads, history, exerciseId, unit)(best.weight))}`
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
        earnedLoad: null,
      };
    }

    const prescription = prescribeExercise(definition, profile, history, lead.includes(exerciseId));
    const nextLoad = plannedLoad(profile.loads, history, exerciseId, unit);
    const { min, max } = prescription.range;
    return {
      exerciseId,
      name,
      // The slot's own requirement in the range it was prescribed in, not the flagship's fixture.
      original: programExercise(exerciseId) ? `${required} × ${min}–${max}` : programTarget(exerciseId, presentedSets),
      adapted: `${presentedSets} ${presentedSets === 1 ? 'set' : 'sets'}`,
      performed,
      next: `${setText(exerciseId, prescription.reps)} @ ${loadText(prescription.weight, exerciseId, unit, nextLoad(prescription.weight))}`,
      reason: describePrescription(prescription, unit),
      earnedLoad:
        prescription.basis === 'load-increase' && prescription.last?.workoutId === workout.id
          ? loadText(prescription.weight, exerciseId, unit, nextLoad(prescription.weight))
          : null,
    };
  });
}

/**
 * The recap's one headline, strictly from records: a load step this workout
 * earned > a new best on the exact variant (heaviest load, then reps, against
 * every earlier completed session of that variant) > first session > fallback.
 */
export function recapHighlight(
  workout: WorkoutRecord,
  history: WorkoutRecord[],
  lines: ProgressionLine[],
  unit: Unit,
  profile?: Pick<Profile, 'loads'>,
): string {
  const earned = lines.find((line) => line.earnedLoad);
  if (earned) return `Next time: ${earned.earnedLoad} on ${earned.name}`;
  const start = Date.parse(workout.date);
  const prior = history.filter(
    (item) => item.id !== workout.id && item.status === 'completed' && Date.parse(item.date) < start,
  );
  for (const line of lines) {
    const today = bestCompletedSet(exerciseInWorkout(workout, line.exerciseId)?.done ?? []);
    const before = bestCompletedSet(
      prior.flatMap((item) => exerciseInWorkout(item, line.exerciseId)?.done ?? []),
    );
    if (
      today &&
      before &&
      (today.weight > before.weight || (today.weight === before.weight && today.reps > before.reps))
    ) {
      return `New best: ${setText(line.exerciseId, today.reps)} @ ${loadText(today.weight, line.exerciseId, unit, plannedLoad(profile?.loads ?? {}, history, line.exerciseId, unit)(today.weight))} on ${line.name}`;
    }
  }
  if (hasWork(workout) && !prior.some(hasWork)) return 'First session on the program';
  return 'Work recorded';
}
