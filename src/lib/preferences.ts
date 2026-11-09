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

export const PREF_LABEL: Record<ExercisePreference, string> = { more: 'More often', less: 'Less often' };
const FUTURE = 'Applies to future workouts only. Logged workouts stay exactly as they are.';

/** A previewed profile change: nothing is saved until the user confirms it. */
export interface ProfileChange {
  title: string;
  detail: string;
  patch: Partial<Profile>;
  /** Confirming takes something away (an exclusion), so the button is .danger (#137). */
  danger?: boolean;
}

type Named = { id: string; name: string };

/** The one preview every more/less/neutral entry point shows (Library and workout sheet). */
export function preferenceChange(profile: Profile, exercise: Named, value: ExercisePreference | null): ProfileChange {
  const excluded = profile.exclusions.includes(exercise.id);
  return {
    title: value ? `${PREF_LABEL[value]}: ${exercise.name}?` : `Neutral: ${exercise.name}?`,
    detail:
      (value === 'more'
        ? 'Picked ahead of similar exercises when a workout is generated. '
        : value === 'less'
          ? 'Picked after similar exercises, but still used when nothing else fits. '
          : 'Back to the default order. ') +
      (excluded && value ? 'It stays excluded until you choose which to keep. ' : '') +
      FUTURE,
    patch: withPreference(profile, exercise.id, value),
  };
}

export function exclusionChange(profile: Profile, exercise: Named, excluded: boolean): ProfileChange {
  const pref = profile.preferences?.[exercise.id];
  return {
    title: excluded ? `Don't recommend ${exercise.name} again?` : `Allow ${exercise.name} again?`,
    detail: `${excluded ? 'It is never programmed; the generator reports a coverage gap instead of substituting silently.' : 'It can be programmed again.'} ${excluded && pref ? `It is also marked ${PREF_LABEL[pref].toLowerCase()}; you will be asked which to keep. ` : ''}${FUTURE}`,
    patch: withExclusion(profile, exercise.id, excluded),
    danger: excluded,
  };
}

/** The two ways out of an exclusion/preference conflict, or null when there is none. */
export function conflictChanges(profile: Profile, exercise: Named): { keepExclusion: ProfileChange; keepPreference: ProfileChange } | null {
  const pref = profile.preferences?.[exercise.id];
  if (!pref || !profile.exclusions.includes(exercise.id)) return null;
  const label = PREF_LABEL[pref].toLowerCase();
  return {
    keepExclusion: {
      title: `Keep ${exercise.name} excluded?`,
      detail: `Removes the ${label} preference. ${FUTURE}`,
      patch: withPreference(profile, exercise.id, null),
    },
    keepPreference: {
      title: `Keep ${exercise.name} ${label}?`,
      detail: `Allows it in workouts again. ${FUTURE}`,
      patch: withExclusion(profile, exercise.id, false),
    },
  };
}

export function resetChange(profile: Profile): ProfileChange {
  const count = Object.keys(profile.preferences ?? {}).length;
  return {
    title: 'Reset preferences?',
    detail: `Clears ${count} more/less often ${count === 1 ? 'choice' : 'choices'}. Exclusions and workout records are not touched. ${FUTURE}`,
    patch: resetPreferences(),
  };
}
