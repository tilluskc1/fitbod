import { useState } from 'react';
import { loadModeOf, detailOf, repsTarget, setText, setUnit } from '../data/flagship';
import type { LoadMode } from '../data/flagship';
import { elapsedMs, pendingExerciseIndex, restRemaining, sessionProgress } from '../lib/session';
import { applyDraft, openDraft, saveDraft } from '../lib/editDraft';
import type { EditDraft } from '../lib/editDraft';
import { lastPerformance } from '../lib/plan';
import { calibrationInputValue, displayValue, toKg, unitLabel } from '../lib/units';
import { exerciseById } from '../data/exercises';
import type { PerformedSet, Unit, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';

interface Props {
  session: WorkoutRecord;
  history: WorkoutRecord[];
  now: number;
  /** Confirmed dumbbell weights for the chosen setup. */
  loadOptions: number[];
  /** Display unit. Records stay in kilograms. */
  unit: Unit;
  onMinimize: () => void;
  onFinish: () => void;
  onUpdateSet: (exerciseIndex: number, setIndex: number, patch: Partial<PerformedSet>) => void;
  onLogNext: () => void;
  onToggleRestPause: () => void;
  onExtendRest: () => void;
  onSwap: (exerciseIndex: number) => void;
  onSkip: (exerciseIndex: number) => void;
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

function setSummary(
  exerciseId: string,
  reps: number,
  weight: number,
  mode: LoadMode,
  unit: Unit,
): string {
  const load =
    weight > 0
      ? ` @ ${calibrationInputValue(weight, unit)} ${unitLabel(unit)}${mode === 'total' ? ' total' : mode === 'each' ? ' each' : ''}`
      : '';
  return `${setText(exerciseId, reps)}${load}`;
}

export default function TrainScreen({
  session,
  history,
  now,
  loadOptions,
  unit,
  onMinimize,
  onFinish,
  onUpdateSet,
  onLogNext,
  onToggleRestPause,
  onExtendRest,
  onSwap,
  onSkip,
  onReturn,
}: Props) {
  const [editing, setEditing] = useState<EditDraft | null>(null);

  /** Edit controls write to the draft only; nothing reaches the record here. */
  const patchDraft = (patch: Partial<Pick<EditDraft, 'reps' | 'weight'>>) =>
    setEditing((draft) => (draft ? applyDraft(draft, patch) : draft));
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const restPaused = Boolean(session.restPausedAt);

  // Only unskipped, unfinished work is offered. When nothing is left to log,
  // the trainer shows a review state instead of quietly landing on the last
  // exercise as if it were current.
  const activeIndex = pendingExerciseIndex(session);
  const index = activeIndex;
  const exercise = activeIndex === -1 ? undefined : session.exercises[activeIndex];
  const next = activeIndex === -1 ? undefined : session.exercises[activeIndex + 1];
  const nothingPending = activeIndex === -1;
  const skippedToday = session.exercises
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => entry.skipped);

  if (!exercise) {
    return (
      <div className="screen flow-screen">
        <header className="flow-header">
          <div className="flow-header__inner">
            <button className="flow-back" onClick={onMinimize} aria-label="Minimize workout">
              <Icon name="arrow_back_ios_new" size={22} />
            </button>
            <h1 className="flow-title">
              {session.name} <span>({session.durationMin ?? 35} min)</span>
            </h1>
            <div className="flow-header__right">
              <span className="elapsed-chip">
                <Icon name="timer" size={16} />
                {clock(elapsedMs(session, now))}
              </span>
              <button className="finish-btn" onClick={onFinish}>
                Finish
              </button>
            </div>
          </div>
        </header>

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
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
              }}
            />
          </div>
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
  const detail = detailOf(exercise.exerciseId);
  const weightLabel =
    mode === 'total'
      ? `${unitLabel(unit)} total`
      : mode === 'each'
        ? `${unitLabel(unit)} each`
        : 'bodyweight';
  /** Loads are stored in kilograms; only the readout converts. */
  const showWeight = (kg: number) => displayValue(kg, unit);
  const showActual = (kg: number) => calibrationInputValue(kg, unit);
  const last = lastPerformance(history, exercise.exerciseId);
  const holdUnit = setUnit(exercise.exerciseId) === 'seconds';
  const plannedTarget = exercise.planned[activeSet === -1 ? exercise.planned.length - 1 : activeSet];
  /** "9 · 9" list for per-set targets, "8–10 reps" for a range, never "2 × 9". */
  const targetReps =
    repsTarget(exercise.exerciseId, exercise.planned.length, exercise.planned) ??
    exercise.planned.map((set) => set.reps).join(' · ');
  const targetWeight = exercise.planned[0]?.weight ?? 0;
  const canPickWeight = equipment === 'Dumbbell' && loadOptions.length > 0;
  const canEnterWeight = mode !== 'none' && equipment !== 'Dumbbell';
  const loadEntry = (weight: number, update: (weight: number) => void) => canEnterWeight ? (
    <input type="number" min="0" step="any" inputMode="decimal"
      aria-label={`Enter ${equipment.toLowerCase()} load (${weightLabel})`}
      defaultValue={calibrationInputValue(weight, unit)}
      onChange={(event) => {
        const value = Number(event.target.value);
        if (event.target.value === '') update(0);
        else if (Number.isFinite(value) && value >= 0) update(toKg(value, unit));
      }} />
  ) : null;

  const activeValues =
    activeSet === -1
      ? null
      : exercise.performed[activeSet];

  const logLabel = nothingPending
    ? 'Finish workout'
    : activeValues
      ? `Log set ${activeSet + 1} · ${
          activeValues.weight > 0
            ? `${setText(exercise.exerciseId, activeValues.reps)} @ ${showActual(activeValues.weight)} ${unitLabel(unit)}`
            : setText(exercise.exerciseId, activeValues.reps)
        }`
      : 'Log set';

  /** Save set is the only path that writes an edited set; it keeps its original timestamp. */
  const saveEditing = () => {
    if (!editing) return;
    const set = session.exercises[editing.exerciseIndex]?.performed[editing.setIndex];
    if (!set) {
      setEditing(null);
      return;
    }
    onUpdateSet(editing.exerciseIndex, editing.setIndex, saveDraft(editing, set));
    setEditing(null);
  };

  const renderSet = (set: PerformedSet, setIndex: number) => {
    const draft =
      editing && editing.exerciseIndex === index && editing.setIndex === setIndex ? editing : null;
    const editingElsewhere = Boolean(editing && editing.exerciseIndex === index);
    const isActive = setIndex === activeSet && !set.done && !editingElsewhere;

    if (draft) {
      return (
        <div className="set-card" key={setIndex}>
          <div className="set-card__head">
            <span className="set-card__num">{setIndex + 1}</span>
            <div>
              <div className="set-card__title">
                Set {setIndex + 1} of {exercise.performed.length}
              </div>
              <div className="set-card__sub">Editing saved set</div>
            </div>
            <span className="set-card__target">
              Saved: {setText(exercise.exerciseId, set.reps)}
              {set.weight > 0 ? ` · ${showActual(set.weight)} ${unitLabel(unit)}` : ''}
            </span>
          </div>

          <div className="aw-field">
            <div className="aw-field__label">
              <span>Weight ({weightLabel})</span>
              <span className="aw-field__note">{equipment}</span>
            </div>
            {canPickWeight ? (
              <div className="weight-pills">
                {loadOptions.map((weight) => (
                  <button
                    key={weight}
                    aria-pressed={draft.weight === weight}
                    onClick={() => patchDraft({ weight })}
                  >
                    {showWeight(weight)}
                  </button>
                ))}
              </div>
            ) : canEnterWeight ? loadEntry(draft.weight, (weight) => patchDraft({ weight })) : (
              <p style={{ fontSize: 14, color: 'var(--on-surface-variant)' }}>Bodyweight</p>
            )}
          </div>

          <div className="reps-field">
            <div>
              <div className="reps-field__label">
                {holdUnit ? 'Seconds held' : 'Reps completed'}
              </div>
              <div className="reps-field__hint">Tap + or − to adjust</div>
            </div>
            <div className="stepper">
              <button
                onClick={() => patchDraft({ reps: Math.max(0, draft.reps - 1) })}
                aria-label={holdUnit ? 'Decrease seconds' : 'Decrease reps'}
              >
                <Icon name="remove" size={20} />
              </button>
              <output aria-live="polite">{draft.reps}</output>
              <button
                onClick={() => patchDraft({ reps: draft.reps + 1 })}
                aria-label={holdUnit ? 'Increase seconds' : 'Increase reps'}
              >
                <Icon name="add" size={20} />
              </button>
            </div>
          </div>

          <div className="review-footer__row">
            <button className="pill-quiet" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="pill-primary" onClick={saveEditing}>
              Save set
            </button>
          </div>
        </div>
      );
    }

    if (set.done) {
      return (
        <div className="aw-set" key={setIndex}>
          <span className="aw-set__check" aria-label={`Set ${setIndex + 1} completed`}>
            <Icon name="check" size={20} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="aw-set__label">
              Set {setIndex + 1}: {setSummary(exercise.exerciseId, set.reps, set.weight, mode, unit)}
            </span>
          </span>
          <button
            className="aw-set__edit"
            onClick={() =>
              setEditing(openDraft(index, setIndex, set))
            }
            aria-label={`Edit set ${setIndex + 1}`}
          >
            <Icon name="edit" size={18} />
          </button>
        </div>
      );
    }

    if (!isActive) {
      return (
        <div className="aw-set" key={setIndex}>
          <span className="aw-set__check" aria-hidden="true" style={{ background: 'transparent', borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
            {setIndex + 1}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="aw-set__label">
              {setSummary(exercise.exerciseId, set.reps, set.weight, mode, unit)}
            </span>
          </span>
        </div>
      );
    }

    return (
      <div className="set-card" key={setIndex}>
        <div className="set-card__head">
          <span className="set-card__num">{setIndex + 1}</span>
          <div>
            <div className="set-card__title">
              Set {setIndex + 1} of {exercise.performed.length}
            </div>
            <div className="set-card__sub">Current set</div>
          </div>
          <span className="set-card__target">
            Target: {setText(exercise.exerciseId, plannedTarget?.reps ?? 0)}
            {(plannedTarget?.weight ?? 0) > 0
              ? ` · ${showWeight(plannedTarget.weight)} ${unitLabel(unit)}`
              : ''}
          </span>
        </div>

        <div className="aw-field">
          <div className="aw-field__label">
            <span>Weight ({weightLabel})</span>
            <span className="aw-field__note">{equipment}</span>
          </div>
          {canPickWeight ? (
            <div className="weight-pills">
              {loadOptions.map((weight) => (
                <button
                  key={weight}
                  aria-pressed={set.weight === weight}
                  onClick={() => onUpdateSet(index, setIndex, { weight })}
                >
                  {showWeight(weight)}
                </button>
              ))}
            </div>
          ) : canEnterWeight ? loadEntry(set.weight, (weight) => onUpdateSet(index, setIndex, { weight })) : (
            <p style={{ fontSize: 14, color: 'var(--on-surface-variant)' }}>Bodyweight</p>
          )}
        </div>

        <div className="reps-field">
          <div>
            <div className="reps-field__label">
              {holdUnit ? 'Seconds held' : 'Reps completed'}
            </div>
            <div className="reps-field__hint">Tap + or − to adjust</div>
          </div>
          <div className="stepper">
            <button
              onClick={() => onUpdateSet(index, setIndex, { reps: Math.max(0, set.reps - 1) })}
              aria-label={holdUnit ? 'Decrease seconds' : 'Decrease reps'}
            >
              <Icon name="remove" size={20} />
            </button>
            <output aria-live="polite">{set.reps}</output>
            <button
              onClick={() => onUpdateSet(index, setIndex, { reps: set.reps + 1 })}
              aria-label={holdUnit ? 'Increase seconds' : 'Increase reps'}
            >
              <Icon name="add" size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="screen flow-screen">
      <header className="flow-header">
        <div className="flow-header__inner">
          <button className="flow-back" onClick={onMinimize} aria-label="Minimize workout">
            <Icon name="arrow_back_ios_new" size={22} />
          </button>
          <h1 className="flow-title">
            {session.name} <span>({session.durationMin ?? 35} min)</span>
          </h1>
          <div className="flow-header__right">
            <span className="elapsed-chip">
              <Icon name="timer" size={16} />
              {clock(elapsedMs(session, now))}
            </span>
            <button className="finish-btn" onClick={onFinish}>
              Finish
            </button>
          </div>
        </div>
      </header>

      <div className="flow-body" style={{ gap: 14 }}>
        <section className="aw-exercise" aria-label={exercise.name}>
          <div className="aw-exercise__media">
            <Demo exerciseId={exercise.exerciseId} name={exercise.name} className="aw-exercise__photo" eager />
            <div className="aw-exercise__overlay">
              <div className="aw-exercise__top">
                <span className="aw-order">
                  Exercise {index + 1} of {session.exercises.length}
                </span>
                <span className="aw-setcount">
                  Set {Math.max(1, activeSet + 1)} of {exercise.performed.length}
                </span>
                {/* Only the remaining work can change exercise; nothing pending means nothing to swap. */}
                <button
                  className="aw-swap"
                  onClick={() => onSwap(index)}
                  disabled={!exercise.performed.some((set) => !set.done)}
                >
                  <Icon name="swap_horiz" size={16} />
                  Swap
                </button>
              </div>
              <h2 className="aw-exercise__name">{exercise.name}</h2>
            </div>
          </div>
          <div className="aw-exercise__info">
            <div className="aw-loadline">
              <Icon name="fitness_center" size={18} />
              {(plannedTarget?.weight ?? 0) > 0
                ? `${showWeight(plannedTarget.weight)} ${weightLabel} · ${detail}`
                : `${mode === 'none' ? 'Bodyweight' : 'Load not set'} · ${detail}`}
            </div>
            <div className="aw-history">
              <div className="aw-history__line">
                <Icon name="history" size={16} />
                {last
                  ? `Last session: ${setText(exercise.exerciseId, last.reps)}${last.weight > 0 ? ` @ ${showActual(last.weight)} ${unitLabel(unit)}${mode === 'total' ? ' total' : ' each'}` : ''}`
                  : 'No previous session recorded'}
              </div>
              <div className="aw-history__line aw-history__line--target">
                <Icon name="flag" size={16} />
                Today’s target: {targetReps}
                {targetWeight > 0 ? ` @ ${showWeight(targetWeight)} ${weightLabel}` : ''}
              </div>
            </div>
          </div>
        </section>

        {rest > 0 && (
          <div className="rest-bar" role="timer" aria-label={`Rest, ${rest} seconds remaining`}>
            <div className="rest-bar__left">
              <Icon name="timer" size={18} />
              <span>Rest</span>
              <span className="rest-bar__time">{restClock(rest)}</span>
            </div>
            <div className="rest-bar__actions">
              <button className="rest-bar__toggle" onClick={onToggleRestPause}>
                <Icon name={restPaused ? 'play_arrow' : 'pause'} size={16} />
                {restPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                className="rest-bar__extend"
                onClick={onExtendRest}
                aria-label="Add 30 seconds of rest"
              >
                +30s
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="sets-head">
            <h2>Sets ({exercise.performed.length} total)</h2>
            <span>
              Target: {targetReps}
              {targetWeight > 0 ? ` @ ${showWeight(targetWeight)} ${weightLabel}` : ''}
            </span>
          </div>

          {exercise.performed.map((set, setIndex) => renderSet(set, setIndex))}

          <button
            className="pill-quiet"
            style={{ marginTop: 12 }}
            onClick={() => onSkip(index)}
            disabled={!exercise.performed.some((set) => !set.done)}
          >
            Skip remaining for today
          </button>
          <p className="data-note" style={{ marginTop: 6 }}>
            Skipping records nothing. The planned sets stay as they are, and you can return to them
            before you finish.
          </p>
        </div>

        {skippedToday.length > 0 && (
          <section aria-label="Skipped today">
            <div className="sets-head">
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

        {next && (
          <div className="up-next">
            <span className="up-next__icon">
              <Icon name="fitness_center" size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="up-next__label">Up next</span>
              <span className="up-next__name" style={{ display: 'block' }}>
                {next.name}
              </span>
              <span className="up-next__meta" style={{ display: 'block' }}>
                {next.planned.length} {next.planned.length === 1 ? 'set' : 'sets'}
                {next.planned[0]?.weight
                  ? ` @ ${showWeight(next.planned[0].weight)} ${unitLabel(unit)}${
                      loadModeOf(next.exerciseId) === 'total' ? ' total' : ' each'
                    }`
                  : ''}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="flow-dock flow-dock--edge">
        <div className="progress-line">
          <span>Workout progress</span>
          <strong>
            {progress.done} of {progress.total} sets
          </strong>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%` }}
          />
        </div>
        <button
          className="save-bar"
          onClick={editing ? saveEditing : nothingPending ? onFinish : onLogNext}
        >
          {editing ? 'Save set' : logLabel}
        </button>
      </div>
    </div>
  );
}
