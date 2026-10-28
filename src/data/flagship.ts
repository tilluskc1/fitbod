/**
 * The programmed workout the flagship flow runs on.
 *
 * One module, one source of truth: Today, Adjust, Review and the active
 * workout all read these exact values, so no screen can invent its own
 * exercises, sets, reps or loads. Records live in `AppState`; nothing here is
 * ever overwritten by logging.
 */

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
  requires: 'dumbbell' | 'bodyweight';
}

export interface Program {
  id: string;
  name: string;
  minutes: number;
  exercises: ProgramExercise[];
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
 * The last completed floor-press session in the sample program. Real records
 * take precedence; this keeps the first-run screens honest and concrete.
 */
export interface SessionSummary {
  reps: number[];
  weight: number;
}

export const LAST_SESSIONS: Record<string, SessionSummary> = {
  'dumbbell-floor-press': { reps: [9, 9, 8], weight: 15 },
};

export function programSetCount(program: Program): number {
  return program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
}

/** "15 kg each" / "18 kg total" / "Bodyweight". */
export function loadLabel(exercise: Pick<ProgramExercise, 'weight' | 'load'>): string {
  if (exercise.load === 'none' || exercise.weight <= 0) return 'Bodyweight';
  return `${exercise.weight} kg ${exercise.load}`;
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
): string {
  const reps = exercise.holdSeconds
    ? `${exercise.holdSeconds}s`
    : exercise.targetReps
      ? repLabel(exercise, count)
      : `${repLabel(exercise, count)} reps`;
  return exercise.weight > 0 ? `${reps} @ ${loadLabel(exercise)}` : reps;
}

export function programExercise(exerciseId: string): ProgramExercise | undefined {
  return FULL_BODY_A.exercises.find((exercise) => exercise.exerciseId === exerciseId);
}

/**
 * "9 · 9 · 9" when the program carries per-set targets, "8–10 reps" when it
 * prescribes a range. A range must never collapse to its low bound on screen.
 */
export function repsTarget(exerciseId: string, count: number): string | null {
  const program = programExercise(exerciseId);
  if (!program) return null;
  if (program.holdSeconds) return `${program.holdSeconds}s`;
  if (program.targetReps) return program.targetReps.slice(0, count).join(' · ');
  return `${program.repRange[0]}–${program.repRange[1]} reps`;
}

/** "3 sets · 8–10 reps · 15 kg each" for a workout row. */
export function exerciseMeta(
  exercise: ProgramExercise,
  count = exercise.sets,
  includeSets = true,
): string {
  const sets = `${count} ${count === 1 ? 'set' : 'sets'}`;
  const reps = exercise.holdSeconds
    ? `${exercise.holdSeconds}s hold`
    : exercise.targetReps
      ? repLabel(exercise, count)
      : `${repLabel(exercise, count)} reps`;
  // Targets read "9 · 9 @ 15 kg each"; ranges read "8–10 reps · 18 kg total".
  const load =
    exercise.weight > 0 ? `${exercise.targetReps ? ' @ ' : ' · '}${loadLabel(exercise)}` : '';
  return includeSets ? `${sets} · ${reps}${load}` : `${reps}${load}`;
}
