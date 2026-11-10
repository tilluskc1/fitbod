import { useMemo, useRef, useState } from 'react';
import { loadModeOf, NEEDS_LOAD_REASON, needsLoad, setText, setUnit } from '../data/flagship';
import {
  calibrationInputValue, correctionBlur, correctionKeystroke, loadLimitMessage, repsLimitMessage, typedReps, unitLabel,
} from '../lib/units';
import { plannedLoad } from '../lib/liveProgression';
import { bestCompletedSet, exerciseInWorkout } from '../lib/plan';
import { doneSets, progressTotals, trainedMinutes } from '../lib/progressTotals';
import type { Profile, Unit, WorkoutFeedback, WorkoutRecord } from '../types';
import { FEEDBACK_CHOICES, feedbackLabel } from '../lib/feedback';
import { ArrowIcon, CheckIcon, ChevronIcon, DownloadIcon } from '../components/ui/Icons';

/** (#294) Session history with nothing in it. */
export const NO_WORKOUTS_YET = 'No workouts yet. Your first one will appear here.';

interface Props {
  history: WorkoutRecord[];
  unit: Unit;
  /** The profile's confirmed loads, so a rack load reads like the target. */
  loads?: Profile['loads'];
  /** (#293) Opens the backup sheet; nothing is saved until the user confirms there. */
  onBackup: () => void;
  onCorrect: (
    workoutId: string,
    exerciseIndex: number,
    setIndex: number,
    patch: { weight?: number; reps?: number; done?: boolean },
    /** Why the typed value was refused; the patch then carries the focus value (#101, #109). */
    refused?: string,
  ) => void;
  onDelete: (workoutId: string) => void;
  onFeedback: (workoutId: string, value: WorkoutFeedback | null) => void;
  /** (#294) A workout is under way: the empty state resumes it instead of starting today's. */
  running?: boolean;
  /** Opens today's preview (Today's Start), or resumes the running workout. */
  onStartToday: () => void;
  /** Today has nothing to start, as Today's own Preview button is then disabled. */
  startDisabled?: boolean;
  /** Which view opens first; tests render Session history directly. */
  initialTab?: 'overview' | 'history';
}

const minutesOf = (workout: WorkoutRecord) => trainedMinutes(workout).minutes;
const setsOf = doneSets;

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
  onBackup,
  onCorrect,
  onDelete,
  onFeedback,
  running = false,
  onStartToday,
  startDisabled = false,
  initialTab = 'overview',
}: Props) {
  const [tab, setTab] = useState<'overview' | 'history'>(initialTab);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The weight a history field held when focused; a refused load reverts to it (#101). */
  const focusedLoad = useRef<number | null>(null);
  /** The reps a history field held when focused; refused reps revert to it (#109). */
  const focusedReps = useRef<number | null>(null);
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

  const totals = progressTotals(sessions);

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
        <button className="icon-btn" onClick={onBackup} aria-label="Back up workouts">
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

      {tab === 'overview' && totals.workouts === 0 ? (
        // (#294) No finished workout yet: say what is missing and the one action that fixes it.
        <div className="empty-state progress-empty">
          <h2 className="progress-empty__title">Your progress starts with your first workout.</h2>
          <p>After it, you'll see your workouts, sets and minutes here, and a chart for each lift.</p>
          <button className="primary" onClick={onStartToday} disabled={!running && startDisabled}>
            {running ? 'Resume workout' : "Start today's workout"}
            <ArrowIcon />
          </button>
        </div>
      ) : tab === 'overview' ? (
        <>
          <div className="stats-3">
            <div className="stat">
              <span className="stat-label">Workouts</span>
              <span className="stat-value">{totals.workouts}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Sets</span>
              <span className="stat-value">{totals.sets}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Minutes</span>
              <span className="stat-value">{totals.minutes}</span>
            </div>
          </div>
          <p className="stats-note">all time</p>
          {totals.approx && <p className="stats-note">≈ includes planned time for older workouts.</p>}

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
                      <line x1="8" y1={CHART_H - 18} x2={CHART_W - 8} y2={CHART_H - 18} stroke="#dde8e6" />
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
                          stroke="#5c9ab5"
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
                          fill={index === points.length - 1 ? '#2f6f88' : '#8fb7c7'}
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
            ) : null}
          </div>
        </>
      ) : (
        <div className="history-list">
          {/* (#294) Empty or all-skipped records count as none, here as on Overview: no "0 sets" row. */}
          {totals.workouts === 0 && <p className="note-card">{NO_WORKOUTS_YET}</p>}
          {(totals.workouts === 0 ? [] : sessions).map((workout) => {
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
                                    {/* Saved per keystroke; a missing (#103) or over-limit (#101) load reverts to the focus value on blur. */}
                                    <input
                                      type="number"
                                      key={unit}
                                      aria-label={`Correct weight for set ${setIndex + 1} of ${exercise.name}`}
                                      defaultValue={calibrationInputValue(set.weight, unit)}
                                      onFocus={() => { focusedLoad.current = set.weight; }}
                                      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                      onChange={(event) => {
                                        const kg = correctionKeystroke(event.target.value, unit,
                                          focusedLoad.current ?? set.weight, loaded && set.done);
                                        if (kg !== null) onCorrect(workout.id, exerciseIndex, setIndex, { weight: kg });
                                      }}
                                      onBlur={(event) => {
                                        const focused = focusedLoad.current ?? set.weight;
                                        focusedLoad.current = null;
                                        const revert = correctionBlur(event.target.value, unit, focused, loaded && set.done);
                                        setRefused(revert?.reason === 'needs-load' ? exerciseKey : '');
                                        if (!revert) return;
                                        event.target.value = calibrationInputValue(revert.kg, unit);
                                        onCorrect(workout.id, exerciseIndex, setIndex, { weight: revert.kg },
                                          revert.reason === 'limit' ? loadLimitMessage(unit) : undefined);
                                      }}
                                    />
                                    {unitLabel(unit)} ×
                                  </>
                                )}
                                <input
                                  type="number"
                                  aria-label={`Correct ${timed ? 'seconds' : 'reps'} for set ${setIndex + 1} of ${exercise.name}`}
                                  value={set.reps || ''}
                                  onFocus={() => { focusedReps.current = set.reps; }}
                                  onBlur={() => { focusedReps.current = null; }}
                                  onChange={(event) => {
                                    const next = typedReps(event.target.value, focusedReps.current ?? set.reps);
                                    onCorrect(workout.id, exerciseIndex, setIndex, { reps: next.reps },
                                      next.refused ? repsLimitMessage(timed) : undefined);
                                  }}
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
