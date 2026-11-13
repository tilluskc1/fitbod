import { exerciseById } from '../data/exercises.ts';
import type { Feasibility, MuscleGroup, Profile, SlotSkip } from '../types.ts';
import { missingFamilies } from './feasibility.ts';
import { usualGear } from './todayOnly.ts';
import { nouns, type DayStatus } from './todayTalk.ts';

/** (#297) Plan's header: the saved setup, length and week, so a later day's 30 min has its reason on screen. */
export function usualLine(profile: Profile): string {
  const days = profile.daysPerWeek;
  return `Your usual: ${usualGear(profile)} · ${profile.sessionMinutes ?? 35} min · ${days} ${days === 1 ? 'day' : 'days'} a week`;
}

/**
 * (#297) A day's focus in plain words: "back and biceps", "chest, shoulders, triceps". Core is named
 * only when the day holds an exercise whose own work is core (listed first), never for the brace a
 * deadlift lists last.
 */
export function plainFocus(focus: readonly MuscleGroup[], exerciseIds: readonly string[]): string {
  const core = exerciseIds.some((id) => exerciseById(id)?.muscles[0] === 'Core');
  const words = focus.filter((muscle) => muscle !== 'Core' || core).map((muscle) => muscle.toLowerCase());
  return words.length === 2 ? words.join(' and ') : words.join(', ');
}

/**
 * The reason parts of a not-Ready planned day, after its status word: "3 of 5 exercises", "no
 * hinge", "no calf work". FeasibilityNote's line and Plan's chip read the same parts (#297).
 */
export function feasibilityParts(feasibility: Feasibility): string[] {
  const { selectedCount, targetCount } = feasibility;
  const missing = missingFamilies(feasibility);
  const countGap = selectedCount > 0 && selectedCount < targetCount;
  // A full day whose gear cannot train a focus muscle at all names that muscle (#67, #174).
  const open = !countGap && !missing ? feasibility.reason.match(/ No (.+) exercise is possible/)?.[1] : undefined;
  return [
    countGap ? `${selectedCount} of ${targetCount} exercises` : '',
    missing ? `no ${missing}` : '',
    open ? `no ${open} work` : '',
  ].filter(Boolean);
}

/** (#297) Plan's status chip for a planned day: null when Ready, else the status and its reason. */
export function feasibilityChip(feasibility: Feasibility | undefined): { tone: 'limited' | 'none'; label: string } | null {
  if (!feasibility || feasibility.status === 'ok') return null;
  if (feasibility.status === 'infeasible') return { tone: 'none', label: 'Not enough equipment' };
  return { tone: 'limited', label: ['Limited', ...feasibilityParts(feasibility)].join(' · ') };
}

/** (#297) A described day's chip, from the same gaps its note names (#219): "Limited · no calf work". */
export function describedChip(day: DayStatus | null | undefined): { tone: 'limited' | 'none'; label: string } | null {
  if (!day || day.status === 'ready') return null;
  if (day.status === 'none') return { tone: 'none', label: 'Not enough equipment' };
  const muscles = [...new Set(day.gaps.map((gap) => gap.muscle))];
  return { tone: 'limited', label: muscles.length ? `Limited · no ${nouns(muscles)} work` : 'Limited' };
}

/** (#297) Slots of this plan skipped today: Plan marks them "skipped today" where the sequence put them, last. */
export function skippedToday(skips: readonly SlotSkip[] | undefined, revision: number, now: Date): Set<string> {
  return new Set((skips ?? [])
    .filter((skip) => skip.revision === revision && new Date(skip.at).toDateString() === now.toDateString())
    .map((skip) => skip.slotId));
}
