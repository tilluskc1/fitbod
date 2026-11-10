import { useState } from 'react';
import type { Profile, WorkoutRecord } from '../types';
import { feedbackLabel, latestFeedback } from '../lib/feedback';
import { equipmentTitle, sessionLength } from '../lib/coachLabels';
import { finishedWorkouts } from '../lib/progressTotals';
import { ArrowIcon, DumbbellIcon, EditIcon, GoalIcon, ClockIcon } from '../components/ui/Icons';

interface Props {
  profile: Profile;
  history: WorkoutRecord[];
  program: { name: string; minutes: number; approx?: boolean };
  onWhy: () => void;
  onEdit: (section: 'equipment' | 'minutes' | 'goal' | 'units') => void;
}

// (#257) The scripted "Talk to coach" demo is gone for launch; "Plan today with me" (#236) is the
// conversational path, and a real chat returns only with the cloud track (#42-#44).
type CoachTab = 'review' | 'memory';

export default function CoachScreen({ profile, history, program, onWhy, onEdit }: Props) {
  const [tab, setTab] = useState<CoachTab>('review');

  // (#294) Only finished workouts with a logged set count, the same as Progress.
  const finished = finishedWorkouts(history);
  const last = finished[0];
  const equipment = profile.equipment.length > 0 ? profile.equipment.join(' · ') : 'Bodyweight only';
  // Only an answer the user actually gave, with the workout it belongs to.
  const felt = latestFeedback(history);

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">Your coach.</h1>
        </div>
      </header>
      <p className="page-sub">Review the context. Approve the change. Keep what works.</p>

      <div className="segmented coach-tabs" role="tablist" aria-label="Coach views">
        <button
          role="tab"
          aria-selected={tab === 'review'}
          className={tab === 'review' ? 'on' : ''}
          onClick={() => setTab('review')}
        >
          Your review
        </button>
        <button
          role="tab"
          aria-selected={tab === 'memory'}
          className={tab === 'memory' ? 'on' : ''}
          onClick={() => setTab('memory')}
        >
          What I know
        </button>
      </div>

      {tab === 'review' && (
        <>
          <section className="big-card">
            <span className="kicker">
              {finished.length === 0 ? 'A FAMILIAR STARTING POINT' : 'FROM YOUR EXERCISE HISTORY'}
            </span>
            <h2 className="big-title">
              {finished.length === 0 ? 'Consistency starts with a familiar plan.' : 'Your work carries forward.'}
            </h2>
            <p className="big-copy">
              {finished.length === 0
                ? 'Start with the plan, edit the loads to suit you, and build your own history one set at a time.'
                : 'Each movement keeps its own recorded loads and reps. Review the next target before you train.'}
            </p>
            <button className="primary" onClick={onWhy}>
              How your targets work
              <ArrowIcon />
            </button>
          </section>

          <div className="card" style={{ marginTop: 14 }}>
            <span className="kicker">OBSERVE → REVIEW → ADAPT</span>
            <h2 className="card-title">Your recent context</h2>
            {finished.length === 0 ? (
              <p className="big-copy" style={{ marginTop: 10 }}>After your first workout I'll show what changed and why.</p>
            ) : (
            <div className="context-list">
              <div className="context-row">
                <span>Sessions recorded</span>
                <span>{finished.length}</span>
              </div>
              <div className="context-row">
                <span>Last session</span>
                <span>{last ? last.name : 'Your first is ahead'}</span>
              </div>
              <div className="context-row">
                <span>How it felt</span>
                <span>
                  {felt
                    ? `${feedbackLabel(felt.feedback)} · ${felt.workout.name} · ${new Date(felt.workout.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : 'No feedback yet'}
                </span>
              </div>
              <div className="context-row" style={{ borderBottom: 0 }}>
                <span>Next session</span>
                <span>
                  {program.name} · {program.approx ? '≈' : ''}{program.minutes} min
                </span>
              </div>
            </div>
            )}
            <p className="data-note">
              Suggestions use your own completed sessions. Example records never trigger a personal
              review.
            </p>
          </div>
        </>
      )}

      {tab === 'memory' && (
        <>
          <h2 className="big-title" style={{ fontSize: 28, marginTop: 8 }}>
            You’re in control of the context.
          </h2>
          <p className="sheet-copy" style={{ marginTop: 12 }}>
            Equipment, duration and goals change your plan settings. Temporary changes apply to one
            session only and never overwrite what is stored here.
          </p>

          <div className="memory-row">
            <span className="memory-icon">
              <DumbbellIcon />
            </span>
            <span>
              <span className="memory-title">{equipmentTitle(profile)}</span>
              <span className="memory-value">{equipment}</span>
              <span className="pill">Confirmed</span>
            </span>
            <button className="icon-btn" onClick={() => onEdit('equipment')} aria-label="Edit equipment">
              <EditIcon />
            </button>
          </div>

          <div className="memory-row">
            <span className="memory-icon">
              <ClockIcon size={19} />
            </span>
            <span>
              <span className="memory-title">Session preference</span>
              <span className="memory-value">{sessionLength(profile)}</span>
              <span className="pill">Confirmed</span>
            </span>
            <button className="icon-btn" onClick={() => onEdit('minutes')} aria-label="Edit session length">
              <EditIcon />
            </button>
          </div>

          <div className="memory-row">
            <span className="memory-icon">
              <GoalIcon />
            </span>
            <span>
              <span className="memory-title">Training goal</span>
              <span className="memory-value">{profile.goal}</span>
              <span className="pill">Confirmed</span>
            </span>
            <button className="icon-btn" onClick={() => onEdit('goal')} aria-label="Edit training goal">
              <EditIcon />
            </button>
          </div>

          <div className="memory-row">
            <span className="memory-icon">
              <GoalIcon />
            </span>
            <span>
              <span className="memory-title">Units</span>
              <span className="memory-value">{profile.unit === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}</span>
              <span className="pill">Confirmed</span>
            </span>
            <button className="icon-btn" onClick={() => onEdit('units')} aria-label="Edit units">
              <EditIcon />
            </button>
          </div>

          <p className="data-note">
            No account, no cloud copy. Everything above is stored in this browser and included in your
            JSON export.
          </p>
        </>
      )}

    </div>
  );
}
