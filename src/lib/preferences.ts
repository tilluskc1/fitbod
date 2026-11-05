import type { ExercisePreference, Profile } from '../types.ts';

/** Profile patches for the Library's review/edit surface. Absent key = neutral. */
export function withPreference(profile: Profile, exerciseId: string, value: ExercisePreference | null): Partial<Profile> {
  const preferences = { ...profile.preferences };
  if (value) preferences[exerciseId] = value;
  else delete preferences[exerciseId];
  return { preferences };
}

export function withExclusion(profile: Profile, exerciseId: string, excluded: boolean): Partial<Profile> {
  const rest = profile.exclusions.filter((id) => id !== exerciseId);
  return { exclusions: excluded ? [...rest, exerciseId] : rest };
}

/** Clears preferences only; exclusions and workout records are untouched. */
export function resetPreferences(): Partial<Profile> {
  return { preferences: {} };
}

/** Variants that are both excluded and preferred. The exclusion wins until the user picks. */
export function conflicts(profile: Profile): string[] {
  return profile.exclusions.filter((id) => profile.preferences?.[id]);
}
