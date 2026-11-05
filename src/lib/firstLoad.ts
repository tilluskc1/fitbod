import type { Exercise, Experience, MuscleGroup, Unit } from '../types.ts';
import { isCompound } from './progression.ts';
import { parseLoads } from './units.ts';

type Role = 'small' | 'upper' | 'lower';

const LOWER: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['Quads', 'Hamstrings', 'Glutes', 'Calves']);

/**
 * Starting load per hand for a dumbbell, in each unit's own steps (#116). A
 * conservative draft for the owner to tune: isolation work, then upper and
 * lower compounds.
 */
const DUMBBELL: Record<Unit, Record<Role, Record<Experience, number>>> = {
  lb: {
    small: { Beginner: 5, Intermediate: 10, Advanced: 15 },
    upper: { Beginner: 15, Intermediate: 25, Advanced: 35 },
    lower: { Beginner: 20, Intermediate: 35, Advanced: 50 },
  },
  kg: {
    small: { Beginner: 2, Intermediate: 4, Advanced: 6 },
    upper: { Beginner: 6, Intermediate: 10, Advanced: 16 },
    lower: { Beginner: 8, Intermediate: 16, Advanced: 22 },
  },
};
/** A barbell starts at the empty bar. */
const BAR: Record<Unit, number> = { lb: 45, kg: 20 };

/**
 * The load the first-time step starts from, in kg: derived from the profile,
 * never stored, and only logged once the user confirms it. Bodyweight gets 0
 * (no number), as before.
 */
export function suggestedFirstLoad(
  exercise: Pick<Exercise, 'pattern' | 'muscles' | 'equipment'>,
  experience: Experience,
  unit: Unit,
): number {
  const role: Role = !isCompound(exercise) ? 'small' : LOWER.has(exercise.muscles[0]) ? 'lower' : 'upper';
  const perHand = DUMBBELL[unit][role][experience];
  const value = exercise.equipment === 'Bodyweight' ? 0
    : exercise.equipment === 'Barbell' ? BAR[unit]
    // A stack carries both hands' worth.
    : exercise.equipment === 'Machine' || exercise.equipment === 'Cable' ? perHand * 2
    : perHand;
  // Same conversion and precision as a load the user typed.
  return value > 0 ? parseLoads(String(value), unit)[0] ?? 0 : 0;
}

/** The owned load closest to `kg`, the lighter on a tie; null with none owned. */
export function nearestLoad(loads: number[], kg: number): number | null {
  return [...loads].sort((a, b) => Math.abs(a - kg) - Math.abs(b - kg) || a - b)[0] ?? null;
}
