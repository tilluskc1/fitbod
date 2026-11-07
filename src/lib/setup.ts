import type { Profile, SetupChoice } from '../types.ts';

/**
 * The setup the profile saved (#188): its own gear, or bodyweight when it has none. Only a
 * today-only setup other than this one is a rebuild; the saved setup's sessions are untagged.
 * Its own module so plan.ts and progression.ts can both use it without importing each other (#212).
 */
export function savedSetup(profile: Pick<Profile, 'equipment' | 'support'>): SetupChoice {
  return profile.equipment.length > 0 || profile.support.length > 0 ? 'home' : 'bodyweight';
}
