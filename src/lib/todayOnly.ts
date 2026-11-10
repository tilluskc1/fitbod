import type { AppState, Profile } from '../types.ts';
import { EQUIPMENT_OPTIONS, setupFor } from './adapt.ts';
import { customDayName } from './areas.ts';
import { activeOverride } from './plan.ts';
import { savedSetup } from './setup.ts';

/** (#298) Today's change against the saved setup, as the today-only bar names it. */
export interface TodayOnly {
  /** "Today only: Travel gym · 45 min": only what differs. */
  label: string;
  /** Today's gear is not the saved setup: the gear pill shows its dot. */
  gearDiffers: boolean;
}

/** The saved setup's short name, as the gear pill shows it: "Gym", "Home" or "Bodyweight". */
export function usualGear(profile: Profile): string {
  return setupFor(savedSetup(profile), profile).short;
}

/**
 * (#298) What today changes, or null when nothing does. Hidden while a session runs (it owns
 * Today, #260) and once the override's day has passed (midnight). A no-gear profile's bodyweight
 * day is its saved setup, never a change.
 */
export function todayOnly(state: AppState, now: Date): TodayOnly | null {
  const profile = state.profile;
  if (!profile || state.current) return null;
  const override = activeOverride(state, now);
  if (!override) return null;
  // Read the gear the way todayConstraints does, so legacy overrides without a choice agree with Today.
  const choice = override.choice ?? (override.equipment.includes('Dumbbell') ? 'home' : 'bodyweight');
  const gearDiffers = choice !== 'home' && choice !== savedSetup(profile);
  const parts: string[] = [];
  if (override.focus) parts.push(`${customDayName(override.focus)} (you chose)`);
  if (gearDiffers) parts.push(EQUIPMENT_OPTIONS[choice].chip);
  if (override.minutes !== (profile.sessionMinutes ?? 35)) parts.push(`${override.minutes} min`);
  if (parts.length === 0) return null;
  return { label: `Today only: ${parts.join(' · ')}`, gearDiffers };
}

/** (#298) The Done message after Undo: "Back to your usual: Gym · 30 min." */
/** (#295) The Done toast after a today-only change of length or gear. */
export const CHANGED_FOR_TODAY = 'Changed for today. Your plan stays the same.';

export function undoToast(profile: Profile): string {
  return `Back to your usual: ${usualGear(profile)} · ${profile.sessionMinutes ?? 35} min.`;
}
