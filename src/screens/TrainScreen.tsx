import { useEffect, useRef, useState } from 'react';
import { loadModeOf, NEEDS_LOAD_REASON, needsLoad, repsTarget, setUnit } from '../data/flagship';
import { exerciseById } from '../data/exercises';
import { elapsedMs, pendingExerciseIndex, restRemaining, sessionProgress } from '../lib/session';
import { isRestMuted, playRestCue, primeRestAudio, restEnded, setRestMuted, shouldCue } from '../lib/restCue';
import { exerciseInWorkout, lastPerformance } from '../lib/plan';
import { firstTimeLoaded, plannedLoad } from '../lib/liveProgression';
import { nearestLoad, suggestedFirstLoad } from '../lib/firstLoad';
import { availableLoads } from '../lib/progression';
import { calibrationInputValue, loadLimitMessage, loadValue, repsLimitMessage, typedLoad, typedReps, unitLabel } from '../lib/units';
import { restLabel } from '../lib/sessionTime';
import { GENERAL_WARM_UP_TEXT, generalWarmUpMinutes, rampExerciseIndex, rampSets, setWarmUpChecks, showsGeneralWarmUp, warmUpChecks } from '../lib/warmUp';
import type { WarmUpChecks } from '../lib/warmUp';
import type { Experience, PerformedSet, Profile, Unit, WorkoutExercise, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
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
function SetCell({ id, label, shown, inputMode, enterKeyHint, empty, onText, onEnter }: {
  id: string;
  label: string;
  shown: string;
  inputMode: 'decimal' | 'numeric';
  enterKeyHint: 'next' | 'done';
  empty: boolean;
  onText: (text: string, typed: boolean) => CellAnswer;
  onEnter: (input: HTMLInputElement) => void;
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
    <input ref={input} id={id} className={empty ? 'lg-cell lg-input lg-cell--empty' : 'lg-cell lg-input'} type="text"
      inputMode={inputMode} enterKeyHint={enterKeyHint} autoComplete="off" aria-label={label}
      placeholder="—" value={text ?? shown}
      onFocus={(event) => { setText(shown); event.currentTarget.select(); }}
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
      onBlur={() => setText(null)}
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
  onReturn,
}: Props) {
  /**
   * Set cells (`calibrationKey:setIndex`) whose suggested start the lifter cleared: they stay empty for
   * this visit. Nothing is stored (owner, #315 item 12): after a reload the muted suggestion shows again,
   * and it reaches the record only when a set is logged with it.
   */
  const [cleared, setCleared] = useState<string[]>([]);
  /** A refused keystroke's message, under the row it was typed in. */
  const [refusal, setRefusal] = useState<{ key: string; text: string } | null>(null);
  /** After the focused control unmounts, focus moves here (an element id, or 'log' for the next open ✓) instead of <body>. */
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    // The next open ✓; an exercise with no load yet offers its first weight cell. After the last ✓, Finish.
    const element = target === 'log'
      ? document.querySelector<HTMLElement>('button.lg-check:not(:disabled)') ?? document.querySelector<HTMLElement>('input.lg-input')
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

  const rows = exercise.performed.flatMap((set, setIndex) => {
    const key = rowKey(setIndex);
    const n = setIndex + 1;
    const before = previous[setIndex];
    // The suggested start shows in every empty weight cell still to log; logging writes it to that set.
    const shownPrefill = !set.done && set.weight <= 0 && prefill !== null && !cleared.includes(`${calibrationKey}:${setIndex}`)
      ? prefill : null;
    const noLoad = needsLoad(exercise.exerciseId) && set.weight <= 0 && shownPrefill === null;
    // An emptied reps (or seconds) cell is never logged as 0 either (#309 review 1).
    const noReps = set.reps <= 0;
    const reason = !set.done && (noLoad || noReps) && setIndex === activeSet ? `${key}:reason` : undefined;
    const refused = refusal?.key === key ? `${key}:refused` : undefined;
    const weightShown = set.weight > 0 ? showPending(set.weight, setIndex)
      : shownPrefill !== null ? showActual(shownPrefill) : '';
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
            <SetCell id={`${key}:weight`} label={`Set ${n} weight, ${unitWord}`} shown={weightShown}
              empty={set.weight <= 0} inputMode="decimal" enterKeyHint="next"
              onText={(text, typed) => typeWeight(set, setIndex, key, text, typed)}
              onEnter={() => document.getElementById(`${key}:reps`)?.focus()} />
          )}
        </td>
        <td>
          <SetCell id={`${key}:reps`} label={`Set ${n} ${holdUnit ? 'seconds' : 'reps'}`}
            shown={String(set.reps)} empty={false} inputMode="numeric" enterKeyHint="done"
            onText={(text, typed) => typeReps(set, setIndex, key, text, typed)}
            onEnter={(input) => input.blur()} />
        </td>
        <td>
          {set.done ? (
            <span className="lg-check" role="img" aria-label={`Set ${n} logged`}>
              <Icon name="check" size={20} />
            </span>
          ) : (
            <button type="button" className="lg-check" aria-label={`Log set ${n}`} disabled={noLoad || noReps}
              aria-describedby={reason}
              // Keep the keyboard's field focused through the tap, so the row does not jump first.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                primeRestAudio();
                setRefusal(null);
                focusNext.current = 'log';
                onLogSet(index, setIndex, exercise.exerciseId, shownPrefill ?? undefined);
              }}>
              <Icon name="check" size={20} />
            </button>
          )}
        </td>
      </tr>
    );
    const note = reason && (
      <tr key={reason} className="lg-note">
        <td colSpan={5} id={reason}>{noLoad ? NEEDS_LOAD_REASON : `Enter ${holdUnit ? 'seconds' : 'reps'} to log this set`}</td>
      </tr>
    );
    const error = refused && (
      <tr key={refused} className="lg-note"><td colSpan={5} id={refused} className="error-text" role="alert">{refusal?.text}</td></tr>
    );
    const heads = held !== null && held.exerciseIndex === index && held.setIndex === setIndex && (
      <tr key={`${key}:held`} className="lg-note lg-note--held">
        <td colSpan={5}>
          <NoticeCard kind="headsUp" title={held.text} onDismiss={held.onDismiss}
            actions={<button type="button" className="notice-card__fix" onPointerDown={(event) => event.preventDefault()} onClick={held.onApply}>Apply to all</button>} />
        </td>
      </tr>
    );
    return [row, note, error, heads].filter(Boolean);
  });

  // #300: two ramp sets before the lead's working sets, from the load set 1 shows. Not sets: never
  // logged, counted or stored. A dumbbell ramps on the rack the logger's own picker offers (Travel's
  // hotel rack on a today-only day), else plate steps.
  const rampRack = equipment === 'Dumbbell' ? rampLoads : rack;
  const ramps = mode !== 'none' && index === rampExerciseIndex(session)
    ? rampSets({ equipment, working: exercise.performed[0]?.weight ?? 0, unit, rack: rampRack })
    : [];
  const rampRows = ramps.map((ramp, rampIndex) => {
    const key = `${exercise.exerciseId}:${rampIndex}`;
    const ticked = warm.ramps.includes(key);
    return (
      <tr key={`${exerciseKey}:warm-${rampIndex}`} className={ticked ? 'lg-row--warm lg-row--warm-done' : 'lg-row--warm'}>
        <td><abbr title="Warm-up">W</abbr></td>
        <td className="lg-warm-tag">Warm-up</td>
        <td><span className="lg-cell lg-cell--warm">{loadValue(ramp.weight, unit, rampRack)}</span></td>
        <td><span className="lg-cell lg-cell--warm">{ramp.reps}</span></td>
        <td>
          <button type="button" className="lg-wcheck" aria-pressed={ticked}
            aria-label={`Warm-up set ${rampIndex + 1}, ${loadValue(ramp.weight, unit, rampRack)} ${weightLabel} × ${ramp.reps}, done`}
            onClick={() => updateWarm({ ramps: ticked ? warm.ramps.filter((item) => item !== key) : [...warm.ramps, key] })}>
            <Icon name="check" size={20} />
          </button>
        </td>
      </tr>
    );
  });

  return (
    <div className="screen flow-screen">
      {header}

      <div className="flow-body lg-body">
        {showsGeneralWarmUp(session) && (
          <section className={warm.general ? 'lg-warm lg-warm--done' : 'lg-warm'} aria-label="Warm-up">
            <div className="lg-warm__head">
              <div className="lg-warm__text">
                <h2 className="lg-warm__title">Warm-up · {warmMinutes} min</h2>
                {!warm.general && <p className="lg-warm__note">{GENERAL_WARM_UP_TEXT}</p>}
              </div>
              <button type="button" className="lg-wcheck" aria-pressed={warm.general}
                aria-label={`Warm-up, ${warmMinutes} min easy cardio, done`}
                onClick={() => updateWarm({ general: !warm.general, timerStartedAt: null })}>
                <Icon name="check" size={20} />
              </button>
            </div>
            {!warm.general && (
              <button type="button" className="pill-quiet lg-warm__timer"
                aria-label={warmLeft === null ? `Start ${warmMinutes}-minute warm-up timer` : 'Stop warm-up timer'}
                onClick={() => updateWarm({ timerStartedAt: warmLeft === null ? Date.now() : null })}>
                <Icon name="timer" size={16} />
                {warmLeft === null ? `Start ${warmMinutes}:00 timer` : restClock(warmLeft)}
              </button>
            )}
          </section>
        )}

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
          <tbody>{rampRows}{rows}</tbody>
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
