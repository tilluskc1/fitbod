import type { AppState, MuscleGroup, PlanDay, Profile, SlotSkip, WorkoutRecord } from '../types.ts';
import type { Program, ProgramExercise } from '../data/flagship.ts';
import type { EquipmentChoice } from './adapt.ts';
import { detailOf, loadModeOf, programExercise } from '../data/flagship.ts';
import { EXERCISES, exerciseById } from '../data/exercises.ts';
import { buildPlan, generateWorkout } from './generator.ts';
import { leadCompoundId, REP_RANGES, roleTarget, savedSetup } from './progression.ts';
import { MAX_WEIGHT } from './validate.ts';
import { customDayName, worksSkipped } from './areas.ts';

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
  setup: EquipmentChoice = 'home',
): Program {
  const generated = generateWorkout(profile, { name: slot.name, focus: slot.focus }, slot.index, history, undefined, setup);
  const lead = leadCompoundId(generated.exercises.map((entry) => entry.exerciseId));
  const exercises: ProgramExercise[] = generated.exercises.map((entry) => {
    const catalog = exerciseById(entry.exerciseId);
    const known = programExercise(entry.exerciseId);
    const prescribed = entry.planned[0]?.reps ?? 10;
    const weight = entry.planned[0]?.weight ?? 0;
    const hold = known?.holdSeconds;
    // Same range prescribeExercise uses: the role's, or the program's own when it defines one.
    const range = hold ? { min: hold, max: hold }
      : catalog ? roleTarget(catalog, profile, entry.exerciseId === lead).range
      : REP_RANGES.compound;
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
    feasibility: generated.feasibility,
  };
}

/** The slot's day for a length chosen today: a longer one rebuilds the day there (#17); a shorter one is trimmed by adapt. */
export function slotProgramAt(profile: Profile, slot: PlanSlot, history: WorkoutRecord[], minutes?: number): Program {
  return slotProgram(minutes !== undefined && minutes > (profile.sessionMinutes ?? 35) ? { ...profile, sessionMinutes: minutes } : profile, slot, history);
}

/** The kit a today-only setup other than the saved one provides (#188). Bands have no catalog movements. */
const SETUP_KIT: Record<Exclude<EquipmentChoice, 'home'>, Pick<Profile, 'equipment' | 'support'>> = {
  hotel: { equipment: ['Dumbbell'], support: ['Bench'] },
  bodyweight: { equipment: [], support: [] },
  bands: { equipment: [], support: [] },
};

/** The profile as today's setup sees it: the saved kit, or that setup's own (#188, #193). */
export function kitProfile(profile: Profile, equipment: EquipmentChoice = 'home'): Profile {
  return equipment === 'home' ? profile : { ...profile, ...SETUP_KIT[equipment] };
}

/**
 * The profile with everything that works a skipped muscle group left out (#193), the same rule
 * a described day is built with and its in-session swaps are offered by (see `worksSkipped`).
 */
export function withSkipped(profile: Profile, skip: MuscleGroup[]): Profile {
  const spared = EXERCISES.filter((exercise) => worksSkipped(exercise, skip) && !profile.exclusions.includes(exercise.id));
  return spared.length === 0 ? profile : { ...profile, exclusions: [...profile.exclusions, ...spared.map((exercise) => exercise.id)] };
}

/**
 * Today's program for the slot (#188). Every setup builds at today's length the way
 * `slotProgramAt` does: a longer day is rebuilt there (#17), a shorter one keeps the saved length
 * and `adaptWorkout` trims it on the timer's model (#203). The saved setup keeps the saved day;
 * another setup rebuilds the day from that setup's kit, so it gets that kit's best work and its
 * own honest feasibility instead of what survives the saved day. The saved setup is the one
 * `defaultConstraints` picks (`savedSetup`): a no-gear profile's bodyweight day is its program.
 * A day the lifter described (#193: focus and skip) is generated from its own focus at today's
 * length, on whichever setup today has.
 */
export function todayProgram(
  profile: Profile,
  plannedSlot: PlanSlot,
  history: WorkoutRecord[],
  today: { minutes?: number; equipment?: EquipmentChoice; focus?: MuscleGroup[]; skip?: MuscleGroup[] } = {},
): Program {
  const saved = profile.sessionMinutes ?? 35;
  // A day the lifter described (#193) is generated like any other, from its own focus, at today's length.
  const skip = today.skip ?? [];
  const focus = today.focus?.filter((muscle) => !skip.includes(muscle)) ?? [];
  const custom = focus.length > 0;
  const slot = custom ? { ...plannedSlot, id: `${plannedSlot.id}-today`, name: customDayName(focus), focus } : plannedSlot;
  // A skipped muscle group stays out of the whole day, not just its focus: nothing that works it
  // is picked (see `worksSkipped`). Those are no exclusions of the lifter's, so none is offered back.
  const spared = custom ? withSkipped(profile, skip).exclusions.slice(profile.exclusions.length) : [];
  if (spared.length > 0) {
    const program = todayProgram(withSkipped(profile, skip), plannedSlot, history, { ...today, skip: [], focus });
    const feasibility = program.feasibility && {
      ...program.feasibility,
      alternatives: program.feasibility.alternatives.filter((alt) => !(alt.exerciseId && spared.includes(alt.exerciseId))),
    };
    return { ...program, feasibility };
  }
  // The saved setup (bodyweight for a profile with no gear) is the program, never a gear rebuild;
  // a described day on it is the lifter's own day, still untagged (#188 follow-up).
  if (!today.equipment || today.equipment === 'home' || today.equipment === savedSetup(profile)) {
    if (!custom) return slotProgramAt(profile, slot, history, today.minutes);
    const minutes = today.minutes ?? saved;
    return slotProgram(minutes === saved ? profile : { ...profile, sessionMinutes: minutes }, slot, history);
  }
  // A described day keeps today's length (#193); a rebuilt planned day is trimmed from the saved one.
  const minutes = custom ? today.minutes ?? saved : today.minutes !== undefined && today.minutes > saved ? today.minutes : saved;
  const kit = SETUP_KIT[today.equipment];
  const program = slotProgram({ ...profile, ...kit, sessionMinutes: minutes }, slot, history, today.equipment);
  // Gear chips would add to the saved setup, which today's gear does not change: the reason
  // already names what today's setup cannot train, and the gym sheet switches back.
  const feasibility = program.feasibility && {
    ...program.feasibility,
    alternatives: program.feasibility.alternatives.filter((alt) => alt.kind !== 'capability'),
  };
  return { ...program, feasibility, setup: today.equipment };
}

/**
 * The slot link a new session carries. A today-only described day (#193) carries none, so
 * finishing it records the session but cannot move the plan: the planned day stays next.
 */
export function slotLinkFor(state: AppState, custom: boolean): { slotId?: string; slotSeq?: number; planRevision: number } {
  const revision = planRevisionOf(state);
  if (custom) return { planRevision: revision };
  const cursor = state.programCursor;
  return {
    slotId: currentSlot(state)?.id,
    slotSeq: cursor && cursor.revision === revision ? cursor.seq : 0,
    planRevision: revision,
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
  if (!workout.exercises.some((exercise) => exercise.performed.some((set) => set.done))) return state;
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
/** Owned loads the loader would reject never reach state, so a reload cannot lock the app (#101). */
function withLoadableLoads(profile: Profile): Profile {
  const loads = Object.fromEntries(
    Object.entries(profile.loads).map(([equipment, kgs]) => [equipment, kgs?.filter((kg) => kg <= MAX_WEIGHT)]),
  );
  return { ...profile, loads };
}

export function revisePlan(state: AppState, input: Profile): AppState {
  const profile = withLoadableLoads(input);
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

/**
 * Settings that change the ordered slot list start a new plan revision. Other
 * edits (loads, minutes, goal …) shape prescriptions only, so the cursor stays.
 */
export function updateProfile(state: AppState, patch: Partial<Profile>): AppState {
  if (!state.profile) return state;
  const next = withLoadableLoads({ ...state.profile, ...patch });
  const slotList = (plan: PlanDay[]) => JSON.stringify(planSlots(plan));
  return slotList(state.plan) === slotList(buildPlan(next))
    ? { ...state, profile: next }
    : revisePlan(state, next);
}
