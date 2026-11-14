import type { Program } from '../data/flagship.ts';
import { exerciseById } from '../data/exercises.ts';
import type { MuscleGroup, Profile, WorkoutRecord } from '../types.ts';
import { todayGlance } from './adapt.ts';
import type { AdaptedWorkout, Constraints } from './adapt.ts';
import { AREAS, AREA_MUSCLES, PRESET_MUSCLES, areasOf, musclesOf, presetOf } from './areas.ts';
import type { Area, Preset } from './areas.ts';
import { isCompound } from './progression.ts';
import { dayLabel, recentlyTrained } from './recovery.ts';
import { describedDayStatus, talkConstraints } from './todayTalk.ts';

export { PRESETS, PRESET_MUSCLES } from './areas.ts';
export type { Preset } from './areas.ts';

/**
 * (#296) "Or train something else" in Switch workout: a preset (single choice) or body parts
 * (multi-select). Both build a described day through the one path Plan today with me uses
 * (`talkConstraints` → `todayProgram` with `focus`, lesson 9); the only stored trace is the
 * existing `TodayOverride.focus`.
 */
/** The chip label for an area: "Core", as Today names a core-only day (#296 r2, owner). */
export const PART_LABEL: Record<Area, string> = {
  Chest: 'Chest', Back: 'Back', Shoulders: 'Shoulders', Arms: 'Arms', Legs: 'Legs', Core: 'Core',
};

export interface Picks {
  preset: Preset | null;
  parts: Area[];
}
export const NO_PICKS: Picks = { preset: null, parts: [] };

/** A preset fills its body parts; tapping it again clears both. */
export function pickPreset(picks: Picks, preset: Preset): Picks {
  if (picks.preset === preset) return NO_PICKS;
  return { preset, parts: areasOf(PRESET_MUSCLES[preset]) };
}

/** Editing a part clears the preset label (#296). */
export function togglePart(picks: Picks, area: Area): Picks {
  const on = picks.parts.includes(area);
  return { preset: null, parts: AREAS.filter((item) => (item === area ? !on : picks.parts.includes(item))) };
}

/** Every part selected is the same as Full body: it builds Full body (#296 edge case). */
function effectivePreset(picks: Picks): Preset | null {
  if (picks.preset) return picks.preset;
  return picks.parts.length === AREAS.length ? 'Full body' : null;
}

/** The muscles the picks train, or none when nothing is picked. */
export function pickedMuscles(picks: Picks): MuscleGroup[] {
  const preset = effectivePreset(picks);
  return preset ? PRESET_MUSCLES[preset] : musclesOf(picks.parts);
}

/** "Push", or the parts by their chip names: "Shoulders + Arms". */
export function pickLabel(picks: Picks): string {
  // Parts that are exactly a preset read as it, as Today names the day (Legs alone is "Lower", review 2).
  return effectivePreset(picks) ?? presetOf(pickedMuscles(picks))
    ?? AREAS.filter((area) => picks.parts.includes(area)).map((area) => PART_LABEL[area]).join(' + ');
}

/**
 * (#296 coach rule 2) A single small-muscle pick: Arms only or Core only. It is built at most at the
 * saved length and says so honestly, never padded with work the lifter did not ask for.
 */
export function smallOnly(picks: Picks): Area | null {
  if (effectivePreset(picks)) return null;
  return picks.parts.length === 1 && (picks.parts[0] === 'Arms' || picks.parts[0] === 'Core') ? picks.parts[0] : null;
}

/**
 * Today's constraints for the picks, through the same function Plan today with me runs: parts are
 * the composer's Train chips, so the same picks give the same day by construction. A preset whose
 * muscles are not whole areas (Push trains Triceps, not Biceps) carries its own focus. Picks equal
 * to the planned day are the planned day, as in the composer.
 */
export function pickConstraints(picks: Picks, today: Constraints, plannedFocus: MuscleGroup[], savedMinutes: number): Constraints {
  const small = smallOnly(picks);
  const minutes = small ? Math.min(today.minutes, savedMinutes) : today.minutes;
  const { focus: _focus, skip: _skip, ...plain } = today;
  const preset = effectivePreset(picks);
  if (!preset) {
    return talkConstraints({ train: picks.parts, skip: [], sore: [], pain: false, notices: [], equipment: today.equipment, minutes }, plain.loads, plannedFocus);
  }
  const focus = PRESET_MUSCLES[preset];
  const planned = focus.length === plannedFocus.length && focus.every((muscle) => plannedFocus.includes(muscle));
  return { ...plain, minutes, ...(planned ? {} : { focus }) };
}

/**
 * (#296 coach rule 1) When a part's muscles were last trained, as the chip says it: "trained
 * yesterday" or "trained 2 days ago" by calendar day, within #134's 48 h window. A label only: the
 * chip stays selectable. Same-day training reads "trained today".
 */
export function recoveryLabels(history: WorkoutRecord[], now: Date): Partial<Record<Area, string>> {
  const recent = recentlyTrained(history, now);
  const labels: Partial<Record<Area, string>> = {};
  for (const area of AREAS) {
    const times = AREA_MUSCLES[area].map((muscle) => recent.get(muscle)).filter((at): at is Date => at !== undefined);
    if (times.length === 0) continue;
    labels[area] = `trained ${dayLabel(new Date(Math.max(...times.map((at) => at.getTime()))), now)}`;
  }
  return labels;
}

/** (#296) What the picks build, read from the same program and adaptation Today and Start use. */
export interface PickPreview {
  /** "Push" or "Shoulders + Arms". */
  label: string;
  exercises: number;
  sets: number;
  minutes: number;
  approx: boolean;
  status: 'ready' | 'limited' | 'none';
  /** The described day's reasons (#219): "Not possible here: no back exercise with this gear." */
  reasons: { label: string; text: string }[];
  /** Some asked muscle has no exercise for today's gear: the sheet offers the gear fix. */
  gearGap: boolean;
  /** (#296 rule 2) "Arms only: 5 exercises, all isolation." */
  smallLine?: string;
}

/** The consequence line: "Shoulders + Arms · 5 exercises · 14 sets · 44 min". */
export function consequenceLine(preview: PickPreview): string {
  if (preview.exercises === 0) return `${preview.label} · Not enough equipment`;
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  return `${preview.label} · ${count(preview.exercises, 'exercise')} · ${count(preview.sets, 'set')} · ${preview.approx ? '≈' : ''}${preview.minutes} min`;
}

/** The balance guard's honest line, or none for a pick that is not a single small part. */
export function smallLine(picks: Picks, exerciseIds: string[]): string | undefined {
  const small = smallOnly(picks);
  if (!small || exerciseIds.length === 0) return undefined;
  const isolation = exerciseIds.every((id) => {
    const exercise = exerciseById(id);
    return exercise !== undefined && !isCompound(exercise);
  });
  const n = exerciseIds.length;
  return `${PART_LABEL[small]} only: ${n} ${n === 1 ? 'exercise' : 'exercises'}${isolation ? ', all isolation' : ''}.`;
}

/**
 * (#296) The picks' preview from the day Today and Start will run: `program` and `live` are built
 * from `next` (= `pickConstraints`) by the app's own `programFor` and `adaptFor`, then live loads.
 * A described day reads its status as Today does (#219); picks equal to the planned day read the
 * generator's verdict, as Switch's split rows do.
 */
export function pickPreview(picks: Picks, next: Constraints, program: Pick<Program, 'feasibility'>, live: AdaptedWorkout, profile: Profile, plannedName?: string): PickPreview {
  const day = describedDayStatus(next, program, live, profile);
  const status: PickPreview['status'] = day?.status
    ?? (live.exercises.length === 0 || program.feasibility?.status === 'infeasible' ? 'none'
      : program.feasibility?.status === 'limited' ? 'limited'
      : 'ready');
  const { minutes, approx } = todayGlance(live, null, false, profile.goal, profile);
  const ids = live.exercises.map((exercise) => exercise.exerciseId);
  return {
    // Picks equal to the planned day build it, so they read as Today will: "Push" (review 3).
    label: !next.focus && plannedName ? plannedName : pickLabel(picks),
    exercises: live.exercises.length,
    sets: live.totalSets,
    minutes,
    approx,
    status,
    reasons: day?.reasons ?? [],
    gearGap: Boolean(day?.gaps.some((gap) => gap.cause === 'gear')),
    ...(smallLine(picks, ids) ? { smallLine: smallLine(picks, ids) } : {}),
  };
}
