import { useState } from 'react';
import type { FormEvent } from 'react';
import type { WorkoutRecord } from '../types';
import { pendingExerciseIndex, sessionProgress } from '../lib/session';
import { menuStatus, rowKind, setsLabel } from '../lib/openWorkout';
import Sheet from './ui/Sheet';
import Icon from './ui/Icon';
import { CheckCircleIcon, FlagIcon, HideIcon, LogSetIcon, MoreHorizIcon, PencilIcon, SendIcon, SwapIcon } from './ui/Icons';

/**
 * (#430) Everything an open workout shows outside the logger: the slight resume row, its `...` sheet and
 * discard confirm, the start-conflict sheet, the expiry note and the Ask sheet. Presentational only: App
 * owns every write, so no component here can change or drop a set by itself.
 */

/** Today and Progress: one quiet line, Resume and `...`. Never a black button, never takes over the screen. */
export function ResumeRow({
  workout,
  now,
  onResume,
  onMore,
}: {
  workout: WorkoutRecord;
  now: number;
  onResume: () => void;
  onMore: () => void;
}) {
  const kind = rowKind(workout, now);
  const { done, total } = sessionProgress(workout);
  return (
    <div className={`rrow rrow--${kind}`} role="group" aria-label={`${workout.name} workout is open`}>
      <span className="rrow__dot" aria-hidden="true" />
      <span className="rrow__text">
        <span className="rrow__name">{workout.name}</span>
        {kind === 'empty' ? (
          <span className="rrow__rest"> open · no sets<span className="rrow__sets"> logged</span></span>
        ) : (
          <span className="rrow__rest">
            {kind === 'paused' ? ' paused' : ' in progress'} · {done} of {total}
            <span className="rrow__sets"> sets</span>
          </span>
        )}
      </span>
      <button type="button" className="rrow__go" onClick={onResume}>Resume</button>
      <button type="button" className="rrow__more" aria-label={`More for ${workout.name}`} onClick={onMore}>
        <MoreHorizIcon />
      </button>
    </div>
  );
}

export type ExpiryNoteKind = 'saved' | 'closed';

/** The one-time note after expiry, in the row's slot. Dismissible; never names the next day. */
export function ExpiryNote({ kind, sets, onDismiss }: { kind: ExpiryNoteKind; sets: number; onDismiss: () => void }) {
  return (
    <div className="note-line" role="status">
      {kind === 'saved' ? <CheckCircleIcon /> : <Icon name="info" size={20} />}
      {kind === 'saved' ? (
        <p>
          Saved your paused workout: {setsLabel(sets)}.<small>Find it in Progress.</small>
        </p>
      ) : (
        <p>Closed your empty workout. Its notes were not saved.</p>
      )}
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

/** The row's `...`: Save, Hide, Discard. With no sets there is nothing to save, so Save is not offered. */
export function WorkoutMenuSheet({
  workout,
  now,
  onSave,
  onHide,
  onDiscard,
  onClose,
}: {
  workout: WorkoutRecord;
  now: number;
  onSave: () => void;
  onHide: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { done, total } = sessionProgress(workout);
  return (
    <Sheet
      title={done > 0 ? `${workout.name} · ${done} of ${total} sets` : `${workout.name} · no sets logged`}
      sub2={menuStatus(workout, now)}
      onClose={onClose}
    >
      <div className="sheet-actions">
        {done > 0 && (
          <button type="button" className="pill-primary" onClick={onSave}>
            Save {setsLabel(done)} and finish
          </button>
        )}
        <button type="button" className="pill-quiet wide" onClick={onHide}>
          <HideIcon />
          &nbsp;Hide for now
        </button>
        <button type="button" className="danger" onClick={onDiscard}>
          Discard workout
        </button>
      </div>
      <p className="sheet-copy">
        {done > 0 ? 'Save puts the sets in your history. ' : ''}Hide only tucks this row away on this phone.
      </p>
    </Sheet>
  );
}

/** Discard with sets logged: names the exact count; Cancel takes first focus and changes nothing. */
export function DiscardWorkoutConfirm({
  name,
  sets,
  onConfirm,
  onCancel,
}: {
  name: string;
  sets: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={`Discard ${name}?`} onClose={onCancel} initialFocus=".js-cancel">
      <p className="sheet-copy">
        This deletes the {setsLabel(sets)} you logged in {name}. It can't be undone.
      </p>
      <div className="sheet-actions">
        <button type="button" className="pill-quiet wide js-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-danger-soft" onClick={onConfirm}>
          Discard {setsLabel(sets)}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Starting a different workout while one is open (D4). With sets: Save-and-start is recommended, Back
 * changes nothing, Discard asks once more with the count. No sets but notes: Back, or Discard and start.
 */
export function StartConflictSheet({
  openName,
  sets,
  nextName,
  onSaveAndStart,
  onBack,
  onDiscardAndStart,
}: {
  openName: string;
  sets: number;
  nextName: string;
  onSaveAndStart: () => void;
  onBack: () => void;
  onDiscardAndStart: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // (#430) One wording for Start, Switch and Ask, as in the mock: "start Pull" in every case.
  if (sets === 0) {
    return (
      <Sheet title={`${openName} is still open`} sub2={`It has notes but no sets. You picked ${nextName}.`} onClose={onBack}>
        <div className="sheet-actions">
          <button type="button" className="pill-primary" onClick={onBack}>
            Back to {openName}
          </button>
          <button type="button" className="danger" onClick={onDiscardAndStart}>
            Discard and start {nextName}
          </button>
        </div>
        <p className="sheet-copy">Starting {nextName} closes {openName}. Its notes are not saved.</p>
      </Sheet>
    );
  }
  if (confirming) {
    return (
      <Sheet key="confirm" title={`Discard ${openName} and start ${nextName}?`} onClose={() => setConfirming(false)} initialFocus=".js-cancel">
        <p className="sheet-copy">
          The {setsLabel(sets)} you logged in {openName} are deleted for good. {nextName} starts fresh.
        </p>
        <div className="sheet-actions">
          <button type="button" className="pill-quiet wide js-cancel" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className="btn-danger-soft" onClick={onDiscardAndStart}>
            Discard {setsLabel(sets)} and start {nextName}
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet
      key="choose"
      title={<>{openName} is still open<br />{setsLabel(sets)} logged</>}
      sub2={`You picked ${nextName}. What about ${openName}?`}
      onClose={onBack}
    >
      <div className="sheet-actions">
        <div>
          <span className="rec-tag"><CheckCircleIcon size={16} />Recommended · keeps everything</span>
          <button type="button" className="pill-primary" onClick={onSaveAndStart}>
            Save {setsLabel(sets)} and start {nextName}
          </button>
        </div>
        <button type="button" className="pill-quiet wide" onClick={onBack}>
          Back to {openName}
        </button>
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          Discard {openName} and start {nextName}
        </button>
      </div>
    </Sheet>
  );
}

export const ASK_TITLE = 'What do you want to do today?';

/** The typed path for a plan question: an input, a mic when voice works, and a send button. */
function AskInput({ voice, onVoice, onText }: { voice: boolean; onVoice: () => void; onText: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onText(text.trim());
  };
  return (
    <form className="ask-in" onSubmit={submit}>
      <input
        className="ask-in__field"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What's sore? How long?"
        aria-label="Ask about today's plan"
        maxLength={200}
      />
      {voice && (
        <button type="button" className="ic" aria-label="Ask by voice" onClick={onVoice}>
          <Icon name="mic" size={22} />
        </button>
      )}
      <button type="submit" className="ic go" aria-label="Send" disabled={!text.trim()}>
        <SendIcon />
      </button>
    </form>
  );
}

/**
 * Ask with a workout open (D5): four ways back into the workout, then the plan question. None of them
 * starts a second workout or touches a set; Finish goes through the same Save or Discard sheet as the row.
 */
export function WorkoutAskSheet({
  workout,
  voice,
  onLogSet,
  onSwap,
  onBack,
  onFinish,
  onVoice,
  onText,
  onClose,
}: {
  workout: WorkoutRecord;
  voice: boolean;
  onLogSet: () => void;
  onSwap?: () => void;
  onBack: () => void;
  onFinish: () => void;
  onVoice: () => void;
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const { done } = sessionProgress(workout);
  const index = pendingExerciseIndex(workout);
  const exercise = index >= 0 ? workout.exercises[index] : undefined;
  const nextSet = exercise ? exercise.performed.findIndex((set) => !set.done) + 1 : 0;
  return (
    <Sheet title={ASK_TITLE} onClose={onClose}>
      <div className="opt-list">
        <button type="button" className="opt" onClick={onLogSet}>
          <span className="opt__ic"><LogSetIcon /></span>
          <span>
            Log a set
            <small>{exercise && nextSet > 0 ? `Set ${nextSet} of ${exercise.name}` : 'Every set is logged'}</small>
          </span>
          <Icon name="chevron_right" size={20} />
        </button>
        {onSwap && (
          <button type="button" className="opt" onClick={onSwap}>
            <span className="opt__ic"><SwapIcon /></span>
            <span>Swap this exercise</span>
            <Icon name="chevron_right" size={20} />
          </button>
        )}
        <button type="button" className="opt" onClick={onBack}>
          <span className="opt__ic"><Icon name="undo" size={20} /></span>
          <span>Back to my workout</span>
          <Icon name="chevron_right" size={20} />
        </button>
        <button type="button" className="opt" onClick={onFinish}>
          <span className="opt__ic"><FlagIcon /></span>
          <span>
            Finish workout
            <small>{done > 0 ? `Save ${setsLabel(done)} or discard` : 'No sets logged yet'}</small>
          </span>
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
      <p className="divider-label">Or ask about today's plan</p>
      <AskInput voice={voice} onVoice={onVoice} onText={onText} />
      <p className="tt-hint ask-hint">Voice answers questions and plan requests. It can't log sets.</p>
    </Sheet>
  );
}

/**
 * Ask with no workout open when voice is blocked or missing: the same question, typed. Empty input
 * previews today's planned workout; text builds the day from it on Today.
 */
export function TypedAskSheet({
  onText,
  onPreview,
  onClose,
}: {
  onText: (text: string) => void;
  onPreview: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onText(text.trim());
    else onPreview();
  };
  return (
    <Sheet title={ASK_TITLE} onClose={onClose}>
      <p className="sheet-copy">Type how long, what's sore, and what to train.</p>
      <form onSubmit={submit}>
        <div className="search-wrap">
          <PencilIcon />
          <input
            className="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. 30 min, sore legs"
            aria-label="Tell me what you want to do"
            maxLength={200}
          />
        </div>
        <div className="sheet-actions">
          <button type="submit" className="pill-primary">
            Preview workout <Icon name="arrow_forward" size={20} />
          </button>
        </div>
      </form>
    </Sheet>
  );
}
