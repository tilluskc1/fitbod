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

/** A today-only day is named after what it trains: "Chest + Core". */
export function customDayName(focus: MuscleGroup[]): string {
  return areasOf(focus).join(' + ') || 'Today';
}

/** "No shoulder work": the area as a noun before "work" or "exercise". */
export const AREA_NOUN: Record<Area, string> = {
  Chest: 'chest', Back: 'back', Shoulders: 'shoulder', Arms: 'arm', Legs: 'leg', Core: 'core',
};

/**
 * Whether an exercise works a muscle group the lifter skipped today (#193). Its first or second
 * listed muscle counts; on a hip hinge every listed muscle counts, because a hinge loads the
 * whole back of the body (a Romanian deadlift is listed Hamstrings, Glutes, Back). Core listed
 * last never counts: it is the brace every standing lift needs, not the work.
 */
export function worksSkipped(exercise: Pick<Exercise, 'muscles' | 'pattern'>, skip: MuscleGroup[]): boolean {
  if (skip.length === 0) return false;
  const listed = exercise.muscles.filter((muscle, index) =>
    !(muscle === 'Core' && index > 0 && index === exercise.muscles.length - 1));
  const counted = exercise.pattern === 'hinge' ? listed : listed.slice(0, 2);
  return counted.some((muscle) => skip.includes(muscle));
}
