import { EQUIPMENT_OPTIONS, EXERCISES, SUPPORT_OPTIONS, areIncompatible } from '../data/exercises.ts';
import type {
  Exercise,
  MuscleGroup,
  PlanDay,
  Profile,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import {
  evaluateFeasibility,
  isRelevantToDay,
  matchesRequirement,
  requirementsForDay,
} from './feasibility.ts';
import { pickLead, prescribeExercise } from './progression.ts';

const SPLITS: Record<number, PlanDay[]> = {
  2: [
    { name: 'Full Body A', focus: ['Chest', 'Back', 'Quads', 'Hamstrings', 'Shoulders', 'Core'] },
    { name: 'Full Body B', focus: ['Back', 'Chest', 'Glutes', 'Hamstrings', 'Biceps', 'Triceps', 'Calves'] },
  ],
  3: [
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  ],
  4: [
    { name: 'Upper A', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { name: 'Lower A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
    { name: 'Upper B', focus: ['Back', 'Chest', 'Shoulders', 'Triceps', 'Biceps'] },
    { name: 'Lower B', focus: ['Hamstrings', 'Quads', 'Glutes', 'Calves', 'Core'] },
  ],
  5: [
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
    { name: 'Upper', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { name: 'Lower', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  ],
  6: [
    { name: 'Push A', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull A', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
    { name: 'Push B', focus: ['Shoulders', 'Chest', 'Triceps'] },
    { name: 'Pull B', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs B', focus: ['Hamstrings', 'Glutes', 'Quads', 'Calves', 'Core'] },
  ],
};

const CORE_PATTERNS = new Set(['core_flexion', 'core_stability']);

export function buildPlan(profile: Profile): PlanDay[] {
  const days = Math.min(6, Math.max(2, profile.daysPerWeek));
  return SPLITS[days];
}

/** Time a set takes: 35 s of work plus the 75 s default rest. */
const SET_SECONDS = 35 + 75;
/** Setting up and moving to the next exercise. */
const EXERCISE_SECONDS = 60;
export const MIN_EXERCISES = 3;
/** Past this, extra exercises mostly add fatigue, not results. */
export const MAX_EXERCISES = { Beginner: 6, Intermediate: 8, Advanced: 8 } as const;
/** Thinned to fit a short session, an exercise keeps at least this many sets; the lead keeps 3. */
const MIN_SETS = 2;

/** Minutes a day of these set counts takes, by the same per-set time the fit uses. */
export function estimatedSeconds(sets: number[]): number {
  return sets.reduce((sum, count) => sum + count * SET_SECONDS + EXERCISE_SECONDS, 0);
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface GeneratedSession {
  exercises: WorkoutExercise[];
  feasibility: ReturnType<typeof evaluateFeasibility>;
  targetCount: number;
}

/**
 * Coverage-first, seeded selection, up to `target` exercises in priority order.
 *
 * The seed still does the work it always did (stable day-to-day ordering).
 * What changed is the stopping rule: an exercise is only eligible if its
 * complete equipment requirements are met, it is not excluded, it belongs to
 * the day's focus, and taking it does not pile a third exercise onto the same
 * movement pattern. When the pool cannot fill the target, the session is
 * shorter and reports itself as limited instead of silently padding with
 * unrelated movements.
 */
function selectExercises(profile: Profile, day: PlanDay, dayIndex: number, target: number) {
  const requirements = requirementsForDay(day);
  const caps = capabilitiesFor(profile);
  const exclusions = new Set(profile.exclusions);

  const pool = EXERCISES.filter(
    (exercise) =>
      provides(caps, exercise.needs) &&
      !exclusions.has(exercise.id) &&
      isRelevantToDay(exercise, day),
  );

  // Within the seeded order, "more" moves ahead and "less" behind (still
  // eligible). The sort is stable, so compound-first below keeps it as a tiebreaker.
  const rank = (exercise: Exercise) =>
    profile.preferences?.[exercise.id] === 'more' ? 0 : profile.preferences?.[exercise.id] === 'less' ? 2 : 1;
  const shuffled = seededShuffle(pool, 7 + dayIndex * 13).sort((a, b) => rank(a) - rank(b));
  // Keep the seeded order as the tiebreaker, but prefer compound movements
  // when filling slots so an accessory cannot consume the last slot for a
  // primary muscle and leave the session short.
  const compoundFirst = [...shuffled].sort((a, b) => b.muscles.length - a.muscles.length);
  const picked: Exercise[] = [];
  const patternCounts = new Map<string, number>();
  const primaryMuscleCounts = new Map<MuscleGroup, number>();

  const canTake = (exercise: Exercise, allowDuplicatePattern: boolean): boolean => {
    if (picked.some((item) => item.id === exercise.id || areIncompatible(item.id, exercise.id))) return false;
    const patterns = patternCounts.get(exercise.pattern) ?? 0;
    if (CORE_PATTERNS.has(exercise.pattern)) {
      if (patterns >= 1) return false;
    } else if (!allowDuplicatePattern && patterns >= 1) {
      return false;
    } else if (patterns >= 2) {
      return false;
    }
    const primary = exercise.muscles[0];
    if ((primaryMuscleCounts.get(primary) ?? 0) >= 2) return false;
    return true;
  };

  const covering = new Set<Exercise>();
  const take = (exercise: Exercise) => {
    picked.push(exercise);
    patternCounts.set(exercise.pattern, (patternCounts.get(exercise.pattern) ?? 0) + 1);
    const primary = exercise.muscles[0];
    primaryMuscleCounts.set(primary, (primaryMuscleCounts.get(primary) ?? 0) + 1);
  };

  // 1. Cover every required movement family, if the equipment allows it.
  for (const requirement of requirements) {
    const alreadyCovered = picked.some((exercise) => matchesRequirement(exercise, requirement));
    if (alreadyCovered) continue;
    const candidates = shuffled.filter(
      (exercise) => matchesRequirement(exercise, requirement) && canTake(exercise, false),
    );
    // Multi-muscle first, then the day's earliest focus muscle (Push-Up over
    // Diamond Push-Up on a Push day), so an incompatible twin cannot crowd out
    // the exercise that fills the first slot.
    const focusRank = (exercise: Exercise) => {
      const index = day.focus.indexOf(exercise.muscles[0]);
      return index < 0 ? day.focus.length : index;
    };
    const best = [...candidates].sort(
      (a, b) =>
        Number(b.muscles.length >= 2) - Number(a.muscles.length >= 2) ||
        rank(a) - rank(b) || // "more" and "less" outrank focus order
        focusRank(a) - focusRank(b),
    )[0];
    if (best) { take(best); covering.add(best); }
  }

  // 1a. "More" exercises claim a slot before the focus filler can spend it.
  for (const exercise of shuffled) {
    if (picked.length >= target) break;
    if (rank(exercise) === 0 && canTake(exercise, false)) take(exercise);
  }

  // 1b. Give every focus muscle its own exercise while slots remain, so the
  // last slot is decided by the day, not by whichever caps happen to be left.
  for (const muscle of day.focus) {
    if (picked.length >= target) break;
    if (picked.some((exercise) => exercise.muscles[0] === muscle)) continue;
    const candidate = shuffled.find(
      (exercise) => exercise.muscles[0] === muscle && canTake(exercise, false),
    );
    if (candidate) take(candidate);
  }

  // 2. Fill using movement patterns not already used.
  for (const exercise of compoundFirst) {
    if (picked.length >= target) break;
    if (canTake(exercise, false)) take(exercise);
  }

  // 3. Only add a variation of a movement already used if slots remain.
  for (const exercise of compoundFirst) {
    if (picked.length >= target) break;
    if (canTake(exercise, true)) take(exercise);
  }

  return { picked, covering, requirements };
}

/**
 * The day for the saved session length (#89). Exercises are taken in priority
 * order while their real sets fit the minutes (never fewer than 3, nor fewer than
 * the day's required movements); a day still too long at that floor thins sets,
 * and one with every possible exercise and time left adds a set to accessories.
 *
 * Prescriptions come from the progression policy: the load and rep target are
 * derived from the last completed session that trained each exercise, so a
 * session carries real numbers instead of a fixed 0 kg × 10.
 */
export function generateWorkout(
  profile: Profile,
  day: PlanDay,
  dayIndex: number,
  history: WorkoutRecord[] = [],
  targetCountOverride?: number,
): GeneratedSession {
  const max = MAX_EXERCISES[profile.experience];
  const fixed = targetCountOverride && targetCountOverride > 0
    ? Math.min(max, Math.max(MIN_EXERCISES, Math.round(targetCountOverride)))
    : undefined;
  const { picked, covering, requirements } = selectExercises(profile, day, dayIndex, fixed ?? max);

  const coveredRequirements = requirements.filter((requirement) =>
    picked.some((exercise) => matchesRequirement(exercise, requirement)),
  ).length;

  // Core accessories alone do not make a Push/Pull/Legs session. If none of the
  // day's required movement families can be performed, this is infeasible and
  // the caller must not start a workout.
  if (requirements.length > 0 && coveredRequirements === 0) {
    const targetCount = fixed ?? max;
    return {
      exercises: [],
      feasibility: evaluateFeasibility(profile, day, [], targetCount),
      targetCount,
    };
  }

  const lead = pickLead(picked, day.focus);
  if (lead) picked.splice(0, picked.length, lead, ...picked.filter((exercise) => exercise !== lead));
  const prescriptions = picked.map((exercise) =>
    prescribeExercise(exercise, profile, history, exercise === lead, lead !== undefined));
  const sets = prescriptions.map((prescription) => prescription.sets);

  let targetCount = fixed ?? picked.length;
  if (fixed === undefined) {
    const budget = (profile.sessionMinutes ?? 35) * 60;
    const floor = Math.min(picked.length, Math.max(MIN_EXERCISES,
      ...picked.map((exercise, index) => (covering.has(exercise) ? index + 1 : 0))));
    let kept = picked.length;
    while (kept > floor && estimatedSeconds(sets.slice(0, kept)) > budget) kept -= 1;
    const room = budget - estimatedSeconds(sets.slice(0, kept));
    // A count gap is only reported when gear or exclusions caused it: the same
    // day with everything allowed shows how many the caps can actually hold.
    // Preferences stay: a 'more' pick reorders the fill, and that is the user's choice, not a gap.
    const open = { ...profile, equipment: [...EQUIPMENT_OPTIONS], support: [...SUPPORT_OPTIONS], exclusions: [] };
    const capacity = selectExercises(open, day, dayIndex, max).picked.length;
    targetCount = kept < picked.length ? kept
      : Math.min(capacity, kept + Math.max(0, Math.floor(room / estimatedSeconds([3]))));
    const exhausted = kept === picked.length;
    picked.splice(kept);
    sets.splice(kept);
    // Too long even at the floor: thin the last exercises first, down to 2 sets (the lead to 3).
    for (let index = kept - 1; index >= 0 && estimatedSeconds(sets) > budget; ) {
      const least = index === 0 && lead ? 3 : MIN_SETS;
      if (sets[index] > least) sets[index] -= 1;
      else index -= 1;
    }
    // No exercise left to add and at least one more exercise's worth of time:
    // the 3-set work behind the lead gets a fourth set, in priority order, while it fits.
    if (exhausted && room >= estimatedSeconds([3])) {
      for (let index = lead ? 1 : 0; index < kept; index += 1) {
        if (sets[index] < 4 && estimatedSeconds(sets) + SET_SECONDS <= budget) sets[index] += 1;
      }
    }
  }

  const exercises: WorkoutExercise[] = picked.map((exercise, index) => {
    const prescription = prescriptions[index];
    const planned = Array.from({ length: sets[index] }, () => ({
      weight: prescription.weight,
      reps: prescription.reps,
    }));
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      planned,
      performed: planned.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        done: false,
        completedAt: null,
      })),
    };
  });

  return {
    exercises,
    feasibility: evaluateFeasibility(profile, day, picked, targetCount),
    targetCount,
  };
}
