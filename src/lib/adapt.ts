import type { Program, ProgramExercise } from '../data/flagship.ts';
import { exerciseById } from '../data/exercises.ts';
import { FULL_BODY_A, HOME_DUMBBELLS, HOTEL_DUMBBELLS, loadModeOf, detailOf } from '../data/flagship.ts';
import type { Exercise, Goal, MuscleGroup, Profile, SetupChoice, WorkoutExercise, WorkoutRecord } from '../types.ts';
import { latestDoneSet } from './session.ts';
import type { SwapCandidate } from './session.ts';
import { atOrUnder, isCompound, isGymKit, leadCompoundId, prescribeExercise, repRangeFor } from './progression.ts';
import { estimatedSeconds } from './generator.ts';
import { SHORT_SESSION_MINUTES, sessionRests, warmUpSeconds } from './sessionTime.ts';
import { keepPairs, pairedSessionSeconds, sessionPairs, storedPairs } from './supersets.ts';
import type { PairSource } from './supersets.ts';
import { liveExercises } from './liveProgression.ts';

/**
 * The deterministic plan engine.
 *
 * It takes the programmed workout plus today's constraints and returns the
 * version that fits. It is a plain function: no model call, no randomness, and
 * no new numbers. Exercises, loads and per-set rep targets only ever come from
 * the program; the engine's whole job is deciding what to leave out.
 */

export type EquipmentChoice = SetupChoice;

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

// Lives beside ownedLoads in progression.ts (no import cycle); re-exported for existing callers.
export { isGymKit };

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
  /** A today-only day the lifter described (#193): what it trains, and what it leaves alone. */
  focus?: MuscleGroup[];
  skip?: MuscleGroup[];
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
  /** Set when the day was rebuilt from today's setup's kit (#188), not adapted from the program. */
  setup?: Program['setup'];
  /** The rebuilt day's own feasibility, so a review of it can say Limited (#188). */
  feasibility?: Program['feasibility'];
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
 * The program's own sets-per-minute ratio, for the length label of a request above the program
 * (#141). Never a figure the app promises: those come from `workMinutes` (#203).
 */
export function estimatedMinutes(program: Program, sets: number): number {
  const total = program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  if (total === 0 || sets === 0) return 0;
  return Math.max(1, Math.round((program.minutes * sets) / total));
}

/**
 * Seconds these exercises take in this order, warm-up included, by the timer's own model (#132). With
 * pairing on (#88) the pairs `sessionPairs` finds share their rest, as the logger runs them; `'stored'`
 * reads a started session's own pairs (`storedPairs`) instead.
 */
export function workSeconds(
  exercises: { exerciseId: string; sets: number; skipped?: boolean; pair?: number }[],
  goal?: Goal,
  sessionMinutes?: number,
  pairing?: PairSource | null | 'stored',
): number {
  const live = exercises.filter((exercise) => exercise.sets > 0);
  if (live.length === 0) return 0;
  const rests = sessionRests(live.map((exercise) => exercise.exerciseId), goal, sessionMinutes);
  const sets = live.map((exercise) => exercise.sets);
  const pairs = pairing === 'stored' ? storedPairs(live) : sessionPairs(live, pairing, sessionMinutes);
  if (pairs.length === 0) return estimatedSeconds(sets, rests, sessionMinutes);
  return pairedSessionSeconds(sets.map((count, index) => ({ sets: count, rest: rests[index] })),
    pairs, warmUpSeconds(sessionMinutes));
}

/**
 * Minutes these exercises take, warm-up included, by the generator's own time model (#132).
 * With a goal and session length, rests and warm-up are the ones the timer runs; with the profile's
 * pairing, supersets too (#88).
 */
export function workMinutes(exercises: { exerciseId: string; sets: number; skipped?: boolean; pair?: number }[], goal?: Goal, sessionMinutes?: number, pairing?: PairSource | null | 'stored'): number {
  const seconds = workSeconds(exercises, goal, sessionMinutes, pairing);
  return seconds === 0 ? 0 : Math.max(1, Math.round(seconds / 60));
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
 * was started at, and the pairs stored at its start, #88), so Start, a later settings change or a new
 * slot cannot move it (#200).
 */
export function todayGlance(adapted: AdaptedWorkout, current: WorkoutRecord | null, overridden = false, goal?: Goal, pairing?: PairSource | null): DayGlance {
  const asked = current ? current.durationMin : adapted.minutes;
  const work = current
    ? current.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId, sets: exercise.planned.length,
      ...(exercise.skipped ? { skipped: true } : {}), ...(exercise.pair === undefined ? {} : { pair: exercise.pair }),
    }))
    : adapted.exercises;
  const minutes = workMinutes(work, goal, asked, current ? 'stored' : pairing);
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
  program: Program,
  constraints: Constraints,
  excluded: string[],
  /**
   * Required, even when unknown (undefined): the goal sets the lead's rest, so trimming fits the
   * length by the timer's own clock and a Get Stronger day is never trimmed with short rests (#203).
   */
  goal: Goal | undefined,
  /** The profile's pairing (#88): the length is fitted with supersets as the logger will run them. */
  pairing?: PairSource | null,
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
  /** Lighter than any load today's setup has: kept with no load, for the lifter to pick (#188). */
  const pickOwn: string[] = [];
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
    // judges it; a hotel gym keeps its own rack check, taking its closest load
    // at or under the program's, or none for the lifter to pick when even its
    // lightest is heavier: never a heavier one (#188). A day rebuilt for today's
    // setup was already built from that kit.
    const travelRack = exercise.requires === 'dumbbell' && constraints.equipment !== 'home' && setup.allowsLoads;
    const travelLoad = travelRack && exercise.weight > 0 ? atOrUnder(setup.loads, exercise.weight) ?? 0 : undefined;
    const unusable =
      (exercise.requires === 'dumbbell' && !setup.allowsLoads) ||
      (exercise.requires === 'configured' && constraints.equipment !== 'home' && program.setup !== constraints.equipment) ||
      (exercise.requires !== 'configured' && exercise.weight > 0 && !knownInventory && constraints.equipment !== 'home' && !setup.loads.includes(exercise.weight) && travelLoad === undefined);
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
    if (travelLoad !== undefined && travelLoad !== weight) {
      if (travelLoad > 0) limited.push({ name: exercise.name, from: weight, to: travelLoad });
      else pickOwn.push(exercise.name);
      weight = travelLoad;
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

  // A length under the program's trims until the rest timer's model fits it (#203); at or over it,
  // the day stays as built (the generator already fitted it to its own length).
  const budget = minutes < program.minutes ? minutes * 60 : Infinity;
  const seconds = () => workSeconds(exercises, goal, minutes, pairing);

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

  // 1b. Over the length: a muscle's third (#96) goes, the last first, before any set is cut.
  const thirds = new Set(program.thirds);
  for (const exercise of [...exercises].reverse()) {
    if (seconds() <= budget) break;
    if (thirds.has(exercise.exerciseId)) exercise.sets = 0;
  }

  // 2. Over the length: every movement goes to its floor (two working sets on a lift, one on a
  //    hold), and step 4 hands sets back evenly. Trimming one movement at a time left the lead at
  //    five sets with everything else at two (#203).
  if (seconds() > budget) {
    for (const exercise of exercises) exercise.sets = Math.min(exercise.sets, exercise.holdSeconds ? 1 : 2);
  }

  // 3. Still over: drop whole movements in the same order, never the last one.
  while (seconds() > budget) {
    const active = trimOrder.filter((exercise) => exercise.sets > 0);
    if (active.length <= 1) break;
    active[0].sets = 0;
  }

  // 4. Refill: round-robin in reverse trim order (lead, compounds, isolation), one set per
  //    movement per pass while the day still fits, up to each movement's own sets. No movement
  //    passes the lead's count (#133), and a dropped movement stays dropped (#203).
  const leadExercise = exercises.find((exercise) => exercise.exerciseId === leadId);
  const refill = [...trimOrder].reverse().filter((exercise) => exercise.sets > 0);
  for (let added = true; added; ) {
    added = false;
    for (const exercise of refill) {
      const cap = !leadExercise || exercise === leadExercise ? exercise.originalSets : Math.min(exercise.originalSets, leadExercise.sets);
      if (exercise.sets >= cap) continue;
      exercise.sets += 1;
      if (seconds() > budget) exercise.sets -= 1;
      else added = true;
    }
  }

  for (const exercise of exercises) {
    exercise.targetReps = exercise.targetReps?.slice(0, exercise.sets);
  }

  // 5. Anything reduced to nothing was dropped to fit the time, so the review
  //    screen can say what went and why. A day built at a today-only length under 45 minutes
  //    (#229) names the saved day's movements it does not have.
  const kept = exercises.filter((exercise) => exercise.sets > 0);
  if (program.shortenedFrom && minutes <= program.minutes) {
    for (const exercise of program.shortenedFrom.dropped) skipped.push({ ...exercise, reason: 'time' });
  }
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
      note: `This day has no main movement with ${setup.chip.toLowerCase()}. Use the required equipment or skip it.`,
    };
  }

  const totalSets = kept.reduce((sum, exercise) => sum + exercise.sets, 0);
  const trimmedSets = kept.some((exercise) => exercise.sets < exercise.originalSets);
  const forTime = skipped.filter((item) => item.reason === 'time');
  const forEquipment = skipped.filter((item) => item.reason === 'equipment');
  // A day built at a shorter today-only length (#229) was cut for time even when no movement went.
  const timeTrimmed = trimmedSets || forTime.length > 0 || (program.shortenedFrom !== undefined && minutes <= program.minutes);
  // The program is the ceiling: a request above its own minutes cannot add
  // work, so cap the label at what the surviving sets take. Requests at or
  // under the program (the trimming direction) keep their label unchanged.
  // shortcut: with a movement skipped, 35 min still reads 35 while 36+ reads what the work takes;
  // labelling the at-or-under direction honestly too is #141.
  const capped = totalSets > 0 && minutes > program.minutes;
  const appliedMinutes = capped ? estimatedMinutes(program, totalSets) : minutes;

  // A day rebuilt for today's setup is not the program, so it never says "same as your program" (#188).
  const rebuilt = program.setup !== undefined && program.setup === constraints.equipment ? program.setup : undefined;
  let note: string;
  if (kept.length === 0) {
    note = `None of this workout can be done with ${setup.chip.toLowerCase()}.`;
  } else if (rebuilt) {
    // Bands have no movements in the library yet, so that day is bodyweight work: say so.
    note = rebuilt === 'bands' ? `No band exercises yet: ${program.name} uses bodyweight moves today.`
      : `${program.name} rebuilt for ${setup.chip.toLowerCase()} today.`;
    if (timeTrimmed) note += ` Volume trimmed to ${totalSets} ${totalSets === 1 ? 'set' : 'sets'} to fit ${minutes} min.`;
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
    const source = constraints.equipment === 'home' ? 'the closest of your confirmed loads, not' : `the closest ${setup.chip.toLowerCase()} load at or under`;
    note += ` ${listOf(limited.map((item) => `${item.name} ${item.to} kg`))} — ${source} your program's.`;
  }
  if (pickOwn.length > 0) {
    note += ` ${listOf(pickOwn)}: no ${setup.chip.toLowerCase()} dumbbell is this light — pick your load.`;
  }
  const forExcluded = skipped.filter((item) => item.reason === 'excluded');
  if (forExcluded.length > 0) {
    note += ` ${listOf(forExcluded.map((item) => item.name))} excluded in your library.`;
  }

  return {
    programId: program.id,
    name: program.name,
    minutes: appliedMinutes,
    // The ceiling notice names what the capped day takes by the timer's model, as every other figure does.
    cappedMinutes: capped ? { asked: minutes, applied: workMinutes(kept, goal, appliedMinutes, pairing) } : null,
    originalMinutes: program.minutes,
    exercises: kept,
    skipped,
    totalSets,
    originalSets,
    note,
    ...(rebuilt ? { setup: rebuilt, feasibility: program.feasibility } : {}),
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
      ...(adapted.setup ? { setup: adapted.setup } : {}),
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
  /** The setup the swapped sets run on (#188). */
  setup: EquipmentChoice = 'home',
): SwapCandidate {
  const open = session ? latestDoneSet(session, target.id) : null;
  if (open) {
    return { exerciseId: target.id, name: target.name, weight: open.weight, reps: open.reps };
  }
  const hold = FULL_BODY_A.exercises.find((exercise) => exercise.exerciseId === target.id)?.holdSeconds;
  if (hold) return { exerciseId: target.id, name: target.name, weight: 0, reps: hold };
  const prescription = prescribeExercise(target, profile, history, lead, true, setup);
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
  const prescription = profile ? liveExercises(original, profile, history) : toWorkoutExercises(original);
  const inSession = new Set(session.exercises.map((exercise) => exercise.exerciseId));
  // Which prescribed exercise a logged entry counts against (#250), by identity, never by position:
  // 1. the same exercise, every setup segment of it (#188);
  // 2. an exercise the day does not prescribe (a replacement) only when its pattern leaves one choice:
  //    the day's only exercise of that pattern, or the only one with no entry in the session (the one
  //    swapped away). Replacements of one pattern share that choice.
  // 3. anything else is ambiguous and stays its own entry, owing nothing (#247 owns swap identity).
  const slotOf = (entry: WorkoutExercise): number => {
    const own = prescription.findIndex((prescribed) => prescribed.exerciseId === entry.exerciseId);
    if (own >= 0) return own;
    const same = prescription.flatMap((prescribed, slot) => pattern(prescribed.exerciseId) === pattern(entry.exerciseId) ? [slot] : []);
    const missing = same.filter((slot) => !inSession.has(prescription[slot].exerciseId));
    return same.length === 1 ? same[0] : missing.length === 1 ? missing[0] : -1;
  };
  const owner = new Map(completed.map((exercise) => [exercise, slotOf(exercise)]));
  const exercises: WorkoutExercise[] = [];
  prescription.forEach((prescribed, slot) => {
    const group = completed.filter((exercise) => owner.get(exercise) === slot);
    group.forEach((exercise) => {
      exercise.originalPlannedSets = Math.max(exercise.originalPlannedSets ?? 0, prescribed.planned.length);
    });
    const done = group.reduce((sum, exercise) => sum + exercise.performed.length, 0);
    const pending = prescribed.planned.slice(done);
    // Pending sets join a segment on the same setup; a gear switch starts a new segment, so
    // each set keeps the setup it ran on (#188).
    const sameVariant = group.find((exercise) => exercise.exerciseId === prescribed.exerciseId && exercise.setup === prescribed.setup);
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
  });
  // Completed work stays even when the restored equipment/exclusions no longer prescribe it.
  exercises.push(...completed.filter((exercise) => owner.get(exercise) === -1));
  // (#372) A rebuilt entry starts without a note. Kept (logged) entries carry their own; an exercise whose
  // entries all lost theirs gets its note back on its first entry.
  const notes = new Map<string, string>();
  session.exercises.forEach((exercise) => {
    if (exercise.note && !notes.has(exercise.exerciseId)) notes.set(exercise.exerciseId, exercise.note);
  });
  const noted = exercises.slice();
  notes.forEach((note, exerciseId) => {
    if (noted.some((exercise) => exercise.exerciseId === exerciseId && exercise.note)) return;
    const first = noted.findIndex((exercise) => exercise.exerciseId === exerciseId);
    if (first >= 0) noted[first] = { ...noted[first], note };
  });
  // (#88) Stored pairs survive only where both halves did; nothing new pairs mid-session.
  return { ...session, durationMin: original.minutes, exercises: keepPairs(session.exercises, noted) };
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
  goal?: Goal,
  pairing?: PairSource | null,
): LengthOption[] {
  const base = adaptWorkout(program, { ...constraints, minutes: defaultMinutes }, exclusions, goal, pairing);
  const kept = new Set(base.exercises.map((exercise) => exercise.exerciseId));
  return LENGTH_CHOICES.map((minutes) => {
    // A day rebuilt for today's setup (#188) is rebuilt at every length, as picking it would.
    // So is a shorter one under 45 minutes, built at that length the way picking it would (#229).
    const source = programAt && (minutes > defaultMinutes || (minutes < defaultMinutes && minutes < SHORT_SESSION_MINUTES) || program.setup)
      ? programAt(minutes) : program;
    const adapted = adaptWorkout(source, { ...constraints, minutes }, exclusions, goal, pairing);
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
  /** 'rebuilt': the day is built again from that setup's kit (#188). */
  kind: 'program' | 'same' | 'fewer' | 'rebuilt' | 'none';
}

/**
 * What each setup leaves of today's workout, at today's length, against the saved home setup.
 * With `programFor`, each setup previews the day it rebuilds (#188) instead of what survives.
 */
export function setupOptions(
  program: Program,
  constraints: Constraints,
  exclusions: string[],
  goal?: Goal,
  programFor?: (choice: EquipmentChoice) => Program,
  pairing?: PairSource | null,
): SetupOption[] {
  const sourceFor = (choice: EquipmentChoice) => programFor?.(choice) ?? program;
  const base = adaptWorkout(sourceFor('home'), { ...constraints, equipment: 'home' }, exclusions, goal, pairing);
  return SETUP_CHOICES.map((choice) => {
    const adapted = adaptWorkout(sourceFor(choice), { ...constraints, equipment: choice }, exclusions, goal, pairing);
    const kind: SetupOption['kind'] =
      adapted.totalSets === 0 ? 'none'
      : choice === 'home' ? 'program'
      // Only a day actually rebuilt for a today-only setup says so; the saved setup is the program.
      : programFor && adapted.setup ? 'rebuilt'
      : adapted.totalSets === base.totalSets ? 'same'
      : 'fewer';
    const { minutes, approx } = todayGlance(adapted, null, false, goal, pairing);
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
  if (option.kind === 'rebuilt') return `${sets} · ${minutes} · ${option.choice === 'bands' ? 'bodyweight moves' : 'rebuilt for this gear'}`;
  return `${option.totalSets} of ${option.baseSets} sets fit · ${minutes}`;
}
