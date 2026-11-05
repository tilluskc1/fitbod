import { useMemo, useState } from 'react';
import { loadModeOf, NEEDS_LOAD_REASON, needsLoad, setText, setUnit } from '../data/flagship';
import { calibrationInputValue, toKg, unitLabel } from '../lib/units';
import { plannedLoad } from '../lib/liveProgression';
import { bestCompletedSet, exerciseInWorkout, hasWork } from '../lib/plan';
import type { Profile, Unit, WorkoutFeedback, WorkoutRecord } from '../types';
import { FEEDBACK_CHOICES, feedbackLabel } from '../lib/feedback';
import { ArrowIcon, BarIcon, CheckIcon, ChevronIcon, DownloadIcon } from '../components/ui/Icons';

interface Props {
  history: WorkoutRecord[];
  unit: Unit;
  /** The profile's confirmed loads, so a rack load reads like the target. */
  loads?: Profile['loads'];
  onExport: () => void;
  onCorrect: (
    workoutId: string,
    exerciseIndex: number,
    setIndex: number,
    patch: { weight?: number; reps?: number; done?: boolean },
  ) => void;
  onDelete: (workoutId: string) => void;
  onFeedback: (workoutId: string, value: WorkoutFeedback | null) => void;
  onGoTrain: () => void;
}

function minutesOf(workout: WorkoutRecord): number {
  if (workout.endedAt) {
    const span = (Date.parse(workout.endedAt) - Date.parse(workout.date)) / 60000;
    if (Number.isFinite(span) && span > 0) return Math.max(1, Math.round(span));
  }
  return workout.durationMin ?? 0;
}

function setsOf(workout: WorkoutRecord): number {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.performed.filter((set) => set.done).length,
    0,
  );
}

function dateParts(iso: string): { month: string; day: string } {
  const date = new Date(iso);
  return {
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
  };
}

const CHART_W = 316;
const CHART_H = 128;

export default function ProgressScreen({
  history,
  unit,
  loads = {},
  onExport,
  onCorrect,
  onDelete,
  onFeedback,
  onGoTrain,
}: Props) {
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  /** The exercise whose weight correction was just refused, as `workoutId:exerciseIndex`. */
  const [refused, setRefused] = useState('');

  const sessions = useMemo(
    () => [...history].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    [history],
  );

  const exerciseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const workout of sessions) {
      for (const exercise of workout.exercises) {
        if (!seen.has(exercise.exerciseId)) seen.set(exercise.exerciseId, exercise.name);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sessions]);

  const activeExerciseId = selectedId || exerciseOptions[0]?.id || '';

  const series = useMemo(() => {
    if (!activeExerciseId) return [];
    return sessions
      .map((workout) => {
        // Repeated segments (a swap keeps the done sets and returns the rest)
        // all count; the first segment alone would understate the chart.
        const found = exerciseInWorkout(workout, activeExerciseId);
        if (!found) return null;
        // Only a completed set is a performance: an untouched prescription is not.
        const best = bestCompletedSet(found.done);
        if (!best) return null;
        return {
          workoutId: workout.id,
          workoutName: workout.name,
          date: workout.date,
          best: best.weight,
          reps: best.reps,
        };
      })
      .filter(
        (item): item is {
          workoutId: string;
          workoutName: string;
          date: string;
          best: number;
          reps: number;
        } => item !== null,
      )
      .reverse()
      .slice(-8);
  }, [activeExerciseId, sessions]);

  // A bodyweight or hold exercise has no load to chart; its recorded count is
  // shown as it was logged instead of as a zero-kg strength record.
  // shortcut: the flag is per exercise, so a lifted movement that once logged
  // a zero-kg set still charts that one point on the baseline.
  const weighted = series.some((point) => point.best > 0);
  const latest = series[series.length - 1];
  // The program owns per-hand vs total; "18 kg" alone would drop that.
  const loadMode = loadModeOf(activeExerciseId);
  const loadText = (kg: number) =>
    kg <= 0
      ? 'Bodyweight'
      : `${plannedLoad(loads, history, activeExerciseId, unit)(kg)} ${unitLabel(unit)}${loadMode === 'each' ? ' each' : loadMode === 'total' ? ' total' : ''}`;
  const sessionLabel = (point: { date: string; workoutName: string }) =>
    `${dateParts(point.date).month} ${dateParts(point.date).day} · ${point.workoutName}`;

  const worked = sessions.filter(hasWork);
  const totalSets = worked.reduce((sum, workout) => sum + setsOf(workout), 0);
  const totalMinutes = worked.reduce((sum, workout) => sum + minutesOf(workout), 0);

  const max = Math.max(...series.map((point) => point.best), 1);
  const points = series.map((point, index) => {
    const x = 12 + (index * (CHART_W - 24)) / Math.max(1, series.length - 1);
    const y = CHART_H - 18 - (point.best / max) * (CHART_H - 36);
    return { ...point, x, y };
  });
  const path = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">Progress.</h1>
        </div>
        <button className="icon-btn" onClick={onExport} aria-label="Export backup">
          <DownloadIcon />
        </button>
      </header>
      <p className="page-sub">Your records tell the story. No invented scores.</p>

      <div className="segmented" role="tablist" aria-label="Progress views">
        <button
          role="tab"
          aria-selected={tab === 'overview'}
          className={tab === 'overview' ? 'on' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? 'on' : ''}
          onClick={() => setTab('history')}
        >
          Session history
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="stats-3">
            <div className="stat">
              <span className="stat-label">Sessions recorded</span>
              <span className="stat-value">{worked.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Working sets</span>
              <span className="stat-value">{totalSets}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Minutes invested</span>
              <span className="stat-value">{totalMinutes}</span>
            </div>
          </div>

          <div className="card">
            <span className="kicker">ONE EXERCISE AT A TIME</span>
            <h2 className="card-title">Working loads</h2>
            {exerciseOptions.length > 0 ? (
              <>
                <select
                  className="select"
                  style={{ marginTop: 14 }}
                  value={activeExerciseId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  aria-label="Exercise to chart"
                >
                  {exerciseOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <p className="data-note" style={{ marginTop: 10 }}>
                  {weighted ? `Best recorded load per set · ${unit}` : 'Best recorded set per session'}.
                  Open any session to compare the full record.
                </p>
                {series.length === 0 ? (
                  <p className="data-note" style={{ marginTop: 14 }}>
                    No completed sets recorded for this exercise yet.
                  </p>
                ) : weighted ? (
                  <>
                    <svg
                      className="chart"
                      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                      role="img"
                      aria-label={`Best set load for ${exerciseOptions.find((option) => option.id === activeExerciseId)?.name ?? 'exercise'} across ${series.length} sessions`}
                    >
                      <defs>
                        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#c5f777" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="#c5f777" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <line x1="8" y1={CHART_H - 18} x2={CHART_W - 8} y2={CHART_H - 18} stroke="#2c3427" />
                      {points.length > 1 && (
                        <polygon
                          points={`${path} ${points[points.length - 1].x},${CHART_H - 18} ${points[0].x},${CHART_H - 18}`}
                          fill="url(#fill)"
                        />
                      )}
                      {points.length > 1 && (
                        <polyline
                          points={path}
                          fill="none"
                          stroke="#c5f777"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                      {points.map((point, index) => (
                        <circle
                          key={point.workoutId}
                          cx={point.x}
                          cy={point.y}
                          r={index === points.length - 1 ? 4.5 : 3}
                          fill={index === points.length - 1 ? '#c5f777' : '#7f9960'}
                        />
                      ))}
                    </svg>
                    <div className="context-row" style={{ borderBottom: 0 }}>
                      <span>
                        Latest best set{latest ? ` · ${sessionLabel(latest)}` : ''}
                      </span>
                      <span>
                        {loadText(latest?.best ?? 0)} × {latest?.reps ?? 0}
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    {series.slice(-4).map((point) => (
                      <div className="context-row" key={point.workoutId} style={{ borderBottom: 0 }}>
                        <span>{sessionLabel(point)}</span>
                        <span>{setText(activeExerciseId, point.reps)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="chart-empty">
                <div className="bars">
                  <BarIcon />
                </div>
                <h3>Your first session starts the story.</h3>
                <p>Complete a set to see your own data here.</p>
                <button className="text-link" onClick={onGoTrain}>
                  Go to your workout
                  <ArrowIcon />
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="history-list">
          {sessions.length === 0 && (
            <p className="note-card">No sessions recorded yet. Finish a workout and it appears here.</p>
          )}
          {sessions.map((workout) => {
            const parts = dateParts(workout.date);
            const open = openId === workout.id;
            return (
              <div key={workout.id}>
                <button
                  className="history-row"
                  onClick={() => setOpenId(open ? null : workout.id)}
                  aria-expanded={open}
                >
                  <span className="history-date">
                    <span>{parts.month}</span>
                    <strong>{parts.day}</strong>
                  </span>
                  <span>
                    <strong className="history-name">{workout.name}</strong>
                    <span className="history-meta">
                      {minutesOf(workout)} min · {setsOf(workout)} {setsOf(workout) === 1 ? 'set' : 'sets'}
                      {workout.completedEarly ? ' · Finished early' : ''}
                    </span>
                  </span>
                  <span className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
                    <ChevronIcon />
                  </span>
                </button>

                {open && (
                  <div className="history-detail">
                    <p className="data-note" style={{ marginTop: 0 }}>
                      Recorded sets can be corrected here. Changes save immediately and never modify the
                      original prescription.
                    </p>
                    {workout.exercises.map((exercise, exerciseIndex) => {
                      const done = exercise.performed.filter((set) => set.done).length;
                      const timed = setUnit(exercise.exerciseId) === 'seconds';
                      const loaded = needsLoad(exercise.exerciseId);
                      const exerciseKey = `${workout.id}:${exerciseIndex}`;
                      const blocked = (set: { weight: number; done: boolean }) => loaded && !set.done && set.weight <= 0;
                      return (
                        <div className="history-ex" key={`${exercise.exerciseId}-${exerciseIndex}`}>
                          <div className="history-ex-head">
                            <span>{exercise.name}</span>
                            <span className="tag">
                              {timed
                                ? `${exercise.planned.length} ${exercise.planned.length === 1 ? 'set' : 'sets'} · ${setText(exercise.exerciseId, exercise.planned.map((set) => set.reps))}`
                                : `${exercise.planned.length} × ${exercise.planned[0]?.reps ?? 0}`} prescribed
                              {' · '}
                              {done} done
                              {exercise.skipped ? ' · Skipped' : ''}
                            </span>
                          </div>
                          <div className="history-sets">
                            {exercise.performed.map((set, setIndex) => (
                              <span className={`mini-set ${set.done ? 'done' : ''}`} key={setIndex}>
                                {!timed && (
                                  <>
                                    {/* A draft until blur or Enter, so it can be cleared and retyped. */}
                                    <input
                                      type="number"
                                      key={`${set.weight}:${unit}`}
                                      aria-label={`Correct weight for set ${setIndex + 1} of ${exercise.name}`}
                                      defaultValue={calibrationInputValue(set.weight, unit)}
                                      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                      onBlur={(event) => {
                                        const shown = String(calibrationInputValue(set.weight, unit));
                                        if (event.target.value === shown) return;
                                        const weight = toKg(Number(event.target.value) || 0, unit);
                                        if (loaded && set.done && weight <= 0) {
                                          event.target.value = shown;
                                          setRefused(exerciseKey);
                                          return;
                                        }
                                        setRefused('');
                                        onCorrect(workout.id, exerciseIndex, setIndex, { weight });
                                      }}
                                    />
                                    {unitLabel(unit)} ×
                                  </>
                                )}
                                <input
                                  type="number"
                                  aria-label={`Correct ${timed ? 'seconds' : 'reps'} for set ${setIndex + 1} of ${exercise.name}`}
                                  value={set.reps || ''}
                                  onChange={(event) =>
                                    onCorrect(workout.id, exerciseIndex, setIndex, {
                                      reps: Number(event.target.value) || 0,
                                    })
                                  }
                                />
                                {timed && ' seconds'}
                                <button
                                  disabled={blocked(set)}
                                  onClick={() =>
                                    onCorrect(workout.id, exerciseIndex, setIndex, {
                                      done: !set.done,
                                    })
                                  }
                                  aria-label={
                                    set.done
                                      ? `Unmark set ${setIndex + 1} of ${exercise.name}`
                                      : `Mark set ${setIndex + 1} of ${exercise.name} complete`
                                  }
                                  aria-pressed={set.done}
                                >
                                  {set.done ? <CheckIcon size={13} /> : '○'}
                                </button>
                              </span>
                            ))}
                          </div>
                          {(refused === exerciseKey || exercise.performed.some(blocked)) && (
                            <p className="data-note" role="status">{NEEDS_LOAD_REASON}</p>
                          )}
                        </div>
                      );
                    })}
                    <div className="history-ex">
                      <div className="history-ex-head">
                        <span>How it fit</span>
                        <span className="tag">
                          {workout.feedback ? feedbackLabel(workout.feedback) : 'No answer'}
                        </span>
                      </div>
                      <p className="data-note" style={{ marginTop: 0 }}>
                        Your own answer about this session. Changing or clearing it never touches the
                        recorded sets.
                      </p>
                      <div className="feedback-btns">
                        {FEEDBACK_CHOICES.map((choice) => (
                          <button
                            key={choice.value}
                            className={workout.feedback === choice.value ? 'on' : ''}
                            aria-pressed={workout.feedback === choice.value}
                            aria-label={`${choice.label} for ${workout.name}`}
                            onClick={() => onFeedback(workout.id, choice.value)}
                          >
                            {choice.label}
                          </button>
                        ))}
                        {workout.feedback && (
                          <button
                            className="secondary"
                            aria-label={`Clear feedback for ${workout.name}`}
                            onClick={() => onFeedback(workout.id, null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      className="danger"
                      style={{ marginTop: 10 }}
                      onClick={() => onDelete(workout.id)}
                    >
                      Delete workout
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="data-note">
        Records live in this browser only. Export a JSON backup before clearing site data.
      </p>
    </div>
  );
}
