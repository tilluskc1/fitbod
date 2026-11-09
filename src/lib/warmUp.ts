import type { Equipment, Unit, WorkoutRecord } from '../types.ts';
import { leadCompoundId } from './progression.ts';
import { warmUpSeconds } from './sessionTime.ts';
import { toKg } from './units.ts';

/**
 * The warm-up shown at the top of a session (#300). Everything here is derived from the open
 * session and never stored: warm-up rows are not sets, so they change no sets, volume, minutes,
 * bests or next target. Checks live in memory for the session (see `warmUpChecks`).
 */

/** The general warm-up's minutes: the same budget the session's promised minutes already hold. */
export function generalWarmUpMinutes(sessionMinutes?: number): number {
  return Math.round(warmUpSeconds(sessionMinutes) / 60);
}

export const GENERAL_WARM_UP_TEXT = 'Easy cardio: treadmill walk or jog, bike or rower, enough to break a sweat.';

/** Two ramp sets before the lead's working sets: share of today's working load, and reps. */
export const RAMP_STEPS: readonly { share: number; reps: number }[] = [
  { share: 0.5, reps: 8 },
  { share: 0.75, reps: 3 },
];

/** The empty bar, by display unit: the floor for barbell ramps. */
const BAR: Record<Unit, number> = { kg: 20, lb: 45 };

/** Plate steps by display unit, for kit with no listed loads. */
const STEPS: Record<Unit, Partial<Record<Equipment, number>>> = {
  kg: { Barbell: 2.5, Dumbbell: 2.5, Kettlebell: 4, Machine: 5, Cable: 2.5 },
  lb: { Barbell: 5, Dumbbell: 5, Kettlebell: 5, Machine: 10, Cable: 5 },
};

export interface RampSet {
  /** Kilograms, like every stored load. */
  weight: number;
  reps: number;
}

const EPSILON = 0.001;

/**
 * Ramp sets for a working load, rounded to the kit's load steps: a listed rack's own loads,
 * otherwise plate steps in the lifter's unit. Rounding never goes past the working load; the
 * empty bar is the floor for a barbell and the lightest load for anything else. None when the
 * working load is at or below that floor, or the lift carries no load.
 */
export function rampSets(args: { equipment: Equipment; working: number; unit: Unit; rack?: number[] }): RampSet[] {
  const { equipment, working, unit } = args;
  if (equipment === 'Bodyweight' || !(working > 0)) return [];
  const rack = (args.rack ?? []).filter((load) => Number.isFinite(load) && load > 0).sort((a, b) => a - b);
  if (rack.length > 0 && equipment !== 'Barbell') {
    if (working <= rack[0] + EPSILON) return [];
    const under = rack.filter((load) => load <= working + EPSILON);
    return RAMP_STEPS.map(({ share, reps }) => ({ weight: nearest(under, working * share), reps }));
  }
  const step = STEPS[unit][equipment];
  if (!step) return [];
  // In the display unit, so a pound lifter's ramp reads in whole plates.
  const shown = unit === 'lb' ? working / toKg(1, 'lb') : working;
  const floor = equipment === 'Barbell' ? BAR[unit] : step;
  if (shown <= floor + EPSILON) return [];
  return RAMP_STEPS.map(({ share, reps }) => {
    const target = shown * share;
    let value = Math.round(target / step) * step;
    // Ties go down: a ramp set is never the heavier of two equal choices.
    if (Math.abs(value - target - step / 2) < EPSILON) value -= step;
    if (value > shown + EPSILON) value = Math.floor((shown + EPSILON) / step) * step;
    value = Math.max(floor, value);
    return { weight: unit === 'lb' ? toKg(value, 'lb') : value, reps };
  });
}

/** The listed load closest to `kg`, the lighter on a tie. */
function nearest(loads: number[], kg: number): number {
  return [...loads].sort((a, b) => Math.abs(a - kg) - Math.abs(b - kg) || a - b)[0];
}

/**
 * The session index whose exercise carries the ramp rows: the day's lead compound in session
 * order (its first segment), while none of its sets is logged. A swap before the first working
 * set moves the rows to the new lead; after it, the logged segment keeps the slot and nothing ramps.
 */
export function rampExerciseIndex(session: Pick<WorkoutRecord, 'exercises'>): number {
  const id = leadCompoundId(session.exercises.map((exercise) => exercise.exerciseId));
  if (id === undefined) return -1;
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === id);
  const lead = session.exercises[index];
  return lead.skipped || lead.performed.some((set) => set.done) ? -1 : index;
}

/** The general warm-up shows until the session's first set is logged (a started session never shows it). */
export function showsGeneralWarmUp(session: Pick<WorkoutRecord, 'exercises'>): boolean {
  return session.exercises.length > 0 && !session.exercises.some((exercise) => exercise.performed.some((set) => set.done));
}

export interface WarmUpChecks {
  general: boolean;
  /** When the optional timer started (ms), or null. */
  timerStartedAt: number | null;
  /** Ramp rows ticked, keyed `exerciseId:row`. */
  ramps: string[];
}

const checks = new Map<string, WarmUpChecks>();
const EMPTY: WarmUpChecks = { general: false, timerStartedAt: null, ramps: [] };

/** In memory only: a reload starts the warm-up again, and nothing reaches the stored record. */
export function warmUpChecks(sessionId: string): WarmUpChecks {
  return checks.get(sessionId) ?? EMPTY;
}

export function setWarmUpChecks(sessionId: string, next: WarmUpChecks): void {
  checks.set(sessionId, next);
}
