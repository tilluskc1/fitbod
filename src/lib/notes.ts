import type { WorkoutRecord } from '../types.ts';

/**
 * (#372) A short note per exercise, kept on that exercise in the session record and shown the next
 * time the same exerciseId comes up. Plain text the lifter wrote: the app never reads it for advice.
 */
export const MAX_NOTE = 120;

/** Trimmed and capped at 120 characters; blank means no note. */
export function cleanNote(text: string): string | undefined {
  const trimmed = text.trim().slice(0, MAX_NOTE).trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A stored note from a file or storage: kept only when it is text of 1 to 120 characters, otherwise dropped. */
export function readNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > MAX_NOTE ? undefined : trimmed;
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
