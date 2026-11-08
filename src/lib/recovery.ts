import type { MuscleGroup, WorkoutRecord } from '../types.ts';
import { exerciseById } from '../data/exercises.ts';
import { areasOf, worksSkipped } from './areas.ts';
import type { PlanSlot } from './sequence.ts';
import type { SwitchOption } from './switchDay.ts';

/** A muscle trained this recently is still recovering (#134). */
export const RECOVERY_HOURS = 48;
const HOUR_MS = 3_600_000;

/**
 * The muscles a finished session worked, by the rule a skipped area uses (`worksSkipped`, #193):
 * the first two listed muscles, every listed muscle on a hinge, never the closing Core brace, arms
 * only when listed first. Only exercises with at least one done set count.
 */
export function musclesWorked(record: WorkoutRecord): Set<MuscleGroup> {
  const worked = new Set<MuscleGroup>();
  for (const entry of record.exercises) {
    if (!entry.performed.some((set) => set.done)) continue;
    const exercise = exerciseById(entry.exerciseId);
    if (!exercise) continue;
    for (const muscle of exercise.muscles) {
      if (worksSkipped(exercise, [muscle])) worked.add(muscle);
    }
  }
  return worked;
}

/**
 * Each muscle trained in the last 48 h, with when it was last trained. Derived from history alone:
 * finished sessions, timed by when they ended (or started, on legacy records). Nothing is stored.
 */
export function recentlyTrained(history: WorkoutRecord[], now: Date): Map<MuscleGroup, Date> {
  const recent = new Map<MuscleGroup, Date>();
  for (const record of history) {
    if (record.status !== 'completed') continue;
    const at = new Date(record.endedAt ?? record.date);
    const age = now.getTime() - at.getTime();
    if (Number.isNaN(age) || age < 0 || age > RECOVERY_HOURS * HOUR_MS) continue;
    for (const muscle of musclesWorked(record)) {
      const last = recent.get(muscle);
      if (!last || at > last) recent.set(muscle, at);
    }
  }
  return recent;
}

/** The muscles a day repeats. Core is left out: most days end with it, and it recovers fast. */
function repeats(slot: PlanSlot, recent: Map<MuscleGroup, Date>): MuscleGroup[] {
  return slot.focus.filter((muscle) => muscle !== 'Core' && recent.has(muscle));
}

export interface FresherDay {
  /** The Switch sheet's own option, so picking it runs the same forward skip (#150). */
  option: SwitchOption;
  /** The day up next. */
  nextName: string;
  /** Areas the day up next repeats, in area order: "Chest, Back and Arms". */
  areas: string[];
  /** When the most recent of them was trained: "today", "yesterday" or "2 days ago". */
  when: string;
}

function dayLabel(at: Date, now: Date): string {
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / (24 * HOUR_MS));
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * (#134, owner choice A) When the day up next repeats muscles trained in the last 48 h, the
 * freshest day in the split that can run today. The fixed split stays the default: this only
 * offers. Freshest is the fewest repeated muscles, ties to the fewest skips; it is offered only
 * when it repeats at most half as many as the day up next, so near-equal days (Full Body) never
 * nag. A day with nothing to train today ('none') is never offered.
 */
export function fresherDay(
  slots: PlanSlot[],
  options: SwitchOption[],
  history: WorkoutRecord[],
  now: Date,
): FresherDay | null {
  const recent = recentlyTrained(history, now);
  if (recent.size === 0) return null;
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const next = options.find((option) => option.offset === 0);
  const nextSlot = next && byId.get(next.slotId);
  if (!next || !nextSlot) return null;
  const nextRepeats = repeats(nextSlot, recent);
  if (nextRepeats.length === 0) return null;

  let best: { option: SwitchOption; count: number } | null = null;
  for (const option of options) {
    const slot = byId.get(option.slotId);
    if (option.offset === 0 || !slot || option.status === 'none') continue;
    const count = repeats(slot, recent).length;
    if (!best || count < best.count || (count === best.count && option.offset < best.option.offset)) best = { option, count };
  }
  if (!best || best.count * 2 > nextRepeats.length) return null;

  const latest = nextRepeats.reduce((last, muscle) => {
    const at = recent.get(muscle)!;
    return at > last ? at : last;
  }, new Date(0));
  return { option: best.option, nextName: next.name, areas: areasOf(nextRepeats), when: dayLabel(latest, now) };
}

/** "Chest, Back and Arms": an English list. */
export function listAreas(areas: string[]): string {
  if (areas.length <= 1) return areas.join('');
  return `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
}
