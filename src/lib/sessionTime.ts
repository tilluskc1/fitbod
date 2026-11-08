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

/** At 30 minutes or less every role rests at the short end of its range (lead 120–180, compound 90–120, isolation 60–90; #229). */
export const SHORT_REST_SECONDS = {
  lead: 120,
  strengthLead: 150,
  compound: 90,
  isolation: 60,
  core: 45,
} as const;

const isShort = (sessionMinutes?: number) => sessionMinutes !== undefined && sessionMinutes <= 30;

/** Working time of one set. */
export const WORK_SECONDS = 35;
/** Setting up an exercise and moving on to the next. */
export const TRANSITION_SECONDS = 90;
/** General warm-up before the first working set, counted once per session: 5 min, 3 at 30 min or less. */
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

/** Under this many minutes no movement takes more than `SHORT_SESSION_MAX_SETS` (#229). */
export const SHORT_SESSION_MINUTES = 45;
export const SHORT_SESSION_MAX_SETS = 3;

/** The lead's floor when a day is fitted: 3 sets, 2 under 30 minutes so a four-movement day still fits (#132, #229). */
export function leadFloorSets(sessionMinutes: number): number {
  return sessionMinutes < 30 ? 2 : 3;
}

/** One movement as `fitSets` sees it. */
export interface FitItem {
  sets: number;
  rest: number;
  /** A timed hold: its floor is one set. */
  hold?: boolean;
  /** The day's lead: no other movement ends with more sets. */
  lead?: boolean;
  /** Dropped last (a day requirement's only cover); never dropped unless `keepIsSoft`. */
  keep?: boolean;
  /** The movement pattern, for `twoPresses`. */
  pattern?: string;
}

/**
 * Fits a day to a budget on the timer's own clock (#203, #229), the one rule a saved length and a
 * today-only length both use. Each movement starts at its own sets, at most `cap`. Over the budget,
 * every movement goes to its floor (2 sets, 1 on a hold, `leadFloor` on the lead); still over, whole movements drop in
 * `dropOrder` (a kept one only after the rest, and only when `keepIsSoft`; never below `minCount`). Then sets come back one per movement per
 * pass, in reverse drop order, while the day fits (after `twoPresses`, below): up to each movement's own count and `cap`, and
 * never past the lead's (#133). Returns the set counts; 0 means dropped.
 */
export function fitSets(
  items: FitItem[],
  dropOrder: number[],
  budget: number,
  warmUp: number,
  {
    cap = Infinity,
    minCount = 1,
    leadFloor = 2,
    keepIsSoft = false,
    twoPresses = false,
  }: { cap?: number; minCount?: number; leadFloor?: number; keepIsSoft?: boolean; twoPresses?: boolean } = {},
): number[] {
  const most = items.map((item) => Math.min(item.sets, cap));
  const sets = [...most];
  const seconds = () => sessionSeconds(items.map((item, index) => ({ sets: sets[index], rest: item.rest })), warmUp);
  const floor = (item: FitItem) => (item.hold ? 1 : item.lead ? leadFloor : 2);
  if (seconds() > budget) items.forEach((item, index) => { sets[index] = Math.min(sets[index], floor(item)); });
  // Kept movements go last, and only when `keepIsSoft`: a today-only length must fit its minutes.
  const passes = keepIsSoft ? [false, true] : [false];
  for (const dropKept of passes) for (const index of dropOrder) {
    if (seconds() <= budget || sets.filter((count) => count > 0).length <= minCount) break;
    if (!items[index].keep || dropKept) sets[index] = 0;
  }
  // `twoPresses`: a day that pulls keeps at most two presses; a third goes in drop order and its time
  // goes back to the rest (#131, #229). A Push day is all presses and keeps them.
  const live = (test: RegExp) => items.map((_, index) => index).filter((index) => sets[index] > 0 && test.test(items[index].pattern ?? ''));
  if (twoPresses && live(/_pull$/).length > 0) {
    for (const index of dropOrder) {
      if (live(/_push$/).length <= 2 || sets.filter((count) => count > 0).length <= minCount) break;
      if (sets[index] > 0 && /_push$/.test(items[index].pattern ?? '') && !items[index].lead && !items[index].keep) sets[index] = 0;
    }
  }
  const lead = items.findIndex((item, index) => item.lead && sets[index] > 0);
  const refill = [...dropOrder].reverse().filter((index) => sets[index] > 0);
  for (let added = true; added; ) {
    added = false;
    for (const index of refill) {
      const limit = lead < 0 || index === lead ? most[index] : Math.min(most[index], sets[lead]);
      if (sets[index] >= limit) continue;
      sets[index] += 1;
      if (seconds() > budget) sets[index] -= 1;
      else added = true;
    }
  }
  return sets;
}

/** "2:30" for 150 s, "90 s" under two minutes. */
export function restLabel(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
