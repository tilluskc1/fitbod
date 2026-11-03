import type { AppState, MuscleGroup, PlanDay, Profile, SlotSkip, WorkoutRecord } from '../types.ts';
import type { Program, ProgramExercise } from '../data/flagship.ts';
import { detailOf, loadModeOf, programExercise } from '../data/flagship.ts';
import { exerciseById } from '../data/exercises.ts';
import { buildPlan, generateWorkout } from './generator.ts';
import { repRangeFor } from './progression.ts';

/**
 * The program sequence.
 *
 * A program is an ordered list of slots (A, B, C …). The cursor names the slot
 * the user is up to; it moves only on an explicit finish with work or an
 * explicit skip, never because a date passed. Live prescriptions come from the
 * configured plan and the user's recorded history, so a slot is the real day's
 * work rather than one fixture repeated.
 */

export interface PlanSlot {
  /** Stable across reloads for one plan revision: `slot-<index>-<slug>`. */
  id: string;
  index: number;
  name: string;
  focus: MuscleGroup[];
}

export interface ProgramCursor {
  revision: number;
  seq: number;
}

const MAX_SEQ = 1_000_000;

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'slot';

export function planSlots(plan: PlanDay[]): PlanSlot[] {
  return plan.map((day, index) => ({
    id: `slot-${index}-${slugOf(day.name)}`,
    index,
    name: day.name,
    focus: day.focus,
  }));
}

export function planRevisionOf(state: AppState): number {
  return state.planRevision ?? 0;
}

/**
 * The cursor clamped to the plan that is actually saved. A cursor written for
 * another revision (or no cursor at all) starts at the first slot instead of
 * pointing at a slot the current plan does not have.
 */
export function cursorFor(state: AppState): ProgramCursor {
  const revision = planRevisionOf(state);
  const cursor = state.programCursor;
  if (!cursor || cursor.revision !== revision) return { revision, seq: 0 };
  return { revision, seq: Math.max(0, Math.min(MAX_SEQ, Math.floor(cursor.seq))) };
}

export function nextSlotIndex(state: AppState): number {
  const total = state.plan.length;
  if (total === 0) return 0;
  return cursorFor(state).seq % total;
}

export function currentSlot(state: AppState): PlanSlot | null {
  return slotAt(state.plan, state.planRevision, state.programCursor);
}

/** Same rule as `currentSlot`, from the three saved pieces, for memoisation. */
export function slotAt(
  plan: PlanDay[],
  revision: number | undefined,
  cursor: ProgramCursor | null | undefined,
): PlanSlot | null {
  const slots = planSlots(plan);
  if (slots.length === 0) return null;
  const seq = cursor && cursor.revision === (revision ?? 0) ? Math.max(0, Math.floor(cursor.seq)) : 0;
  return slots[seq % slots.length];
}

/**
 * One slot's program: the exercises the configured plan day actually selects
 * for this user, with the loads and rep targets the progression policy derives
 * from their own completed sessions. Nothing here is a fixture, and nothing is
 * transferred between movements.
 */
export function slotProgram(
  profile: Profile,
  slot: PlanSlot,
  history: WorkoutRecord[],
): Program {
  const generated = generateWorkout(profile, { name: slot.name, focus: slot.focus }, slot.index, history);
  const exercises: ProgramExercise[] = generated.exercises.map((entry) => {
    const catalog = exerciseById(entry.exerciseId);
    const known = programExercise(entry.exerciseId);
    const prescribed = entry.planned[0]?.reps ?? 10;
    const weight = entry.planned[0]?.weight ?? 0;
    const hold = known?.holdSeconds;
    const range = hold ? { min: hold, max: hold } : repRangeFor(catalog?.pattern ?? 'horizontal_push');
    const reps = hold ?? prescribed;
    return {
      exerciseId: entry.exerciseId,
      name: entry.name,
      sets: entry.planned.length,
      repRange: [range.min, range.max],
      targetReps: Array.from({ length: entry.planned.length }, () => reps),
      holdSeconds: hold,
      weight,
      load: loadModeOf(entry.exerciseId),
      detail: detailOf(entry.exerciseId),
      // Generator already checked the saved equipment and support. Adapt only
      // excludes those movements when today's setup differs from home.
      requires: catalog?.needs.length === 0 ? 'bodyweight'
        : catalog?.equipment === 'Dumbbell' ? 'dumbbell' : 'configured',
    };
  });
  return {
    id: `${slot.id}-program`,
    name: slot.name,
    minutes: profile.sessionMinutes ?? 35,
    exercises,
  };
}

/**
 * Move past a finished slot. The cursor only ever moves forward, and only for a
 * session recorded under the plan that is still current, so a repeated finish,
 * a restored duplicate or a session started before a plan change cannot advance
 * the sequence twice or out of order.
 */
export function advanceAfterFinish(state: AppState, workout: WorkoutRecord): AppState {
  if (workout.slotSeq === undefined) return state;
  if (workout.planRevision !== undefined && workout.planRevision !== planRevisionOf(state)) return state;
  const cursor = cursorFor(state);
  const target = Math.min(MAX_SEQ, Math.max(0, Math.floor(workout.slotSeq)) + 1);
  if (target <= cursor.seq) return state;
  return { ...state, programCursor: { revision: cursor.revision, seq: target } };
}

/**
 * Skip the slot on offer. Exactly one slot moves per skip, the skip is recorded
 * as a skip (never a workout, never a set) and earns no progression. Repeating
 * the same skip for the same cursor position cannot log a second one.
 */
export function skipCurrentSlot(state: AppState, now: string, offered?: ProgramCursor): AppState {
  const cursor = cursorFor(state);
  if (state.current || (offered && (offered.revision !== cursor.revision || offered.seq !== cursor.seq))) return state;
  const slot = currentSlot(state);
  if (!slot) return state;
  const id = `skip:${cursor.revision}:${cursor.seq}`;
  const skips = state.slotSkips ?? [];
  const recorded = skips.some((skip) => skip.id === id);
  const entry: SlotSkip = {
    id,
    revision: cursor.revision,
    seq: cursor.seq,
    slotId: slot.id,
    at: now,
  };
  return {
    ...state,
    slotSkips: recorded ? skips : [...skips, entry],
    programCursor: { revision: cursor.revision, seq: Math.min(MAX_SEQ, cursor.seq + 1) },
  };
}

/**
 * A new plan (for example a different number of training days) starts a new
 * revision: the sequence restarts at its first slot, old skips stay with the old
 * plan, and an open session keeps every set it already logged.
 */
export function revisePlan(state: AppState, profile: Profile): AppState {
  const revision = planRevisionOf(state) + 1;
  return {
    ...state,
    profile,
    plan: buildPlan(profile),
    planRevision: revision,
    programCursor: { revision, seq: 0 },
    slotSkips: state.slotSkips ?? [],
  };
}

/** Settings that change future prescriptions start a new plan revision. */
export function updateProfile(state: AppState, patch: Partial<Profile>): AppState {
  if (!state.profile) return state;
  const next = { ...state.profile, ...patch };
  const planInputs = (profile: Profile) => JSON.stringify([
    profile.goal, profile.experience, profile.daysPerWeek, profile.equipment,
    profile.support, profile.exclusions, Object.entries(profile.loads).sort(),
    profile.sessionMinutes,
  ]);
  return planInputs(state.profile) === planInputs(next)
    ? { ...state, profile: next }
    : revisePlan(state, next);
}
