import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useWakeLock } from '../lib/wakeLock';
import { loadModeOf, NEEDS_LOAD_REASON, needsLoad, repsTarget, setUnit } from '../data/flagship';
import { exerciseById } from '../data/exercises';
import { elapsedMs, restRemaining, sessionProgress } from '../lib/session';
import { lastNote } from '../lib/notes';
import { canMoveLater, pairRound, pairedPendingIndex, partnerOf, restAfterLog } from '../lib/supersets';
import './supersets.css';
import { isRestMuted, playRestCue, primeRestAudio, restEnded, setRestMuted, shouldCue } from '../lib/restCue';
import { exerciseInWorkout, lastPerformance } from '../lib/plan';
import { firstTimeLoaded, plannedLoad } from '../lib/liveProgression';
import { nearestLoad, suggestedFirstLoad } from '../lib/firstLoad';
import { availableLoads } from '../lib/progression';
import { weightSteps } from '../lib/weightSteps';
import { calibrationInputValue, loadLimitMessage, loadValue, repsLimitMessage, typedLoad, typedReps, unitLabel } from '../lib/units';
import { restLabel } from '../lib/sessionTime';
import { BAR, GENERAL_WARM_UP_TEXT, generalWarmUpMinutes, liveRampBurst, rampExerciseIndex, rampSets, rampWorking, setWarmUpChecks, showsGeneralWarmUp, warmUpChecks } from '../lib/warmUp';
import type { WarmUpChecks } from '../lib/warmUp';
import type { Experience, PerformedSet, Profile, Unit, WorkoutExercise, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import HowTo from '../components/ui/HowTo';
import Sheet from '../components/ui/Sheet';
import Icon from '../components/ui/Icon';
import { NoticeCard } from '../components/ui/Notices';
import { MoreIcon } from '../components/ui/Icons';

interface Props {
  session: WorkoutRecord;
  history: WorkoutRecord[];
  now: number;
  /** The profile's confirmed loads by equipment: the rack a logged load is compared with. */
  profileLoads?: Profile['loads'];
  /** The setup's dumbbell rack (a hotel gym's on Travel); only the #300 ramp rows read it, never the set cells. */
  rampLoads?: number[];
  /** Only the user's confirmed loads; the first-weight step never offers the example rack. */
  calibrationLoads?: number[];
  /** The profile's level: the first-weight step starts from a load suggested for it (#116). Absent, it suggests nothing. */
  experience?: Experience;
  /** Display unit. Records stay in kilograms. */
  unit: Unit;
  /** One factual reason per exercise for today's computed target. */
  targetNotes?: Record<string, string>;
  /** Rest after a set, per exercise in session order, by role (#132). */
  rests?: number[];
  /** (#88) Supersets as index pairs: they alternate set by set. Empty: every exercise runs straight. */
  pairs?: [number, number][];
  /** #165: exercises ready to go heavier, keyed to last time's load (the floor for the next pick). */
  goHeavier?: Record<string, number>;
  onMinimize: () => void;
  onFinish: () => void;
  onUpdateSet: (exerciseIndex: number, setIndex: number, patch: Partial<PerformedSet>, how?: SetEdit) => void;
  /**
   * (#327) A weight more than 10% over last time, held on the set typed: its Heads-up shows under that
   * row, next to the field the phone keeps in view, with its one action.
   */
  held?: { exerciseIndex: number; setIndex: number; text: string; onApply: () => void; onDismiss: () => void } | null;
  /**
   * The exercise id lets the handler refuse a tap rendered against a since-changed session. `weight`:
   * the suggested start the empty cell showed (#309), written to that set before it is logged.
   */
  onLogSet: (exerciseIndex: number, setIndex: number, exerciseId: string, weight?: number) => void;
  onToggleRestPause: () => void;
  onExtendRest: () => void;
  onOpenActions: (exerciseIndex: number, mode?: 'instructions' | 'history') => void;
  /** (#151) Opens Replace for the remaining sets straight from the quick-action row. */
  onReplace?: (exerciseIndex: number) => void;
  /** (#369) One tap: this exercise moves to Skipped today, the same as Remove today's remaining work. */
  onLater?: (exerciseIndex: number) => void;
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

/**
 * `revert`: the keystroke was refused or emptied the cell; the handler undoes its burst (#309 review 2).
 * `prefill`: the suggested start the empty cell showed, the base of the "Big jump" heads-up (#306).
 */
export interface SetEdit {
  revert?: 'refused' | 'emptied';
  prefill?: number;
  /** (#371) A − or + tap: the same burst as typing, but its Undo also puts the tapped set back. */
  step?: boolean;
}

/**
 * What a cell does with a keystroke: null keeps the typed text; 'block' ignores the keystroke (the text
 * stays as it was, nothing is saved); 'reset' shows the stored value again, selected, so the next key
 * replaces it rather than appending to it (#309 review 2).
 */
type CellAnswer = null | 'block' | 'reset';

/**
 * A set's weight or reps, typed in its own cell (#309). Away from focus it shows the stored value;
 * while focused it shows exactly what was typed, so a value is never reformatted mid-keystroke.
 * `typed` is true for a key typed on the keyboard, false for a paste, autofill or drop.
 */
function SetCell({ id, label, shown, inputMode, enterKeyHint, empty, onText, onEnter, onFocusChange }: {
  id: string;
  label: string;
  shown: string;
  inputMode: 'decimal' | 'numeric';
  enterKeyHint: 'next' | 'done';
  empty: boolean;
  onText: (text: string, typed: boolean) => CellAnswer;
  onEnter: (input: HTMLInputElement) => void;
  /** Called with true on focus and false on blur: the cell's typing burst begins and ends (#326). */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  /** Set by a reset; the render it causes selects the stored value it shows. */
  const selectNext = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectNext.current) return;
    selectNext.current = false;
    input.current?.select();
  });
  return (
    <input ref={input} id={id} type="text"
      // (#380 review 1) A load of 5 or more characters ("102.5") takes the tighter style that fits at 360.
      className={`lg-cell lg-input${empty ? ' lg-cell--empty' : ''}${(text ?? shown).length > 4 ? ' lg-input--long' : ''}`}
      inputMode={inputMode} enterKeyHint={enterKeyHint} autoComplete="off" aria-label={label}
      placeholder="—" value={text ?? shown}
      onFocus={(event) => { setText(shown); event.currentTarget.select(); onFocusChange?.(true); }}
      onChange={(event) => {
        const typed = event.target.value.replace(',', '.');
        const answer = onText(typed, (event.nativeEvent as InputEvent).inputType === 'insertText');
        if (answer === 'block') return;
        if (answer === 'reset') {
          // While focused the cell shows `text`, so drop it to show the stored value, then select it.
          selectNext.current = true;
          setText(null);
          return;
        }
        setText(typed);
      }}
      onBlur={() => { setText(null); onFocusChange?.(false); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onEnter(event.currentTarget);
      }} />
  );
}

export default function TrainScreen({
  session,
  history,
  now,
  profileLoads = {},
  rampLoads = [],
  calibrationLoads = [],
  experience,
  unit,
  targetNotes,
  rests = [],
  pairs = [],
  goHeavier = {},
  onMinimize,
  onFinish,
  onUpdateSet,
  held = null,
  onLogSet,
  onToggleRestPause,
  onExtendRest,
  onOpenActions,
  onReplace,
  onLater,
  onReturn,
}: Props) {
  useWakeLock();
  // (#379) The photo: a tap opens the how-to player, a 0.5 s hold the chips' menu (and not the tap).
  const [howTo, setHowTo] = useState<WorkoutExercise | null>(null);
  const [hold, setHold] = useState(false);
  const holdTimer = useRef(0);
  const holding = useRef(false);
  const release = () => clearTimeout(holdTimer.current);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  // The hold's release lands on the menu, not the photo: closing the menu ends the hold (review 1).
  const closeHold = () => { holding.current = false; setHold(false); };
  /**
   * Set cells (`calibrationKey:setIndex`) whose suggested start the lifter cleared: they stay empty for
   * this visit. Nothing is stored (owner, #315 item 12): after a reload the muted suggestion shows again,
   * and it reaches the record only when a set is logged with it.
   */
  const [cleared, setCleared] = useState<string[]>([]);
  /** A refused keystroke's message, under the row it was typed in. */
  const [refusal, setRefusal] = useState<{ key: string; text: string } | null>(null);
  /**
   * (#326) While set 1's weight cell is focused, the load it showed when focus began: the ramp rows read
   * it until blur, so typing 135 to 140 ("1", "14", "140") never adds or removes a row. Keyed by session,
   * slot and exercise, so a swap or another session never inherits it. In memory only.
   */
  const [rampBurst, setRampBurst] = useState<{ key: string; kg: number } | null>(null);
  /** After the focused control unmounts, focus moves here (an element id, or 'log' for the card's Log button) instead of <body>. */
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    // The card's Log button; a set with no load yet offers its weight cell. After the last set, Finish.
    const element = target === 'log'
      ? document.querySelector<HTMLElement>('button.lg-log:not(:disabled)') ?? document.querySelector<HTMLElement>('.lg-focus input.lg-input')
        ?? document.querySelector<HTMLElement>('.finish-btn')
      : document.getElementById(target);
    (element?.matches('button, input') ? element
      : element?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? element?.querySelector<HTMLElement>('button, input'))?.focus();
  });

  // (#327) A held jump's card appears under the row being typed; keep it in view above the dock or
  // keyboard, the way the phone keeps the field in view (its scroll margins include --kb and --vv-top).
  const heldKey = held === null ? null : `${held.exerciseIndex}:${held.setIndex}`;
  useEffect(() => {
    if (heldKey === null) return;
    document.querySelector('.lg-note--held .notice-card')?.scrollIntoView({ block: 'nearest' });
  }, [heldKey]);

  // #300: warm-up checks live in memory for the session; nothing reaches the record.
  // Read by session id every render, so a session replaced under a mounted logger never shows another's checks.
  const [, setWarmTick] = useState(0);
  const warm = warmUpChecks(session.id);
  const updateWarm = (patch: Partial<WarmUpChecks>) => {
    setWarmUpChecks(session.id, { ...warmUpChecks(session.id), ...patch });
    setWarmTick((tick) => tick + 1);
  };
  const warmMinutes = generalWarmUpMinutes(session.durationMin);
  const warmLeft = warm.timerStartedAt === null ? null
    : Math.max(0, Math.ceil(warmMinutes * 60 - (now - warm.timerStartedAt) / 1000));
  // The optional timer running out ticks the warm-up done, derived from the tick like "Rest over".
  if (warmLeft === 0 && !warm.general) updateWarm({ general: true });
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const restPaused = Boolean(session.restPausedAt);

  const [muted, setMuted] = useState(() => isRestMuted(session.id));
  const [restOver, setRestOver] = useState(false);
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
  // (#88) In a superset the half that is behind is up: A1, B1, A2, B2.
  const index = pairedPendingIndex(session, pairs);
  const exercise = index === -1 ? undefined : session.exercises[index];
  // Up next is work still on offer: never a skipped or finished exercise. In a superset it is the
  // exercise that follows this set: the partner, or A again for the next round.
  const afterThisSet = exercise ? (() => {
    const setIndex = exercise.performed.findIndex((set) => !set.done);
    const exercises = session.exercises.map((entry, entryIndex) => entryIndex !== index ? entry
      : { ...entry, performed: entry.performed.map((set, i) => (i === setIndex ? { ...set, done: true } : set)) });
    return pairedPendingIndex({ exercises }, pairs);
  })() : -1;
  const next = index === -1 ? undefined
    : afterThisSet >= 0 && afterThisSet !== index && partnerOf(pairs, index) === afterThisSet ? session.exercises[afterThisSet]
    : session.exercises
      .find((entry, entryIndex) => entryIndex > index && !entry.skipped && entry.performed.some((set) => !set.done));
  const round = index === -1 ? null : pairRound(session, index, pairs);
  const partner = index === -1 ? undefined : partnerOf(pairs, index);
  /** The rest this set starts: 30 s to the partner, the pair's rest after a round (#88), else the role's. */
  const restAfter = index === -1 || rests[index] === undefined ? undefined : restAfterLog(session, index, rests, pairs);
  const skippedToday = session.exercises
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => entry.skipped);

  /**
   * (#380) The set the card shows: a tapped row's set, in memory only. Null is the next set to log. Cleared
   * on a log, and whenever the exercise on screen, its key or the set itself is no longer there.
   */
  const [focus, setFocus] = useState<{ key: string; setIndex: number } | null>(null);
  /**
   * (#380 review 1) While rest runs the dock sits over the bottom of the screen: its height is published as
   * --lg-dock, so the card's fields and Log button scroll clear of it (the keyboard, when up, covers it).
   * Measured when rest starts or ends; a later mount measures again, so no cleanup is needed.
   */
  const dockRef = useRef<HTMLDivElement>(null);
  const resting = rest > 0;
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--lg-dock', `${dockRef.current?.offsetHeight ?? 0}px`);
    // A standing toast places itself above the dock on resize: the dock coming or going moves that floor.
    window.dispatchEvent(new Event('resize'));
  }, [resting]);

  const header = (
    <header className="flow-header lg-header">
      <div className="flow-header__inner">
        <button className="flow-back" onClick={onMinimize} aria-label="Minimize workout">
          <Icon name="arrow_back_ios_new" size={22} />
        </button>
        <h1 className="flow-title">{session.name}</h1>
        <div className="flow-header__right">
          <button className="finish-btn" onClick={onFinish}>
            Finish
          </button>
        </div>
      </div>
      <div className="lg-prog">
        <b className="lg-count">{progress.done} of {progress.total} sets</b>
        <span className="lg-clock">{clock(elapsedMs(session, now))}</span>
      </div>
      {/* One tick per set, grouped by exercise; a logged set fills lime. */}
      <div className="lg-ticks" aria-hidden="true">
        {session.exercises.map((entry, entryIndex) => (
          <span className="lg-ticks__group" key={entryIndex}>
            {entry.performed.map((set, setIndex) => <span key={setIndex} className={set.done ? 'lg-tick lg-tick--done' : 'lg-tick'} />)}
          </span>
        ))}
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
                : progress.skipped > 0 ? 'All remaining work is skipped' : 'Every set is logged'}
            </h2>
            <p className="data-note" style={{ marginTop: 8 }}>
              {progress.done} of {progress.total} sets completed
              {progress.skipped > 0 ? ` · ${progress.skipped} skipped` : ''}
              {progress.pending > 0 ? ` · ${progress.pending} not logged` : ''}.{' '}
              {progress.skipped > 0 ? 'Skipping records nothing, and Finish' : 'Finish'} saves only completed sets.
            </p>
          </section>

          {session.exercises.map((entry, entryIndex) => {
            const done = entry.performed.filter((set) => set.done).length;
            const pendingSets = entry.performed.filter((set) => !set.done).length;
            // A gear switch splits one exercise into segments (#188): the line is said once, on its
            // last segment, about all of its sets.
            const lastSegment = session.exercises.slice(entryIndex + 1).every((other) => other.exerciseId !== entry.exerciseId);
            const carried = session.exercises.filter((other) => other.exerciseId === entry.exerciseId)
              .reduce((sum, other) => sum + other.performed.length, 0);
            return (
              <div className="card" key={`${entry.exerciseId}-${entryIndex}`}>
                <div className="context-row" style={{ borderBottom: 0 }}>
                  <span>{entry.name}</span>
                  <span className="tag">
                    {done} of {entry.performed.length} {entry.performed.length === 1 ? 'set' : 'sets'}
                    {entry.skipped ? ' · Skipped' : ''}
                    {!entry.skipped && pendingSets > 0 ? ' · Not logged' : ''}
                  </span>
                </div>
                {lastSegment && (entry.originalPlannedSets ?? 0) > carried && (
                  <p className="data-note">
                    Original prescription: {entry.originalPlannedSets} sets. This session carried{' '}
                    {carried}.
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

  // #80: everything a row renders is keyed by exercise, segment and set, so a
  // skip or swap mounts fresh controls instead of reusing another exercise's.
  const exerciseKey = `${exercise.exerciseId}:${index}`;
  const rowKey = (setIndex: number) => `${exerciseKey}:${setIndex}`;
  // (#380) The card's set: the tapped row while it is still there, else the next set to log.
  const focusKey = `${session.id}:${exerciseKey}`;
  const focusLive = focus !== null && focus.key === focusKey && focus.setIndex < exercise.performed.length;
  if (focus !== null && !focusLive) setFocus(null);
  const focused = focusLive ? focus.setIndex : activeSet;
  const calibrationKey = `${session.id}:${index}:${exercise.exerciseId}`;
  // Ready to go heavier (#165): the lifter types the next load up from last time's.
  const floor = goHeavier[exercise.exerciseId];
  const raising = floor !== undefined && exercise.performed[0]?.weight === 0
    && !exercise.performed.some((set) => set.done);
  // First time on a loaded lift (#116): empty weight cells show a suggested start (#309), in the
  // user's own dumbbells when they listed them. It reaches the record only when a set is logged with it.
  // The suggestion stays on empty cells after a set is logged out of order (#309 review 1); the hint
  // line, which talks about set 1, only until the first set is logged.
  const neverLogged = firstTimeLoaded(exercise, history, { evenIfLogged: true });
  const firstTime = firstTimeLoaded(exercise, history);
  const definition = exerciseById(exercise.exerciseId);
  const table = neverLogged && !raising && experience && definition ? suggestedFirstLoad(definition, experience, unit) : 0;
  const ownDumbbells = equipment === 'Dumbbell' ? calibrationLoads : [];
  const suggested = table > 0 ? (ownDumbbells.length > 0 ? nearestLoad(ownDumbbells, table) ?? table : table) : null;
  const prefill = suggested;
  const perSide = mode === 'each' ? ' each' : '';
  const hint = suggested !== null && firstTime
    ? `Suggested start ${calibrationInputValue(suggested, unit)} ${unitLabel(unit)}${perSide}. Do 5 easy reps with it, then adjust set 1.`
    : null;
  const coach = raising
    ? `Ready to go heavier. Pick your next ${equipment.toLowerCase()} up from ${calibrationInputValue(floor, unit)} ${weightLabel}, for ${exercise.planned[0]?.reps ?? 0} reps.`
    : hint ?? (firstTime && mode !== 'none'
      ? `First time on this one. Pick a weight you could lift for ${exercise.planned[0]?.reps ?? 10} reps with 2–3 to spare.`
      : targetNotes?.[exercise.exerciseId]);
  // (#372) The lifter's own note from the last finished session with one on this exact exercise.
  const noteLast = lastNote(history, exercise.exerciseId);
  const unitWord = `${unit === 'kg' ? 'kilograms' : 'pounds'}${perSide}`;

  /**
   * A value past the limit (#101, #109). A typed key is capped at the cell: it is never typed, so nothing
   * changes (#309 review 2). Anything else (a paste) is refused, and the burst it ended is undone: every
   * set it carried goes back to what Undo restores, and the cell shows its value again, selected.
   */
  const refuse = (setIndex: number, key: string, message: string, patch: Partial<PerformedSet>, typed: boolean): CellAnswer => {
    setRefusal({ key, text: message });
    if (typed) return 'block';
    onUpdateSet(index, setIndex, patch, { revert: 'refused' });
    return 'reset';
  };
  /** A weight keystroke. An emptied cell undoes its burst; a logged set keeps its load (#103). */
  const typeWeight = (set: PerformedSet, setIndex: number, key: string, text: string, typed: boolean): CellAnswer => {
    const next = typedLoad(text, unit, set.weight);
    if (!next) return 'block';
    if (next.refused) return refuse(setIndex, key, loadLimitMessage(unit), { weight: set.weight }, typed);
    setRefusal(null);
    if (next.kg <= 0) {
      // Clearing a cell drops the suggested start from that cell only: an emptied cell stays empty.
      const cell = `${calibrationKey}:${setIndex}`;
      if (prefill !== null && !cleared.includes(cell)) setCleared((keys) => [...keys, cell]);
      onUpdateSet(index, setIndex, { weight: 0 }, { revert: 'emptied' });
      return null;
    }
    onUpdateSet(index, setIndex, { weight: next.kg }, { prefill: prefill ?? 0 });
    return null;
  };
  /** A reps (or seconds) keystroke; above the limit it is capped or refused, as a load is. */
  const typeReps = (set: PerformedSet, setIndex: number, key: string, text: string, typed: boolean): CellAnswer => {
    if (!/^\d*$/.test(text)) return 'block';
    const next = typedReps(text, set.reps);
    if (next.refused) return refuse(setIndex, key, repsLimitMessage(holdUnit), { reps: set.reps }, typed);
    setRefusal(null);
    onUpdateSet(index, setIndex, { reps: next.reps }, next.reps <= 0 ? { revert: 'emptied' } : {});
    return null;
  };

  // (#371) − and + move the card's set by one real step: the same edit (and burst) as typing its weight.
  // (#380) The card's set when it is still to log (a logged set is edited by typing only).
  const stepSet = focused >= 0 && !exercise.performed[focused]?.done && mode !== 'none' && !holdUnit && equipment !== 'Bodyweight'
    ? exercise.performed[focused] : undefined;
  const stepFrom = !stepSet ? 0 : stepSet.weight > 0 ? stepSet.weight
    : prefill !== null && !cleared.includes(`${calibrationKey}:${focused}`) ? prefill : raising ? floor : 0;
  // A dumbbell steps the rack today's gear offers (a Travel gym's hotel rack), as the ramp rows do (#371 review 1).
  // (#389) The steps measure from the cell's own readout, and a stepped-to load reads as an edited set does.
  const cellFrom = !stepSet ? 0 : Number(stepSet.weight > 0 ? showPending(stepSet.weight, focused) : showActual(stepFrom)) || 0;
  const steps = stepSet ? weightSteps({ kg: stepFrom, equipment, available: equipment === 'Dumbbell' ? rampLoads : rack, unit,
    cell: { from: cellFrom, to: (kg) => Number(showActual(kg)) } }) : null;
  const stepTo = (kg: number | null) => {
    if (kg === null) return;
    setRefusal(null);
    onUpdateSet(index, focused, { weight: kg }, { prefill: prefill ?? 0, step: true });
  };

  // #300/#326: the ramp rows' slot, and the load set 1 shows (its typed load, else the suggested start).
  const rampIndex = mode !== 'none' ? rampExerciseIndex(session) : -1;
  // #344: set 1's cell can stop being the ramp cell while still focused (its ✓ keeps focus), and then no
  // blur clears the burst. Drop it here, so a later ramp never starts from a stale burst.
  const burst = liveRampBurst(rampBurst, { key: calibrationKey, rampIndex, index });
  if (rampBurst !== null && burst === null) setRampBurst(null);
  const setOne = exercise.performed[0];
  const setOneKg = rampWorking({
    setOneKg: setOne?.weight ?? 0,
    suggestedKg: setOne && !setOne.done && prefill !== null && !cleared.includes(`${calibrationKey}:0`) ? prefill : null,
  });


  // The suggested start shows in every empty weight cell still to log; logging writes it to that set.
  const prefillOf = (set: PerformedSet, setIndex: number) =>
    !set.done && set.weight <= 0 && prefill !== null && !cleared.includes(`${calibrationKey}:${setIndex}`) ? prefill : null;
  /** The load a set shows, as its cell or its list row reads it ('' when it has none yet). */
  const weightText = (set: PerformedSet, setIndex: number) => {
    const shownPrefill = prefillOf(set, setIndex);
    return set.weight > 0 ? showPending(set.weight, setIndex) : shownPrefill !== null ? showActual(shownPrefill) : '';
  };
  const repsText = (reps: number, hold: boolean) => (hold ? `${reps}s` : String(reps));
  /** "135 lb × 5", "BW × 12", "20 lb × 30s": what a list row says about its set. */
  const setLine = (weight: string, reps: number, bodyweight: boolean, hold: boolean) =>
    `${bodyweight ? 'BW' : weight ? `${weight} ${unitLabel(unit)}` : '—'} × ${repsText(reps, hold)}`;

  // ---------- The card: the focused set's fields and its one button ----------
  const set = exercise.performed[focused] ?? exercise.performed[0];
  const key = rowKey(focused);
  const n = focused + 1;
  const before = previous[focused];
  const shownPrefill = prefillOf(set, focused);
  const noLoad = needsLoad(exercise.exerciseId) && set.weight <= 0 && shownPrefill === null;
  // An emptied reps (or seconds) cell is never logged as 0 either (#309 review 1).
  const noReps = set.reps <= 0;
  const reason = !set.done && (noLoad || noReps) ? `${key}:reason` : undefined;
  const refused = refusal?.key === key ? `${key}:refused` : undefined;
  const rampCell = focused === 0 && rampIndex === index;
  const weightShown = weightText(set, focused);
  // "lb · bar": the load on the card is the empty barbell (#380).
  const onBar = equipment === 'Barbell' && weightShown !== '' && Math.abs(Number(weightShown) - BAR[unit]) < 0.001;
  const weightUnit = `${unitLabel(unit)}${perSide}${onBar ? ' · bar' : ''}`;
  // (#88) In a superset the card names the half by its place in the pair: A is the first, B the second.
  const pair = round && partner !== undefined ? pairs.find(([a, b]) => a === index || b === index) : undefined;
  const letterOf = (entryIndex: number) => (pair ? (entryIndex === Math.min(...pair) ? 'A' : 'B') : '');
  const letter = letterOf(index);
  const tail = 132 + (reason ? 40 : 0) + (refused ? 40 : 0);

  // (#327) A held jump's Heads-up: on the card while it shows the held set, else under that set's row.
  const heldNotice = held !== null && (
    <div className="lg-note lg-note--held" key="held">
      <NoticeCard kind="headsUp" title={held.text} onDismiss={held.onDismiss}
        actions={<button type="button" className="notice-card__fix" onPointerDown={(event) => event.preventDefault()} onClick={held.onApply}>Apply to all</button>} />
    </div>
  );

  const card = (
    <section className="lg-focus" aria-label={letter ? `${letter}${n}, set ${n} of ${exercise.performed.length}` : `Set ${n} of ${exercise.performed.length}`}
      key={`${exerciseKey}:card`} style={{ '--lg-tail': `${tail}px` } as CSSProperties}
      // (#380) A field the phone already shows is not scrolled on focus, so reveal it again with its scroll
      // margins: under the sticky top (--lg-top, measured now), and Log (--lg-tail below it) clear of the dock
      // or keyboard. When field and Log do not both fit, the field wins (fix 2: it is the one being typed).
      onFocus={(event) => {
        const field = event.target;
        document.documentElement.style.setProperty('--lg-top', `${document.querySelector('.lg-header')?.clientHeight}px`);
        requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest' }));
      }}>
      <div className="lg-focus__head">
        <h3 className="lg-focus__set">
          {letter ? <>{letter}{n} <span>· set {n} of {exercise.performed.length}</span></> : <>Set {n} <span>of {exercise.performed.length}</span></>}
        </h3>
        {before && (
          <span className="lg-focus__prev">
            Previous <b>{before.weight > 0 ? `${showWeight(before.weight)} × ${before.reps}` : repsText(before.reps, holdUnit)}</b>
          </span>
        )}
      </div>
      <div className="lg-fields">
        {mode === 'none' ? (
          <div className="lg-field">
            <span className="lg-field__num"><span className="lg-cell lg-cell--bw">BW</span><small>bodyweight</small></span>
          </div>
        ) : (
          <div className="lg-field lg-field--w" role={steps && steps.step > 0 ? 'group' : undefined}
            aria-label={steps && steps.step > 0 ? `Weight steps for set ${n}` : undefined}>
            {steps && steps.step > 0 && (
              <button type="button" className="lg-step" disabled={steps.down === null} onClick={() => stepTo(steps.down)}
                aria-label={`− ${steps.downBy} ${unitLabel(unit)}`}>
                {'−'}{steps.downBy}
              </button>
            )}
            <label className="lg-field__num">
              <SetCell key={`${key}:weight`} id={`${key}:weight`} label={`Set ${n} weight, ${unitWord}`} shown={weightShown}
                empty={set.weight <= 0} inputMode="decimal" enterKeyHint="next"
                onText={(text, typed) => typeWeight(set, focused, key, text, typed)}
                onEnter={() => document.getElementById(`${key}:reps`)?.focus()}
                onFocusChange={rampCell
                  ? (on) => setRampBurst(on ? { key: calibrationKey, kg: setOneKg } : null)
                  : undefined} />
              <small>{weightUnit}</small>
            </label>
            {steps && steps.step > 0 && (
              <button type="button" className="lg-step" disabled={steps.up === null} onClick={() => stepTo(steps.up)}
                aria-label={`+ ${steps.upBy} ${unitLabel(unit)}`}>
                +{steps.upBy}
              </button>
            )}
          </div>
        )}
        <div className="lg-field">
          <label className="lg-field__num">
            <SetCell key={`${key}:reps`} id={`${key}:reps`} label={`Set ${n} ${holdUnit ? 'seconds' : 'reps'}`}
              shown={String(set.reps)} empty={false} inputMode="numeric" enterKeyHint="done"
              onText={(text, typed) => typeReps(set, focused, key, text, typed)}
              onEnter={(input) => input.blur()} />
            <small>{holdUnit ? 'sec' : 'reps'}</small>
          </label>
        </div>
      </div>
      {reason && <p className="lg-note" id={reason}>{noLoad ? NEEDS_LOAD_REASON : `Enter ${holdUnit ? 'seconds' : 'reps'} to log this set`}</p>}
      {refused && <p className="lg-note error-text" id={refused} role="alert">{refusal?.text}</p>}
      {held !== null && held.exerciseIndex === index && held.setIndex === focused && heldNotice}
      {set.done ? (
        // Q1 (product default): a logged set's edits save as typed; this returns to the next set to log.
        <button type="button" className="lg-log lg-log--back" onPointerDown={(event) => event.preventDefault()}
          onClick={() => { setRefusal(null); setFocus(null); }}>
          Back to set {activeSet + 1}
        </button>
      ) : (
        <button type="button" className="lg-log" aria-label={`Log set ${n}`} disabled={noLoad || noReps}
          aria-describedby={reason}
          // Keep the keyboard's field focused through the tap, so the card does not jump first.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            primeRestAudio();
            setRefusal(null);
            setFocus(null);
            focusNext.current = 'log';
            onLogSet(index, focused, exercise.exerciseId, shownPrefill ?? undefined);
          }}>
          <Icon name="check" size={20} />Log set {n}
        </button>
      )}
    </section>
  );

  // ---------- The list: ramp rows, then every set; a row of this exercise is a button into the card ----------
  const tick = (label?: string) => (
    <span className="lg-tick-mark" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Icon name="check" size={16} />
    </span>
  );
  const setRow = (setIndex: number) => {
    const row = exercise.performed[setIndex];
    const line = setLine(weightText(row, setIndex), row.reps, mode === 'none', holdUnit);
    const isFocus = setIndex === focused;
    const state = row.done ? 'lg-li--done' : isFocus ? 'lg-li--now' : 'lg-li--later';
    // (#380 review 1) The name carries the state the tick or "Now" shows.
    const name = `Set ${setIndex + 1}, ${line}, ${row.done ? 'logged, edit' : isFocus ? 'now' : 'edit'}`;
    const button = (
      <button type="button" key={rowKey(setIndex)} className={`lg-li ${state}${isFocus ? ' lg-li--focus' : ''}`}
        aria-label={name} aria-current={isFocus ? 'true' : undefined}
        onClick={() => { setRefusal(null); setFocus(setIndex === activeSet ? null : { key: focusKey, setIndex }); }}>
        <span className="lg-li__n">{letter}{setIndex + 1}</span>
        <span className="lg-li__v">{line}</span>
        {row.done ? tick(`Set ${setIndex + 1} logged`) : isFocus ? <span className="lg-li__now">Now</span> : <span className="lg-li__ghost" />}
      </button>
    );
    return held !== null && held.exerciseIndex === index && held.setIndex === setIndex && !isFocus ? [button, heldNotice] : button;
  };
  // Q2 (product default): the partner's rows show round by round, muted and display-only.
  const partnerEntry = pair && partner !== undefined ? session.exercises[partner] : undefined;
  const partnerRow = (setIndex: number) => {
    if (!partnerEntry || partner === undefined) return null;
    const row = partnerEntry.performed[setIndex];
    const partnerMode = loadModeOf(partnerEntry.exerciseId);
    const partnerHold = setUnit(partnerEntry.exerciseId) === 'seconds';
    const partnerEquipment = exerciseById(partnerEntry.exerciseId)?.equipment ?? (partnerMode === 'none' ? 'Bodyweight' : 'Dumbbell');
    const partnerRack = availableLoads({ loads: profileLoads }, partnerEquipment);
    const partnerPlanned = plannedLoad(profileLoads, history, partnerEntry.exerciseId, unit);
    const weight = row.weight <= 0 ? ''
      : Math.abs(row.weight - (partnerEntry.planned[setIndex]?.weight ?? -1)) < 0.001 ? partnerPlanned(row.weight) : loadValue(row.weight, unit, partnerRack);
    return (
      <div key={`partner-${partner}-${setIndex}`} className={`lg-li lg-li--partner${row.done ? ' lg-li--done' : ''}`}>
        <span className="lg-li__n">{letterOf(partner)}{setIndex + 1}</span>
        <span className="lg-li__v"><span className="lg-li__ex">{partnerEntry.name}</span> {setLine(weight, row.reps, partnerMode === 'none', partnerHold)}</span>
        {row.done ? tick() : <span className="lg-li__ghost" />}
      </div>
    );
  };
  const listRows = partnerEntry && pair
    ? Array.from({ length: Math.max(exercise.performed.length, partnerEntry.performed.length) }, (_, setIndex) => {
      const own = setIndex < exercise.performed.length ? setRow(setIndex) : null;
      const theirs = setIndex < partnerEntry.performed.length ? partnerRow(setIndex) : null;
      return letter === 'A' ? [own, theirs] : [theirs, own];
    }).flat().filter(Boolean)
    : exercise.performed.map((_, setIndex) => setRow(setIndex));

  // #300: two ramp sets before the lead's working sets, from the load set 1 shows. Not sets: never
  // logged, counted or stored. A dumbbell ramps on the rack the logger's own picker offers (Travel's
  // hotel rack on a today-only day), else plate steps. Once every one is ticked they fold to one line.
  const rampRack = equipment === 'Dumbbell' ? rampLoads : rack;
  const ramps = index === rampIndex
    ? rampSets({ equipment, unit, rack: rampRack, working: burst !== null ? burst.kg : setOneKg })
    : [];
  const rampKey = (rampNumber: number) => `${exercise.exerciseId}:${rampNumber}`;
  const allRampsTicked = ramps.length > 0 && ramps.every((_, rampNumber) => warm.ramps.includes(rampKey(rampNumber)));
  const rampRows = allRampsTicked ? [(
    <div key={`${exerciseKey}:warm`} className="lg-li lg-li--warm lg-li--warm-done">
      <span className="lg-li__n"><abbr title="Warm-up">W</abbr></span>
      <span className="lg-li__v">Warm-up sets · {ramps.map((ramp) => `${loadValue(ramp.weight, unit, rampRack)} × ${ramp.reps}`).join(', ')}</span>
      <button type="button" className="lg-wcheck" aria-pressed="true" aria-label="Warm-up sets, done"
        onClick={() => updateWarm({ ramps: warm.ramps.filter((item) => !ramps.some((_, rampNumber) => item === rampKey(rampNumber))) })}>
        <Icon name="check" size={18} />
      </button>
    </div>
  )] : ramps.map((ramp, rampNumber) => {
    const ticked = warm.ramps.includes(rampKey(rampNumber));
    const load = loadValue(ramp.weight, unit, rampRack);
    return (
      <div key={`${exerciseKey}:warm-${rampNumber}`} className={ticked ? 'lg-li lg-li--warm lg-li--warm-done' : 'lg-li lg-li--warm'}>
        <span className="lg-li__n"><abbr title="Warm-up">W</abbr></span>
        <span className="lg-li__v"><span className="lg-warm-tag">Warm-up</span> <span className="lg-warm-load">{load} {unitLabel(unit)}</span> × <span className="lg-warm-reps">{ramp.reps}</span></span>
        <button type="button" className="lg-wcheck" aria-pressed={ticked}
          aria-label={`Warm-up set ${rampNumber + 1}, ${load} ${weightLabel} × ${ramp.reps}, done`}
          onClick={() => updateWarm({ ramps: ticked ? warm.ramps.filter((item) => item !== rampKey(rampNumber)) : [...warm.ramps, rampKey(rampNumber)] })}>
          <Icon name="check" size={18} />
        </button>
      </div>
    );
  });

  // (#151) The photo's hold menu: one-tap shortcuts into the same actions the sheet holds (#379, unchanged).
  type Act = [string, ReactNode, () => void];
  const historyAct: Act = ['History', <Icon key="i" name="monitoring" size={16} />, () => onOpenActions(index, 'history')];
  const replace: Act[] = onReplace ? [['Replace', <Icon key="i" name="tune" size={16} />, () => onReplace(index)]] : [];
  const acts: Act[] = [
    ['How-to', null, () => setHowTo(exercise)],
    historyAct,
    ...replace,
    // (#369) Hidden on the only exercise with work left: there is nothing to move it behind.
    ...(onLater && canMoveLater(session, index) ? [['Later', null, () => onLater(index)] as Act] : []),
  ];
  // (#380) The chip row: History, Replace, More (the sheet the name opens; Later is its first row).
  const chips: Act[] = [historyAct, ...replace,
    ['More', <span key="i" className="lg-act__more" aria-hidden="true"><MoreIcon size={16} /></span>, () => onOpenActions(index)]];

  return (
    <div className="screen flow-screen">
      {header}
      {howTo && <HowTo exerciseId={howTo.exerciseId} name={howTo.name} onClose={() => setHowTo(null)} />}
      {hold && (
        <Sheet title={exercise.name} onClose={closeHold} headingId="hold-title">
          <div className="sheet-menu">
            {acts.map(([label, , run]) => (
              <button key={label} type="button" className="context-row sheet-menu__row" onClick={() => { closeHold(); run(); }}>
                {label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      <div className="flow-body lg-body">
        {showsGeneralWarmUp(session) && (
          <section className={warm.general ? 'lg-warm lg-warm--done' : 'lg-warm'} aria-label="Warm-up">
            <div className="lg-warm__text">
              <h2 className="lg-warm__title">Warm-up · {warmMinutes} min{warm.general ? <span> · done</span> : null}</h2>
              {!warm.general && <p className="lg-warm__note">{GENERAL_WARM_UP_TEXT}</p>}
            </div>
            {!warm.general && (
              <button type="button" className="lg-warm__timer"
                aria-label={warmLeft === null ? `Start ${warmMinutes}-minute warm-up timer` : 'Stop warm-up timer'}
                onClick={() => updateWarm({ timerStartedAt: warmLeft === null ? Date.now() : null })}>
                <Icon name="timer" size={16} />
                {warmLeft === null ? `${warmMinutes}:00` : restClock(warmLeft)}
              </button>
            )}
            <button type="button" className="lg-wcheck" aria-pressed={warm.general}
              aria-label={`Warm-up, ${warmMinutes} min easy cardio, done`}
              onClick={() => updateWarm({ general: !warm.general, timerStartedAt: null })}>
              <Icon name="check" size={20} />
            </button>
          </section>
        )}

        {round && partner !== undefined && (
          <p className="ss-band">
            <span className="ss-band__tag">Superset</span>
            <span>Round {round.round} of {round.rounds} · with {session.exercises[partner].name}</span>
          </p>
        )}

        <section className="lg-ex" aria-label={exercise.name}>
          <button type="button" className="lg-thumb" aria-label={`${exercise.name} how-to, hold for actions`} aria-haspopup="dialog"
            onPointerDown={() => {
              holding.current = false;
              release();
              holdTimer.current = window.setTimeout(() => { holding.current = true; setHold(true); }, 500);
            }}
            onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => { if (holding.current) holding.current = false; else setHowTo(exercise); }}>
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
              {restAfter ? <> · Rest {restLabel(restAfter)}</> : null}
            </p>
          </div>
        </section>

        <div className="lg-acts" role="group" aria-label={`Actions for ${exercise.name}`}>
          {chips.map(([label, icon, run]) => (
            <button key={label} type="button" className="lg-act" onClick={run} aria-haspopup="dialog">
              {icon}{label}
            </button>
          ))}
        </div>

        {coach && <p className="lg-coach">{coach}</p>}
        {/* (#372) Its own line under any coach text, so a heads-up is never hidden; wraps to at most 3 lines. */}
        {noteLast && <p className="lg-coach lg-coach--note">Last time: {noteLast}</p>}

        {card}

        <section className="lg-list" aria-label={pair ? 'Superset sets' : `Sets for ${exercise.name}`}>
          {rampRows.length > 0 && !allRampsTicked && <p className="lg-list__label">Warm-up sets</p>}
          {rampRows}
          {pair && <p className="lg-list__label">Round by round</p>}
          {listRows}
        </section>

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
              const pendingSets = entry.performed.filter((item) => !item.done).length;
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

      {rest > 0 && (
        <div className="flow-dock lg-dock" ref={dockRef}>
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
        </div>
      )}
    </div>
  );
}
