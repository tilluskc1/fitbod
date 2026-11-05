import { EXERCISES, areIncompatible } from '../data/exercises.ts';
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

export function targetCountFor(profile: Profile): number {
  return profile.experience === 'Beginner' ? 5 : profile.experience === 'Intermediate' ? 6 : 7;
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
 * Coverage-first, seeded selection.
 *
 * The seed still does the work it always did (stable day-to-day ordering).
 * What changed is the stopping rule: an exercise is only eligible if its
 * complete equipment requirements are met, it is not excluded, it belongs to
 * the day's focus, and taking it does not pile a third exercise onto the same
 * movement pattern. When the pool cannot fill the target, the session is
 * shorter and reports itself as limited instead of silently padding with
 * unrelated movements.
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
  const targetCount =
    targetCountOverride && targetCountOverride > 0
      ? Math.min(8, Math.max(2, Math.round(targetCountOverride)))
      : targetCountFor(profile);
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
    if (best) take(best);
  }

  // 1a. "More" exercises claim a slot before the focus filler can spend it.
  for (const exercise of shuffled) {
    if (picked.length >= targetCount) break;
    if (rank(exercise) === 0 && canTake(exercise, false)) take(exercise);
  }

  // 1b. Give every focus muscle its own exercise while slots remain, so the
  // last slot is decided by the day, not by whichever caps happen to be left.
  for (const muscle of day.focus) {
    if (picked.length >= targetCount) break;
    if (picked.some((exercise) => exercise.muscles[0] === muscle)) continue;
    const candidate = shuffled.find(
      (exercise) => exercise.muscles[0] === muscle && canTake(exercise, false),
    );
    if (candidate) take(candidate);
  }

  // 2. Fill using movement patterns not already used.
  for (const exercise of compoundFirst) {
    if (picked.length >= targetCount) break;
    if (canTake(exercise, false)) take(exercise);
  }

  // 3. Only add a variation of a movement already used if slots remain.
  for (const exercise of compoundFirst) {
    if (picked.length >= targetCount) break;
    if (canTake(exercise, true)) take(exercise);
  }

  const coveredRequirements = requirements.filter((requirement) =>
    picked.some((exercise) => matchesRequirement(exercise, requirement)),
  ).length;

  // Core accessories alone do not make a Push/Pull/Legs session. If none of the
  // day's required movement families can be performed, this is infeasible and
  // the caller must not start a workout.
  if (requirements.length > 0 && coveredRequirements === 0) {
    return {
      exercises: [],
      feasibility: evaluateFeasibility(profile, day, [], targetCount),
      targetCount,
    };
  }

  const lead = pickLead(picked, day.focus);
  if (lead) picked.splice(0, picked.length, lead, ...picked.filter((exercise) => exercise !== lead));
  const exercises: WorkoutExercise[] = picked.map((exercise) => {
    const prescription = prescribeExercise(exercise, profile, history, exercise === lead, lead !== undefined);
    const planned = Array.from({ length: prescription.sets }, () => ({
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
