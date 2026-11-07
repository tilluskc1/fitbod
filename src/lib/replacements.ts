import { EXERCISES, areIncompatible } from '../data/exercises.ts';
import type { Exercise, Profile } from '../types.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { patternsOf } from './feasibility.ts';

const CORE_PATTERNS = new Set(['core_flexion', 'core_stability']);

/**
 * Swap candidates for one exercise, best match first. Same primary muscle,
 * performable with the saved gear, not excluded, not already in the day,
 * not incompatible with it, and not pushing a movement past the day's cap
 * (two of a pattern, one core move; the generator's own rule, #177).
 * Ties break on id so the list never reorders itself.
 */
export function rankedReplacements(
  exercise: Exercise,
  profile: Profile,
  inDay: Exercise[] = [],
  limit = 5,
): Exercise[] {
  const caps = capabilitiesFor(profile);
  const excluded = new Set(profile.exclusions);
  const others = inDay.filter((item) => item.id !== exercise.id);
  const mine = new Set(patternsOf(exercise));
  const patternCount = new Map<string, number>();
  for (const item of others) patternCount.set(item.pattern, (patternCount.get(item.pattern) ?? 0) + 1);
  const fitsCap = (candidate: Exercise) =>
    (patternCount.get(candidate.pattern) ?? 0) < (CORE_PATTERNS.has(candidate.pattern) ? 1 : 2);

  const score = (candidate: Exercise): number =>
    (candidate.pattern === exercise.pattern ? 4 : 0) +
    (patternsOf(candidate).some((pattern) => mine.has(pattern)) ? 2 : 0) +
    candidate.muscles.filter((muscle) => exercise.muscles.includes(muscle)).length +
    (candidate.equipment === exercise.equipment ? 1 : 0);

  return EXERCISES.filter(
    (candidate) =>
      candidate.id !== exercise.id &&
      candidate.muscles[0] === exercise.muscles[0] &&
      provides(caps, candidate.needs) &&
      !excluded.has(candidate.id) &&
      !others.some((item) => item.id === candidate.id || areIncompatible(item.id, candidate.id)) &&
      fitsCap(candidate),
  )
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
