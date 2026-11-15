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
  return isPoundValue(kg) ? Math.round(raw * 100) / 100 : Math.round(raw * 2) / 2;
}

/**
 * True when kg holds a value typed in pounds (to 0.01 lb): 55 lb is 24.948 kg, 25 kg is not. A whole or
 * half kilogram is a kg value even when it happens to round-trip (17.5 kg reads back from 38.58 lb).
 */
export function isPoundValue(kg: number): boolean {
  if (Number.isInteger(Math.round(kg * 1000) / 500)) return false;
  const exact = Math.round(toDisplay(kg, 'lb') * 100) / 100;
  return Math.abs(toKg(exact, 'lb') - kg) < 1e-6;
}

/**
 * A step between a kg-stored rack entry and another load, in pounds: the gap snapped once to the nearest
 * 2.5 lb, so a 2.5 kg step reads 5 lb, never 5.5 or 5.1 (#389 decision 4). Snapping the gap, not each
 * entry, keeps every step of a rack the same (entries rounded one by one drift to 7.5). Under 1.25 lb the
 * real gap stands.
 */
export function rackGapLb(gap: number): number {
  const snapped = Math.round(gap / 2.5) * 2.5;
  return snapped > 0 ? snapped : gap;
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
