import type { Equipment, Unit } from '../types.ts';
import { incrementFor, nextLoad } from './progression.ts';
import { toDisplay, toKg } from './units.ts';
import { MAX_WEIGHT } from './validate.ts';

/** Slack in the display unit: a load stored in kg from a typed pound value is off by up to 0.0011 lb. */
const EPS = 0.01;
/** The empty bar, by display unit: a barbell never steps below it (the same bar the first-load and ramp steps use). */
const BAR: Record<Unit, number> = { kg: 20, lb: 45 };

export interface WeightSteps {
  /** One step, in the display unit, as the buttons read it ("5" for "+ 5 lb"). */
  step: number;
  /** The load one step down, in kg; null when there is none (the − button is disabled). */
  down: number | null;
  /** The load one step up, in kg; null past the heaviest owned load or the loader's limit. */
  up: number | null;
}

/**
 * (#371) The logger's − and + steps from `kg`, the load the next set shows. With owned loads (`available`)
 * a step goes to the next or previous owned load (`nextLoad`, at least half a rack step away). Without, it
 * moves to the next point of the step grid in the lifter's unit: `incrementFor`'s kg step, and in pounds
 * that step rounded to whole 5 lb plates, so a pound lifter steps 45, 50, 55. Never 0 or below (a barbell
 * never below the empty bar, nothing below the lightest owned load), never past the loader's limit or the
 * heaviest owned load.
 */
export function weightSteps(args: { kg: number; equipment: Equipment; available: number[]; unit: Unit }): WeightSteps {
  const { kg, equipment, unit } = args;
  const available = args.available.filter((load) => Number.isFinite(load) && load > 0).sort((a, b) => a - b);
  const increment = incrementFor(equipment, available);
  if (increment <= 0) return { step: 0, down: null, up: null };
  if (available.length > 0) {
    const next = nextLoad(kg, increment, available);
    const down = [...available].reverse().find((load) => load <= kg - increment / 2) ?? null;
    return { step: Math.round(toDisplay(increment, unit) * 2) / 2, down, up: next > kg + 1e-9 ? next : null };
  }
  const step = unit === 'lb' ? Math.max(5, Math.round(toDisplay(increment, 'lb') / 5) * 5) : increment;
  const shown = toDisplay(Math.max(0, kg), unit);
  const grid = (count: number) => toKg(Math.round(count * step * 1000) / 1000, unit);
  const up = grid(Math.floor((shown + EPS) / step) + 1);
  const downCount = Math.ceil((shown - EPS) / step) - 1;
  const lightest = equipment === 'Barbell' ? BAR[unit] : step;
  return { step, down: downCount * step >= lightest - EPS ? grid(downCount) : null, up: up <= MAX_WEIGHT ? up : null };
}
