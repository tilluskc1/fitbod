import { useState } from 'react';
import { EQUIPMENT_OPTIONS, SUPPORT_OPTIONS, exerciseById } from '../data/exercises';
import { formatWeight } from '../lib/units';
import type { Profile, Unit, WorkoutExercise } from '../types';
import { lastPerformance } from '../lib/plan';
import type { WorkoutRecord } from '../types';
import {
  EQUIPMENT_OPTIONS as SETUPS,
  type Constraints,
  type EquipmentChoice,
} from '../lib/adapt';
import { repsTarget, setText } from '../data/flagship';
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
import Sheet from '../components/ui/Sheet';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';
import { CheckIcon, LockIcon } from '../components/ui/Icons';

/* ---------------- Adjust today ---------------- */

interface AdjustProps {
  constraints: Constraints;
  originalMinutes: number;
  onClose: () => void;
  onPreview: (next: Constraints, notices: ConstraintNotice[]) => void;
}

/**
 * One constraint state, three controls. The text box, the preset chips and the
 * details below all write to the same object, so no control can drift from
the others.
 */
export function AdjustSheet({ constraints, originalMinutes, onClose, onPreview }: AdjustProps) {
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
                    <span className="equipment-choice__detail">{option.detail}</span>
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

/** "9 · 9 @ 15 kg" for per-set targets, "8–10 reps @ 18 kg" for a range. */
function targetLine(
  planned: { weight: number; reps: number }[],
  unit: Unit,
  exerciseId: string,
): string {
  if (planned.length === 0) return '—';
  const reps = repsTarget(exerciseId, planned.length) ?? planned.map((set) => set.reps).join(' · ');
  return planned[0].weight > 0 ? `${reps} @ ${formatWeight(planned[0].weight, unit)}` : reps;
}

export function WhySheet({
  exerciseId,
  exerciseName,
  planned,
  history,
  unit,
  onClose,
}: {
  exerciseId: string;
  exerciseName: string;
  planned: { weight: number; reps: number }[];
  history: WorkoutRecord[];
  unit: Unit;
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

      <div className="context-list" style={{ marginTop: 16 }}>
        <div className="context-row">
          <span>Last completed sets</span>
          <span>{last ? setText(exerciseId, last.reps) : 'None yet'}</span>
        </div>
        <div className="context-row">
          <span>Working load</span>
          <span>{last ? formatWeight(last.weight, unit) : '—'}</span>
        </div>
        <div className="context-row" style={{ borderBottom: 0 }}>
          <span>Today’s target</span>
          <span>{targetLine(planned, unit, exerciseId)}</span>
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

/* ---------------- Exercise guide ---------------- */

export function ExerciseSheet({
  exerciseId,
  planned,
  history,
  unit,
  onClose,
}: {
  exerciseId: string;
  planned: { weight: number; reps: number }[];
  history: WorkoutRecord[];
  unit: Unit;
  onClose: () => void;
}) {
  const meta = exerciseById(exerciseId);
  const last = lastPerformance(history, exerciseId);
  return (
    <Sheet title={meta?.name ?? 'Exercise'} onClose={onClose}>
      {meta && <Demo exerciseId={exerciseId} name={meta.name} className="lib-photo" />}
      {meta && <p className="lib-instructions" style={{ marginTop: 12 }}>{meta.instructions}</p>}

      <div className="context-list" style={{ marginTop: 12 }}>
        <div className="context-row">
          <span>Equipment</span>
          <span>{meta?.equipment ?? '—'}</span>
        </div>
        <div className="context-row">
          <span>Today</span>
          <span>{targetLine(planned, unit, exerciseId)}</span>
        </div>
        <div className="context-row" style={{ borderBottom: 0 }}>
          <span>Last recorded</span>
          <span>
            {last ? `${formatWeight(last.weight, unit)} · ${setText(exerciseId, last.reps)}` : 'No history'}
          </span>
        </div>
      </div>

      <div className="sheet-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Day preview ---------------- */

export function DaySheet({
  name,
  minutes,
  exercises,
  unit,
  onClose,
}: {
  name: string;
  minutes: number;
  exercises: WorkoutExercise[];
  unit: Unit;
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
              {exercise.planned.length} × {exercise.planned[0]?.reps ?? 0}
              {exercise.planned[0]?.weight
                ? ` @ ${formatWeight(exercise.planned[0].weight, unit)}`
                : ''}
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
  const [name, setName] = useState(profile.name ?? '');
  const minutes = profile.sessionMinutes ?? 35;

  const toggle = <T extends string>(list: T[], item: T, key: 'equipment' | 'support') => {
    const next = list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
    onChange({ [key]: next } as Partial<Profile>);
  };

  return (
    <Sheet title="Training settings" onClose={onClose}>
      <label className="field-label" htmlFor="profile-name">
        Your name
      </label>
      <input
        id="profile-name"
        className="search"
        style={{ marginTop: 0 }}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => onChange({ name: name.trim() || 'Athlete' })}
      />

      <div className="field">
        <span className="field-label-inline">Units</span>
        <div className="unit-toggle" role="group" aria-label="Weight units">
          <button
            className={profile.unit !== 'lb' ? 'on' : ''}
            aria-pressed={profile.unit !== 'lb'}
            onClick={() => onChange({ unit: 'kg' })}
          >
            kg
          </button>
          <button
            className={profile.unit === 'lb' ? 'on' : ''}
            aria-pressed={profile.unit === 'lb'}
            onClick={() => onChange({ unit: 'lb' })}
          >
            lb
          </button>
        </div>
      </div>

      <label className="field-label" htmlFor="session-minutes">
        Usual session length
      </label>
      <div className="time-row">
        <input
          id="session-minutes"
          type="range"
          min={15}
          max={90}
          step={5}
          value={minutes}
          style={{ ['--fill' as string]: `${((minutes - 15) / 75) * 100}%` }}
          onChange={(event) => onChange({ sessionMinutes: Number(event.target.value) })}
        />
        <div className="time-read">
          {minutes}
          <span>min</span>
        </div>
      </div>

      <span className="field-label">Primary equipment</span>
      <div className="chip-row" style={{ flexWrap: 'wrap', padding: '2px 0 6px' }}>
        {EQUIPMENT_OPTIONS.map((item) => (
          <button
            key={item}
            className={`chip ${profile.equipment.includes(item) ? 'on' : ''}`}
            aria-pressed={profile.equipment.includes(item)}
            onClick={() => toggle(profile.equipment, item, 'equipment')}
          >
            {item}
          </button>
        ))}
      </div>

      <span className="field-label">Support equipment</span>
      <div className="chip-row" style={{ flexWrap: 'wrap', padding: '2px 0 6px' }}>
        {SUPPORT_OPTIONS.map((item) => (
          <button
            key={item}
            className={`chip ${profile.support.includes(item) ? 'on' : ''}`}
            aria-pressed={profile.support.includes(item)}
            onClick={() => toggle(profile.support, item, 'support')}
          >
            {item}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="goal-select">
        Training goal
      </label>
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

      <span className="field-label">Your data</span>
      <div className="sheet-actions" style={{ marginTop: 4 }}>
        <button className="secondary" onClick={onExport}>
          Export JSON backup
        </button>
        <label className="secondary" style={{ position: 'relative', cursor: 'pointer' }}>
          Restore from backup
          <input
            type="file"
            accept="application/json,.json"
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            onChange={(event) => {
              onRestore(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="data-note">{storageNote}</p>

      <div className="kept-note" style={{ marginTop: 16 }}>
        <LockIcon />
        <div>
          <strong>This browser is the only copy.</strong>
          <p>There is no account or cloud sync. Export before clearing site data or changing devices.</p>
        </div>
      </div>

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>
          <CheckIcon size={18} />
          Done
        </button>
      </div>
    </Sheet>
  );
}
