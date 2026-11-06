import type { AppState, WorkoutFeedback, WorkoutRecord } from '../types.ts';

/** The three choices, in display order. None of them is a default. */
export const FEEDBACK_CHOICES: { value: WorkoutFeedback; label: string }[] = [
  { value: 'too-much', label: 'Too much' },
  { value: 'about-right', label: 'About right' },
  { value: 'too-little', label: 'Too little' },
];

export function feedbackLabel(value: WorkoutFeedback | undefined): string | null {
  return FEEDBACK_CHOICES.find((choice) => choice.value === value)?.label ?? null;
}

/**
 * Set, change or clear one completed workout's feedback. Only that workout's
 * marker moves: logged sets, prescriptions and timestamps are untouched, and a
 * stale or unknown id changes nothing at all, so a late callback from another
 * workout's screen can never attach an answer to the wrong record.
 */
export function setWorkoutFeedback(
  state: AppState,
  workoutId: string,
  value: WorkoutFeedback | null,
): AppState {
  if (!state.history.some((workout) => workout.id === workoutId)) return state;
  return {
    ...state,
    history: state.history.map((workout) => {
      if (workout.id !== workoutId) return workout;
      const next: WorkoutRecord = { ...workout };
      // Absent is the only representation of "no answer".
      if (value === null) delete next.feedback;
      else next.feedback = value;
      return next;
    }),
  };
}

/**
 * The most recent answer the user actually gave, with the workout it belongs
 * to. `null` when nothing has been answered — never a placeholder value.
 */
export function latestFeedback(
  history: WorkoutRecord[],
): { workout: WorkoutRecord; feedback: WorkoutFeedback } | null {
  let latest: { workout: WorkoutRecord; feedback: WorkoutFeedback } | null = null;
  for (const workout of history) {
    if (!workout.feedback) continue;
    if (!latest || Date.parse(workout.date) > Date.parse(latest.workout.date)) {
      latest = { workout, feedback: workout.feedback };
    }
  }
  return latest;
}
