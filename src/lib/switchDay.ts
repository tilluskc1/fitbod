import type { AppState, Profile, WorkoutRecord } from '../types.ts';
import { adaptWorkout, todayGlance } from './adapt.ts';
import type { Constraints } from './adapt.ts';
import { defaultConstraints } from './constraints.ts';
import { currentSlot, cursorFor, planSlots, skipCurrentSlot, slotProgram, todayProgram } from './sequence.ts';
import type { PlanSlot } from './sequence.ts';

export interface SwitchOption {
  slotId: string;
  name: string;
  /** Forward skips needed to reach this day; 0 is the day already up next. */
  offset: number;
  /** Days skipped on the way, in order. */
  skips: string[];
  totalSets: number;
  /** The day's minutes under today's constraints, by the timer's model (#203). */
  minutes: number;
  approx: boolean;
  status: 'ready' | 'limited' | 'none';
}

/**
 * (#150) Every day in the split with what it holds under today's constraints.
 * Reaching a later day uses the existing forward skip once per day in between,
 * so the record says truthfully which days were skipped.
 */
export function switchOptions(
  profile: Profile,
  state: Pick<AppState, 'plan' | 'planRevision' | 'programCursor'>,
  history: WorkoutRecord[],
  constraints: Constraints,
): SwitchOption[] {
  const slots = planSlots(state.plan);
  const here = currentSlot(state as AppState);
  if (!here || slots.length === 0) return [];
  const start = slots.findIndex((slot) => slot.id === here.id);
  return slots.map((_, step) => {
    const slot = slots[(start + step) % slots.length];
    // Built at today's length, as Today builds it, so the sheet and Today agree (#203). The saved
    // setup rates the saved day; another setup rates the day it rebuilds from its kit (#188).
    const program = todayProgram(profile, slot, history, constraints);
    const adapted = adaptWorkout(program, constraints, profile.exclusions ?? [], profile.goal, profile);
    const status: SwitchOption['status'] =
      adapted.totalSets === 0 || program.feasibility?.status === 'infeasible' ? 'none'
      : program.feasibility?.status === 'limited' ? 'limited'
      : 'ready';
    const skips = Array.from({ length: step }, (_, k) => slots[(start + k) % slots.length].name);
    const { minutes, approx } = todayGlance(adapted, null, false, profile.goal, profile);
    return { slotId: slot.id, name: slot.name, offset: step, skips, totalSets: adapted.totalSets, minutes, approx, status };
  });
}

/** A later day of the plan, as Plan lists it. */
export interface UpcomingDay {
  id: string;
  name: string;
  focus: string[];
  exercises: number;
  sets: number;
  minutes: number;
  approx: boolean;
  status?: 'ok' | 'limited' | 'infeasible';
}

/**
 * Plan: the rest of the week after `slot`, each day built and priced as it will run on its own day,
 * with the saved setup and length, so it reads what Today will read once it is up next (#186, #203).
 */
export function upcomingDays(profile: Profile, plan: AppState['plan'], slot: PlanSlot, history: WorkoutRecord[]): UpcomingDay[] {
  const slots = planSlots(plan);
  return slots.map((_, k) => slots[(slot.index + k) % slots.length]).slice(1).map((day) => {
    const built = slotProgram(profile, day, history);
    const glance = todayGlance(adaptWorkout(built, defaultConstraints(profile), profile.exclusions ?? [], profile.goal, profile), null, false, profile.goal, profile);
    return {
      id: day.id,
      name: day.name,
      focus: day.focus,
      exercises: glance.exercises,
      sets: glance.sets,
      minutes: glance.minutes,
      approx: glance.approx,
      status: built.feasibility?.status,
    };
  });
}

/** Apply `offset` forward skips, each through the existing guarded skip. */
export function skipForward(state: AppState, offset: number, now: string): AppState {
  let next = state;
  for (let k = 0; k < offset; k += 1) next = skipCurrentSlot(next, now, cursorFor(next));
  return next;
}
