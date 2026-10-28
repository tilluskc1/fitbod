import { useState } from 'react';
import type { Profile, WorkoutRecord } from '../types';
import { ArrowIcon, DumbbellIcon, EditIcon, GoalIcon, ClockIcon } from '../components/ui/Icons';

interface Props {
  profile: Profile;
  history: WorkoutRecord[];
  program: { name: string; minutes: number };
  onWhy: () => void;
  onEdit: (section: 'equipment' | 'minutes' | 'goal' | 'units') => void;
}

type CoachTab = 'review' | 'memory' | 'talk';

interface Message {
  from: 'you' | 'coach';
  text: string;
}

function reply(question: string, history: WorkoutRecord[]): string {
  const text = question.toLowerCase();
  if (text.includes('progress') || text.includes('target')) {
    return history.length === 0
      ? 'There is no history yet. Complete one session and the next target comes from what you actually lifted.'
      : `You have ${history.length} recorded session${history.length === 1 ? '' : 's'}. The next load for each exercise comes from its own last completed sets, not from a general formula.`;
  }
  if (text.includes('equipment') || text.includes('dumbbell') || text.includes('kettlebell')) {
    return 'Equipment is part of the plan, not a suggestion. If a movement family cannot be trained with what you own, the app says so and names what would unlock it.';
  }
  if (text.includes('pain') || text.includes('hurt') || text.includes('injur')) {
    return 'This demo cannot assess an injury. Stop the movement that hurts and speak to a qualified professional; nothing here is medical advice.';
  }
  return 'This is a scripted demo reply, not a live model. Use Progress for recorded loads, and Coach → What I know to change equipment or session length.';
}

export default function CoachScreen({ profile, history, program, onWhy, onEdit }: Props) {
  const [tab, setTab] = useState<CoachTab>('review');
  const [messages, setMessages] = useState<Message[]>([
    {
      from: 'coach',
      text: 'Demo coach. I can explain how targets work, but I am not connected to a model and I never change your plan without you approving it.',
    },
  ]);
  const [draft, setDraft] = useState('');

  const last = history[0];
  const equipment = profile.equipment.length > 0 ? profile.equipment.join(' · ') : 'Bodyweight only';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { from: 'you', text },
      { from: 'coach', text: reply(text, history) },
    ]);
    setDraft('');
  };

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
        <button
          role="tab"
          aria-selected={tab === 'talk'}
          className={tab === 'talk' ? 'on' : ''}
          onClick={() => setTab('talk')}
        >
          Talk to coach
        </button>
      </div>

      {tab === 'review' && (
        <>
          <section className="big-card">
            <span className="kicker">
              {history.length === 0 ? 'A FAMILIAR STARTING POINT' : 'FROM YOUR EXERCISE HISTORY'}
            </span>
            <h2 className="big-title">
              {history.length === 0 ? 'Consistency starts with a familiar plan.' : 'Your work carries forward.'}
            </h2>
            <p className="big-copy">
              {history.length === 0
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
            <div className="context-list">
              <div className="context-row">
                <span>Sessions recorded</span>
                <span>{history.length}</span>
              </div>
              <div className="context-row">
                <span>Last session</span>
                <span>{last ? last.name : 'Your first is ahead'}</span>
              </div>
              <div className="context-row">
                <span>How it felt</span>
                <span>No feedback yet</span>
              </div>
              <div className="context-row" style={{ borderBottom: 0 }}>
                <span>Next session</span>
                <span>
                  {program.name} · {program.minutes} min
                </span>
              </div>
            </div>
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
              <span className="memory-title">Home equipment</span>
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
              <span className="memory-value">Under {profile.sessionMinutes ?? 35} minutes</span>
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

      {tab === 'talk' && (
        <>
          <div className="banner" role="note" style={{ marginTop: 12 }}>
            <div>
              <strong>Scripted demo reply.</strong> No model or API is connected. Answers are fixed
              guidance rules, and nothing you type changes your plan.
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            {messages.map((message, index) => (
              <div
                key={index}
                style={{
                  padding: '10px 0',
                  borderBottom: index === messages.length - 1 ? 0 : '1px solid #262e20',
                }}
              >
                <span className="kicker" style={{ marginBottom: 4 }}>
                  {message.from === 'you' ? 'YOU' : 'COACH DEMO'}
                </span>
                <p style={{ color: message.from === 'you' ? '#eef1e7' : '#c3ccb7', fontSize: 14.5 }}>
                  {message.text}
                </p>
              </div>
            ))}
          </div>

          <div className="field" style={{ borderBottom: 0, marginTop: 8 }}>
            <input
              className="search"
              style={{ marginTop: 0 }}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') send();
              }}
              placeholder="Ask about targets, equipment…"
              aria-label="Message the demo coach"
            />
          </div>
          <button className="secondary" onClick={send} disabled={!draft.trim()}>
            Send to demo
          </button>
          <p className="data-note">
            Live coaching arrives in a later milestone: server-side intent parsing, validated
            constraints, and an explicit preview before anything changes.
          </p>
        </>
      )}
    </div>
  );
}
