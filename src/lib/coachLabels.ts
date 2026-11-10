import type { Profile } from '../types.ts';
import { isGymKit } from './progression.ts';
import { savedSetup } from './setup.ts';

/** (#261) Coach > What I know names the kit by the saved setup: a gym kit, home gear, or none. */
export function equipmentTitle(profile: Pick<Profile, 'equipment' | 'support'>): string {
  if (savedSetup(profile) === 'bodyweight') return 'Bodyweight';
  return isGymKit(profile) ? 'Gym equipment' : 'Home equipment';
}

/** (#261) The saved length as the plan uses it, e.g. "30 min sessions". */
export function sessionLength(profile: Pick<Profile, 'sessionMinutes'>): string {
  return `${profile.sessionMinutes ?? 35} min sessions`;
}
