import type { Program, ProgramExercise } from '../data/flagship.ts';
import { exerciseById } from '../data/exercises.ts';
import { FULL_BODY_A, HOME_DUMBBELLS, HOTEL_DUMBBELLS, loadModeOf, detailOf } from '../data/flagship.ts';
import type { Exercise, Goal, Profile, WorkoutExercise, WorkoutRecord } from '../types.ts';
import { latestDoneSet } from './session.ts';
import type { SwapCandidate } from './session.ts';
import { isCompound, leadCompoundId, prescribeExercise, repRangeFor } from './progression.ts';
import { estimatedSeconds } from './generator.ts';
import { sessionRests } from './sessionTime.ts';
import { liveExercises } from './liveProgression.ts';

/**
 * The deterministic plan engine.
 *
 * It takes the programmed workout plus today's constraints and returns the
 * version that fits. It is a plain function: no model call, no randomness, and
 * no new numbers. Exercises, loads and per-set rep targets only ever come from
 * the program; the engine's whole job is deciding what to leave out.
 */

export type EquipmentChoice = 'home' | 'hotel' | 'bodyweight' | 'bands';

export interface EquipmentOption {
  label: string;
  /** Short chip label, sentence case. */
  chip: string;
  /** Compact label for the Today hero line. */
  short: string;
  detail: string;
  /** Loads the user can actually select with this setup. */
  loads: number[];
  /** Whether the setup has any external load at all. */
  allowsLoads: boolean;
}

export const EQUIPMENT_OPTIONS: Record<EquipmentChoice, EquipmentOption> = {
  home: {
    label: 'Home setup',
    chip: 'Home setup',
    short: 'Home',
    // Shown only while the rack is unconfirmed; the logger then takes typed loads.
    detail: 'Your dumbbells: not confirmed — enter weights as you lift',
    loads: HOME_DUMBBELLS,
    allowsLoads: true,
  },
  // Stored as 'hotel'; shown as a travel gym so it is not mistaken for the user's own gym (#180).
  hotel: {
    label: 'Travel gym',
    chip: 'Travel gym',
    short: 'Travel',
    detail: 'Small hotel or travel gym: dumbbells up to 25 kg',
    loads: HOTEL_DUMBBELLS,
    allowsLoads: true,
  },
  bodyweight: {
    label: 'Bodyweight only',
    chip: 'Bodyweight',
    short: 'Bodyweight',
    detail: 'No external load',
    loads: [],
    allowsLoads: false,
  },
  bands: {
    label: 'Resistance bands',
    chip: 'Resistance bands',
    short: 'Bands',
    detail: 'Bands only',
    loads: [],
    allowsLoads: false,
  },
};

/** A saved kit with a barbell and machines or cables is a gym, not a home setup (#180). */
export function isGymKit(profile: Pick<Profile, 'equipment'>): boolean {
  return profile.equipment.includes('Barbell')
    && (profile.equipment.includes('Machine') || profile.equipment.includes('Cable'));
}

/**
 * The option as the user should read it. The saved setup ('home') is the user's own gear, so a
 * full-gym kit is named "Your gym" instead of "Home setup". The stored choice stays 'home'.
 */
export function setupFor(choice: EquipmentChoice, profile?: Pick<Profile, 'equipment'> | null): EquipmentOption {
  const base = EQUIPMENT_OPTIONS[choice];
  if (choice !== 'home' || !profile || !isGymKit(profile)) return base;
  return { ...base, label: 'Your gym', chip: 'Your gym', short: 'Gym', detail: 'Your gym: enter weights as you lift' };
}

export interface Constraints {
  minutes: number;
  equipment: EquipmentChoice;
  /**
   * Loads confirmed for this setup, canonical kg per hand. Undefined means the
   * inventory is unconfirmed, so fixture racks are only a suggestion.
   */
  loads?: number[];
}

export const DEFAULT_CONSTRAINTS: Constraints = { minutes: FULL_BODY_A.minutes, equipment: 'home' };

export interface AdaptedExercise extends ProgramExercise {
  /** Sets left after fitting the time budget. */
  sets: number;
  /** Per-set rep targets for the kept sets. */
  targetReps?: number[];
  originalSets: number;
  /** Program load before a confirmed rack re-targeted it. */
  originalWeight?: number;
}

export interface SkippedExercise {
  exerciseId: string;
  name: string;
  /** Sets that were in the program. */
  sets: number;
  reason: 'time' | 'equipment' | 'excluded';
}

export interface AdaptedWorkout {
  programId: string;
  name: string;
  minutes: number;
  /** Set when the request exceeded what the program holds: asked vs applied. */
  cappedMinutes: { asked: number; applied: number } | null;
  originalMinutes: number;
  exercises: AdaptedExercise[];
  skipped: SkippedExercise[];
  totalSets: number;
  originalSets: number;
  /** Factual sentence shown under "Coach note". No readiness scores. */
  note: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Sets that fit the available minutes, derived from the program's own density
 * (11 sets in 35 minutes). 20 minutes therefore fits 6 sets, 30 fits 9, and 35
 * leaves the program untouched.
 */
export function setBudget(program: Program, minutes: number): number {
  const total = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  if (total === 0) return 0;
  return clamp(Math.round((total * minutes) / program.minutes), 1, total);
}

/**
 * Inverse of setBudget: what the work that survived the constraints takes.
 * Two sets left of an 35-minute program is not a 35-minute session.
 */
export function estimatedMinutes(program: Program, sets: number): number {
  const total = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  if (total === 0 || sets === 0) return 0;
  return Math.max(1, Math.round((program.minutes * sets) / total));
}

/**
 * Minutes these exercises take, warm-up included, by the generator's own time model (#132).
 * With a goal and session length, rests and warm-up are the ones the timer runs.
 */
export function workMinutes(exercises: { exerciseId: string; sets: number }[], goal?: Goal, sessionMinutes?: number): number {
  const live = exercises.filter((exercise) => exercise.sets > 0);
  if (live.length === 0) return 0;
  const rests = sessionRests(live.map((exercise) => exercise.exerciseId), goal, sessionMinutes);
  return Math.max(1, Math.round(estimatedSeconds(live.map((exercise) => exercise.sets), rests, sessionMinutes) / 60));
}

/** Today's day at a glance: the running session, else today's adapted day (#189). */
export interface DayGlance {
  name: string;
  exercises: number;
  sets: number;
  minutes: number;
  /** The work cannot fill the asked length; screens prefix the minutes with ≈. */
  approx: boolean;
  /** A today-only change applies and no session has started ("Adjusted for today"). */
  adjusted: boolean;
}

/**
 * The one source for every surface that names a day's minutes: Today, Plan (today and later days),
 * View session, Coach, the switch and gym sheets and the review (#203).
 * Minutes are the work's own time, with the rests the timer will run for this goal and length.
 * A running session is priced from itself alone (its exercises, planned sets and the length it
 * was started at), so Start, a later settings change or a new slot cannot move it (#200).
 */
export function todayGlance(adapted: AdaptedWorkout, current: WorkoutRecord | null, overridden = false, goal?: Goal): DayGlance {
  const asked = current ? current.durationMin : adapted.minutes;
  const work = current
    ? current.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, sets: exercise.planned.length }))
    : adapted.exercises;
  const minutes = workMinutes(work, goal, asked);
  return {
    name: current?.name ?? adapted.name,
    exercises: work.length,
    sets: work.reduce((sum, exercise) => sum + exercise.sets, 0),
    minutes,
    // ≈ when the work cannot come close to the length asked for; unknown length, no ≈.
    approx: asked !== undefined && minutes < asked * 0.5,
    adjusted: overridden && !current,
  };
}

export function adaptWorkout(
  program: Program = FULL_BODY_A,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  excluded: string[] = [],
): AdaptedWorkout {
  const minutes = clamp(Math.round(constraints.minutes), 10, 120);
  const setup = EQUIPMENT_OPTIONS[constraints.equipment] ?? EQUIPMENT_OPTIONS.home;
  // The saved rack is a home rack: it must not cap a hotel gym or a
  // bodyweight session the user asked for.
  const inventory = setup.allowsLoads && constraints.equipment === 'home'
    ? (constraints.loads ?? []).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
    : [];
  const knownInventory = inventory.length > 0;
  const limited: { name: string; from: number; to: number }[] = [];
  const skipped: SkippedExercise[] = [];
  const exercises: AdaptedExercise[] = [];
  const originalSets = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);

  // 1. Equipment first: a movement that needs a load the user does not have is
  //    dropped, never re-loaded with a number from somewhere else.
  for (const exercise of program.exercises) {
    if (excluded.includes(exercise.exerciseId)) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.sets,
        reason: 'excluded',
      });
      continue;
    }
    // A confirmed inventory decides what is usable: any owned load can be
    // re-targeted below, so only a setup with no external load rules a
    // movement out. An unconfirmed home rack is typed as lifted, so no fixture
    // judges it; a hotel gym keeps its own rack check.
    const unusable =
      (exercise.requires === 'dumbbell' && !setup.allowsLoads) ||
      (exercise.requires === 'configured' && constraints.equipment !== 'home') ||
      (exercise.requires !== 'configured' && exercise.weight > 0 && !knownInventory && constraints.equipment !== 'home' && !setup.loads.includes(exercise.weight));
    if (unusable) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.sets,
        reason: 'equipment',
      });
      continue;
    }
    // Never invent a weight: an owned load at or below the program's own is the
    // only substitution, and it is reported so the review can say so.
    let weight = exercise.weight;
    if (exercise.requires === 'dumbbell' && knownInventory && weight > 0 && !inventory.includes(weight)) {
      const below = inventory.filter((value) => value < weight).at(-1);
      const substitute = below ?? inventory[0];
      limited.push({ name: exercise.name, from: weight, to: substitute });
      weight = substitute;
    }
    exercises.push({
      ...exercise,
      weight,
      originalWeight: exercise.weight,
      sets: exercise.sets,
      targetReps: exercise.targetReps?.slice(0, exercise.sets),
      originalSets: exercise.sets,
    });
  }

  // Today's setup dropped the lead: the next compound takes over its sets.
  const lead = program.exercises.find((exercise) => exercise.exerciseId === leadCompoundId(program.exercises.map((item) => item.exerciseId)));
  const heir = exercises.find((exercise) => exercise.exerciseId === leadCompoundId(exercises.map((item) => item.exerciseId)));
  if (lead && heir && heir.exerciseId !== lead.exerciseId) {
    heir.sets = lead.sets;
    heir.originalSets = lead.sets;
    const reps = heir.targetReps?.[0];
    if (reps !== undefined) heir.targetReps = Array.from({ length: lead.sets }, () => reps);
  }

  let total = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const budget = setBudget(program, minutes);

  // Trim order: isolation first, then other compounds, the lead compound last;
  // within a role, the later movement in the session goes first.
  const leadId = leadCompoundId(exercises.map((exercise) => exercise.exerciseId));
  const role = (exercise: AdaptedExercise): number => {
    if (exercise.exerciseId === leadId) return 2;
    const catalog = exerciseById(exercise.exerciseId);
    return catalog && isCompound(catalog) ? 1 : 0;
  };
  const trimOrder = exercises
    .map((exercise, index) => ({ exercise, index }))
    .sort((a, b) => role(a.exercise) - role(b.exercise) || b.index - a.index)
    .map((entry) => entry.exercise);

  // 2. Trim sets in that order, keeping at least two working sets on a lift
  //    and one on a hold.
  for (const exercise of trimOrder) {
    if (total <= budget) break;
    const floor = exercise.holdSeconds ? 1 : 2;
    while (exercise.sets > floor && total > budget) {
      exercise.sets -= 1;
      total -= 1;
    }
  }

  // 3. Still over: drop whole movements in the same order, never the last one.
  while (total > budget) {
    const active = trimOrder.filter((exercise) => exercise.sets > 0);
    if (active.length <= 1) break;
    const first = active[0];
    total -= first.sets;
    first.sets = 0;
  }

  for (const exercise of exercises) {
    exercise.targetReps = exercise.targetReps?.slice(0, exercise.sets);
  }

  // 4. Anything reduced to nothing was dropped to fit the time, so the review
  //    screen can say what went and why.
  const kept = exercises.filter((exercise) => exercise.sets > 0);
  for (const exercise of exercises) {
    if (exercise.sets === 0) {
      skipped.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.originalSets,
        reason: 'time',
      });
    }
  }

  // Core accessories alone do not make a configured Push/Pull/Legs session.
  // Leave the slot unstartable when today's setup removes all main movements.
  const isCore = (exerciseId: string) => exerciseById(exerciseId)?.muscles[0] === 'Core';
  if (program.id.startsWith('slot-') && kept.length > 0 &&
      program.exercises.some((exercise) => !isCore(exercise.exerciseId)) &&
      kept.every((exercise) => isCore(exercise.exerciseId))) {
    return {
      programId: program.id,
      name: program.name,
      minutes,
      originalMinutes: program.minutes,
      exercises: [],
      skipped,
      cappedMinutes: null,
      totalSets: 0,
      originalSets,
      note: `This slot has no main movement with ${setup.chip.toLowerCase()}. Use the required equipment or skip it.`,
    };
  }

  const totalSets = kept.reduce((sum, exercise) => sum + exercise.sets, 0);
  const trimmedSets = kept.some((exercise) => exercise.sets < exercise.originalSets);
  const forTime = skipped.filter((item) => item.reason === 'time');
  const forEquipment = skipped.filter((item) => item.reason === 'equipment');
  const timeTrimmed = trimmedSets || forTime.length > 0;
  // The program is the ceiling: a request above its own minutes cannot add
  // work, so cap the label at what the surviving sets take. Requests at or
  // under the program (the trimming direction) keep their label unchanged.
  // shortcut: with a movement skipped, 35 min still reads 35 while 36+ reads what the work takes;
  // labelling the at-or-under direction honestly too is #141.
  const capped = totalSets > 0 && minutes > program.minutes;
  const appliedMinutes = capped ? estimatedMinutes(program, totalSets) : minutes;

  let note: string;
  if (kept.length === 0) {
    note = `None of this workout can be done with ${setup.chip.toLowerCase()}.`;
  } else if (!timeTrimmed) {
    note = 'Same exercises, weights and sets as your program.';
  } else {
    note = `Volume trimmed to ${totalSets} ${totalSets === 1 ? 'set' : 'sets'} to fit ${minutes} min.`;
    if (forTime.length > 0) {
      note += ` ${listOf(forTime.map((item) => item.name))} skipped to fit ${minutes} min.`;
    }
  }
  if (forEquipment.length > 0) {
    note += ` ${listOf(forEquipment.map((item) => item.name))} need${forEquipment.length === 1 ? 's' : ''} a load that is not available today.`;
  }
  if (limited.length > 0) {
    const loads = [...new Set(limited.map((item) => item.to))].sort((a, b) => a - b);
    note += ` ${listOf(limited.map((item) => item.name))} use${limited.length === 1 ? 's' : ''} ${loads.join(' / ')} kg — the closest of your confirmed loads, not your program's.`;
  }
  const forExcluded = skipped.filter((item) => item.reason === 'excluded');
  if (forExcluded.length > 0) {
    note += ` ${listOf(forExcluded.map((item) => item.name))} excluded in your library.`;
  }

  return {
    programId: program.id,
    name: program.name,
    minutes: appliedMinutes,
    cappedMinutes: capped ? { asked: minutes, applied: appliedMinutes } : null,
    originalMinutes: program.minutes,
    exercises: kept,
    skipped,
    totalSets,
    originalSets,
    note,
  };
}

/**
 * The adapted version expressed as the session model the logger already uses.
 * Per-set weights and rep targets are copied straight from the program.
 */
export function toWorkoutExercises(adapted: AdaptedWorkout): WorkoutExercise[] {
  return adapted.exercises.map((exercise) => {
    const planned = Array.from({ length: exercise.sets }, (_, index) => ({
      weight: exercise.weight,
      reps: exercise.targetReps?.[index] ?? exercise.holdSeconds ?? exercise.repRange[0],
    }));
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
 * What a swap target prescribes for the remaining work. The open session's
 * logged values win; otherwise the history-derived prescription Today shows,
 * and a hold keeps its programmed seconds.
 */
export function swapCandidateFor(
  target: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
  session: WorkoutRecord | null,
  /** The swapped exercise holds the day's lead slot (see `leadSlotIds`). */
  lead = false,
): SwapCandidate {
  const open = session ? latestDoneSet(session, target.id) : null;
  if (open) {
    return { exerciseId: target.id, name: target.name, weight: open.weight, reps: open.reps };
  }
  const hold = FULL_BODY_A.exercises.find((exercise) => exercise.exerciseId === target.id)?.holdSeconds;
  if (hold) return { exerciseId: target.id, name: target.name, weight: 0, reps: hold };
  const prescription = prescribeExercise(target, profile, history, lead);
  return {
    exerciseId: target.id,
    name: target.name,
    weight: prescription.weight,
    reps: prescription.reps,
  };
}

/**
 * Weights the logger may offer. At home only the confirmed rack, never the
 * example one: with nothing confirmed the logger takes a typed load instead.
 */
export function loadOptions(equipment: EquipmentChoice, inventory?: number[]): number[] {
  // A hotel gym's rack is the gym's, not the user's home rack.
  if (equipment === 'home') return confirmedLoads(equipment, inventory);
  return EQUIPMENT_OPTIONS[equipment]?.loads ?? [];
}

/** Only the loads the user confirmed for this setup; never the example rack. */
export function confirmedLoads(equipment: EquipmentChoice, inventory?: number[]): number[] {
  if (!EQUIPMENT_OPTIONS[equipment]?.allowsLoads || equipment !== 'home') return [];
  return (inventory ?? []).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
}


/** Display the prescription actually accepted by the open session. */
export function currentWorkout(adapted: AdaptedWorkout, session: WorkoutRecord): AdaptedWorkout {
  const exercises: AdaptedExercise[] = session.exercises.map((entry) => {
    const source = FULL_BODY_A.exercises.find((exercise) => exercise.exerciseId === entry.exerciseId);
    const catalog = exerciseById(entry.exerciseId);
    const dumbbell = catalog?.equipment === 'Dumbbell';
    const reps = entry.planned.map((set) => set.reps);
    const range = catalog ? repRangeFor(catalog) : null;
    return {
      exerciseId: entry.exerciseId,
      name: entry.name,
      sets: entry.planned.length,
      originalSets: entry.originalPlannedSets ?? entry.planned.length,
      // Not displayed (targetReps carry the accepted reps); without a profile the lead's range is unknown here.
      repRange: source?.repRange ?? (range ? [range.min, range.max] : [reps[0] ?? 0, reps[0] ?? 0]),
      targetReps: reps,
      holdSeconds: source?.holdSeconds ? reps[0] : undefined,
      weight: entry.planned[0]?.weight ?? 0,
      originalWeight: entry.planned[0]?.weight ?? 0,
      load: loadModeOf(entry.exerciseId),
      detail: detailOf(entry.exerciseId),
      requires: dumbbell ? 'dumbbell' : 'bodyweight',
    };
  });
  return {
    ...adapted,
    name: session.name,
    minutes: session.durationMin ?? adapted.minutes,
    exercises,
    totalSets: exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
    skipped: adapted.skipped.filter((item) => !exercises.some((exercise) => exercise.exerciseId === item.exerciseId)),
  };
}

/**
 * Undo a temporary adaptation without replacing work already completed. With a
 * profile, pending sets carry the history-derived prescription, not the fixture.
 */
export function restorePendingWorkout(
  session: WorkoutRecord,
  original: AdaptedWorkout,
  profile?: Profile | null,
  history: WorkoutRecord[] = [],
): WorkoutRecord {
  const pattern = (id: string) => exerciseById(id)?.pattern ?? id;
  const completed = session.exercises.flatMap((exercise) => {
    const indices = exercise.performed.flatMap((set, index) => set.done ? [index] : []);
    return indices.length > 0 ? [{
      ...exercise,
      planned: indices.map((index) => ({ ...exercise.planned[index] })),
      performed: indices.map((index) => ({ ...exercise.performed[index] })),
    }] : [];
  });
  const kept = new Set<WorkoutExercise>();
  const exercises: WorkoutExercise[] = [];
  // shortcut: flagship has one slot per primary pattern; add slot identity before multi-slot programs.
  for (const prescribed of profile ? liveExercises(original, profile, history) : toWorkoutExercises(original)) {
    const group = completed.filter((exercise) => pattern(exercise.exerciseId) === pattern(prescribed.exerciseId));
    group.forEach((exercise) => {
      kept.add(exercise);
      exercise.originalPlannedSets = Math.max(exercise.originalPlannedSets ?? 0, prescribed.planned.length);
    });
    const done = group.reduce((sum, exercise) => sum + exercise.performed.length, 0);
    const pending = prescribed.planned.slice(done);
    const sameVariant = group.find((exercise) => exercise.exerciseId === prescribed.exerciseId);
    if (sameVariant) {
      sameVariant.planned.push(...pending.map((set) => ({ ...set })));
      sameVariant.performed.push(...pending.map((set) => ({ ...set, done: false, completedAt: null })));
    } else if (pending.length > 0) {
      group.push({
        ...prescribed,
        originalPlannedSets: prescribed.planned.length,
        planned: pending.map((set) => ({ ...set })),
        performed: pending.map((set) => ({ ...set, done: false, completedAt: null })),
      });
    }
    exercises.push(...group);
  }
  // Completed work stays even when the restored equipment/exclusions no longer prescribe it.
  exercises.push(...completed.filter((exercise) => !kept.has(exercise)));
  return { ...session, durationMin: original.minutes, exercises };
}

/** Lengths the Today duration sheet offers (#148). */
export const LENGTH_CHOICES = [15, 20, 30, 45, 60, 90] as const;

export interface LengthOption {
  minutes: number;
  totalSets: number;
  /** Exercises the default length keeps that this length drops. */
  dropped: string[];
  /** Exercises a longer length adds to the default day (#17). */
  added?: string[];
  kind: 'program' | 'same' | 'fewer' | 'more' | 'none';
}

/**
 * What each length does to today's workout, against the user's default length.
 * Longer rebuilds the day at that length when `programAt` is given (#17); shorter trims it.
 */
export function lengthOptions(
  program: Program,
  constraints: Constraints,
  exclusions: string[],
  defaultMinutes: number,
  /** The day rebuilt at a longer length, so more time can add work (#17). Absent: longer only keeps the day. */
  programAt?: (minutes: number) => Program,
): LengthOption[] {
  const base = adaptWorkout(program, { ...constraints, minutes: defaultMinutes }, exclusions);
  const kept = new Set(base.exercises.map((exercise) => exercise.exerciseId));
  return LENGTH_CHOICES.map((minutes) => {
    const source = programAt && minutes > defaultMinutes ? programAt(minutes) : program;
    const adapted = adaptWorkout(source, { ...constraints, minutes }, exclusions);
    const now = new Set(adapted.exercises.map((exercise) => exercise.exerciseId));
    const dropped = base.exercises.filter((exercise) => kept.has(exercise.exerciseId) && !now.has(exercise.exerciseId)).map((exercise) => exercise.name);
    const added = adapted.exercises.filter((exercise) => !kept.has(exercise.exerciseId)).map((exercise) => exercise.name);
    const kind: LengthOption['kind'] =
      adapted.totalSets === 0 ? 'none'
      : minutes === defaultMinutes ? 'program'
      : adapted.totalSets > base.totalSets ? 'more'
      : adapted.totalSets === base.totalSets ? 'same'
      : 'fewer';
    return { minutes, totalSets: adapted.totalSets, dropped, added, kind };
  });
}

function lengthList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What one option does, in a few words. */
export function consequence(option: LengthOption): string {
  const sets = `${option.totalSets} ${option.totalSets === 1 ? 'set' : 'sets'}`;
  if (option.kind === 'none') return 'Nothing fits this setup';
  if (option.kind === 'program') return `${sets} · your program`;
  if (option.kind === 'same') return `${sets} · nothing added`;
  if (option.kind === 'more') {
    return option.added?.length ? `${sets} · adds ${lengthList(option.added)}` : `${sets} · more sets, same exercises`;
  }
  return option.dropped.length ? `${sets} · ${lengthList(option.dropped)} out` : `${sets} · fewer sets, same exercises`;
}


/** Setups the Today gym sheet offers (#149), in display order. */
export const SETUP_CHOICES: EquipmentChoice[] = ['home', 'hotel', 'bodyweight', 'bands'];

export interface SetupOption {
  choice: EquipmentChoice;
  totalSets: number;
  /** Sets the saved home setup holds at today's length. */
  baseSets: number;
  /** The day's minutes with this setup, by the timer's model (#203). */
  minutes: number;
  approx: boolean;
  kind: 'program' | 'same' | 'fewer' | 'none';
}

/** What each setup leaves of today's workout, at today's length, against the saved home setup. */
export function setupOptions(program: Program, constraints: Constraints, exclusions: string[], goal?: Goal): SetupOption[] {
  const base = adaptWorkout(program, { ...constraints, equipment: 'home' }, exclusions);
  return SETUP_CHOICES.map((choice) => {
    const adapted = adaptWorkout(program, { ...constraints, equipment: choice }, exclusions);
    const kind: SetupOption['kind'] =
      adapted.totalSets === 0 ? 'none'
      : choice === 'home' ? 'program'
      : adapted.totalSets === base.totalSets ? 'same'
      : 'fewer';
    const { minutes, approx } = todayGlance(adapted, null, false, goal);
    return { choice, totalSets: adapted.totalSets, baseSets: base.totalSets, minutes, approx, kind };
  });
}

/** What one setup does, in a few words. */
export function setupConsequence(option: SetupOption, dayName: string): string {
  const sets = `${option.totalSets} ${option.totalSets === 1 ? 'set' : 'sets'}`;
  const minutes = `${option.approx ? '≈' : ''}${option.minutes} min`;
  if (option.kind === 'none') return `Nothing in ${dayName} works`;
  if (option.kind === 'program') return `${sets} · ${minutes} · your gear`;
  if (option.kind === 'same') return `${sets} · ${minutes} · same workout`;
  return `${option.totalSets} of ${option.baseSets} sets fit · ${minutes}`;
}
