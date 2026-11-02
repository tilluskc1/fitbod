import type { WorkoutFeedback, WorkoutRecord } from '../types';
import { FEEDBACK_CHOICES } from '../lib/feedback';
import { ArrowIcon, CheckIcon } from '../components/ui/Icons';

/** The write covering this recap's answer, as the app last observed it. */
export interface FeedbackWrite {
  key: string;
  kind: 'saving' | 'saved' | 'error';
}

interface Props {
  workout: WorkoutRecord;
  feedbackWrite: FeedbackWrite | null;
  onFeedback: (workoutId: string, value: WorkoutFeedback | null) => void;
  onRetryFeedback: () => void;
  onViewHistory: () => void;
  onBackToday: () => void;
}

function minutesOf(workout: WorkoutRecord): number {
  if (workout.endedAt) {
    const span = (Date.parse(workout.endedAt) - Date.parse(workout.date)) / 60000;
    if (Number.isFinite(span) && span > 0) return Math.max(1, Math.round(span));
  }
  return workout.durationMin ?? 1;
}

export default function RecapScreen({
  workout,
  feedbackWrite,
  onFeedback,
  onRetryFeedback,
  onViewHistory,
  onBackToday,
}: Props) {
  const feedback = workout.feedback;
  const setCount = workout.exercises.reduce(
    (sum, exercise) => sum + exercise.performed.filter((set) => set.done).length,
    0,
  );
  const exerciseCount = workout.exercises.filter((exercise) =>
    exercise.performed.some((set) => set.done),
  ).length;
  // Work set aside today, counted from what was actually left pending.
  const skippedCount = workout.exercises.reduce(
    (sum, exercise) =>
      sum + (exercise.skipped ? exercise.performed.filter((set) => !set.done).length : 0),
    0,
  );

  // "Saved" is only ever claimed for a write this app verified. A value that
  // arrived from storage is already saved; a pending or failed write is not.
  const key = `${workout.id}:${feedback ?? 'none'}`;
  const write = feedbackWrite && feedbackWrite.key === key ? feedbackWrite.kind : null;
  const status: 'idle' | 'saving' | 'saved' | 'error' =
    write ?? (feedback ? 'saved' : 'idle');

  return (
    <div className="screen no-tabs">
      <div className="recap">
        <div className="check-ring" aria-hidden="true">
          <CheckIcon size={38} />
        </div>
        <span className="recap-kicker">WORK RECORDED</span>
        <h1 className="recap-title">You showed up.</h1>
        <p className="recap-sub">
          {workout.name}
          {workout.completedEarly ? ' · Finished early' : ''}
        </p>

        <div className="recap-stats">
          <div className="stat">
            <span className="stat-value">{minutesOf(workout)}</span>
            <span className="stat-label">Minutes</span>
          </div>
          <div className="stat">
            <span className="stat-value">{setCount}</span>
            <span className="stat-label">Sets logged</span>
          </div>
          <div className="stat">
            <span className="stat-value">{exerciseCount}</span>
            <span className="stat-label">Exercises</span>
          </div>
        </div>

        <section className="feedback">
          <h2>How did today fit?</h2>
          <p>
            Optional, and saved with this workout only. It never changes a prescription and adds no
            catch-up work. Nothing is chosen for you.
          </p>
          <div className="feedback-btns">
            {FEEDBACK_CHOICES.map((choice) => (
              <button
                key={choice.value}
                className={feedback === choice.value ? 'on' : ''}
                aria-pressed={feedback === choice.value}
                onClick={() => onFeedback(workout.id, choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="data-note" role="status">
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved with this workout.'}
            {status === 'error' && 'Not saved yet. Your answer is only in this tab.'}
            {status === 'idle' && 'No answer saved.'}
            {status === 'error' && (
              <>
                {' '}
                <button className="text-link" onClick={onRetryFeedback}>
                  Retry save
                </button>
              </>
            )}
          </p>
          {feedback && (
            <button className="text-link" onClick={() => onFeedback(workout.id, null)}>
              Clear answer
            </button>
          )}
        </section>

        {skippedCount > 0 && (
          <p className="recap-note">
            {skippedCount} {skippedCount === 1 ? 'set was' : 'sets were'} skipped today. Nothing was
            recorded for that work, and it is not owed later.
          </p>
        )}

        <p className="recap-note">
          Only completed sets were recorded. There is no automatic catch-up work.
        </p>

        <div className="recap-actions">
          <button className="primary" onClick={onViewHistory}>
            View workout history
            <ArrowIcon />
          </button>
          <button className="secondary" onClick={onBackToday}>
            Back to Today
          </button>
        </div>
      </div>
    </div>
  );
}
