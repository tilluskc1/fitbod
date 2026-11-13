import type { Exercise, MuscleGroup } from '../types.ts';

/**
 * The six areas a lifter names when saying what today is like (#193). Each is a
 * set of the program's muscle groups; Arms and Legs are more than one.
 */
export type Area = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Core';

export const AREAS: Area[] = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];

export const AREA_MUSCLES: Record<Area, MuscleGroup[]> = {
  Chest: ['Chest'],
  Back: ['Back'],
  Shoulders: ['Shoulders'],
  Arms: ['Biceps', 'Triceps'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Core: ['Core'],
};

/** Muscle groups of these areas, in area order. */
export function musclesOf(areas: Area[]): MuscleGroup[] {
  return AREAS.filter((area) => areas.includes(area)).flatMap((area) => AREA_MUSCLES[area]);
}

/** The areas these muscle groups touch, in area order. */
export function areasOf(muscles: MuscleGroup[]): Area[] {
  return AREAS.filter((area) => AREA_MUSCLES[area].some((muscle) => muscles.includes(muscle)));
}

/** (#296) Switch's presets, each the coach's call and matching the split day it is named after. */
export type Preset = 'Upper' | 'Lower' | 'Push' | 'Pull' | 'Full body';
export const PRESETS: Preset[] = ['Upper', 'Lower', 'Push', 'Pull', 'Full body'];
export const PRESET_MUSCLES: Record<Preset, MuscleGroup[]> = {
  Upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
  Lower: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Back', 'Biceps'],
  'Full body': ['Chest', 'Back', 'Quads', 'Hamstrings', 'Shoulders', 'Core'],
};

/** The preset these muscles are exactly, in any order, or null. */
export function presetOf(focus: MuscleGroup[]): Preset | null {
  return PRESETS.find((preset) => PRESET_MUSCLES[preset].length === focus.length
    && PRESET_MUSCLES[preset].every((muscle) => focus.includes(muscle))) ?? null;
}

/**
 * A today-only day is named after what it trains: "Chest + Core". A preset that whole areas cannot
 * say is named for itself (#296): Pull trains Back and Biceps, not "Back + Arms". Days the areas
 * do say keep their area names, as Plan today with me has always named them ("Legs").
 */
export function customDayName(focus: MuscleGroup[]): string {
  const areas = areasOf(focus);
  const whole = musclesOf(areas).length === new Set(focus).size;
  return (whole ? null : presetOf(focus)) ?? (areas.join(' + ') || 'Today');
}

const ARM_MUSCLES: MuscleGroup[] = ['Biceps', 'Triceps'];

/** "No hamstring work": a muscle group as a noun before "work" or "exercise" (#211). */
export const MUSCLE_NOUN: Record<MuscleGroup, string> = {
  Chest: 'chest', Back: 'back', Shoulders: 'shoulder', Biceps: 'biceps', Triceps: 'triceps',
  Quads: 'quad', Hamstrings: 'hamstring', Glutes: 'glute', Calves: 'calf', Core: 'core',
};

/**
 * Whether an exercise works a muscle group the lifter skipped today (#193). Its first or second
 * listed muscle counts; on a hip hinge every listed muscle counts, because a hinge loads the
 * whole back of the body (a Romanian deadlift is listed Hamstrings, Glutes, Back). Core listed
 * last never counts: it is the brace every standing lift needs, not the work. Arms count only
 * listed first: sore arms skip curls and extensions, not every press and row they assist.
 */
export function worksSkipped(exercise: Pick<Exercise, 'muscles' | 'pattern'>, skip: MuscleGroup[]): boolean {
  if (skip.length === 0) return false;
  const listed = exercise.muscles.filter((muscle, index) =>
    !(muscle === 'Core' && index > 0 && index === exercise.muscles.length - 1));
  const counted = exercise.pattern === 'hinge' ? listed : listed.slice(0, 2);
  return counted.some((muscle, index) => skip.includes(muscle) && (index === 0 || !ARM_MUSCLES.includes(muscle)));
}
