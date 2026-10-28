import type { Constraints, EquipmentChoice } from './adapt.ts';

/**
 * One constraint state, three ways to change it.
 *
 * The text box, the preset chips and the Edit details controls all read and
 * write the same object. Parsing sits behind `ConstraintParser` so a model call
 * can replace the keyword pass later; whatever fills the parser may only
 * produce constraints, never exercises, sets, reps or weights.
 */

export interface ParsedConstraints {
  minutes?: number;
  equipment?: EquipmentChoice;
}

export interface ConstraintParser {
  parse(text: string): ParsedConstraints;
}

function snapMinutes(value: number): number {
  return Math.min(120, Math.max(10, Math.round(value / 5) * 5));
}

/** Local keyword parser. Deterministic and offline. */
export const keywordParser: ConstraintParser = {
  parse(text: string): ParsedConstraints {
    const result: ParsedConstraints = {};
    const withUnit = /(\d{1,3})\s*(?:-|\s)?\s*(?:minutes?|mins?)\b/i.exec(text);
    const bare = withUnit ? null : /(\d{1,3})/.exec(text);
    const match = withUnit ?? bare;
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 5 && value <= 180) result.minutes = snapMinutes(value);
    }

    if (/hotel|travel(?:l)?ing/i.test(text)) {
      result.equipment = 'hotel';
    } else if (/band/i.test(text)) {
      result.equipment = 'bands';
    } else if (/(?:body ?weight|nothing|no (?:equipment|gear|weights)|empty room)/i.test(text)) {
      result.equipment = 'bodyweight';
    } else if (/dumbbell|weights|home|garage/i.test(text)) {
      result.equipment = 'home';
    }

    return result;
  },
};

export interface Preset {
  id: string;
  label: string;
  icon: string;
  patch: Partial<Constraints>;
}

export const PRESETS: Preset[] = [
  { id: '20min', label: '20 minutes', icon: 'schedule', patch: { minutes: 20 } },
  { id: 'hotel', label: 'Hotel gym', icon: 'apartment', patch: { equipment: 'hotel' } },
  { id: 'bodyweight', label: 'Bodyweight', icon: 'accessibility_new', patch: { equipment: 'bodyweight' } },
];

/** Offered session lengths. The −/+ controls go beyond this list. */
export const MINUTE_OPTIONS = [30, 45, 60];

export function mergeConstraints(current: Constraints, patch: Partial<Constraints>): Constraints {
  return {
    minutes: patch.minutes === undefined ? current.minutes : snapMinutes(patch.minutes),
    equipment: patch.equipment ?? current.equipment,
  };
}

export function isPresetActive(preset: Preset, current: Constraints): boolean {
  if (preset.patch.minutes !== undefined) return current.minutes === preset.patch.minutes;
  if (preset.patch.equipment !== undefined) return current.equipment === preset.patch.equipment;
  return false;
}

/** The sentence shown in the text box, rebuilt whenever another control moves. */
export function constraintSentence(current: Constraints): string {
  const gear =
    current.equipment === 'home'
      ? 'dumbbells'
      : current.equipment === 'hotel'
        ? 'a hotel gym'
        : current.equipment === 'bands'
          ? 'resistance bands'
          : 'only bodyweight';
  return `I only have ${current.minutes} minutes and ${gear}`;
}

