import { useState } from 'react';
import type { WorkoutRecord } from '../types';
import { ArrowIcon, CheckIcon } from '../components/ui/Icons';

interface Props {
  workout: WorkoutRecord;
  onViewHistory: () => void;
  onBackToday: () => void;
}

type Feedback = 'too-much' | 'about-right' | 'too-little';

function minutesOf(workout: WorkoutRecord): number {
  if (workout.endedAt) {
    const span = (Date.parse(workout.endedAt) - Date.parse(workout.date)) / 60000;
    if (Number.isFinite(span) && span > 0) return Math.max(1, Math.round(span));
  }
  return workout.durationMin ?? 1;
}

export default function RecapScreen({ workout, onViewHistory, onBackToday }: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const setCount = workout.exercises.reduce(
    (sum, exercise) => sum + exercise.performed.filter((set) => set.done).length,
    0,
  );
  const exerciseCount = workout.exercises.filter((exercise) =>
    exercise.performed.some((set) => set.done),
  ).length;

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
            Saved for your review. This build does not automatically change prescriptions from
            feedback, and no catch-up work is added.
          </p>
          <div className="feedback-btns">
            <button
              className={feedback === 'too-much' ? 'on' : ''}
              aria-pressed={feedback === 'too-much'}
              onClick={() => setFeedback('too-much')}
            >
              Too much
            </button>
            <button
              className={feedback === 'about-right' ? 'on' : ''}
              aria-pressed={feedback === 'about-right'}
              onClick={() => setFeedback('about-right')}
            >
              About right
            </button>
            <button
              className={feedback === 'too-little' ? 'on' : ''}
              aria-pressed={feedback === 'too-little'}
              onClick={() => setFeedback('too-little')}
            >
              Too little
            </button>
          </div>
        </section>

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
