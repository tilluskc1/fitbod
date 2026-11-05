import { useState } from 'react';
import { EQUIPMENT_OPTIONS, SUPPORT_OPTIONS, exerciseById } from '../data/exercises';
import { dumbbellLoadsPatch, formatWeight, loadLimitMessage, loadsInputText, overLoadLimit, parseLoads, unitLabel, unitOf } from '../lib/units';
import type { Profile, Unit, WorkoutExercise } from '../types';
import { lastPerformance } from '../lib/plan';
import { plannedLoad } from '../lib/liveProgression';
import type { WorkoutRecord } from '../types';
import {
  EQUIPMENT_OPTIONS as SETUPS,
  type Constraints,
  type EquipmentChoice,
} from '../lib/adapt';
import { loadModeOf, repsTarget, setText } from '../data/flagship';
import {
  MINUTE_OPTIONS,
  PRESETS,
  constraintSentence,
  isPresetActive,
  keywordParser,
  noticeText,
  resolveConstraints,
  type ConstraintNotice,
  type ParsedConstraints,
} from '../lib/constraints';
import { exerciseActions, exerciseHistory, type ExerciseActionId } from '../lib/exerciseActions';
import { PREF_LABEL, conflictChanges, exclusionChange, preferenceChange, type ProfileChange } from '../lib/preferences';
import Sheet from '../components/ui/Sheet';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';
import { CheckIcon, LockIcon } from '../components/ui/Icons';

/* ---------------- Adjust today ---------------- */

interface AdjustProps {
  constraints: Constraints;
  originalMinutes: number;
  unit: Unit;
  onClose: () => void;
  onPreview: (next: Constraints, notices: ConstraintNotice[]) => void;
}

/**
 * One constraint state, three controls. The text box, the preset chips and the
 * details below all write to the same object, so no control can drift from
the others.
 */
export function AdjustSheet({ constraints, originalMinutes, unit, onClose, onPreview }: AdjustProps) {
  const [current, setCurrent] = useState(constraints);
  const [text, setText] = useState(constraintSentence(constraints));
  const [notices, setNotices] = useState<ConstraintNotice[]>([]);
  // Nothing understood is not the same as nothing to change, so say so.
  const [unread, setUnread] = useState(false);

  const apply = (patch: ParsedConstraints) => {
    const resolved = resolveConstraints(current, patch);
    setCurrent(resolved.constraints);
    setNotices(resolved.notices);
    setUnread(false);
    setText(constraintSentence(resolved.constraints));
  };

  const onText = (value: string) => {
    setText(value);
    const parsed = keywordParser.parse(value);
    const resolved = resolveConstraints(current, parsed);
    setCurrent(resolved.constraints);
    setNotices(resolved.notices);
    setUnread(value.trim().length > 0 && Object.keys(parsed).length === 0);
  };

  const delta = current.minutes - originalMinutes;
  const deltaLabel = delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${delta} min`;
  const timeOptions = [...new Set([...MINUTE_OPTIONS, current.minutes])].sort((a, b) => a - b);

  return (
    <Sheet
      title="Adjust today"
      subtitle="Tell your coach what changed. Your program stays the same."
      onClose={onClose}
      variant="adjust"
      footer={
        <>
          <button className="pill-primary" onClick={() => onPreview(current, notices)}>
            Preview changes
            <Icon name="arrow_forward" size={20} />
          </button>
          <p className="scope-caption">Today only</p>
        </>
      }
    >
      <div className="constraint-input">
        <Icon name="tune" size={18} />
        <input
          aria-label="Tell your coach what changed"
          placeholder="Tell your coach what changed"
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
      </div>

      {notices.map((notice) => (
        <p key={notice.kind} className="constraint-notice" role="status">
          {noticeText(notice)}
        </p>
      ))}
      {unread && (
        <p className="data-note" role="status">
          No change from that sentence. Use a chip or Edit details so the plan can be adjusted.
        </p>
      )}

      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className="preset-pill"
            aria-pressed={isPresetActive(preset, current)}
            onClick={() => apply(preset.patch)}
          >
            <Icon name={preset.icon} size={16} />
            {preset.label}
          </button>
        ))}
      </div>

      <details className="edit-details">
        <summary>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="tune" size={18} />
            Edit details
          </span>
          <Icon name="expand_more" size={20} />
        </summary>
        <div className="edit-details__body">
          <div>
            <div className="detail-label">
              <span>Time available · {current.minutes} min</span>
              <span className="detail-delta">{deltaLabel}</span>
            </div>
            <div className="time-grid" style={{ gridTemplateColumns: `repeat(${timeOptions.length}, 1fr)` }}>
              {timeOptions.map((minutes) => (
                <button
                  key={minutes}
                  aria-pressed={current.minutes === minutes}
                  onClick={() => apply({ minutes })}
                >
                  {minutes} min
                </button>
              ))}
            </div>
            <div className="time-step">
              <button
                className="pill-quiet"
                style={{ flex: 1 }}
                onClick={() => apply({ minutes: current.minutes - 15 })}
                aria-label="15 minutes less"
              >
                −15 min
              </button>
              <button
                className="pill-quiet"
                style={{ flex: 1 }}
                onClick={() => apply({ minutes: current.minutes + 15 })}
                aria-label="15 minutes more"
              >
                +15 min
              </button>
            </div>
          </div>

          <div>
            <div className="detail-label">
              <span>Equipment</span>
            </div>
            {(Object.keys(SETUPS) as EquipmentChoice[]).map((key) => {
              const option = SETUPS[key];
              return (
                <button
                  key={key}
                  className="equipment-choice"
                  aria-pressed={current.equipment === key}
                  onClick={() => apply({ equipment: key })}
                >
                  <span className="equipment-choice__box" aria-hidden="true">
                    <Icon name="check" size={15} />
                  </span>
                  <span>
                    <span className="equipment-choice__name">{option.label}</span>
                    <span className="equipment-choice__detail">
                      {key === 'home' && current.loads?.length
                        ? `Yours: ${current.loads.map((load) => formatWeight(load, unit)).join(', ')}`
                        : option.detail}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </details>
    </Sheet>
  );
}

/* ---------------- Why this target ---------------- */

/** A logged load, by the same rule as the target: accepted prescriptions like it, typed loads exact. */
function loggedLoad(kg: number, unit: Unit, exerciseId: string, loads: Profile['loads'], history: WorkoutRecord[]): string {
  return kg > 0 ? `${plannedLoad(loads, history, exerciseId, unit)(kg)} ${unitLabel(unit)}` : 'Bodyweight';
}

/** "9 · 9 @ 15 kg" for per-set targets, "8–10 reps @ 18 kg" for a range. */
function targetLine(
  planned: { weight: number; reps: number }[],
  unit: Unit,
  exerciseId: string,
  format: (kg: number) => string,
): string {
  if (planned.length === 0) return '—';
  const reps = repsTarget(exerciseId, planned.length, planned) ?? planned.map((set) => set.reps).join(' · ');
  const mode = loadModeOf(exerciseId);
  return planned[0].weight > 0 ? `${reps} @ ${format(planned[0].weight)} ${unitLabel(unit)}${mode === 'each' ? ' each' : mode === 'total' ? ' total' : ''}` : reps;
}

export function WhySheet({
  exerciseId,
  exerciseName,
  planned,
  history,
  unit,
  loads = {},
  reason,
  onClose,
}: {
  exerciseId: string;
  exerciseName: string;
  planned: { weight: number; reps: number }[];
  history: WorkoutRecord[];
  unit: Unit;
  loads?: Profile['loads'];
  /** The precise sentence behind the target; Today shows only the coach line. */
  reason?: string;
  onClose: () => void;
}) {
  const last = lastPerformance(history, exerciseId);
  return (
    <Sheet title="Why this target" onClose={onClose}>
      <p className="sheet-copy">
        {last ? (
          <>
            Each exercise keeps its own record. Today’s target for <strong>{exerciseName}</strong> is
            set from that movement alone, never copied from another exercise in the workout. The sets
            you completed are listed below for comparison.
          </>
        ) : (
          <>
            No session has been recorded for <strong>{exerciseName}</strong> yet, so today’s target is
            the starting prescription rather than a number taken from your history.
          </>
        )}
      </p>
      {reason && <p className="sheet-copy" style={{ marginTop: 10 }}>{reason}</p>}

      <div className="context-list" style={{ marginTop: 16 }}>
        <div className="context-row">
          <span>Last completed sets</span>
          <span>{last ? setText(exerciseId, last.reps) : 'None yet'}</span>
        </div>
        <div className="context-row">
          <span>Working load</span>
          <span>{last ? loggedLoad(last.weight, unit, exerciseId, loads, history) : '—'}</span>
        </div>
        <div className="context-row" style={{ borderBottom: 0 }}>
          <span>Today’s target</span>
          <span>{targetLine(planned, unit, exerciseId, plannedLoad(loads, history, exerciseId, unit))}</span>
        </div>
      </div>

      <p className="data-note">
        Reps climb inside the movement’s range before load moves. A load step comes from your recorded
        inventory when one exists, otherwise from the default increment for that equipment. An
        unfinished session repeats its load instead of jumping. Bodyweight work stops at the rep
        ceiling because the model has no added-load field.
      </p>

      <div className="sheet-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Exercise actions ---------------- */

type ActionMode = 'menu' | 'instructions' | 'history' | 'remove';

/** Preview body for a profile change; nothing is saved unless Confirm is pressed. */
export function ConfirmChange({
  change,
  onConfirm,
  onCancel,
}: {
  change: ProfileChange;
  onConfirm: (patch: Partial<Profile>) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <p className="sheet-copy">{change.detail}</p>
      <div className="sheet-actions">
        <button className="primary" onClick={() => onConfirm(change.patch)}>
          Confirm
        </button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

/**
 * The one menu a workout exercise opens. Every row leads somewhere real; a
 * capability that cannot run says why on its own row instead of failing
 * silently when tapped.
 */
export function ExerciseActionsSheet({
  exerciseId,
  exerciseName,
  exerciseIndex,
  exerciseCount,
  planned,
  pending,
  done,
  history,
  unit,
  profile,
  inSession,
  skipped,
  onReplace,
  onSaveProfile,
  onRemoveToday,
  onReturn,
  onClose,
  initialMode = 'menu',
}: {
  exerciseId: string;
  exerciseName: string;
  exerciseIndex: number;
  exerciseCount: number;
  /** The logger's thumbnail opens straight to the demo. */
  initialMode?: 'menu' | 'instructions';
  planned: { weight: number; reps: number }[];
  pending: number;
  done: number;
  history: WorkoutRecord[];
  unit: Unit;
  profile: Profile;
  /** False for Today's preview before Start: there is no session to change yet. */
  inSession: boolean;
  /** Already removed for today (#26); its return path replaces replace/remove. */
  skipped: boolean;
  onReplace: () => void;
  onSaveProfile: (patch: Partial<Profile>) => void;
  onRemoveToday: () => void;
  onReturn: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ActionMode>(initialMode);
  const meta = exerciseById(exerciseId);
  const actions = exerciseActions(pending, done, inSession, skipped);
  const blockedReason = actions.find((action) => action.blockedReason)?.blockedReason;
  const entries = mode === 'history' ? exerciseHistory(history, exerciseId) : [];
  const back = () => setMode('menu');
  // The change is rebuilt from the live profile, so another tab's edit is never overwritten by a stale preview.
  const [ask, setAsk] = useState<((current: Profile) => ProfileChange | null) | null>(null);
  const change = ask?.(profile) ?? null;
  const exercise = { id: exerciseId, name: exerciseName };
  const pref = profile.preferences?.[exerciseId];
  const excluded = profile.exclusions.includes(exerciseId);
  const conflict = conflictChanges(profile, exercise);
  const label = (id: ExerciseActionId, text: string) =>
    id === 'dont-recommend' && excluded ? 'Allow in workouts again' : text;

  const run = (id: ExerciseActionId) => {
    if (id === 'instructions' || id === 'history') setMode(id);
    if (id === 'replace') {
      onClose();
      onReplace();
    }
    // Tapping the active choice offers neutral, so more and less never coexist.
    if (id === 'more' || id === 'less')
      setAsk(() => (current: Profile) =>
        preferenceChange(current, exercise, current.preferences?.[exerciseId] === id ? null : id));
    if (id === 'dont-recommend')
      setAsk(() => (current: Profile) =>
        exclusionChange(current, exercise, !current.exclusions.includes(exerciseId)));
    if (id === 'remove-today') setMode('remove');
    if (id === 'return') onReturn();
  };

  return (
    <Sheet
      title={exerciseName}
      subtitle={`Exercise ${exerciseIndex + 1} of ${exerciseCount} · ${planned.length} ${
        planned.length === 1 ? 'set' : 'sets'
      } · ${targetLine(planned, unit, exerciseId, plannedLoad(profile.loads, history, exerciseId, unit))}`}
      onClose={onClose}
    >
      {change && (
        <>
          <p className="sheet-copy">
            <strong>{change.title}</strong>
          </p>
          <ConfirmChange
            change={change}
            onConfirm={onSaveProfile}
            onCancel={() => setAsk(null)}
          />
        </>
      )}

      {mode === 'menu' && !change && (
        <div className="sheet-menu">
          {conflict && pref && (
            <div className="note-card" role="status">
              Excluded and marked {PREF_LABEL[pref].toLowerCase()}. The exclusion wins until you pick one.
              <div className="sheet-actions" style={{ marginTop: 12 }}>
                <button className="secondary" onClick={() => setAsk(() => (current: Profile) => conflictChanges(current, exercise)?.keepExclusion ?? null)}>
                  Keep exclusion
                </button>
                <button className="secondary" onClick={() => setAsk(() => (current: Profile) => conflictChanges(current, exercise)?.keepPreference ?? null)}>
                  Keep {PREF_LABEL[pref].toLowerCase()}
                </button>
              </div>
            </div>
          )}
          {actions.map((action) => {
            const on = action.id === pref;
            return (
              <button
                key={action.id}
                className="context-row sheet-menu__row"
                onClick={() => run(action.id)}
                disabled={Boolean(action.blockedReason)}
                aria-describedby={action.blockedReason ? 'why-blocked' : undefined}
                aria-pressed={action.id === 'more' || action.id === 'less' ? on : undefined}
              >
                <span>{label(action.id, action.label)}</span>
                {action.blockedReason ? <LockIcon size={18} /> : <Icon name={on ? 'check' : 'chevron_right'} size={18} />}
              </button>
            );
          })}
          {/* Replace and remove share one reason, so it is stated once. */}
          {blockedReason && (
            <p className="data-note" id="why-blocked">
              {blockedReason}
            </p>
          )}
          {excluded && !conflict && (
            <p className="data-note" role="status">
              {exerciseName} is excluded from future workouts.
            </p>
          )}
        </div>
      )}

      {mode === 'instructions' && (
        <>
          <Demo exerciseId={exerciseId} name={exerciseName} className="lib-photo" />
          <p className="lib-instructions" style={{ marginTop: 12 }}>
            {meta?.instructions ?? 'No written instructions are recorded for this movement yet.'}
          </p>
          <div className="sheet-actions">
            <button className="secondary" onClick={back}>
              Back to actions
            </button>
          </div>
        </>
      )}

      {mode === 'history' && (
        <>
          <p className="sheet-copy">
            Only sets you actually recorded for {exerciseName}. Other variants keep their own
            records.
          </p>
          {entries.length === 0 && (
            <p className="note-card" style={{ marginTop: 12 }}>
              No sets recorded for {exerciseName} yet. Nothing is filled in from another exercise.
            </p>
          )}
          <div style={{ marginTop: entries.length === 0 ? 0 : 12 }}>
            {entries.map((entry, index) => (
              // One workout can hold the same exercise twice (swap-back), so the index keeps keys unique.
              <div className="context-row" key={`${entry.workoutId}-${index}`}>
                <span>
                  {new Date(entry.date).toLocaleDateString()}
                  {entry.completedEarly ? ' · finished early' : ''}
                </span>
                <span>
                  {entry.sets
                    .map(
                      (set) =>
                        `${setText(exerciseId, set.reps)}${
                          set.weight > 0
                            ? ` @ ${plannedLoad(profile.loads, history, exerciseId, unit)(set.weight)} ${unitLabel(unit)}${
                                loadModeOf(exerciseId) === 'each' ? ' each' : ''
                              }`
                            : ''
                        }`,
                    )
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
          <div className="sheet-actions">
            <button className="secondary" onClick={back}>
              Back to actions
            </button>
          </div>
        </>
      )}

      {mode === 'remove' && (
        <>
          <p className="sheet-copy">
            Remove the remaining {pending} {pending === 1 ? 'set' : 'sets'} of{' '}
            <strong>{exerciseName}</strong> from today? Sets you already logged stay, and Return to
            exercise brings the rest back before you finish. This does not become a permanent
            exclusion and does not end the session.
          </p>
          <div className="sheet-actions">
            <button className="primary" onClick={onRemoveToday}>
              Remove from today's workout
            </button>
            <button className="secondary" onClick={back}>
              Keep it in today's workout
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------------- Day preview ---------------- */

export function DaySheet({
  name,
  minutes,
  exercises,
  unit,
  history = [],
  loads = {},
  onStart,
  onClose,
}: {
  name: string;
  minutes: number;
  exercises: WorkoutExercise[];
  unit: Unit;
  history?: WorkoutRecord[];
  loads?: Profile['loads'];
  /** Today's Preview: start through the app's one validated start. */
  onStart?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={name} onClose={onClose}>
      <p className="sheet-copy">
        {minutes} min estimated · {exercises.length}{' '}
        {exercises.length === 1 ? 'exercise' : 'exercises'} ·{' '}
        {exercises.reduce((sum, exercise) => sum + exercise.planned.length, 0)} sets
      </p>

      <div style={{ marginTop: 14 }}>
        {exercises.map((exercise, index) => (
          <div className="context-row" key={`${exercise.exerciseId}-${index}`}>
            <span>{exercise.name}</span>
            <span>
              {exercise.planned.length} sets · {targetLine(exercise.planned, unit, exercise.exerciseId, plannedLoad(loads, history, exercise.exerciseId, unit))}
            </span>
          </div>
        ))}
      </div>

      <p className="data-note">
        This preview is generated from your own equipment and history. Starting uses exactly these
        exercises.
      </p>

      <div className="sheet-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
        {onStart && (
          <button className="primary" onClick={onStart} disabled={exercises.length === 0}>
            Start workout
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- Finish ---------------- */

export function FinishSheet({
  done,
  total,
  onSave,
  onContinue,
  onDiscard,
  onClose,
}: {
  done: number;
  total: number;
  onSave: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Finish your session?" onClose={onClose}>
      <h3 style={{ fontSize: 24, letterSpacing: '-0.03em' }}>
        {done} of {total} sets logged.
      </h3>
      <p className="sheet-copy" style={{ marginTop: 10 }}>
        Only completed sets enter your history. Unfinished work won’t become catch-up debt.
      </p>

      <div className="sheet-actions">
        <button className="primary" onClick={onSave}>
          Save completed work
        </button>
        <button className="secondary" onClick={onContinue}>
          Continue workout
        </button>
        <button className="link-btn" style={{ color: '#d9a79f', alignSelf: 'center' }} onClick={onDiscard}>
          Discard this session
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Replace active session ---------------- */

/**
 * In-app confirm for starting a workout while one is open (#19). Confirming
 * discards the open session once; keeping it changes nothing.
 */
export function DiscardSessionSheet({
  currentName,
  nextName,
  onDiscard,
  onKeep,
  onClose,
}: {
  currentName: string;
  nextName: string;
  onDiscard: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Replace your open session?" onClose={onClose}>
      <p className="sheet-copy">
        <strong>{currentName}</strong> is still in progress. Starting{' '}
        <strong>{nextName}</strong> discards it — logged sets from the active session will be
        lost.
      </p>
      <div className="sheet-actions">
        <button className="primary" onClick={onDiscard}>
          Discard and start {nextName}
        </button>
        <button className="secondary" onClick={onKeep}>
          Keep current workout
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Swap exercise ---------------- */

export function SwapSheet({
  currentName,
  options,
  onPick,
  onClose,
}: {
  currentName: string;
  options: { id: string; name: string; meta: string }[];
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Swap exercise" onClose={onClose}>
      <p className="sheet-copy">
        Replacing <strong>{currentName}</strong> keeps your logged sets and only changes the remaining
        work. New exercises start from their own history; no load is transferred.
      </p>
      <div style={{ marginTop: 14 }}>
        {options.length === 0 && (
          <p className="note-card">No other exercise trains the same pattern with your equipment.</p>
        )}
        {options.map((option) => (
          <button key={option.id} className="context-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => onPick(option.id)}>
            <span>{option.name}</span>
            <span>{option.meta}</span>
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="secondary" onClick={onClose}>
          Keep {currentName}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Settings ---------------- */

interface SettingsProps {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  onExport: () => void;
  onRestore: (file: File | undefined) => void;
  onClose: () => void;
  storageNote: string;
}

export function SettingsSheet({
  profile,
  onChange,
  onExport,
  onRestore,
  onClose,
  storageNote,
}: SettingsProps) {
  const unit = unitOf(profile);
  const [name, setName] = useState(profile.name ?? '');
  const [loadsText, setLoadsText] = useState(() => loadsInputText(profile.loads.Dumbbell, unit));
  const [textUnit, setTextUnit] = useState(unit);
  const [loadsRefused, setLoadsRefused] = useState(false);
  const minutes = profile.sessionMinutes ?? 35;

  // The text is in textUnit; on a unit switch, re-read the stored kg instead of converting the typed text.
  if (textUnit !== unit) {
    setTextUnit(unit);
    setLoadsText(loadsInputText(profile.loads.Dumbbell, unit));
  }

  /** Saved inventory: future workouts only, never a frozen active session. */
  const saveLoads = () => {
    // A load above the limit keeps the text so it can be fixed; nothing is saved (#101).
    const tooHeavy = overLoadLimit(parseLoads(loadsText, unit, profile.loads.Dumbbell));
    setLoadsRefused(tooHeavy);
    if (tooHeavy) return;
    const patch = dumbbellLoadsPatch(loadsText, profile);
    if (patch) onChange(patch);
    else setLoadsText(loadsInputText(profile.loads.Dumbbell, unit));
  };

  const toggle = <T extends string>(list: T[], item: T, key: 'equipment' | 'support') => {
    const next = list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
    onChange({ [key]: next } as Partial<Profile>);
  };

  const chips = <T extends string>(options: readonly T[], list: T[], key: 'equipment' | 'support', label: string) => (
    <div className="settings-chips" role="group" aria-label={label}>
      {options.map((item) => (
        <button
          key={item}
          className={`chip ${list.includes(item) ? 'on' : ''}`}
          aria-pressed={list.includes(item)}
          onClick={() => toggle(list, item, key)}
        >
          {item}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet title="Training settings" onClose={onClose} variant="settings">
      <div className="glass-scope settings">
        <section className="settings-group" aria-labelledby="settings-profile">
          <h3 className="settings-group__title" id="settings-profile">
            Profile
          </h3>
          <div className="settings-card">
            <div className="settings-row">
              <label htmlFor="profile-name">Name</label>
              <input
                id="profile-name"
                className="search"
                value={name}
                maxLength={40}
                autoComplete="given-name"
                onChange={(event) => setName(event.target.value)}
                onBlur={() => onChange({ name: name.trim() || 'Athlete' })}
              />
            </div>
            <div className="settings-row">
              <span id="units-label">Units</span>
              <div className="unit-toggle" role="group" aria-labelledby="units-label">
                <button className={unit === 'kg' ? 'on' : ''} aria-pressed={unit === 'kg'} onClick={() => onChange({ unit: 'kg' })}>
                  kg
                </button>
                <button className={unit === 'lb' ? 'on' : ''} aria-pressed={unit === 'lb'} onClick={() => onChange({ unit: 'lb' })}>
                  lb
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="settings-training">
          <h3 className="settings-group__title" id="settings-training">
            Training
          </h3>
          <div className="settings-card">
            <div className="settings-row settings-row--stack">
              <div className="settings-row__line">
                <label htmlFor="session-minutes">Session length</label>
                <output htmlFor="session-minutes" className="settings-row__value">
                  {minutes} min
                </output>
              </div>
              <input
                id="session-minutes"
                className="glass-range"
                type="range"
                min={15}
                max={90}
                step={5}
                value={minutes}
                style={{ ['--fill' as string]: `${((minutes - 15) / 75) * 100}%` }}
                onChange={(event) => onChange({ sessionMinutes: Number(event.target.value) })}
              />
            </div>
            <div className="settings-row">
              <label htmlFor="goal-select">Goal</label>
              <select
                id="goal-select"
                className="select"
                value={profile.goal}
                onChange={(event) => onChange({ goal: event.target.value as Profile['goal'] })}
              >
                {['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'].map((goal) => (
                  <option key={goal} value={goal}>
                    {goal}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="settings-equipment">
          <h3 className="settings-group__title" id="settings-equipment">
            Equipment
          </h3>
          <div className="settings-card">
            <div className="settings-row settings-row--stack">
              <span>Primary</span>
              {chips(EQUIPMENT_OPTIONS, profile.equipment, 'equipment', 'Primary equipment')}
            </div>
            <div className="settings-row settings-row--stack">
              <label htmlFor="profile-loads">Dumbbells you own ({unitLabel(unit)}, per hand)</label>
              <input
                id="profile-loads"
                className="search"
                inputMode="decimal"
                value={loadsText}
                onChange={(event) => setLoadsText(event.target.value)}
                onBlur={saveLoads}
                placeholder={unit === 'lb' ? 'e.g. 15, 25, 35 lb' : 'e.g. 10, 15, 20 kg'}
                aria-describedby="profile-loads-note"
                aria-invalid={loadsRefused || undefined}
              />
              <p className="settings-row__note" id="profile-loads-note">
                Used by future workouts. Leave blank to keep your rack unconfirmed.
              </p>
              {loadsRefused && <p className="error-text" role="alert">{loadLimitMessage(unit)}</p>}
            </div>
            <div className="settings-row settings-row--stack">
              <span>Support</span>
              {chips(SUPPORT_OPTIONS, profile.support, 'support', 'Support equipment')}
            </div>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="settings-data">
          <h3 className="settings-group__title" id="settings-data">
            Data
          </h3>
          <div className="settings-card">
            <button className="settings-row settings-row--action" onClick={onExport}>
              Export JSON backup
            </button>
            <label className="settings-row settings-row--action">
              Restore from backup
              <input
                type="file"
                accept="application/json,.json"
                className="settings-row__file"
                onChange={(event) => {
                  onRestore(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="settings-group__foot">{storageNote}</p>
          <div className="settings-card settings-lock">
            <LockIcon />
            <div>
              <strong>This browser is the only copy.</strong>
              <p>There is no account or cloud sync. Export before clearing site data or changing devices.</p>
            </div>
          </div>
        </section>

        <div className="sheet-actions">
          <button className="primary" onClick={onClose}>
            <CheckIcon size={18} />
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
