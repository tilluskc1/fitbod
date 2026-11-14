import type { Equipment, Unit } from '../types.ts';
import { incrementFor, nextLoad } from './progression.ts';
import { toDisplay, toKg } from './units.ts';
import { MAX_WEIGHT } from './validate.ts';
import { BAR, STEPS } from './warmUp.ts';

/** Slack in the display unit: a load stored in kg from a typed pound value is off by up to 0.0011 lb. */
const EPS = 0.01;

export interface WeightSteps {
  /** One nominal step, in the display unit. */
  step: number;
  /** The load one step down, in kg; null when there is none (the − button is disabled). */
  down: number | null;
  /** The load one step up, in kg; null past the heaviest owned load or the loader's limit. */
  up: number | null;
  /** What − and + each move the load by, in the display unit ("+ 4 kg"); the nominal step when disabled. */
  downBy: number;
  upBy: number;
}

/**
 * (#371) The logger's − and + steps from `kg`, the load the next set shows. With owned loads (`available`:
 * the rack today's gear offers) a step goes to the next or previous owned load (`nextLoad`, at least half a
 * rack step away; a load under the lightest steps up to it). Without, it moves to the next point of the step
 * grid in the lifter's unit: `incrementFor`'s kg step, or the warm-up's pound plate steps. Never 0 or below,
 * a barbell never below the empty bar (+ from under it goes to the bar), never past the loader's limit or
 * the heaviest owned load.
 */
export function weightSteps(args: { kg: number; equipment: Equipment; available: number[]; unit: Unit }): WeightSteps {
  const { equipment, unit } = args;
  const kg = Math.max(0, args.kg);
  const available = args.available.filter((load) => Number.isFinite(load) && load > 0).sort((a, b) => a - b);
  const increment = incrementFor(equipment, available);
  if (increment <= 0) return { step: 0, down: null, up: null, downBy: 0, upBy: 0 };
  const shown = toDisplay(kg, unit);
  const by = (target: number | null, nominal: number) =>
    target === null ? nominal : Math.round(Math.abs(toDisplay(target, unit) - shown) * 10) / 10;
  const result = (step: number, down: number | null, up: number | null): WeightSteps =>
    ({ step, down, up, downBy: by(down, step), upBy: by(up, step) });
  if (available.length > 0) {
    const step = Math.round(toDisplay(increment, unit) * 2) / 2;
    const next = kg < available[0] - 1e-9 ? available[0] : nextLoad(kg, increment, available);
    const down = [...available].reverse().find((load) => load <= kg - increment / 2) ?? null;
    return result(step, down, next > kg + 1e-9 ? next : null);
  }
  const step = unit === 'lb' ? STEPS.lb[equipment] ?? 5 : increment;
  const grid = (count: number) => toKg(Math.round(count * step * 1000) / 1000, unit);
  const lightest = equipment === 'Barbell' ? BAR[unit] : step;
  const up = shown < lightest - EPS ? toKg(lightest, unit) : grid(Math.floor((shown + EPS) / step) + 1);
  const downCount = Math.ceil((shown - EPS) / step) - 1;
  return result(step, downCount * step >= lightest - EPS ? grid(downCount) : null, up <= MAX_WEIGHT ? up : null);
}
