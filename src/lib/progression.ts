import type {
  Equipment,
  Exercise,
  MovementPattern,
  MuscleGroup,
  Profile,
  SetupChoice,
  Unit,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';
import { loadLimitText, loadValue, unitLabel } from './units.ts';
import { MAX_WEIGHT } from './validate.ts';
import { exerciseInWorkout } from './plan.ts';
import { HOTEL_DUMBBELLS, programExercise } from '../data/flagship.ts';
import { exerciseById } from '../data/exercises.ts';

/**
 * Phase 2 progression policy: double progression.
 *
 * A lift climbs reps inside a range; once every prescribed set is completed at
 * the top of the range, the load moves up one step and reps restart at the
 * bottom. The load is never invented: without a logged session the weight stays
 * at 0 and the user logs what they actually lifted. An exercise that was not
 * finished repeats its load instead of being rewarded with more weight.
 *
 * The load step comes from `Profile.loads` when the user has recorded real
 * available loads, and from a documented default otherwise.
 */

export interface RepRange {
  min: number;
  max: number;
}

/** Core work keeps its own catalog range; the bodyweight rule is for limb movements. */
const CORE_RANGE_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(['core_flexion', 'core_stability']);

const COMPOUND_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'squat',
  'lunge',
  'hinge',
  'hip_extension',
]);

/** Isolation on a small muscle (calves, rear delts) earns its step at 20 reps. */
const SMALL_MUSCLE_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'calf_raise',
  'shoulder_horizontal_abduction',
]);

/** Rep ranges per movement class and day role. Deliberately small: no rules engine. */
export const REP_RANGES: Record<
  'lead' | 'strength' | 'technique' | 'compound' | 'accessory' | 'small',
  RepRange
> = {
  lead: { min: 4, max: 6 },
  strength: { min: 3, max: 5 },
  technique: { min: 8, max: 10 },
  compound: { min: 6, max: 10 },
  accessory: { min: 10, max: 15 },
  small: { min: 12, max: 20 },
};

/** Bodyweight work that cannot add load climbs in reps instead (#133). */
const BODYWEIGHT_RANGE: RepRange = { min: 10, max: 20 };
/** Bodyweight moves that are hard at any level keep a strength-style range: pull-ups, chin-ups, dips. */
const HARD_BODYWEIGHT: ReadonlySet<string> = new Set(['pull-up', 'chin-up', 'dip']);
/** Nordic curls are near-maximal eccentrics: a few clean reps, not a pump set. */
const RANGE_BY_ID: Readonly<Record<string, RepRange>> = {
  'nordic-curl': { min: 3, max: 6 },
  // A swing is ballistic hip power: crisp sets of many reps, never grinding heavy sets (#174).
  'kettlebell-swing': { min: 12, max: 20 },
  // A pullover is a lat stretch under a single dumbbell: moderate reps, never a heavy set.
  'dumbbell-pullover': { min: 8, max: 12 },
  // A deadlift behind another lead still takes low reps: it is never a pump set (#174).
  deadlift: { min: 4, max: 6 },
};
/** Compounds that never take the heavy lead slot (#174). */
const NEVER_LEAD: ReadonlySet<string> = new Set(['kettlebell-swing', 'dumbbell-pullover']);
/** A dumbbell or kettlebell lead: heavy sets are awkward to set up and grip-limited, so a moderate range (#174). */
const FREE_WEIGHT_LEAD: RepRange = { min: 6, max: 10 };
const FREE_WEIGHT_STRENGTH_LEAD: RepRange = { min: 5, max: 8 };

/**
 * Fallback steps when no load inventory exists. These are starting points, not
 * claims about every gym: a barbell moves in plate pairs, a kettlebell in whole
 * sizes, a machine stack in whatever the manufacturer chose.
 */
export const DEFAULT_INCREMENTS: Record<Equipment, number> = {
  Barbell: 2.5,
  Dumbbell: 2.5,
  Kettlebell: 4,
  Machine: 5,
  Cable: 2.5,
  Bodyweight: 0,
};

const DEFAULT_REPS = 10;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The range outside the lead, from the exercise's role (#133): compound 6–10,
 * isolation 10–15, small-muscle isolation 12–20, unloadable bodyweight work 10–20
 * (pull-ups, chin-ups and dips stay 6–10), and Nordic curls 3–6.
 */
export function repRangeFor(exercise: Pick<Exercise, 'pattern' | 'muscles'> & Partial<Pick<Exercise, 'id' | 'equipment'>>): RepRange {
  const byId = exercise.id ? RANGE_BY_ID[exercise.id] : undefined;
  if (byId) return byId;
  if (exercise.equipment === 'Bodyweight' && !(exercise.id && HARD_BODYWEIGHT.has(exercise.id))
    && !CORE_RANGE_PATTERNS.has(exercise.pattern)) {
    return BODYWEIGHT_RANGE;
  }
  if (isCompound(exercise)) return REP_RANGES.compound;
  return SMALL_MUSCLE_PATTERNS.has(exercise.pattern) ? REP_RANGES.small : REP_RANGES.accessory;
}

/** Multi-muscle work on a compound pattern. A rear-delt fly or a cable fly is isolation. */
export function isCompound(exercise: Pick<Exercise, 'pattern' | 'muscles'>): boolean {
  return COMPOUND_PATTERNS.has(exercise.pattern) && exercise.muscles.length >= 2;
}

/** The one lead predicate: a loaded compound. Bodyweight never takes the heavy sets (it cannot add load). */
export function canLead(exercise: Pick<Exercise, 'pattern' | 'muscles' | 'equipment'> & { id?: string }): boolean {
  return isCompound(exercise) && exercise.equipment !== 'Bodyweight' && !(exercise.id && NEVER_LEAD.has(exercise.id));
}

const canLeadId = (id: string): boolean => {
  const exercise = exerciseById(id);
  return exercise !== undefined && canLead(exercise);
};

/**
 * The generator's pick for the lead among a day's exercises: a barbell lift
 * first and a lunge or split squat last, then the day's earliest focus muscle,
 * then session order. It then moves to the front, so everywhere else the lead
 * is simply the first loaded compound.
 */
export function pickLead<T extends Exercise>(exercises: T[], focus: MuscleGroup[] = []): T | undefined {
  const rank = (exercise: Exercise) => (exercise.equipment === 'Barbell' ? 0 : exercise.pattern === 'lunge' ? 2 : 1);
  const focusRank = (exercise: Exercise) => {
    const index = focus.indexOf(exercise.muscles[0]);
    return index < 0 ? focus.length : index;
  };
  return exercises.filter(canLead).sort((a, b) => rank(a) - rank(b) || focusRank(a) - focusRank(b))[0];
}

/** The day's lead in session order: the first loaded compound, which carries the heavy sets. */
export function leadCompoundId(exerciseIds: string[]): string | undefined {
  return exerciseIds.find(canLeadId);
}

/**
 * Every exercise holding the lead slot of a session: the first compound, plus a
 * compound swapped in for its remaining sets. A swap split keeps only the done
 * sets and both halves carry the slot's requirement (see `swapPendingExercise`).
 */
export function leadSlotIds(
  exercises: Pick<WorkoutExercise, 'exerciseId' | 'planned' | 'performed' | 'originalPlannedSets'>[],
): string[] {
  const start = exercises.findIndex((exercise) => canLeadId(exercise.exerciseId));
  if (start < 0) return [];
  const ids = [exercises[start].exerciseId];
  for (let index = start + 1; index < exercises.length; index += 1) {
    const kept = exercises[index - 1];
    const next = exercises[index];
    const required = kept.originalPlannedSets;
    const split = required !== undefined && kept.planned.length < required
      && kept.performed.every((set) => set.done) && next.originalPlannedSets === required;
    if (!split || !canLeadId(next.exerciseId)) break;
    ids.push(next.exerciseId);
  }
  return ids;
}

/**
 * Sets and rep range for the exercise's role in the day. Intermediate and
 * advanced lifters building muscle or strength open with heavy sets; a
 * beginner's lead stays at 3 × 8–10, technique first. Behind a heavy lead the
 * other compounds drop to three sets, so a session holds about as many sets as
 * before and the time budget stays honest.
 */
export function roleTarget(
  exercise: Exercise,
  profile: Pick<Profile, 'goal' | 'experience'>,
  lead = false,
  /** False when the day has no loaded compound to lead: other compounds keep four sets. */
  dayHasLead = true,
): { sets: number; range: RepRange } {
  const compound = isCompound(exercise);
  lead = lead && canLead(exercise);
  const heavy = profile.experience !== 'Beginner' && (profile.goal === 'Build Muscle' || profile.goal === 'Get Stronger');
  if (lead && heavy) {
    const strength = profile.goal === 'Get Stronger';
    const freeWeight = exercise.equipment === 'Dumbbell' || exercise.equipment === 'Kettlebell';
    const range = freeWeight
      ? (strength ? FREE_WEIGHT_STRENGTH_LEAD : FREE_WEIGHT_LEAD)
      : (strength ? REP_RANGES.strength : REP_RANGES.lead);
    return { sets: 5, range };
  }
  // Four technique sets: the lead never has fewer sets than the 4-set compounds behind it (#133).
  if (lead && profile.experience === 'Beginner') return { sets: 4, range: REP_RANGES.technique };
  // The program's own range wins, so the next target matches the recap's "3 × 8–10".
  const programmed = programExercise(exercise.id)?.repRange;
  const range = programmed ? { min: programmed[0], max: programmed[1] } : repRangeFor(exercise);
  return { sets: compound && !(heavy && dayHasLead) ? 4 : 3, range };
}

/**
 * A saved kit with a barbell and machines or cables is a gym, not a home setup (#180). A saved "My gym"
 * list (#357) only drops the barbell from that rule: machines or cables are still required. So a gym
 * without barbells is a gym (review 1), and a kit moved back to home gear (dumbbells, a garage barbell)
 * is home again, list or not, and reads its own rack (reviews 3 and 4). The list never replaces the kit.
 */
export function isGymKit(profile: Pick<Profile, 'equipment'> & Partial<Pick<Profile, 'gymItems'>>): boolean {
  const has = (item: Profile['equipment'][number]) => profile.equipment.includes(item);
  if (profile.gymItems !== undefined) return has('Machine') || has('Cable');
  return profile.equipment.includes('Barbell')
    && (profile.equipment.includes('Machine') || profile.equipment.includes('Cable'));
}

/**
 * The loads the user owns: the one place a stored rack is read. A gym kit owns none, so a rack
 * saved before #180 is ignored, never a cap or a pick; the stored value is left as it is (#194).
 */
export function ownedLoads(profile: Pick<Profile, 'equipment' | 'loads'> & Partial<Pick<Profile, 'gymItems'>>): Profile['loads'] {
  return isGymKit(profile) ? {} : profile.loads;
}

export { savedSetup } from './setup.ts';

/** Loads the profile says are actually selectable for this equipment. */
export function availableLoads(profile: Pick<Profile, 'loads'>, equipment: Equipment): number[] {
  const list = profile.loads[equipment] ?? [];
  return list.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
}

/** The heaviest of these loads at or under `weight`; undefined when none is (never a heavier one). */
export function atOrUnder(loads: number[], weight: number): number | undefined {
  return [...loads].sort((a, b) => a - b).filter((value) => value <= weight).at(-1);
}

/**
 * One step for this equipment. With a real inventory the step is the smallest
 * gap between listed loads, so a fixed dumbbell rack progresses by rack steps.
 */
export function incrementFor(equipment: Equipment, available: number[]): number {
  if (equipment === 'Bodyweight') return 0;
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < available.length; index += 1) {
    const gap = available[index] - available[index - 1];
    if (gap > 0.001 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? round(step) : DEFAULT_INCREMENTS[equipment];
}

/**
 * The next load above `weight`. With an inventory it is the next owned load up;
 * otherwise it rounds up to the step grid.
 */
export function nextLoad(weight: number, increment: number, available: number[]): number {
  if (increment <= 0) return weight;
  if (available.length > 0) {
    // The next owned load at least half a rack step up: weight + the rounded step (2.268 kg -> 2.27)
    // skipped 20 lb, and a load typed in the other unit (9 kg for 9.072) is not a step.
    const reachable = available.find((value) => value >= weight + increment / 2);
    return reachable ?? available[available.length - 1];
  }
  const target = weight + increment;
  const next = round(Math.ceil((target - 0.001) / increment) * increment);
  // Never plan a load the loader rejects (#109): at the limit the load holds.
  return next > MAX_WEIGHT ? weight : next;
}

export interface PerformanceSet {
  weight: number;
  reps: number;
}

export interface ExercisePerformance {
  workoutId: string;
  workoutName: string;
  date: string;
  plannedSets: number;
  plannedWeight: number;
  plannedReps: number;
  /** Sets actually marked done in that session. */
  done: PerformanceSet[];
  /** It held that session's lead slot (see `leadSlotIds`), read from the record's exercise order. */
  lead: boolean;
}

/**
 * The most recent completed session that contains this exercise on this setup (#188).
 * Active sessions are ignored: unfinished data must not drive the next prescription.
 * Sets without a recorded setup ran on the saved one ('home'). A today-only setup with
 * no history of its own for this exercise starts from the saved setup's.
 */
export function lastExercisePerformance(
  history: WorkoutRecord[],
  exerciseId: string,
  setup: SetupChoice = 'home',
): ExercisePerformance | null {
  let latest: ExercisePerformance | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const workout of history) {
    if (workout.status !== 'completed') continue;
    const own = workout.exercises.filter((exercise) => (exercise.setup ?? 'home') === setup);
    const found = exerciseInWorkout({ ...workout, exercises: own }, exerciseId);
    if (!found) continue;
    const time = new Date(workout.date).getTime();
    if (!(time > latestTime)) continue;
    latestTime = time;
    latest = {
      workoutId: workout.id,
      workoutName: workout.name,
      date: workout.date,
      // The slot's original requirement, preserved across swaps; old records
      // without split markers fall back to their planned totals.
      plannedSets: found.requirement,
      plannedWeight: found.firstPlanned?.weight ?? 0,
      plannedReps: found.firstPlanned?.reps ?? 0,
      done: found.done.map((set) => ({ weight: set.weight, reps: set.reps })),
      lead: leadSlotIds(workout.exercises).includes(exerciseId),
    };
  }
  return latest ?? (setup === 'home' ? null : lastExercisePerformance(history, exerciseId, 'home'));
}

export type ProgressionBasis =
  | 'first-time'
  | 'load-increase'
  | 'rep-increase'
  | 'repeat'
  | 'mixed-load'
  | 'hold'
  | 'go-heavier'
  /** The rep range moved above the last session's planned reps: a lighter load for its minimum (#139). */
  | 'range-reset'
  /** Already at or above a today-only rack's heaviest load: its top, one more rep (#188). */
  | 'rack-top';

export interface Prescription {
  equipment: Equipment;
  weight: number;
  reps: number;
  sets: number;
  basis: ProgressionBasis;
  range: RepRange;
  increment: number;
  /** Selectable loads for this equipment; a logged load outside it was typed by the user. */
  available: number[];
  /** Loads the user typed for this exercise (see `typedLoads`): they read exactly as typed. */
  typed: number[];
  last: ExercisePerformance | null;
  /** The load before a today-only rack lowered it (#188), so the day can say so. */
  uncapped?: number;
}

/** Loads the user chose themselves: a done set whose weight differs from what the app planned for it. */
export function typedLoads(history: WorkoutRecord[], exerciseId: string): number[] {
  return history.flatMap((workout) =>
    workout.exercises
      .filter((exercise) => exercise.exerciseId === exerciseId)
      .flatMap((exercise) =>
        exercise.performed
          .filter((set, index) => set.done && Math.abs(set.weight - (exercise.planned[index]?.weight ?? -1)) > 0.001)
          .map((set) => set.weight),
      ),
  );
}

/** A today-only setup's own rack for this equipment (#188): the travel gym's dumbbells. */
function setupRack(setup: SetupChoice, equipment: Equipment): number[] | undefined {
  return setup === 'hotel' && equipment === 'Dumbbell' ? [...HOTEL_DUMBBELLS].sort((a, b) => a - b) : undefined;
}

/**
 * `lead`: this is the day's first compound (see `leadCompoundId`). `setup`: where the work
 * runs (#188). The saved setup reads only its own history. A today-only setup follows whichever
 * of its own and the saved setup's last sessions is more recent, so a stale trip never holds it
 * back, a step down the lifter chose at home carries over, and a run of trips progresses from
 * itself. A travel rack is then the only rack: a load is the closest
 * one at or under the target (none: the lifter picks), and a lift that would go past its
 * heaviest load climbs one rep at a time at that load, up to the range top, and holds there.
 */
export function prescribeExercise(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
  lead = false,
  dayHasLead = true,
  setup: SetupChoice = 'home',
): Prescription {
  const rack = setupRack(setup, exercise.equipment);
  const from = (source: SetupChoice) => {
    // The saved setup's loads are the ones the user owns: a gym kit's stale rack never caps (#194).
    const prescription = prescribeOn(exercise, profile, history, lead, dayHasLead, source, rack ?? availableLoads({ loads: ownedLoads(profile) }, exercise.equipment));
    if (!rack) return prescription;
    const done = prescription.last?.done ?? [];
    if ((prescription.basis === 'go-heavier' || prescription.basis === 'hold') && done.length > 0) {
      const reps = Math.min(prescription.range.max, Math.min(...done.map((set) => set.reps)) + 1);
      return withRack({ ...prescription, basis: 'rack-top', reps }, rack);
    }
    return withRack(prescription, rack);
  };
  const own = from(setup);
  if (setup === 'home') return own;
  const home = from('home');
  const at = (prescription: Prescription) => (prescription.last ? new Date(prescription.last.date).getTime() : Number.NEGATIVE_INFINITY);
  return at(home) > at(own) ? home : own;
}

function withRack(prescription: Prescription, rack: number[]): Prescription {
  if (prescription.weight <= 0) return prescription;
  const weight = atOrUnder(rack, prescription.weight) ?? 0;
  return weight === prescription.weight ? prescription : { ...prescription, weight, uncapped: prescription.weight };
}

function prescribeOn(
  exercise: Exercise,
  profile: Profile,
  history: WorkoutRecord[],
  lead: boolean,
  dayHasLead: boolean,
  setup: SetupChoice,
  available: number[],
): Prescription {
  const catalog = repRangeFor(exercise);
  const { sets, range } = roleTarget(exercise, profile, lead, dayHasLead);
  const increment = incrementFor(exercise.equipment, available);
  const last = lastExercisePerformance(history, exercise.id, setup);
  const base = {
    equipment: exercise.equipment,
    range,
    sets,
    increment,
    available,
    typed: typedLoads(history, exercise.id),
    last,
  };

  if (!last) {
    return { ...base, weight: 0, reps: clamp(catalog.min + 2, range.min, range.max), basis: 'first-time' };
  }

  if (last.done.length === 0) {
    return {
      ...base,
      weight: last.plannedWeight,
      reps: clamp(last.plannedReps || DEFAULT_REPS, range.min, range.max),
      basis: 'repeat',
    };
  }

  const workingWeight = Math.max(...last.done.map((set) => set.weight));
  const lowestReps = Math.min(...last.done.map((set) => set.reps));
  const finished = last.done.length >= last.plannedSets;

  // Unfinished work repeats its target exactly: it neither earns nor loses a step (#104).
  // A first loaded session planned no load, so what was logged becomes the baseline.
  if (!finished) {
    const firstLoad = last.plannedWeight === 0 && workingWeight > 0;
    return {
      ...base,
      weight: firstLoad ? workingWeight : last.plannedWeight,
      reps: clamp(firstLoad ? lowestReps : last.plannedReps, range.min, range.max),
      basis: 'repeat',
    };
  }

  // Working sets at different loads are not one qualifying load: the load
  // holds at the lowest one used until every set qualifies at one load.
  const distinctLoads = new Set(last.done.map((set) => round(set.weight)));
  if (distinctLoads.size > 1) {
    return {
      ...base,
      weight: Math.min(...last.done.map((set) => set.weight)),
      reps: clamp(lowestReps, range.min, range.max),
      basis: 'mixed-load',
    };
  }

  // The range moved above what was planned and lifted (#139: Face Pull 6–10 → 12–20): the planned reps
  // already sat below today's minimum in the same role, so this is not a failed set. A lift that leads
  // one day and follows on another changes range by role, not by a range change, so it never lowers.
  // Lower to the Epley load for the minimum, rounded down to a step; never above the logged load.
  const sameRole = last.lead === (lead && canLead(exercise));
  if (sameRole && lowestReps < range.min && last.plannedReps > 0 && last.plannedReps < range.min && increment > 0) {
    const estimate = (workingWeight * (1 + lowestReps / 30)) / (1 + range.min / 30);
    const down = available.length > 0
      ? atOrUnder(available, estimate) ?? available[0]
      : Math.max(increment, round(Math.floor((estimate + 0.001) / increment) * increment));
    return { ...base, weight: Math.min(down, workingWeight), reps: range.min, basis: 'range-reset' };
  }

  if (lowestReps < range.max) {
    return {
      ...base,
      weight: workingWeight,
      reps: clamp(lowestReps + 1, range.min, range.max),
      basis: 'rep-increase',
    };
  }

  // A fixed weight with no confirmed rack, or lifted above the listed one (#129, a gym has more than
  // the user listed): the next one up is the lifter's to name, not a default step.
  // 0.25 kg of slack: the rack's top typed in the other unit (20 lb for 9 kg, 50 lb for 22.5 kg) is not above it.
  const aboveRack = available.length === 0 || workingWeight > available[available.length - 1] + 0.25;
  if (aboveRack && (exercise.equipment === 'Dumbbell' || exercise.equipment === 'Kettlebell')) {
    return { ...base, weight: workingWeight, reps: range.min, basis: 'go-heavier' };
  }

  const next = increment > 0 ? nextLoad(workingWeight, increment, available) : workingWeight;
  if (next <= workingWeight + 0.001) {
    // No heavier load exists (bodyweight, the top of the recorded rack, or the app's load limit).
    return {
      ...base,
      weight: workingWeight,
      reps: range.max,
      basis: 'hold',
    };
  }

  return { ...base, weight: next, reps: range.min, basis: 'load-increase' };
}

/**
 * Every load, planned or logged, reads by one rule: rack and app-prescribed
 * loads like the target line, a load the user typed exactly as typed.
 */
function fmtLoad(weight: number, equipment: Equipment, unit: Unit, available: number[], typed: number[]): string {
  if (weight <= 0) return equipment === 'Bodyweight' ? 'bodyweight' : 'no added load';
  return `${loadValue(weight, unit, available, typed)} ${unitLabel(unit)}`;
}

function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'last time';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One line explaining why today's numbers are what they are. Loads read in the display unit; records stay kilograms. */
export function describePrescription(prescription: Prescription, unit: Unit): string {
  const { basis, last, range, equipment, weight, available, typed } = prescription;
  const logged = (kg: number) => fmtLoad(kg, equipment, unit, available, typed);
  if (!last) {
    return 'First time — no history. Start light and log what you actually lift.';
  }
  const when = fmtDate(last.date);
  const count = last.done.length;
  const workWeight = last.done.length ? Math.max(...last.done.map((set) => set.weight)) : 0;
  const lowestReps = last.done.length ? Math.min(...last.done.map((set) => set.reps)) : 0;
  const setsLabel = `${count} set${count === 1 ? '' : 's'}`;
  const topped = `${setsLabel} at ${lowestReps} reps (top of ${range.min}–${range.max})`;

  switch (basis) {
    case 'load-increase': {
      // Next shown load minus the current load, both exactly as `logged` prints them.
      const shown = (kg: number) => Number(loadValue(kg, unit, available, typed));
      const step = Math.round((shown(weight) - shown(workWeight)) * 100) / 100;
      const stepText = step > 0 ? `One step up (+${step} ${unitLabel(unit)})` : 'Next load';
      return `${when}: ${topped}, ${logged(workWeight)}. ${stepText}; reps restart at ${range.min}.`;
    }
    case 'rep-increase':
      return `${when}: ${logged(workWeight)}, lowest set ${lowestReps} reps. Add a rep before adding load.`;
    case 'range-reset':
      return `${when}: ${logged(workWeight)} × ${lowestReps}. The range is now ${range.min}–${range.max}, so the load drops to ${logged(weight)} for ${range.min} reps.`;
    case 'go-heavier':
      return `${when}: ${topped}, ${logged(workWeight)}. Ready to go heavier: use your next ${equipment.toLowerCase()} up; reps restart at ${range.min}.`;
    case 'mixed-load':
      // `weight` is the planned load: it reads exactly as the target line does.
      return `${when}: ${setsLabel} at different loads (heaviest ${logged(workWeight)}). The load holds at ${logged(weight)} — use one working load for every set to earn the next step.`;
    case 'repeat':
      return last.done.length === 0
        ? `${when} was not logged. Repeating the same prescription.`
        : `Repeat ${prescription.sets} × ${prescription.reps}${weight > 0 ? ` @ ${logged(weight)}` : ''}: ${when} was cut short. Finish every set to earn the next step.`;
    case 'rack-top':
      return lowestReps >= prescription.reps
        ? `${when}: ${logged(workWeight)}, lowest set ${lowestReps} reps. Top travel dumbbell: hold at ${prescription.reps} reps.`
        : `${when}: ${logged(workWeight)}, lowest set ${lowestReps} reps. ${logged(weight)} is this rack's heaviest: one more rep.`;
    case 'hold':
      if (equipment === 'Bodyweight') {
        return `Bodyweight movement at the top of the rep range (${range.max}). Add external load manually to keep progressing.`;
      }
      // With no rack the only ceiling is the app's limit (#109).
      return available.length === 0
        ? `Top of the app's load limit — ${loadLimitText(unit)} The load holds at ${logged(weight)}.`
        : `Top of your available loads at ${range.max} reps — add heavier ${equipment.toLowerCase()} loads to progress further.`;
    case 'first-time':
    default:
      return 'First time — no history yet.';
  }
}

/**
 * Today's coach line: the same prescription as the target, in about a dozen
 * words. Today's load reads exactly as the target line; only last time's
 * logged load keeps its stored precision off the rack.
 */
export function coachLine(prescription: Prescription, unit: Unit): string {
  const { basis, last, equipment, weight, reps, available, typed } = prescription;
  const first =
    equipment === 'Bodyweight'
      ? 'First time on this one. Log the reps you do.'
      : 'First time on this one. Start light, log what you lift.';
  if (!last) return first;
  const today = weight > 0 ? `${fmtLoad(weight, equipment, unit, available, typed)} for ${reps}` : `${reps} reps`;
  const owned = last.done.length ? Math.max(...last.done.map((set) => set.weight)) : 0;
  switch (basis) {
    case 'load-increase':
      return `You owned ${fmtLoad(owned, equipment, unit, available, typed)}. Today: ${today}.`;
    case 'rep-increase':
      return `Add a rep: ${today}.`;
    case 'range-reset':
      return `New rep range: ${today}.`;
    case 'go-heavier':
      return `Ready to go heavier: use your next ${equipment.toLowerCase()} up.`;
    case 'mixed-load':
      return `One load for every set: ${today}.`;
    case 'rack-top':
      return last.done.length && Math.min(...last.done.map((set) => set.reps)) >= reps
        ? `Top travel dumbbell: hold at ${reps} reps.`
        : `This rack's heaviest — one more rep: ${today}.`;
    case 'hold':
      if (equipment === 'Bodyweight') return `Top of the range — own ${today}.`;
      return available.length === 0 ? `Top of the app's load limit — own ${today}.` : `Top of your rack — own ${today}.`;
    case 'repeat':
      return last.done.length === 0 ? `Last time wasn't logged. Same plan: ${today}.` : `Finish every set: ${today}.`;
    case 'first-time':
    default:
      return first;
  }
}
