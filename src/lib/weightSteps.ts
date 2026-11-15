import type { Equipment, Unit } from '../types.ts';
import { isPoundValue, LB_EPS, lbGridKg, lbStep, rackGapLb, shownLb } from './lbGrid.ts';
import { incrementFor, nextLoad } from './progression.ts';
import { toDisplay, toKg } from './units.ts';
import { MAX_WEIGHT } from './validate.ts';
import { BAR } from './warmUp.ts';

/** Slack in the display unit: a load stored in kg from a typed pound value is off by up to 0.0011 lb. */
const EPS = LB_EPS;

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
 * grid in the lifter's unit (a grid point at least half a step away): `incrementFor`'s kg step, or the
 * pound grid (`lbGrid.ts`, 5 lb). Never 0 or below, a barbell never below the empty bar (+ from under it goes
 * to the bar), never past the loader's limit or the heaviest owned load.
 * (#389) In pounds every step measures from the load as the logger cell shows it (`cell`: its value now and
 * what a target will read; without it, `shownLb`), so 25 kg planned reads 55 and steps −5 / +5, not −5.1 /
 * +4.9. A step to or from a kg-stored rack entry snaps to 2.5 lb once (a 2.5 kg rack steps 5 lb, not 5.5);
 * a rack typed in pounds keeps its own gaps. Kilograms are unchanged.
 */
export function weightSteps(args: {
  kg: number;
  equipment: Equipment;
  available: number[];
  unit: Unit;
  /** The cell's readout in the display unit: `from` for this load, `to` for what a stepped-to load reads. */
  cell?: { from: number; to: (kg: number) => number };
}): WeightSteps {
  const { equipment, unit, cell } = args;
  const kg = Math.max(0, args.kg);
  const available = args.available.filter((load) => Number.isFinite(load) && load > 0).sort((a, b) => a - b);
  const increment = incrementFor(equipment, available);
  if (increment <= 0) return { step: 0, down: null, up: null, downBy: 0, upBy: 0 };
  const pounds = unit === 'lb';
  const kgEntry = (load: number) => available.some((owned) => Math.abs(owned - load) < 0.001) && !isPoundValue(load);
  /** The pound gap between two loads as shown; snapped once when either end is a kg-stored rack entry. */
  const gapLb = (from: number, fromShown: number, to: number, toShown: number) => {
    const gap = Math.abs(toShown - fromShown);
    return kgEntry(from) || kgEntry(to) ? rackGapLb(gap) : gap;
  };
  const shown = pounds ? cell?.from ?? shownLb(kg) : toDisplay(kg, unit);
  const by = (target: number | null, nominal: number) => {
    if (target === null) return nominal;
    const gap = pounds ? gapLb(kg, shown, target, cell?.to(target) ?? shownLb(target)) : Math.abs(toDisplay(target, unit) - shown);
    return Math.round(gap * 10) / 10;
  };
  const result = (step: number, down: number | null, up: number | null): WeightSteps =>
    ({ step, down, up, downBy: by(down, step), upBy: by(up, step) });
  if (available.length > 0) {
    const gaps = available.slice(1).map((load, index) => gapLb(available[index], shownLb(available[index]), load, shownLb(load)))
      .filter((gap) => gap > 0.001);
    const step = pounds ? (gaps.length ? Math.round(Math.min(...gaps) * 10) / 10 : lbStep(equipment))
      : Math.round(toDisplay(increment, unit) * 2) / 2;
    const next = kg < available[0] - 1e-9 ? available[0] : nextLoad(kg, increment, available);
    const down = [...available].reverse().find((load) => load <= kg - increment / 2) ?? null;
    return result(step, down, next > kg + 1e-9 ? next : null);
  }
  const step = pounds ? lbStep(equipment) : increment;
  const grid = (count: number) => (pounds ? lbGridKg(count, step) : toKg(Math.round(count * step * 1000) / 1000, unit));
  const lightest = equipment === 'Barbell' ? BAR[unit] : step;
  // As `nextLoad` on a rack: the grid point at least half a step away, so 49.6 lb steps to 55 and 45, not 50 (review 2).
  const up = shown < lightest - EPS ? toKg(lightest, unit) : grid(Math.ceil((shown + step / 2 - EPS) / step));
  const downCount = Math.floor((shown - step / 2 + EPS) / step);
  return result(step, downCount * step >= lightest - EPS ? grid(downCount) : null, up <= MAX_WEIGHT ? up : null);
}
