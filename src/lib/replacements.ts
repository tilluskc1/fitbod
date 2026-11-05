import { EXERCISES, areIncompatible } from '../data/exercises.ts';
import type { Exercise, Profile } from '../types.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { patternsOf } from './feasibility.ts';

/**
 * Swap candidates for one exercise, best match first. Same primary muscle,
 * performable with the saved gear, not excluded, not already in the day and
 * not incompatible with it. Ties break on id so the list never reorders itself.
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
      !others.some((item) => item.id === candidate.id || areIncompatible(item.id, candidate.id)),
  )
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
