import {
  EQUIPMENT_OPTIONS,
  type AdaptedWorkout,
  type Constraints,
  type EquipmentChoice,
} from './adapt.ts';
import type { Profile } from '../types.ts';

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
  /**
   * Loads the sentence names, canonical kilograms per hand. A number with a
   * weight unit is a load, never a session length.
   */
  loads?: number[];
  /**
   * Equipment the user named that no setup covers. Kept visible so the UI
   * can explain the gap instead of silently falling back to home dumbbells.
   */
  unsupportedEquipment?: string;
  /** Two halves of the sentence that cannot both be true. */
  contradiction?: string;
}

export interface ConstraintParser {
  parse(text: string): ParsedConstraints;
}

function snapMinutes(value: number): number {
  return Math.min(120, Math.max(10, Math.round(value / 5) * 5));
}

/** Equipment families the user can name that the program does not cover yet. */
const UNSUPPORTED_EQUIPMENT = ['kettlebell', 'barbell', 'machine', 'cable'] as const;

/** Local keyword parser. Deterministic and offline. */
export const keywordParser: ConstraintParser = {
  parse(text: string): ParsedConstraints {
    const result: ParsedConstraints = {};
    // Loads come out first: "5 kg dumbbells" is a weight, not five minutes.
    const weights: number[] = [];
    const withoutLoads = text.replace(
      // A digit must not start mid-number, so "1200 lb" is not read as 200 lb.
      /(?:^|[^\d.,])(\d{1,3}(?:[.,]\d+)?)\s*(kg|kgs?|kilos?|kilograms?|lb|lbs?|pounds?)\b/gi,
      (_match, raw: string, unit: string) => {
        const value = Number(raw.replace(',', '.'));
        if (Number.isFinite(value) && value > 0) {
          weights.push(/^(?:lb|lbs|pound)/i.test(unit) ? Math.round((value / 2.2046226218) * 10) / 10 : value);
        }
        return ' ';
      },
    );
    if (weights.length > 0) result.loads = [...new Set(weights)].sort((a, b) => a - b);

    const withUnit = /(\d{1,3})\s*(?:-|\s)?\s*(?:minutes?|mins?)\b/i.exec(withoutLoads);
    // Standalone token only: a slice of a longer number is not a session length.
    const bare = withUnit ? null : /(?:^|[^\d.,])(\d{1,3})(?![\d.,])/.exec(withoutLoads);
    const match = withUnit ?? bare;
    if (match) {
      const value = Number(match[1]);
      // Raw: range and rounding are the contract's job, so the UI can show
      // what was asked before anything is adjusted.
      if (Number.isFinite(value) && value >= 1 && value <= 999) result.minutes = value;
    }

    const deniesGear = /\b(?:no|without|don'?t have|do not have)\s+(?:any\s+)?(?:dumbbells?|weights?)\b/i.test(text);
    const affirmsDumbbells = /\b(?:dumbbells?\s+only|only\s+dumbbells?)\b/i.test(text) || weights.length > 0;
    if (deniesGear && affirmsDumbbells) {
      result.contradiction = 'dumbbells and no dumbbells';
    }

    if (/hotel|travel(?:l)?ing/i.test(text)) {
      result.equipment = 'hotel';
    } else if (/band/i.test(text)) {
      result.equipment = 'bands';
    } else if (/(?:body ?weight|nothing|empty room|no (?:equipment|gear))/i.test(text) || deniesGear) {
      result.equipment = 'bodyweight';
    } else if (/dumbbell|weights|home|garage/i.test(text)) {
      result.equipment = 'home';
    } else {
      const named = UNSUPPORTED_EQUIPMENT.find((family) => new RegExp(`\\b${family}s?\\b`, 'i').test(text));
      if (named) result.unsupportedEquipment = named;
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
    loads: patch.loads ?? current.loads,
  };
}

export function isPresetActive(preset: Preset, current: Constraints): boolean {
  if (preset.patch.minutes !== undefined) return current.minutes === preset.patch.minutes;
  if (preset.patch.equipment !== undefined) return current.equipment === preset.patch.equipment;
  return false;
}

/** What the user asked for that the plan could not use as asked. */
export type ConstraintNoticeKind = 'unsupported-equipment' | 'minutes-adjusted' | 'contradictory-input' | 'program-ceiling';

export interface ConstraintNotice {
  kind: ConstraintNoticeKind;
  asked: string;
  applied: string;
}

export interface ResolvedConstraints {
  constraints: Constraints;
  notices: ConstraintNotice[];
}

/** Supported session range. Requests outside it stay visible and need approval. */
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 120;

/**
 * The one validated constraint contract. Every control — text, presets and
 * details — resolves through here, so preview, apply and Start always read
 * the same snapshot and no adjustment happens silently.
 */
export function resolveConstraints(
  current: Constraints,
  patch: ParsedConstraints,
): ResolvedConstraints {
  const notices: ConstraintNotice[] = [];
  // A contradictory sentence changes nothing at all — not the time, not the
  // rack, not the setup — or the notice would be lying.
  if (patch.contradiction !== undefined) {
    notices.push({
      kind: 'contradictory-input',
      asked: patch.contradiction,
      applied: EQUIPMENT_OPTIONS[current.equipment].chip,
    });
    return { constraints: current, notices };
  }
  const loads = patch.loads && patch.loads.length > 0
    ? [...new Set(patch.loads)].sort((a, b) => a - b)
    : current.loads;
  let minutes = current.minutes;
  if (patch.minutes !== undefined) {
    if (patch.minutes < MIN_MINUTES || patch.minutes > MAX_MINUTES) {
      const applied = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, patch.minutes));
      notices.push({
        kind: 'minutes-adjusted',
        asked: `${patch.minutes} min`,
        applied: `${applied} min`,
      });
      minutes = applied;
    } else {
      minutes = snapMinutes(patch.minutes);
    }
  }
  let equipment = current.equipment;
  if (patch.equipment !== undefined) {
    equipment = patch.equipment;
  } else if (patch.unsupportedEquipment !== undefined) {
    notices.push({
      kind: 'unsupported-equipment',
      asked: `${patch.unsupportedEquipment}-only`,
      applied: EQUIPMENT_OPTIONS[equipment].chip,
    });
  }
  return { constraints: loads === undefined ? { minutes, equipment } : { minutes, equipment, loads }, notices };
}

/**
 * The program-ceiling notice for an already-computed adaptation: the request
 * exceeded what the program holds, so the label was capped at the surviving
 * work. Null when nothing was capped.
 */
export function programCeilingNotice(adapted: AdaptedWorkout): ConstraintNotice | null {
  if (!adapted.cappedMinutes) return null;
  return {
    kind: 'program-ceiling',
    asked: `${adapted.cappedMinutes.asked} min`,
    applied: `${adapted.cappedMinutes.applied} min`,
  };
}

/**
 * The parser's notices plus the ceiling, if any. A ceiling replaces the
 * 10–120 clamp notice, keeping what was typed, so two notices never disagree.
 */
export function withCeiling(notices: ConstraintNotice[], adapted: AdaptedWorkout): ConstraintNotice[] {
  const ceiling = programCeilingNotice(adapted);
  if (!ceiling) return notices;
  const clamp = notices.find((notice) => notice.kind === 'minutes-adjusted');
  return [...notices.filter((notice) => notice !== clamp), clamp ? { ...ceiling, asked: clamp.asked } : ceiling];
}

/**
 * The default setup follows the saved equipment: dumbbell owners get their
 * home plan, other configured equipment uses the home setup, and people with
 * no gear get bodyweight. Never assumes a dumbbell rack exists.
 */
export function defaultConstraints(profile: Profile): Constraints {
  const saved = profile.loads.Dumbbell ?? [];
  return saved.length > 0
    ? {
        minutes: profile.sessionMinutes ?? 35,
        equipment: profile.equipment.length > 0 || profile.support.length > 0 ? 'home' : 'bodyweight',
        loads: saved,
      }
    : {
        minutes: profile.sessionMinutes ?? 35,
        equipment: profile.equipment.length > 0 || profile.support.length > 0 ? 'home' : 'bodyweight',
      };
}

/** One factual line per adjustment, for the adjust sheet and the review screen. */
export function noticeText(notice: ConstraintNotice): string {
  if (notice.kind === 'contradictory-input') {
    return `Your note asks for ${notice.asked}. Decide which you have — nothing changed, still showing ${notice.applied}.`;
  }
  if (notice.kind === 'unsupported-equipment') {
    const asked = notice.asked.charAt(0).toUpperCase() + notice.asked.slice(1);
    return `${asked} isn't covered by this program — showing ${notice.applied} instead. Start only if that works for you.`;
  }
  if (notice.kind === 'program-ceiling') {
    return `You asked for ${notice.asked} — the program has no more work to add, so this shows the ${notice.applied} it takes. Start only if that works for you.`;
  }
  return `You asked for ${notice.asked} — sessions run ${MIN_MINUTES}–${MAX_MINUTES} min, so this shows ${notice.applied}. Start only if that works for you.`;
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
