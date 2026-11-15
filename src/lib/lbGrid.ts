import type { Equipment } from '../types.ts';
import { toDisplay, toKg } from './units.ts';
import { MAX_WEIGHT } from './validate.ts';

/**
 * (#389, #391) The one pound grid. A pound lifter with no owned rack loads whole 5 lb steps on every
 * loaded kit (barbell, dumbbell, kettlebell, machine, cable), so the next load, the coach line's
 * "+5 lb" and the logger's − and + all land on it. Stored loads stay kilograms; only the rounding is
 * done in pounds. Kilogram lifters never reach this file.
 */
export const LB_STEP = 5;

/** Slack in pounds: a load stored in kg from a typed pound value is off by up to 0.0011 lb. */
export const LB_EPS = 0.01;

/** The grid step for this kit in pounds; 0 for bodyweight, which has no load to step. */
export function lbStep(equipment: Equipment): number {
  return equipment === 'Bodyweight' ? 0 : LB_STEP;
}

/** The grid point `count` steps up from 0, as stored kilograms. */
export function lbGridKg(count: number, step: number = LB_STEP): number {
  return toKg(Math.round(count * step * 1000) / 1000, 'lb');
}

/**
 * The pound value a stored load reads as, for step maths. A load typed in pounds (55 lb is 24.948 kg)
 * reads exactly as typed; anything else (25 kg from the old kilogram grid) reads to the half pound,
 * as the logger shows it, so it measures from 55 and not 55.12.
 */
export function shownLb(kg: number): number {
  const raw = toDisplay(kg, 'lb');
  const exact = Math.round(raw * 100) / 100;
  return Math.abs(toKg(exact, 'lb') - kg) < 1e-6 ? exact : Math.round(raw * 2) / 2;
}

/** An owned load as a pound rack entry, to the nearest 2.5 lb: a kg rack's 2.5 kg gap reads 5 lb, not 5.5. */
export function rackLb(kg: number): number {
  return Math.round(toDisplay(kg, 'lb') / 2.5) * 2.5;
}

/** The next load at least one step up, rounded up onto the grid (137 → 145), as kg. At the loader limit it holds. */
export function lbNextLoad(kg: number, step: number = LB_STEP): number {
  if (step <= 0) return kg;
  const next = lbGridKg(Math.ceil((shownLb(kg) + step - LB_EPS) / step), step);
  return next > MAX_WEIGHT ? kg : next;
}

/** The heaviest grid load at or under `kg` (40.7 lb → 40), never under one step, as kg. */
export function lbLoadAtOrUnder(kg: number, step: number = LB_STEP): number {
  return lbGridKg(Math.max(1, Math.floor((toDisplay(kg, 'lb') + LB_EPS) / step)), step);
}
