import { Fragment, useEffect, useRef, useState } from 'react';
import { loadModeOf, NEEDS_LOAD_REASON, needsLoad, repsTarget, setUnit } from '../data/flagship';
import { exerciseById } from '../data/exercises';
import { elapsedMs, pendingExerciseIndex, restRemaining, sessionProgress } from '../lib/session';
import { isRestMuted, playRestCue, primeRestAudio, restEnded, setRestMuted, shouldCue } from '../lib/restCue';
import { applyDraft, openDraft, saveDraft } from '../lib/editDraft';
import type { EditDraft } from '../lib/editDraft';
import { exerciseInWorkout, lastPerformance } from '../lib/plan';
import { needsCalibration, plannedLoad } from '../lib/liveProgression';
import { nearestLoad, suggestedFirstLoad } from '../lib/firstLoad';
import { availableLoads } from '../lib/progression';
import { calibrationInputValue, loadLimitMessage, loadValue, typedLoad, unitLabel } from '../lib/units';
import { restLabel } from '../lib/sessionTime';
import { MAX_REPS } from '../lib/validate';
import type { Experience, PerformedSet, Profile, Unit, WorkoutExercise, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';
import { MoreIcon } from '../components/ui/Icons';

interface Props {
  session: WorkoutRecord;
  history: WorkoutRecord[];
  now: number;
  /** Confirmed dumbbell weights for the chosen setup. */
  loadOptions: number[];
  /** The profile's confirmed loads by equipment: the rack a logged load is compared with. */
  profileLoads?: Profile['loads'];
  /** Only the user's confirmed loads; the first-weight step never offers the example rack. */
  calibrationLoads?: number[];
  /** `sessionId:exerciseIndex:exerciseId` keys whose first-weight step was skipped. */
  skippedCalibrations?: string[];
  onSkipCalibration?: (key: string) => void;
  /** The profile's level: the first-weight step starts from a load suggested for it (#116). Absent, it suggests nothing. */
  experience?: Experience;
  /** Display unit. Records stay in kilograms. */
  unit: Unit;
  /** One factual reason per exercise for today's computed target. */
  targetNotes?: Record<string, string>;
  /** Rest after a set, per exercise in session order, by role (#132). */
  rests?: number[];
  onMinimize: () => void;
  onFinish: () => void;
  onUpdateSet: (exerciseIndex: number, setIndex: number, patch: Partial<PerformedSet>) => void;
  onConfirmWeight: (exerciseIndex: number, weight: number) => void;
  /** The exercise id lets the handler refuse a tap rendered against a since-changed session. */
  onLogSet: (exerciseIndex: number, setIndex: number, exerciseId: string) => void;
  onToggleRestPause: () => void;
  onExtendRest: () => void;
  onOpenActions: (exerciseIndex: number, mode?: 'instructions' | 'history') => void;
  /** (#151) Opens Replace for the remaining sets straight from the quick-action row. */
  onReplace?: (exerciseIndex: number) => void;
  onReturn: (exerciseIndex: number) => void;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function restClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** "4 × 12" or "2 × 45s"; a mixed prescription lists its reps rather than claim one number. */
function shortTarget(entry: WorkoutExercise): string {
  const reps = entry.planned.map((set) => set.reps);
  const same = reps.length > 0 && reps.every((value) => value === reps[0]);
  const seconds = setUnit(entry.exerciseId) === 'seconds' ? 's' : '';
  return same ? `${reps.length} × ${reps[0]}${seconds}` : repsTarget(entry.exerciseId, reps.length, entry.planned) ?? '';
}

/** The user's loads in one row: a tap writes that load to every set not yet logged (#66). */
export function WeightRow({ label, unitText, loads, selected, suggested = null, show, onPick }: {
  label: string;
  unitText: string;
  loads: number[];
  selected: number | null;
  /** Marked, not chosen: the tap still confirms it (#116). */
  suggested?: number | null;
  show: (kg: number) => string;
  onPick: (kg: number) => void;
}) {
  return (
    <div className="lg-quick" role="group" aria-label={`${label} (${unitText})`}>
      <span className="lg-quick__label" aria-hidden="true">{label}</span>
      {loads.map((weight) => (
        <button type="button" key={weight} aria-pressed={selected === weight}
          className={suggested === weight ? 'is-suggested' : undefined}
          aria-label={suggested === weight ? `${show(weight)}, suggested` : undefined} onClick={() => onPick(weight)}>
          {show(weight)}
        </button>
      ))}
    </div>
  );
}

/** A logged loaded set saves only with a load (#103). */
export function SaveSetRow({ needsWeight, onCancel, onSave }: {
  needsWeight: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {needsWeight && <p className="lg-coach lg-save-reason">{NEEDS_LOAD_REASON}</p>}
      <button className="pill-quiet" onClick={onCancel}>Cancel</button>
      <button className="pill-primary" disabled={needsWeight} onClick={onSave}>Save set</button>
    </>
  );
}

/**
 * First-load help for an uncalibrated variant. It starts from a load suggested by
 * the profile (#116), which the user confirms or changes; the warm-up it
 * describes is never recorded.
 * A load pill confirms with its own tap; a typed load needs Confirm.
 */
export function CalibrationStep({ selected = null, onConfirm, onSkip }: {
  selected?: number | null;
  onConfirm?: (weight: number) => void;
  onSkip: () => void;
}) {
  return (
    <div className="lg-first__step">
      <p className="data-note">
        Do 5 easy reps with it, then confirm or change. This warm-up is not logged.
      </p>
      <div className="lg-first__actions">
        <button className="pill-quiet" aria-label="Skip first-weight help" onClick={onSkip}>Skip</button>
        {onConfirm && (
          <button className="pill-primary" disabled={selected === null}
            onClick={() => selected !== null && onConfirm(selected)}>Confirm</button>
        )}
      </div>
    </div>
  );
}

/**
 * A typed load. One above the loader's limit is refused with a message and the
 * field falls back to the load held at focus, so nothing invalid is kept (#101).
 */
function LoadEntry({ weight, update, shown, unit, label }: {
  weight: number;
  update: (weight: number) => void;
  shown?: string;
  unit: Unit;
  label: string;
}) {
  const [refused, setRefused] = useState(false);
  const focused = useRef(weight);
  return (
    <>
      <input type="number" min="0" step="any" inputMode="decimal" aria-label={label} aria-invalid={refused || undefined}
        defaultValue={shown ?? calibrationInputValue(weight, unit)}
        onFocus={() => { focused.current = weight; }}
        onChange={(event) => {
          const next = typedLoad(event.target.value, unit, focused.current);
          if (!next) return;
          setRefused(next.refused);
          if (next.refused) event.target.value = calibrationInputValue(next.kg, unit);
          update(next.kg);
        }} />
      {refused && <span className="error-text" role="alert">{loadLimitMessage(unit)}</span>}
    </>
  );
}

export default function TrainScreen({
  session,
  history,
  now,
  loadOptions,
  profileLoads = {},
  calibrationLoads = [],
  skippedCalibrations = [],
  onSkipCalibration,
  experience,
  unit,
  targetNotes,
  rests = [],
  onMinimize,
  onFinish,
  onUpdateSet,
  onConfirmWeight,
  onLogSet,
  onToggleRestPause,
  onExtendRest,
  onOpenActions,
  onReplace,
  onReturn,
}: Props) {
  /** A logged set's edit; the record is untouched until Save set. */
  const [editing, setEditing] = useState<EditDraft | null>(null);
  /** The row whose editor is open, by its exercise-segment-set key. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** The calibration pick lives here until Confirm; nothing reaches the record before it. */
  const [calibration, setCalibration] = useState<{ key: string; weight: number } | null>(null);
  /** After the focused control unmounts, focus moves here (an element id, or 'log' for the next open ✓) instead of <body>. */
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    // A calibrating exercise has no open ✓ yet; its first-weight row comes first. After the last ✓, Finish.
    const element = target === 'log'
      ? document.querySelector<HTMLElement>('button.lg-check:not(:disabled)') ?? document.querySelector<HTMLElement>('.lg-first')
        ?? document.querySelector<HTMLElement>('.finish-btn')
      : document.getElementById(target);
    (element?.matches('button, input') ? element
      : element?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? element?.querySelector<HTMLElement>('button, input'))?.focus();
  });

  /** Edit controls write to the draft only; nothing reaches the record here. */
  const patchDraft = (patch: Partial<Pick<EditDraft, 'reps' | 'weight'>>) =>
    setEditing((draft) => (draft ? applyDraft(draft, patch) : draft));
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const restPaused = Boolean(session.restPausedAt);

  const [muted, setMuted] = useState(() => isRestMuted(session.id));
  const [restOver, setRestOver] = useState(false);
  // The typed field is uncontrolled: a rack tap remounts it, so it never shows a weight the pill replaced.
  const [rackTaps, setRackTaps] = useState(0);
  const [prevRest, setPrevRest] = useState(rest);
  const restActive = Boolean(session.restStartedAt);
  const ended = restEnded({ prev: prevRest, remaining: rest, active: restActive, paused: restPaused, muted });
  // Adjusting state during render keeps "Rest over" derived from the tick, not an effect.
  if (prevRest !== rest) setPrevRest(rest);
  if (ended && !restOver) setRestOver(true);
  if (rest > 0 && restOver) setRestOver(false);
  // The render above already advanced prevRest, so the tone reads its own ref.
  const cueFrom = useRef(rest);
  useEffect(() => {
    const prev = cueFrom.current;
    cueFrom.current = rest;
    if (shouldCue({ prev, remaining: rest, active: restActive, paused: restPaused, muted })) playRestCue();
  }, [rest, restActive, restPaused, muted]);

  // Only unskipped, unfinished work is offered. When nothing is left to log,
  // the trainer shows a review state instead of quietly landing on the last
  // exercise as if it were current.
  const index = pendingExerciseIndex(session);
  const exercise = index === -1 ? undefined : session.exercises[index];
  // Up next is work still on offer: never a skipped or finished exercise.
  const next = index === -1 ? undefined : session.exercises
    .find((entry, entryIndex) => entryIndex > index && !entry.skipped && entry.performed.some((set) => !set.done));
  const skippedToday = session.exercises
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => entry.skipped);

  const header = (
    <header className="flow-header lg-header">
      <div className="flow-header__inner">
        <button className="flow-back" onClick={onMinimize} aria-label="Minimize workout">
          <Icon name="arrow_back_ios_new" size={22} />
        </button>
        <h1 className="flow-title">{session.name}</h1>
        <div className="flow-header__right">
          <span className="lg-clock">{clock(elapsedMs(session, now))}</span>
          <button className="finish-btn" onClick={onFinish}>
            Finish
          </button>
        </div>
      </div>
    </header>
  );

  const bar = (
    <div className="progress-track lg-bar">
      <div
        className="progress-fill"
        style={{ width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%` }}
      />
    </div>
  );

  if (!exercise) {
    return (
      <div className="screen flow-screen">
        {header}

        <div className="flow-body" style={{ gap: 14 }}>
          <section className="card">
            <h2 style={{ fontSize: 20, letterSpacing: '-0.02em' }}>
              {session.exercises.length === 0
                ? 'This session has no exercises'
                : 'All remaining work is skipped'}
            </h2>
            <p className="data-note" style={{ marginTop: 8 }}>
              {progress.done} of {progress.total} sets completed · {progress.skipped} skipped
              {progress.pending > 0 ? ` · ${progress.pending} not logged` : ''}. Skipping records
              nothing, and Finish saves only completed sets.
            </p>
          </section>

          {session.exercises.map((entry, entryIndex) => {
            const done = entry.performed.filter((set) => set.done).length;
            const pendingSets = entry.performed.filter((set) => !set.done).length;
            return (
              <div className="card" key={`${entry.exerciseId}-${entryIndex}`}>
                <div className="context-row" style={{ borderBottom: 0 }}>
                  <span>{entry.name}</span>
                  <span className="tag">
                    {done} of {entry.performed.length} sets
                    {entry.skipped ? ' · Skipped' : ''}
                    {!entry.skipped && pendingSets > 0 ? ' · Not logged' : ''}
                  </span>
                </div>
                {(entry.originalPlannedSets ?? 0) > entry.performed.length && (
                  <p className="data-note">
                    Original prescription: {entry.originalPlannedSets} sets. This session carried{' '}
                    {entry.performed.length}.
                  </p>
                )}
                {entry.skipped && pendingSets > 0 && (
                  <button className="pill-quiet" onClick={() => onReturn(entryIndex)}>
                    Return to exercise
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flow-dock flow-dock--edge">
          <div className="progress-line">
            <span>Workout progress</span>
            <strong>
              {progress.done} of {progress.total} sets
            </strong>
          </div>
          {bar}
          <button className="save-bar" onClick={onFinish}>
            {progress.done === 0 ? 'Finish or discard' : 'Finish workout'}
          </button>
        </div>
      </div>
    );
  }

  const activeSet = exercise.performed.findIndex((set) => !set.done);
  const mode = loadModeOf(exercise.exerciseId);
  const equipment = exerciseById(exercise.exerciseId)?.equipment ?? (mode === 'none' ? 'Bodyweight' : 'Dumbbell');
  const weightLabel =
    mode === 'total'
      ? `${unitLabel(unit)} total`
      : mode === 'each'
        ? `${unitLabel(unit)} each`
        : 'bodyweight';
  /** Loads are stored in kilograms; only the readout converts. */
  // One rule for planned and logged loads alike (history holds earlier sessions' typed loads).
  const showWeight = plannedLoad(profileLoads, history, exercise.exerciseId, unit);
  // Only confirmed loads are on the rack; anything else was typed and keeps its value.
  const rack = availableLoads({ loads: profileLoads }, equipment);
  const showActual = (kg: number) => loadValue(kg, unit, rack);
  // A set (pending or saved) at the load the app planned for it reads like the target; an edited one keeps its typed value.
  const showPending = (kg: number, setIndex: number) =>
    Math.abs(kg - (exercise.planned[setIndex]?.weight ?? -1)) < 0.001 ? showWeight(kg) : showActual(kg);
  const last = lastPerformance(history, exercise.exerciseId);
  const previous = last ? exerciseInWorkout(last.workout, exercise.exerciseId)?.done ?? [] : [];
  const holdUnit = setUnit(exercise.exerciseId) === 'seconds';
  const canPickWeight = equipment === 'Dumbbell' && loadOptions.length > 0;
  // A dumbbell with no confirmed rack is typed, the same way a barbell load is.
  const canEnterWeight = mode !== 'none' && !canPickWeight;
  const loadEntry = (weight: number, update: (weight: number) => void, shown?: string,
    label = `Enter ${equipment.toLowerCase()} load (${weightLabel})`) => (
    <LoadEntry weight={weight} update={update} shown={shown} unit={unit} label={label} />
  );

  // #80: everything a row renders is keyed by exercise, segment and set, so a
  // skip or swap mounts fresh controls instead of reusing another exercise's.
  const exerciseKey = `${exercise.exerciseId}:${index}`;
  const rowKey = (setIndex: number) => `${exerciseKey}:${setIndex}`;
  const calibrationKey = `${session.id}:${index}:${exercise.exerciseId}`;
  // Untouched (undefined), the step holds the suggested load; a cleared field (0) holds none.
  const touched = calibration?.key === calibrationKey ? calibration.weight : undefined;
  const canPickCalibration = equipment === 'Dumbbell' && calibrationLoads.length > 0;
  const calibrating = (canPickCalibration || canEnterWeight)
    && !skippedCalibrations.includes(calibrationKey) && needsCalibration(exercise, history);
  const choose = (weight: number) => setCalibration({ key: calibrationKey, weight });
  const quickLoads = calibrating ? (canPickCalibration ? calibrationLoads : []) : canPickWeight ? loadOptions : [];
  const definition = exerciseById(exercise.exerciseId);
  const table = calibrating && experience && definition ? suggestedFirstLoad(definition, experience, unit) : 0;
  const suggested = table > 0 ? (quickLoads.length > 0 ? nearestLoad(quickLoads, table) : table) : null;
  const held = touched === undefined ? suggested : touched > 0 ? touched : null;
  const coach = calibrating
    ? `First time on this one. Pick a weight you could lift for ${exercise.planned[0]?.reps ?? 10} reps with 2–3 to spare.`
    : targetNotes?.[exercise.exerciseId];

  const openEditor = (set: PerformedSet, setIndex: number, field: 'weight' | 'reps') => {
    const key = rowKey(setIndex);
    setEditing(set.done ? openDraft(index, setIndex, set) : null);
    setOpenKey(key);
    focusNext.current = `${key}:edit-${field}`;
  };
  const closeEditor = (key: string) => {
    setEditing(null);
    setOpenKey(null);
    focusNext.current = `${key}:reps`;
  };
  /** Save set is the only path that writes an edited set; it keeps its original timestamp. */
  const saveEditing = (key: string) => {
    const set = editing && session.exercises[editing.exerciseIndex]?.performed[editing.setIndex];
    if (editing && set) onUpdateSet(editing.exerciseIndex, editing.setIndex, saveDraft(editing, set));
    closeEditor(key);
  };

  const editor = (set: PerformedSet, setIndex: number, key: string, draft: EditDraft | null) => {
    const value = draft ?? set;
    const patch = draft ? patchDraft : (change: Partial<PerformedSet>) => onUpdateSet(index, setIndex, change);
    return (
      <div className="set-card lg-editor" role="group"
        aria-label={draft ? `Edit logged set ${setIndex + 1}` : `Set ${setIndex + 1}`}>
        {mode !== 'none' && (
          <div className="aw-field" id={`${key}:edit-weight`}>
            <div className="aw-field__label">
              <span>Weight ({weightLabel})</span>
              <span className="aw-field__note">{equipment}</span>
            </div>
            {canPickWeight && (
              <div className="weight-pills">
                {loadOptions.map((weight) => (
                  <button key={weight} aria-pressed={value.weight === weight}
                    onClick={() => { patch({ weight }); setRackTaps((taps) => taps + 1); }}>
                    {showWeight(weight)}
                  </button>
                ))}
              </div>
            )}
            {/* A listed rack is a shortcut, never a cap: a gym has more than the user listed (#129). */}
            <Fragment key={rackTaps}>
              {loadEntry(value.weight, (weight) => patch({ weight }), draft ? undefined : showPending(set.weight, setIndex),
                `Set ${setIndex + 1} load (${weightLabel})`)}
            </Fragment>
          </div>
        )}
        <div className="reps-field">
          <div className="reps-field__label">{holdUnit ? 'Seconds held' : 'Reps completed'}</div>
          <div className="stepper" id={`${key}:edit-reps`}>
            <button onClick={() => patch({ reps: Math.max(0, value.reps - 1) })}
              aria-label={holdUnit ? 'Decrease seconds' : 'Decrease reps'}>
              <Icon name="remove" size={20} />
            </button>
            <output aria-live="polite">{value.reps}</output>
            <button onClick={() => patch({ reps: value.reps + 1 })} disabled={value.reps >= MAX_REPS}
              aria-label={holdUnit ? 'Increase seconds' : 'Increase reps'}>
              <Icon name="add" size={20} />
            </button>
          </div>
        </div>
        <div className="review-footer__row">
          {draft ? (
            <SaveSetRow needsWeight={needsLoad(exercise.exerciseId) && draft.weight <= 0}
              onCancel={() => closeEditor(key)} onSave={() => saveEditing(key)} />
          ) : (
            <button className="pill-quiet" onClick={() => closeEditor(key)}>Done</button>
          )}
        </div>
      </div>
    );
  };

  const rows = exercise.performed.flatMap((set, setIndex) => {
    const key = rowKey(setIndex);
    const n = setIndex + 1;
    const draft = editing && editing.exerciseIndex === index && editing.setIndex === setIndex ? editing : null;
    // A logged set is only ever edited through its draft.
    const open = openKey === key && (!set.done || draft !== null);
    const before = previous[setIndex];
    const noLoad = needsLoad(exercise.exerciseId) && set.weight <= 0;
    // While calibrating, the first-weight row already says what to do.
    const reason = !set.done && noLoad && !calibrating && setIndex === activeSet ? `${key}:reason` : undefined;
    const row = (
      <tr key={key} className={set.done ? 'lg-row--done' : setIndex === activeSet ? 'lg-row--current' : undefined}>
        <td>{n}</td>
        <td className="lg-prev">
          {!before ? '—' : before.weight > 0 ? `${showWeight(before.weight)} × ${before.reps}` : `${before.reps}${holdUnit ? 's' : ''}`}
        </td>
        <td>
          {mode === 'none' ? (
            <span className="lg-cell lg-cell--bw">BW</span>
          ) : (
            <button type="button" className={set.weight > 0 ? 'lg-cell' : 'lg-cell lg-cell--empty'} id={`${key}:weight`}
              aria-label={`Edit weight for set ${n}`} aria-expanded={open} onClick={() => openEditor(set, setIndex, 'weight')}>
              {set.weight > 0 ? showPending(set.weight, setIndex) : '—'}
            </button>
          )}
        </td>
        <td>
          <button type="button" className="lg-cell" id={`${key}:reps`}
            aria-label={`Edit ${holdUnit ? 'seconds' : 'reps'} for set ${n}`} aria-expanded={open}
            onClick={() => openEditor(set, setIndex, 'reps')}>
            {`${set.reps}${holdUnit ? 's' : ''}`}
          </button>
        </td>
        <td>
          {set.done ? (
            <span className="lg-check" role="img" aria-label={`Set ${n} logged`}>
              <Icon name="check" size={20} />
            </span>
          ) : (
            <button type="button" className="lg-check" aria-label={`Log set ${n}`} disabled={calibrating || noLoad}
              aria-describedby={reason}
              onClick={() => {
                primeRestAudio();
                if (openKey === key) setOpenKey(null);
                focusNext.current = 'log';
                onLogSet(index, setIndex, exercise.exerciseId);
              }}>
              <Icon name="check" size={20} />
            </button>
          )}
        </td>
      </tr>
    );
    const note = reason && <tr key={reason} className="lg-note"><td colSpan={5} id={reason}>{NEEDS_LOAD_REASON}</td></tr>;
    return [row, note, open && <tr key={`${key}:edit`} className="lg-edit"><td colSpan={5}>{editor(set, setIndex, key, draft)}</td></tr>]
      .filter(Boolean);
  });

  return (
    <div className="screen flow-screen">
      {header}

      <div className="flow-body lg-body">
        <section className="lg-ex" aria-label={exercise.name}>
          <button type="button" className="lg-thumb" onClick={() => onOpenActions(index, 'instructions')}
            aria-label={`${exercise.name} demo and instructions`} aria-haspopup="dialog">
            <Demo exerciseId={exercise.exerciseId} name={exercise.name} eager />
            <span className="lg-thumb__play" aria-hidden="true"><Icon name="play_arrow" size={12} /></span>
          </button>
          <div className="lg-ex__text">
            <h2 className="aw-exercise__name">
              <button className="aw-exercise__name-btn" onClick={() => onOpenActions(index)} aria-haspopup="dialog">
                {exercise.name}
              </button>
            </h2>
            <p className="lg-ex__meta">
              Exercise {index + 1} of {session.exercises.length} · Target <b>{shortTarget(exercise)}</b>
              {rests[index] ? <> · Rest {restLabel(rests[index])}</> : null}
            </p>
          </div>
          {/* The same menu the row opens: instructions, history, replace, remove for today. */}
          <button className="lg-more" onClick={() => onOpenActions(index)}
            aria-label={`More actions for ${exercise.name}`} aria-haspopup="dialog">
            <MoreIcon size={18} />
          </button>
        </section>

        {/* (#151) One-tap shortcuts into the same actions the menu holds. */}
        <div className="lg-acts" role="group" aria-label={`Actions for ${exercise.name}`}>
          <button type="button" className="lg-act" onClick={() => onOpenActions(index, 'instructions')} aria-haspopup="dialog">
            <Icon name="play_arrow" size={16} />How-to
          </button>
          <button type="button" className="lg-act" onClick={() => onOpenActions(index, 'history')} aria-haspopup="dialog">
            <Icon name="monitoring" size={16} />History
          </button>
          {onReplace && (
            <button type="button" className="lg-act" onClick={() => onReplace(index)} aria-haspopup="dialog">
              <Icon name="tune" size={16} />Replace
            </button>
          )}
        </div>

        {coach && <p className="lg-coach">{coach}</p>}

        {mode !== 'none' && (quickLoads.length > 0 || calibrating) && (
          <div className="lg-first" key={exerciseKey} id={`${exerciseKey}:first`}>
            {quickLoads.length > 0 && (
              <WeightRow label={canPickCalibration ? 'Your dumbbells' : 'Dumbbells'} unitText={weightLabel}
                loads={quickLoads} selected={exercise.performed[activeSet]?.weight ?? null}
                suggested={calibrating && touched === undefined ? suggested : null} show={showWeight}
                onPick={(weight) => { onConfirmWeight(index, weight); setRackTaps((taps) => taps + 1); }} />
            )}
            {calibrating && (
              <label className="lg-first__typed">
                <span>{quickLoads.length > 0 ? 'Or type a weight' : 'Weight'} ({weightLabel})</span>
                {loadEntry(held ?? 0, choose)}
              </label>
            )}
            {suggested !== null && experience && (
              <p className="data-note">
                Suggested: {calibrationInputValue(suggested, unit)} {weightLabel}, from your {experience} setup. Change it if it feels off.
              </p>
            )}
            {calibrating && (
              <CalibrationStep
                selected={held}
                onConfirm={(weight) => {
                  focusNext.current = 'log';
                  onConfirmWeight(index, weight);
                }}
                onSkip={() => {
                  focusNext.current = `${rowKey(Math.max(activeSet, 0))}:weight`;
                  onSkipCalibration?.(calibrationKey);
                }}
              />
            )}
          </div>
        )}

        <table className="lg-table" aria-label={`Sets for ${exercise.name}`}>
          <thead>
            <tr>
              <th scope="col">Set</th>
              <th scope="col">Previous</th>
              <th scope="col">{mode === 'none' ? 'Load' : weightLabel}</th>
              <th scope="col">{holdUnit ? 'Secs' : 'Reps'}</th>
              <th scope="col"><span className="sr-only">Log</span></th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>

        <div className="sr-only" role="status" aria-live="polite">
          {restOver ? 'Rest over' : ''}
        </div>

        {next && (
          <div className="lg-next">
            <span>Up next · <b>{next.name}</b></span>
            <span className="lg-next__target">{shortTarget(next)}</span>
          </div>
        )}

        {skippedToday.length > 0 && (
          <section aria-label="Skipped today">
            <div className="lg-skipped__head">
              <h2>Skipped today</h2>
              <span>Nothing recorded</span>
            </div>
            {skippedToday.map(({ entry, entryIndex }) => {
              const pendingSets = entry.performed.filter((set) => !set.done).length;
              return (
                <div className="context-row" key={`skipped-${entryIndex}`}>
                  <span>
                    {entry.name} · {pendingSets} {pendingSets === 1 ? 'set' : 'sets'}
                  </span>
                  <button className="pill-quiet" onClick={() => onReturn(entryIndex)}>
                    Return to exercise
                  </button>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <div className="flow-dock lg-dock">
        {rest > 0 && (
          <div className="lg-rest" role="timer" aria-label={`Rest, ${rest} seconds remaining`}>
            <span className="lg-rest__time">{restClock(rest)}</span>
            <span className="lg-rest__label">Rest</span>
            <button onClick={onExtendRest} aria-label="Add 30 seconds of rest">+30s</button>
            <button onClick={onToggleRestPause}>{restPaused ? 'Resume' : 'Pause'}</button>
            <button
              aria-pressed={muted}
              aria-label="Mute rest cue"
              onClick={() => {
                primeRestAudio();
                setRestMuted(session.id, !muted);
                setMuted(!muted);
              }}
            >
              {muted ? 'Muted' : 'Mute'}
            </button>
          </div>
        )}
        {bar}
        <p className="lg-cap">{progress.done} of {progress.total} sets</p>
      </div>
    </div>
  );
}
