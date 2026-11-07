import type { MuscleGroup } from '../types.ts';

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

/** A today-only day is named after what it trains: "Chest + Core". */
export function customDayName(focus: MuscleGroup[]): string {
  return areasOf(focus).join(' + ') || 'Today';
}
