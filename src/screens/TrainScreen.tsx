import { useState } from 'react';
import { exerciseById } from '../data/exercises';
import { FULL_BODY_A, repsTarget, setText, setUnit } from '../data/flagship';
import type { LoadMode } from '../data/flagship';
import { elapsedMs, restRemaining, sessionProgress } from '../lib/session';
import { applyDraft, openDraft, saveDraft } from '../lib/editDraft';
import type { EditDraft } from '../lib/editDraft';
import { lastPerformance } from '../lib/plan';
import { displayValue, unitLabel } from '../lib/units';
import type { PerformedSet, Unit, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';

interface Props {
  session: WorkoutRecord;
  history: WorkoutRecord[];
  now: number;
  /** Weights the chosen setup owns. Never free-typed. */
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

function loadModeOf(exerciseId: string): LoadMode {
  const program = FULL_BODY_A.exercises.find((entry) => entry.exerciseId === exerciseId);
  if (program) return program.load;
  return exerciseById(exerciseId)?.equipment === 'Dumbbell' ? 'each' : 'none';
}

function detailOf(exerciseId: string): string {
  return (
    FULL_BODY_A.exercises.find((entry) => entry.exerciseId === exerciseId)?.detail ??
    (exerciseById(exerciseId)?.equipment === 'Dumbbell' ? 'Dumbbell' : 'Floor mat')
  );
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
      ? ` @ ${displayValue(weight, unit)} ${unitLabel(unit)}${mode === 'total' ? ' total' : mode === 'each' ? ' each' : ''}`
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
}: Props) {
  const [editing, setEditing] = useState<EditDraft | null>(null);

  /** Edit controls write to the draft only; nothing reaches the record here. */
  const patchDraft = (patch: Partial<Pick<EditDraft, 'reps' | 'weight'>>) =>
    setEditing((draft) => (draft ? applyDraft(draft, patch) : draft));
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const restPaused = Boolean(session.restPausedAt);

  const activeIndex = session.exercises.findIndex((exercise) =>
    exercise.performed.some((set) => !set.done),
  );
  const index = activeIndex === -1 ? session.exercises.length - 1 : activeIndex;
  const exercise = session.exercises[index];
  const next = session.exercises[index + 1];
  const allDone = progress.done === progress.total && progress.total > 0;

  if (!exercise) {
    return (
      <div className="screen flow-screen">
        <header className="flow-header">
          <div className="flow-header__inner">
            <button className="flow-back" onClick={onMinimize} aria-label="Back to today">
              <Icon name="arrow_back_ios_new" size={22} />
            </button>
            <h1 className="flow-title">{session.name}</h1>
          </div>
        </header>
        <div className="flow-body">
          <p className="empty-state">This session has no exercises. Finish it or discard it.</p>
        </div>
      </div>
    );
  }

  const activeSet = exercise.performed.findIndex((set) => !set.done);
  const mode = loadModeOf(exercise.exerciseId);
  const detail = detailOf(exercise.exerciseId);
  const weightLabel =
    mode === 'total'
      ? `${unitLabel(unit)} total`
      : mode === 'each'
        ? `${unitLabel(unit)} each`
        : 'bodyweight';
  /** Loads are stored in kilograms; only the readout converts. */
  const showWeight = (kg: number) => displayValue(kg, unit);
  const last = lastPerformance(history, exercise.exerciseId);
  const holdUnit = setUnit(exercise.exerciseId) === 'seconds';
  const plannedTarget = exercise.planned[activeSet === -1 ? exercise.planned.length - 1 : activeSet];
  /** "9 · 9" list for per-set targets, "8–10 reps" for a range, never "2 × 9". */
  const targetReps =
    repsTarget(exercise.exerciseId, exercise.planned.length) ??
    exercise.planned.map((set) => set.reps).join(' · ');
  const targetWeight = exercise.planned[0]?.weight ?? 0;
  const canPickWeight = mode !== 'none' && loadOptions.length > 0;

  const activeValues =
    activeSet === -1
      ? null
      : exercise.performed[activeSet];

  const logLabel = allDone
    ? 'Finish workout'
    : activeValues
      ? `Log set ${activeSet + 1} · ${
          activeValues.weight > 0
            ? `${setText(exercise.exerciseId, activeValues.reps)} @ ${showWeight(activeValues.weight)} ${unitLabel(unit)}`
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
              {set.weight > 0 ? ` · ${showWeight(set.weight)} ${unitLabel(unit)}` : ''}
            </span>
          </div>

          <div className="aw-field">
            <div className="aw-field__label">
              <span>Weight ({weightLabel})</span>
              <span className="aw-field__note">{canPickWeight ? 'Dumbbell' : 'Bodyweight'}</span>
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
            ) : (
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
            <span className="aw-field__note">{canPickWeight ? 'Dumbbell' : 'Bodyweight'}</span>
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
          ) : (
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
                <button className="aw-swap" onClick={() => onSwap(index)}>
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
                : `Bodyweight · ${detail}`}
            </div>
            <div className="aw-history">
              <div className="aw-history__line">
                <Icon name="history" size={16} />
                {last
                  ? `Last session: ${setText(exercise.exerciseId, last.reps)}${last.weight > 0 ? ` @ ${showWeight(last.weight)} ${unitLabel(unit)}${mode === 'total' ? ' total' : ' each'}` : ''}`
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

        </div>

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
          onClick={editing ? saveEditing : allDone ? onFinish : onLogNext}
        >
          {editing ? 'Save set' : logLabel}
        </button>
      </div>
    </div>
  );
}
