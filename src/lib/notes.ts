import type { WorkoutExercise, WorkoutRecord } from '../types.ts';

/**
 * (#372) A short note per exercise, kept on that exercise in the session record and shown the next
 * time the same exerciseId comes up. Plain text the lifter wrote: the app never reads it for advice.
 */
export const MAX_NOTE = 120;

/** Characters as the lifter sees them (code points), so an emoji counts once and is never split. */
const chars = (text: string) => Array.from(text);

/** Trimmed and capped at 120 characters; blank means no note. */
export function cleanNote(text: string): string | undefined {
  const trimmed = chars(text.trim()).slice(0, MAX_NOTE).join('').trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A stored note from a file or storage: kept only when it is text of 1 to 120 characters, otherwise dropped. */
export function readNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || chars(trimmed).length > MAX_NOTE ? undefined : trimmed;
}

/** Write (or, when blank, remove) the note on one exercise of this session. A stale index changes nothing. */
export function setExerciseNote(session: WorkoutRecord, exerciseIndex: number, exerciseId: string, text: string): WorkoutRecord {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise || exercise.exerciseId !== exerciseId) return session;
  const note = cleanNote(text);
  if (note === exercise.note) return session;
  const next = { ...exercise, note };
  if (note === undefined) delete next.note;
  const exercises = session.exercises.slice();
  exercises[exerciseIndex] = next;
  return { ...session, exercises };
}

/** The note from the most recent finished session that has one on this exact exercise. */
export function lastNote(history: WorkoutRecord[], exerciseId: string): string | undefined {
  let best: { at: number; note: string } | undefined;
  for (const workout of history) {
    if (workout.status !== 'completed') continue;
    const at = Date.parse(workout.endedAt ?? workout.date);
    for (const entry of workout.exercises) {
      if (entry.exerciseId !== exerciseId || !entry.note) continue;
      if (!best || at > best.at) best = { at, note: entry.note };
    }
  }
  return best?.note;
}

/** A swap before any set is logged replaces the whole entry, so its note goes (it never moves to the replacement). */
export function swapDropsNote(exercise: Pick<WorkoutExercise, 'note' | 'performed'> | undefined): boolean {
  return Boolean(exercise?.note) && !exercise!.performed.some((set) => set.done);
}

/** The swap toast; it says so when the swapped-out exercise's note went with it. */
export function swapNotice(name: string, noteDropped: boolean): string {
  return `${name} swapped in. Logged sets stay put.${noteDropped ? ' Its note was removed.' : ''}`;
}

/** Finishing with nothing logged cancels the session; any notes in it go too. */
export function noSetsNotice(hadNotes: boolean): string {
  return `No sets logged, so nothing was saved.${hadNotes ? " Notes weren't kept either." : ''}`;
}
