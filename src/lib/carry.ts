import { formatActualWeight } from './units.ts';
import type { Unit, WorkoutRecord } from '../types.ts';

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
  return `Big jump from the starting load. Make sure ${formatActualWeight(kg, unit, { perSide: mode === 'each' })} moves well for all sets.`;
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
