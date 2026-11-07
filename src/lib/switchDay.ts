import type { AppState, Profile, WorkoutRecord } from '../types.ts';
import { adaptWorkout } from './adapt.ts';
import type { Constraints } from './adapt.ts';
import { currentSlot, cursorFor, planSlots, skipCurrentSlot, slotProgram } from './sequence.ts';

export interface SwitchOption {
  slotId: string;
  name: string;
  /** Forward skips needed to reach this day; 0 is the day already up next. */
  offset: number;
  /** Days skipped on the way, in order. */
  skips: string[];
  totalSets: number;
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
    const program = slotProgram(profile, slot, history);
    const adapted = adaptWorkout(program, constraints, profile.exclusions ?? []);
    const status: SwitchOption['status'] =
      adapted.totalSets === 0 || program.feasibility?.status === 'infeasible' ? 'none'
      : program.feasibility?.status === 'limited' ? 'limited'
      : 'ready';
    const skips = Array.from({ length: step }, (_, k) => slots[(start + k) % slots.length].name);
    return { slotId: slot.id, name: slot.name, offset: step, skips, totalSets: adapted.totalSets, status };
  });
}

/** Apply `offset` forward skips, each through the existing guarded skip. */
export function skipForward(state: AppState, offset: number, now: string): AppState {
  let next = state;
  for (let k = 0; k < offset; k += 1) next = skipCurrentSlot(next, now, cursorFor(next));
  return next;
}
