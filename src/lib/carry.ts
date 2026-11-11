import { formatActualWeight, toDisplay } from './units.ts';
import { needsLoad } from '../data/flagship.ts';
import type { SetupChoice, Unit, WorkoutRecord } from '../types.ts';

/** "set 3", "sets 2 to 4", "sets 2 and 4", "sets 2, 3 and 5" (indices are 0-based). */
export function setsPhrase(indices: number[]): string {
  const n = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  if (n.length === 1) return `set ${n[0]}`;
  if (n.every((value, i) => i === 0 || value === n[i - 1] + 1)) return `sets ${n[0]} to ${n.at(-1)}`;
  return `sets ${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

/** The toast after a carry (#306): "135 lb applied to sets 2 to 4". */
export function carryMessage(args: {
  field: 'weight' | 'reps';
  kg: number;
  reps: number;
  carried: number[];
  unit: Unit;
  mode: 'each' | 'total' | 'none';
  seconds: boolean;
}): string {
  const value = args.field === 'weight'
    ? formatActualWeight(args.kg, args.unit, { perSide: args.mode === 'each' })
    : args.seconds ? `${args.reps}s` : `${args.reps} ${args.reps === 1 ? 'rep' : 'reps'}`;
  return `${value} applied to ${setsPhrase(args.carried)}`;
}

/** "Set all remaining sets to…" (#306): "135 lb × 6 set for sets 2 to 4". */
export function setAllMessage(args: { kg: number; reps: number; carried: number[]; unit: Unit; mode: 'each' | 'total' | 'none'; seconds: boolean }): string {
  const reps = args.seconds ? `${args.reps}s` : String(args.reps);
  const value = args.mode === 'none' ? (args.seconds ? reps : `${reps} reps`)
    : `${formatActualWeight(args.kg, args.unit, { perSide: args.mode === 'each' })} × ${reps}`;
  return `${value} set for ${setsPhrase(args.carried)}`;
}

/**
 * The once-per-exercise heads-up (#306): on a first-time lift, a load above twice the prefilled one.
 * It never blocks.
 */
export function bigJumpNote(firstTime: boolean, startKg: number, kg: number, unit: Unit, mode: 'each' | 'total' | 'none'): string | null {
  if (!firstTime || startKg <= 0 || kg <= startKg * 2) return null;
  return `Big jump from the start. Check ${formatActualWeight(kg, unit, { perSide: mode === 'each' })} moves well.`;
}

/** What an exercise's sets look like right after a carry burst's latest edit (#306). */
export function burstMark(session: WorkoutRecord, exerciseIndex: number): string {
  const exercise = session.exercises[exerciseIndex];
  return `${session.id}:${exercise?.exerciseId}:${JSON.stringify(exercise?.performed ?? null)}`;
}

/**
 * A burst (its Undo and its fixed followers) is live only while the exercise's sets are exactly what
 * the burst left. Any other change (Confirm, a logged set, restore, swap, another tab) ends it.
 */
export function burstLive(session: WorkoutRecord | null | undefined, exerciseIndex: number, mark: string): boolean {
  return Boolean(session) && burstMark(session as WorkoutRecord, exerciseIndex) === mark;
}

/**
 * (#327) The last logged working weight of this exact exercise, in kg: the heaviest logged set with a
 * load in the most recent finished session that has one. Warm-up ramp rows are never stored as sets;
 * skipped (unlogged) and 0-weight sets don't count. Per exercise ID, so a swapped-in variant has none.
 * The setup reads as the logger's "Previous" does: a today-only setup has its own history first.
 */
export function lastWorkingKg(history: WorkoutRecord[], exerciseId: string, setup: SetupChoice = 'home'): number | null {
  let best: number | null = null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const workout of history) {
    if (workout.status !== 'completed') continue;
    const loads = workout.exercises
      .filter((exercise) => exercise.exerciseId === exerciseId && (exercise.setup ?? 'home') === setup)
      .flatMap((exercise) => exercise.performed)
      .filter((set) => set.done && set.weight > 0)
      .map((set) => set.weight);
    const time = new Date(workout.date).getTime();
    if (loads.length === 0 || !(time > latest)) continue;
    latest = time;
    best = Math.max(...loads);
  }
  return best ?? (setup === 'home' ? null : lastWorkingKg(history, exerciseId, 'home'));
}

/**
 * (#327) A typed working weight more than 10% over the last logged one: it applies to the typed set
 * only, never carried. Compared in the display unit, rounded to whole units, so 60 to 66 is fine and
 * 60 to 67 is over. None for a lift with no history, a lighter load, or a lift without a load (seconds,
 * bodyweight). Each and total never mix: the load mode belongs to the exercise.
 */
export function overLastTime(args: {
  history: WorkoutRecord[];
  exerciseId: string;
  setup?: SetupChoice;
  kg: number;
  unit: Unit;
}): { percent: number; lastKg: number } | null {
  if (!needsLoad(args.exerciseId) || !(args.kg > 0)) return null;
  const lastKg = lastWorkingKg(args.history, args.exerciseId, args.setup);
  if (lastKg === null) return null;
  const last = Math.round(toDisplay(lastKg, args.unit));
  const typed = Math.round(toDisplay(args.kg, args.unit));
  if (!(last > 0) || typed * 10 <= last * 11) return null;
  return { percent: Math.round(((typed - last) / last) * 100), lastKg };
}

/** (#327) "80 kg is 33% over last time. Applied to set 1 only." */
export function heldMessage(args: { kg: number; percent: number; setIndex: number; unit: Unit; mode: 'each' | 'total' | 'none' }): string {
  const value = formatActualWeight(args.kg, args.unit, { perSide: args.mode === 'each' });
  return `${value} is ${args.percent}% over last time. Applied to set ${args.setIndex + 1} only.`;
}
