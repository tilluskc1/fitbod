import type { Exercise, Goal } from '../types.ts';
import { exerciseById } from '../data/exercises.ts';
import { isCompound, leadCompoundId } from './progression.ts';

/**
 * One time model for the rest timer and every minute the app promises (#132, #155).
 * Rest depends on the exercise's role in the day and, for the lead, the goal.
 */
export const REST_SECONDS = {
  lead: 150,
  strengthLead: 180,
  compound: 120,
  isolation: 75,
  core: 60,
} as const;

/** Under 30 minutes every role rests at the short end of its range (lead 120–180, compound 90–120, isolation 60–90). */
export const SHORT_REST_SECONDS = {
  lead: 120,
  strengthLead: 150,
  compound: 90,
  isolation: 60,
  core: 45,
} as const;

const isShort = (sessionMinutes?: number) => sessionMinutes !== undefined && sessionMinutes < 30;

/** Working time of one set. */
export const WORK_SECONDS = 35;
/** Setting up an exercise and moving on to the next. */
export const TRANSITION_SECONDS = 90;
/** General warm-up before the first working set, counted once per session: 5 min, 3 under 30 min. */
export const WARM_UP_SECONDS = 300;
export const SHORT_WARM_UP_SECONDS = 180;

/** The warm-up a session of this length allows for. */
export function warmUpSeconds(sessionMinutes?: number): number {
  return isShort(sessionMinutes) ? SHORT_WARM_UP_SECONDS : WARM_UP_SECONDS;
}

const CORE = new Set(['core_flexion', 'core_stability']);

/** Rest after a set of this exercise. `lead`: it holds the day's lead slot. */
export function restSecondsFor(
  exercise: Pick<Exercise, 'pattern' | 'muscles'>,
  lead: boolean,
  goal?: Goal,
  sessionMinutes?: number,
): number {
  const table = isShort(sessionMinutes) ? SHORT_REST_SECONDS : REST_SECONDS;
  if (lead) return goal === 'Get Stronger' ? table.strengthLead : table.lead;
  if (CORE.has(exercise.pattern)) return table.core;
  return isCompound(exercise) ? table.compound : table.isolation;
}

/** Rest per exercise of a session, in order; the lead is the first loaded compound. */
export function sessionRests(exerciseIds: string[], goal?: Goal, sessionMinutes?: number): number[] {
  const lead = leadCompoundId(exerciseIds);
  return exerciseIds.map((id) => {
    const exercise = exerciseById(id);
    return exercise ? restSecondsFor(exercise, id === lead, goal, sessionMinutes) : REST_SECONDS.isolation;
  });
}

/** One exercise: its sets of work, rest between them, and the move to the next. */
export function exerciseSeconds(sets: number, rest: number): number {
  if (sets <= 0) return 0;
  return sets * WORK_SECONDS + (sets - 1) * rest + TRANSITION_SECONDS;
}

/** A whole session, warm-up included. Empty work takes no time. */
export function sessionSeconds(items: { sets: number; rest: number }[], warmUp = WARM_UP_SECONDS): number {
  const work = items.reduce((sum, item) => sum + exerciseSeconds(item.sets, item.rest), 0);
  return work > 0 ? warmUp + work : 0;
}

/** "2:30" for 150 s, "90 s" under two minutes. */
export function restLabel(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
