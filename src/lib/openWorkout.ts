import type { WorkoutRecord } from '../types.ts';
import { idleState, lastActiveMs, sessionProgress } from './session.ts';

/** (#430) The open workout's words outside the logger: the resume row's variant, set counts and times. */

export type RowKind = 'in-progress' | 'paused' | 'empty';

/** Which variant the row shows: no sets logged, still active, or paused (suspended). */
export function rowKind(workout: WorkoutRecord, nowMs: number): RowKind {
  if (sessionProgress(workout).done === 0) return 'empty';
  return idleState(workout, nowMs) === 'active' ? 'in-progress' : 'paused';
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "3 sets", "1 set". */
export const setsLabel = (count: number) => plural(count, 'set');

/** "just now", "25 min ago", "3 h ago". */
export function agoLabel(fromMs: number, nowMs: number): string {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return 'a while ago';
  const minutes = Math.floor((nowMs - fromMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

function latestSetMs(workout: WorkoutRecord): number {
  let best = Number.NaN;
  for (const exercise of workout.exercises) {
    for (const set of exercise.performed) {
      const at = set.done && set.completedAt ? Date.parse(set.completedAt) : Number.NaN;
      if (Number.isFinite(at) && !(at <= best)) best = at;
    }
  }
  return best;
}

/** The `...` sheet's second line: "Paused · last set 25 min ago". */
export function menuStatus(workout: WorkoutRecord, nowMs: number): string {
  const kind = rowKind(workout, nowMs);
  const word = kind === 'empty' ? 'Open' : kind === 'paused' ? 'Paused' : 'In progress';
  const lastSet = latestSetMs(workout);
  return Number.isFinite(lastSet)
    ? `${word} · last set ${agoLabel(lastSet, nowMs)}`
    : `${word} · opened ${agoLabel(lastActiveMs(workout), nowMs)}`;
}
