import
 { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { backupReminder, shareBackup } from './lib/backup';
import { offerFirstBackup } from './lib/dataHome';
import { currentDevice } from './lib/install';
import { noticeHome, screenKey } from './lib/noticeScreen';
import
 { downloadText } from './lib/download';
import
 { activeOverride, dayKey } from './lib/plan';
import
 {
  adaptWorkout,
  confirmedLoads,
  isGymKit,
  lengthOptions,
  setupOptions,
  EQUIPMENT_OPTIONS as SETUPS,
  DEFAULT_CONSTRAINTS,
  loadOptions,
  restorePendingWorkout,
  swapCandidateFor,
  toWorkoutExercises,
  todayGlance,
} from './lib/adapt';
import
 type { Constraints, EquipmentChoice } from './lib/adapt';
import
 { createProposal, decideProposalApproval } from './lib/proposal';
import
 type { Proposal, ProposalContext } from './lib/proposal';
import
 { defaultConstraints, ownedProfile, todayConstraints, withCeiling } from './lib/constraints';
import
 type { ConstraintNotice } from './lib/constraints';
import  { FULL_BODY_A } from './data/flagship';
import { cursorFor, dayCounter, isDescribedSession, planSlots, revisePlan, skipCurrentSlot, slotAt, slotLinkFor, todayProgram, updateProfile, withSkipped } from './lib/sequence';
import { withoutCustomDay } from './lib/plan';
import { todayOnly, undoToast, usualGear } from './lib/todayOnly';
import { baseTalk, customDayPreview, describedDayStatus, describedSessionStatus, talkConstraints } from './lib/todayTalk';
import type { TalkState } from './lib/todayTalk';
import TodayTalk from './components/TodayTalk';
import {
  liveAdapted,
  liveExercises,
  progressionLines,
  recapHighlight,
  targetReason,
  goHeavierFloor,
} from './lib/liveProgression';
import { sessionRests } from './lib/sessionTime';
import { removeTodayNotice } from './lib/exerciseActions';
import { leadCompoundId, leadSlotIds, savedSetup } from './lib/progression';
import { areasOf } from './lib/areas';
import
 {
  applyCancel,
  applyCorrection,
  applyFinish,
  createSession,
  extendRest,
  confirmWeight,
  logSet,
  sessionProgress,
  skipExercise,
  swapPendingExercise,
  toggleRestPause,
  unskipExercise,
  updatePerformedSet,
} from './lib/session';import { setWorkoutFeedback } from './lib/feedback';
import
 { EMPTY_STATE,
  startOverErase,
  STORAGE_KEY,
  exportFilename,
  loadState,
  mergeImport,
  saveState,
  serializeExport,
  uid,
} from './lib/storage';
import type { ImportSummary, LoadedState, SaveFailureReason } from './lib/storage';
import { parseState } from './lib/validate';
import
 { unitOf } from './lib/units';
import
 { EXERCISES, exerciseById } from './data/exercises';
import
 { rankedReplacements } from './lib/replacements';
import
 type {
  AppState,
  PerformedSet,
  Profile,
  TodayOverride,
  WorkoutFeedback,
} from './types';
import
 { PhoneFrame, TabBar } from './components/ui/Chrome';
import
 type { Tab } from './components/ui/Chrome';
import { tabBarAction } from './lib/tabBarAction';
import type { ProfileChange } from './lib/preferences';
import Sheet from './components/ui/Sheet';
import
 TodayScreen from './screens/TodayScreen';
import
 PlanScreen from './screens/PlanScreen';
import
 ProgressScreen from './screens/ProgressScreen';
import
 CoachScreen from './screens/CoachScreen';
import
 TrainScreen from './screens/TrainScreen';
import
 RecapScreen from './screens/RecapScreen';
import
 LibraryScreen from './screens/LibraryScreen';
import
 AdaptScreen from './screens/AdaptScreen';
import DurationSheet from './components/DurationSheet';
import type { LengthScope } from './components/DurationSheet';
import GymSheet from './components/GymSheet';
import SwitchSheet from './components/SwitchSheet';
import { skipForward, switchOptions, upcomingDays } from './lib/switchDay';
import type { SwitchOption } from './lib/switchDay';
import { keepKey, todayFresher } from './lib/recovery';
import { opensOnSplash, splashAfterAdopt } from './lib/firstScreen';
import
 Onboarding from './components/Onboarding';
import
 SplashScreen from './screens/SplashScreen';
import
 Recovery from './components/Recovery';
import
 {
  AdjustSheet,
  ConfirmChange,
  DaySheet,
  ConfirmSheet,
  DiscardSessionSheet,
  ExerciseActionsSheet,
  FinishSheet,
  SettingsSheet,
  StartOverSheet,
  SwapSheet,
  WhySheet,
} from './screens/Sheets';

type View = 'tabs' | 'train' | 'recap' | 'library' | 'adapt';

type SheetState =
  | { kind: 'none' }
  | { kind: 'adjust' }
  | { kind: 'length' }
  | { kind: 'gym' }
  | { kind: 'switch' }
  | { kind: 'settings' }
  | { kind: 'startOver' }
  | { kind: 'actions'; exerciseId: string; exerciseIndex: number; mode?: 'instructions' | 'history' }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'preview' }
  | { kind: 'why'; exerciseId: string; exerciseIndex: number }
  | { kind: 'finish' }
  | { kind: 'swap'; exerciseIndex: number }
  | { kind: 'confirm'; change: ProfileChange }
  | { kind: 'delete-workout'; workoutId: string };

interface SaveUi {
  kind: 'idle' | 'saved' | 'error';
  reason?: SaveFailureReason;
  message?: string;
}

const INITIAL: LoadedState = loadState();
const CORRUPT_BACKUP_KEY = 'fitbod-clone-v1:corrupt-backup';

function initialSaveUi(load: LoadedState): SaveUi {
  if (load.status === 'unavailable') {
    return { kind: 'error', reason: 'unavailable', message: load.error ?? 'Storage is unavailable.' };
  }
  if (load.status === 'migrated' && load.error) {
    return { kind: 'error', reason: 'unavailable', message: load.error };
  }
  return load.status === 'empty' ? { kind: 'idle' } : { kind: 'saved' };
}

const NO_EXCLUSIONS: string[] = [];

function backupRaw(raw: string): boolean {
  try {
    globalThis.localStorage?.setItem(CORRUPT_BACKUP_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * (#263) Starting over remounts the app from storage, exactly as a first
 * launch reads it, so no in-memory screen, sheet or session survives an erase.
 */
export default function App() {
  const [boot, setBoot] = useState({ run: 0, initial: INITIAL });
  return (
    <AppRun
      key={boot.run}
      initial={boot.initial}
      onStartOver={() => setBoot((current) => ({ run: current.run + 1, initial: loadState() }))}
    />
  );
}

function AppRun({ initial, onStartOver }: { initial: LoadedState; onStartOver: () => void }) {
  const [state, setState] = useState<AppState>(initial.state);
  const [view, setView] = useState<View>('tabs');
  const [tab, setTab] = useState<Tab>('today');
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const [pending, setPending] = useState<Proposal | null>(null);
  const [pendingNotices, setPendingNotices] = useState<ConstraintNotice[]>([]);
  const [recapId, setRecapId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveUi, setSaveUi] = useState<SaveUi>(() => initialSaveUi(initial));
  // The one feedback write the screens can speak about. It only becomes "saved"
  // when saveState verified the write that carried this answer.
  const [feedbackWrite, setFeedbackWrite] = useState<
    { key: string; kind: 'saving' | 'saved' | 'error' } | null
  >(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // A stored profile means onboarding already happened: a reload must never
  // drop a resumed or just-finished session behind the splash again.
  const [showSplash, setShowSplash] = useState(() => opensOnSplash(initial.state));
  const [recovery, setRecovery] = useState<{ message: string; raw: string } | null>(
    initial.status === 'corrupt'
      ? { message: initial.error ?? 'Saved data could not be read.', raw: initial.raw ?? '' }
      : null,
  );
  // Active-session replacement asks in-app (#19); the native prompt blocked
  // automated renderers and deadlocked a tab.
  const [replacePrompt, setReplacePrompt] = useState<Constraints | null>(null);
  /** First-weight steps skipped in this tab; in memory only, never stored. */
  const [calibrationSkips, setCalibrationSkips] = useState<string[]>([]);
  /** (#134) Keep tapped on the fresher-day offer: this slot, today. In memory only, never stored. */
  const [keptFresher, setKeptFresher] = useState<string | null>(null);
  /** (#193) The Today composer is open or previewing; it clears this when it closes or unmounts. */
  const [composing, setComposing] = useState(false);

  const appliedProposalRef = useRef<string | null>(null);
  const proposalRevisionRef = useRef(0);
  const revisionRef = useRef(initial.revision);
  const pendingWriteRef = useRef<string | undefined>(undefined);
  const adoptingRef = useRef(false);
  const forceSaveRef = useRef(initial.status === 'corrupt');

  /* ---------- persistence ---------- */

  /**
   * One write attempt. The failed-save banner's Retry runs the same path, so a
   * retry after freeing space or unblocking storage persists exactly once.
   */
  const attemptSave = useCallback(() => {
    const result = saveState(state, revisionRef.current, {
      force: forceSaveRef.current,
      pendingWrite: pendingWriteRef.current,
    });
    if (result.ok) {
      pendingWriteRef.current = undefined;
      forceSaveRef.current = false;
      revisionRef.current = result.revision;
      setSaveUi({ kind: 'saved' });
      setConflict(null);
      // The write that covered this answer succeeded, so it is genuinely saved.
      setFeedbackWrite((current) => (current ? { ...current, kind: 'saved' } : current));
    } else {
      if (result.pendingWrite) pendingWriteRef.current = result.pendingWrite;
      setSaveUi({ kind: 'error', reason: result.reason, message: result.error });
      if (result.reason === 'stale') setConflict(result.error);
      setFeedbackWrite((current) => (current ? { ...current, kind: 'error' } : current));
    }
  }, [state]);

  useEffect(() => {
    // Never write back what was just loaded. An identity check, not a one-shot flag: StrictMode
    // re-runs this on mount, and a spent flag wrote an empty record over a start over (#263).
    if (recovery || state === initial.state) return;
    if (adoptingRef.current) {
      adoptingRef.current = false;
      return;
    }
    attemptSave();
  }, [state, initial.state, recovery, attemptSave]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || recovery) return;
      const loaded = loadState();
      if (loaded.status === 'corrupt') return;
      if (loaded.revision <= revisionRef.current) return;
      if (saveUi.kind === 'error') {
        setConflict('Another tab saved newer data. This tab still has unsaved changes.');
        return;
      }
      proposalRevisionRef.current += 1;
      adoptingRef.current = true;
      revisionRef.current = loaded.revision;
      // A newer snapshot can merge/reorder even same-ID exercise segments.
      setSheet((open) =>
        open.kind === 'actions' ||
        open.kind === 'why' ||
        open.kind === 'day' ||
        open.kind === 'swap'
          ? { kind: 'none' }
          : open,
      );
      setState(loaded.state);
      // A tab left on the splash follows another tab's onboarding to Today (#288).
      setShowSplash((shown) => splashAfterAdopt(shown, loaded.state));
      setSaveUi({ kind: 'saved' });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [recovery, saveUi.kind]);

  const sessionRunning = Boolean(state.current);

  useEffect(() => {
    if (!sessionRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sessionRunning]);

  // (#134) Outside a session `now` does not tick: coming back to the app refreshes it.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000); // at most 4 s (#259)
    return () => window.clearTimeout(timer);
  }, [notice]);

  // (#259) A message stays on the screen it was raised on. A new message is stamped with the screen
  // it first shows on, so a handler that sets a message and moves screen in one update stamps the new
  // screen; a later move clears it (or carries it, recap to Today). A layout effect, so a message
  // leaving with the screen is gone before the next screen paints.
  const screen = screenKey(view, tab);
  const noticeScreenRef = useRef<string | null>(null);
  const stampedNoticeRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (notice !== stampedNoticeRef.current) {
      stampedNoticeRef.current = notice;
      noticeScreenRef.current = notice ? screen : null;
      return;
    }
    if (noticeScreenRef.current === null) return;
    const home = noticeHome(noticeScreenRef.current, screen);
    noticeScreenRef.current = home;
    if (home === null) setNotice(null);
  }, [notice, screen]);

  /* ---------- derived ---------- */

  /** Every screen reads the owned loads (#194); Settings edits the stored profile itself. */
  const profile = useMemo(() => ownedProfile(state.profile), [state.profile]);
  const unit = unitOf(profile);
  const today = useMemo(() => new Date(now), [now]);
  const override = useMemo(() => activeOverride(state, today), [state, today]);

  /** Today's constraints, a described day's focus and skip included (#193); see `todayConstraints`. */
  const constraints: Constraints = useMemo(() => todayConstraints(profile, override), [override, profile]);
  /** Today's gear and time without a described day: what the planned days are rated with. */
  const plainConstraints = useMemo(() => {
    const { focus: _focus, skip: _skip, ...plain } = constraints;
    return plain;
  }, [constraints]);

  const exclusions = profile?.exclusions ?? NO_EXCLUSIONS;
  /** The slot the sequence is up to: the real A/B/C day, not a repeated fixture. */
  const slot = useMemo(
    () => slotAt(state.plan, state.planRevision, state.programCursor),
    [state.plan, state.planRevision, state.programCursor],
  );
  /** The plan's day after the one on offer, for "Skip to …" (#184). */
  const nextSlotName = useMemo(() => {
    const slots = planSlots(state.plan);
    return slot && slots.length > 1 ? slots[(slot.index + 1) % slots.length]?.name : undefined;
  }, [slot, state.plan]);
  /** Plan: the rest of the week after the day up next, each priced as Today will price it (#186, #203). */
  const upcoming = useMemo(
    () => (profile && slot ? upcomingDays(profile, state.plan, slot, state.history) : []),
    [profile, slot, state.plan, state.history],
  );
  /**
   * (#134) A fresher day than the one up next. `now` only ticks while a session is open, and then
   * the gate returns before pricing any day, so following `today` stays cheap.
   */
  const fresher = useMemo(
    () => todayFresher(profile, state, plainConstraints, keptFresher, today),
    [profile, state, plainConstraints, keptFresher, today],
  );
  const slotLabel = useMemo(() => {
    const slots = planSlots(state.plan);
    return slot ? dayCounter(slot.index, slots.length) : undefined;
  }, [slot, state.plan]);
  /**
   * The slot's own program, prescribed from this user's plan and history. One
   * value feeds Today, the review, the logger and the sheets, so no screen can
   * describe work the next one will not ask for.
   */
  /**
   * The slot's day for a length and setup: longer than the saved length adds work (#17), a
   * shorter one is trimmed by adaptWorkout on the timer's model (#203), and a setup other than
   * the saved one is rebuilt from that setup's kit (#188).
   */
  const programFor = useCallback(
    (today: Partial<Constraints> = {}) => (profile && slot ? todayProgram(profile, slot, state.history, today) : FULL_BODY_A),
    [profile, slot, state.history],
  );
  const program = useMemo(() => programFor(constraints), [programFor, constraints]);
  /** The saved setup's day at today's length: what the saved gear runs and restores to. */
  const homeProgram = useMemo(() => programFor({ minutes: constraints.minutes }), [programFor, constraints.minutes]);
  /** The saved day at the saved length: what Restore original goes back to (a short day today is rebuilt, #229). */
  const savedProgram = useMemo(() => programFor(), [programFor]);
  /** Today's setup (and described day) at the saved length: the base the duration sheet compares against. */
  const defaultProgram = useMemo(
    () => programFor({ equipment: constraints.equipment, focus: constraints.focus, skip: constraints.skip }),
    [programFor, constraints.equipment, constraints.focus, constraints.skip],
  );
  /** A proposed adaptation: another setup or a described day is rebuilt, the saved one adapts the saved day. */
  const adaptFor = useCallback(
    // The saved day at another length is the length sheet's rebuild (#193: the composer's time chip).
    (next: Constraints) => adaptWorkout(next.equipment === 'home' && !next.focus && next.minutes === constraints.minutes ? homeProgram : programFor(next), next, exclusions, profile?.goal),
    [homeProgram, programFor, exclusions, constraints.minutes, profile?.goal],
  );
  const adapted = useMemo(
    () => adaptWorkout(program, constraints, exclusions, profile?.goal),
    [program, constraints, exclusions, profile?.goal],
  );

  /**
   * Today's numbers come from the recorded history, not the program fixture.
   * The shape of the session still comes from the adaptation.
   */
  const liveProgram = useMemo(
    () => (profile ? liveAdapted(adapted, profile, state.history) : adapted),
    [adapted, profile, state.history],
  );

  const current = state.current;
  /**
   * (#219) A described day's status and reasons, read as its preview did; null on a planned day.
   * (#220) While a described session runs, the session's own, until its day's override expires.
   */
  const described = useMemo(
    () => (!profile ? null
      : current && isDescribedSession(current) ? describedSessionStatus(current, override, profile)
      : describedDayStatus(constraints, program, liveProgram, profile)),
    [constraints, program, liveProgram, profile, current, override],
  );

  const pendingAdapted = useMemo(
    () => (pending ? adaptFor(pending.constraints) : null),
    [pending, adaptFor],
  );
  /** (#219) The review of a described day reads as Today will: its own status, never the generator's requirements. */
  const pendingDescribed = useMemo(
    () => (pending && pendingAdapted && profile ? describedDayStatus(pending.constraints, programFor(pending.constraints), pendingAdapted, profile) : null),
    [pending, pendingAdapted, profile, programFor],
  );

  /**
   * The workout Today is showing, expressed as the logger's model: the live
   * session when one exists, otherwise today's adapted program. Sheets read
   * this instead of the generated plan, so they can never describe a movement
   * that is not on screen.
   */
  const todayExercises = useMemo(
    () =>
      current?.exercises ??
      (profile ? liveExercises(liveProgram, profile, state.history) : toWorkoutExercises(adapted)),
    [current, adapted, liveProgram, profile, state.history],
  );
  /** The name, counts and minutes of that same day, for Plan, View session and Coach alike (#189, #200). */
  const todayDay = useMemo(() => todayGlance(adapted, current, Boolean(override), profile?.goal), [adapted, current, override, profile?.goal]);

  /** The one-line reason behind each computed target, keyed by exercise. */
  const targetNotes = useMemo(() => {
    const notes: Record<string, string> = {};
    if (!profile) return notes;
    const lead = leadCompoundId(liveProgram.exercises.map((exercise) => exercise.exerciseId));
    for (const exercise of liveProgram.exercises) {
      const reason = targetReason(exercise.exerciseId, profile, state.history, unit, exercise.exerciseId === lead, liveProgram.setup);
      if (reason) notes[exercise.exerciseId] = reason;
    }
    return notes;
  }, [liveProgram, profile, state.history, unit]);
  // #165: exercises whose next target is "your next one up", keyed to the load it starts above.
  const goHeavier = useMemo(() => {
    const floors: Record<string, number> = {};
    if (!profile || !current) return floors;
    const lead = leadCompoundId(current.exercises.map((exercise) => exercise.exerciseId));
    for (const exercise of current.exercises) {
      const floor = goHeavierFloor(exercise.exerciseId, profile, state.history, exercise.exerciseId === lead, exercise.setup);
      if (floor !== null) floors[exercise.exerciseId] = floor;
    }
    return floors;
  }, [profile, current, state.history]);
  const recap = recapId ? state.history.find((workout) => workout.id === recapId) ?? null : null;

  const storageNote =
    saveUi.kind === 'error'
      ? saveUi.message ?? 'The last change is not saved.'
      : `Records are stored in this browser. Last write: ${
          saveUi.kind === 'saved' ? 'verified' : 'no changes yet'
        }.`;

  /* ---------- actions ---------- */

  const patchProfile = (patch: Partial<Profile>) => {
    setState((currentState) => updateProfile(currentState, patch));
  };

  const completeOnboarding = (nextProfile: Profile) => {
    setState((currentState) => ({
      ...revisePlan(currentState, nextProfile),
      current: null,
      todayOverride: null,
    }));
    setTab('today');
  };

  /** One creation path for every start, so preview and logger can never disagree. */
  const beginSession = (workout: ReturnType<typeof adaptWorkout>, custom = false) => {
    // The link back to the slot is what makes completion advance once, and
    // only for the plan it was started under. A described day (#193) has none.
    const session = createSession({
      id: uid(),
      name: workout.name,
      dayIndex: slot?.index ?? 0,
      ...slotLinkFor(state, custom),
      exercises: profile
        ? liveExercises(workout, profile, state.history)
        : toWorkoutExercises(workout),
      now: new Date().toISOString(),
      durationMin: workout.minutes,
    });
    setState((currentState) => ({ ...currentState, current: session }));
    setView('train');
  };

  /**
   * Starting is always built from the same engine output the screens showed,
   * so the preview, the review and the logger can never disagree.
   */
  const startSession = (next: Constraints): boolean => {
    const workout = adaptFor(next);
    if (workout.exercises.length === 0) {
      setNotice('No movement in this workout can be done with that setup.');
      return false;
    }
    if (current) {
      // Ask in-app; only an explicit discard reaches the replacement below.
      setReplacePrompt(next);
      return false;
    }
    beginSession(workout, Boolean(next.focus));
    return true;
  };

  const startWorkout = () => {
    startSession(constraints);
  };
  // (#260) The tab bar's centre button and Today's Resume: one handler (lesson 9).
  const openWorkout = current ? () => setView('train') : startWorkout;

  /**
   * Skip the slot on offer. Explicit only: nothing skips because a date passed,
   * and a skip is recorded apart from history so it counts as no training.
   */  const skipTodaySlot = () => {
    if (!slot) return;
    if (current) {
      setNotice('Finish or discard the open session before skipping this one.');
      return;
    }
    const offered = cursorFor(state);
    setState((currentState) => skipCurrentSlot(currentState, new Date().toISOString(), offered));
    setNotice('Session skipped. A skip is not a workout and earns no progression.');
  };

  /** Explicit discard consent from the in-app sheet (#19) runs the replacement once. */
  const discardAndBegin = () => {
    const next = replacePrompt;
    setReplacePrompt(null);
    if (!next) return;
    const workout = adaptFor(next);
    if (workout.exercises.length > 0) beginSession(workout, Boolean(next.focus));
  };

  /** Fingerprint of everything a preview was built against. */
  const proposalBase = (): ProposalContext => ({
    sessionId: current?.id ?? null,
    revision: proposalRevisionRef.current,
    done: current ? sessionProgress(current).done : 0,
    historyLength: state.history.length,
    equipmentKey: [
      ...(profile?.equipment ?? []),
      ...(profile?.support ?? []),
      ...(profile?.exclusions ?? []),
    ].join(','),
  });

  /**
   * Review changes → start: refuse a preview built before intervening logging
   * or equipment changes, then persist today's adaptation and open the
   * session. A second approval of the same preview only navigates.
   */
  const acceptAdaptation = (proposal: Proposal) => {
    const decision = decideProposalApproval(proposal, proposalBase(), appliedProposalRef.current);
    if (decision === 'already-applied') {
      setView(current ? 'train' : 'tabs');
      return;
    }
    if (decision === 'stale') {
      setNotice(
        'That preview is stale — a set was logged or equipment changed. Preview again for a fresh approval.',
      );
      setView('tabs');
      setTab('today');
      setSheet({ kind: 'adjust' });
      return;
    }
    const next = proposal.constraints;
    const choice: EquipmentChoice = next.equipment;
    const approved: TodayOverride = {
      date: dayKey(new Date()),
      // The request, not the capped label: every screen re-derives the label (#17).
      minutes: next.minutes,
      equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
      support: [],
      appliedAt: new Date().toISOString(),
      choice,
      ...(next.focus ? { focus: next.focus } : {}),
      ...(next.skip ? { skip: next.skip } : {}),
    };
    // An open session keeps its completed sets: the adaptation replaces only
    // the pending prescriptions, so adjusting mid-workout never discards work.
    const workout = adaptFor(next);
    if (current) {
      if (workout.exercises.length === 0) {
        setNotice('No movement in this workout can be done with that setup.');
        return;
      }
      setState((currentState) => ({
        ...currentState,
        todayOverride: approved,
        current: currentState.current
          ? restorePendingWorkout(currentState.current, workout, currentState.profile, currentState.history)
          : null,
      }));
      appliedProposalRef.current = proposal.id;
      setPendingNotices([]);
      setPending(null);
      setSheet({ kind: 'none' });
      setView('train');
      return;
    }
    if (!startSession(next)) return;
    appliedProposalRef.current = proposal.id;
    setPendingNotices([]);
    setState((currentState) => ({ ...currentState, todayOverride: approved }));
    setPending(null);
    setSheet({ kind: 'none' });
  };

  /** The described day (#193) a length or gear change keeps. */
  const describedDay = override?.focus ? { focus: override.focus, ...(override.skip ? { skip: override.skip } : {}) } : {};

  /**
   * (#148) Duration sheet choice. "This workout" sets today's override without
   * starting a session; picking the default length restores the original.
   * "Set as default" changes the profile length, as Settings already does.
   */
  const pickLength = (minutes: number, scope: LengthScope) => {
    if (!profile || current) return;
    const fallback = profile.sessionMinutes ?? 35;
    if (scope === 'default') {
      patchProfile({ sessionMinutes: minutes });
      if (override) restoreOriginal();
      else setSheet({ kind: 'none' });
      setNotice(`${minutes} min is now your default length.`);
      return;
    }
    // The saved setup is savedSetup(profile): 'bodyweight' for a no-gear profile, else 'home'.
    if (minutes === fallback && (constraints.equipment === 'home' || constraints.equipment === savedSetup(profile)) && !constraints.focus) {
      restoreOriginal();
      setNotice('Back to your program.');
      return;
    }
    const choice: EquipmentChoice = constraints.equipment;
    setState((currentState) => ({
      ...currentState,
      todayOverride: {
        date: dayKey(new Date()),
        minutes,
        equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
        support: [],
        appliedAt: new Date().toISOString(),
        choice,
        ...describedDay,
      },
    }));
    proposalRevisionRef.current += 1;
    appliedProposalRef.current = null;
    setPending(null);
    setPendingNotices([]);
    setSheet({ kind: 'none' });
    setNotice('Today only. Your program is unchanged.');
  };

  /** (#149) Today's equipment. Today only; the saved setup at the default length restores the original. */
  const pickSetup = (choice: EquipmentChoice) => {
    if (!profile || current) return;
    if ((choice === 'home' || choice === savedSetup(profile)) && constraints.minutes === (profile.sessionMinutes ?? 35) && !constraints.focus) {
      restoreOriginal();
      setNotice('Back to your gear.');
      return;
    }
    setState((currentState) => ({
      ...currentState,
      todayOverride: {
        date: dayKey(new Date()),
        minutes: constraints.minutes,
        equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
        support: [],
        appliedAt: new Date().toISOString(),
        choice,
        ...describedDay,
      },
    }));
    proposalRevisionRef.current += 1;
    appliedProposalRef.current = null;
    setPending(null);
    setPendingNotices([]);
    setSheet({ kind: 'none' });
    setNotice('Today only. Your program is unchanged.');
  };

  /**
   * (#149) On a day the current setup cannot train, name another day in the
   * split that it can, with its set count. Nothing is invented: each is adapted
   * from the user's own plan with today's constraints.
   */
  const alternativeDay = (() => {
    if (!profile || !slot || adapted.exercises.length > 0) return undefined;
    const fits = planSlots(state.plan)
      .filter((other) => other.id !== slot.id)
      .map((other) => ({ name: other.name, sets: adaptWorkout(todayProgram(profile, other, state.history, plainConstraints), plainConstraints, profile.exclusions ?? [], profile.goal).totalSets }))
      .filter((other) => other.sets > 0);
    const chip = SETUPS[constraints.equipment].chip.toLowerCase();
    return fits.length
      ? fits.map((other) => `${other.name} works with ${chip}: ${other.sets} sets.`).join(' ') + ' Switch day to train it.'
      : `No day in your split works with ${chip}.`;
  })();

  /** (#193) The composer's chips before anything is said: today's gear and time, the planned day's areas. */
  const talkBase = useMemo(() => (slot ? baseTalk(constraints, slot.focus, profile ? isGymKit(profile) : false) : null), [slot, constraints, profile]);

  /** (#193) The day the chips build, from the same adaptation Start runs. */
  const talkPreview = (talk: TalkState) => {
    if (!profile || !slot) return null;
    const next = talkConstraints(talk, constraints.loads, slot.focus);
    const adaptedDay = adaptFor(next);
    return customDayPreview(talk, programFor(next), liveAdapted(adaptedDay, profile, state.history), profile, slot.focus);
  };

  /**
   * (#193) Approve the chips: save today's override and start exactly what the preview showed.
   * Chips equal to the planned day change only its gear and time, so that session moves the plan.
   */
  const startTalk = (talk: TalkState) => {
    if (!profile || !slot) return;
    const next = talkConstraints(talk, constraints.loads, slot.focus);
    if (!startSession(next)) return;
    const choice: EquipmentChoice = next.equipment;
    const plain = !next.focus && (choice === 'home' || choice === savedSetup(profile)) && next.minutes === (profile.sessionMinutes ?? 35);
    setState((currentState) => ({
      ...currentState,
      todayOverride: plain ? null : {
        date: dayKey(new Date()),
        minutes: next.minutes,
        equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
        support: [],
        appliedAt: new Date().toISOString(),
        choice,
        ...(next.focus ? { focus: next.focus } : {}),
        ...(next.skip ? { skip: next.skip } : {}),
      },
    }));
    proposalRevisionRef.current += 1;
    appliedProposalRef.current = null;
    setPending(null);
    setPendingNotices([]);
  };

  /** (#150) Train another day in the split: forward skips through the existing guarded skip, never a catch-up. */
  const pickDay = (option: SwitchOption) => {
    if (option.offset === 0) {
      setSheet({ kind: 'none' });
      return;
    }
    if (current) {
      setNotice('Finish or discard the open session before switching days.');
      return;
    }
    // A planned day picked here replaces a described one (#193).
    setState((currentState) => withoutCustomDay(skipForward(currentState, option.offset, new Date().toISOString())));
    setSheet({ kind: 'none' });
    setNotice(`${option.name} is up. Skipped ${option.skips.join(', ')}; a skip earns no progression.`);
  };

  /** A described session (#193) has no planned work to restore into; it is finished or discarded instead. */
  const describedSession = Boolean(current && isDescribedSession(current));

  const restoreOriginal = (message = 'Original remaining work restored. Logged sets were kept.') => {
    if (describedSession) return;
    setState((currentState) => {
      const original = adaptWorkout(
        savedProgram,
        currentState.profile ? defaultConstraints(currentState.profile) : DEFAULT_CONSTRAINTS,
        currentState.profile?.exclusions ?? [],
        currentState.profile?.goal,
      );
      return {
        ...currentState,
        todayOverride: null,
        current: currentState.current
          ? restorePendingWorkout(currentState.current, original, currentState.profile, currentState.history)
          : null,
      };
    });
    proposalRevisionRef.current += 1;
    appliedProposalRef.current = null;
    setPending(null);
    setPendingNotices([]);
    setSheet({ kind: 'none' });
    setNotice(message);
  };

  const updateSet = (exerciseIndex: number, setIndex: number, patch: Partial<PerformedSet>) => {
    const stamp = new Date().toISOString();
    setState((currentState) =>
      currentState.current
        ? {
            ...currentState,
            current: updatePerformedSet(currentState.current, exerciseIndex, setIndex, patch, stamp),
          }
        : currentState,
    );
  };

  const confirmFirstWeight = (exerciseIndex: number, weight: number) => {
    const stamp = new Date().toISOString();
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: confirmWeight(currentState.current, exerciseIndex, weight, stamp) }
        : currentState,
    );
  };

  const logOneSet = (exerciseIndex: number, setIndex: number, exerciseId: string) => {
    const stamp = new Date().toISOString();
    setState((currentState) => {
      const session = currentState.current;
      const exercise = session?.exercises[exerciseIndex];
      // A tap rendered against another exercise, or on work the user set aside, records nothing.
      if (!session || exercise?.exerciseId !== exerciseId || exercise.skipped) return currentState;
      // Rest by the exercise's role in the day, the same seconds the minutes were fitted with (#132).
      const rest = sessionRests(session.exercises.map((item) => item.exerciseId), currentState.profile?.goal, session.durationMin)[exerciseIndex];
      const logged = logSet(session, exerciseIndex, setIndex, stamp, rest);
      return logged === session ? currentState : { ...currentState, current: logged };
    });
  };

  const closeSheet = () => setSheet({ kind: 'none' });

  /** Confirmation only asks when work is still outstanding. */
  const requestFinish = () => {
    if (current) {
      const progress = sessionProgress(current);
      if (progress.total > 0 && progress.pending === 0) {
        saveFinish();
        return;
      }
    }
    setSheet({ kind: 'finish' });
  };

  const saveFinish = () => {
    if (!current) return;
    const progress = sessionProgress(current);
    if (progress.done === 0) {
      setState((currentState) => applyCancel(currentState, current.id));
      setSheet({ kind: 'none' });
      setView('tabs');
      setTab('today');
      setNotice('No completed sets, so nothing was saved. The session was discarded.');
      return;
    }
    const early = progress.done < progress.total;
    const id = current.id;
    setState((currentState) =>
      applyFinish(currentState, id, { early, now: new Date().toISOString() }),
    );
    setRecapId(id);
    setSheet({ kind: 'none' });
    setView('recap');
    setNotice(
      early
        ? progress.skipped > 0
          ? 'Saved the completed sets. Skipped and unfinished work was not recorded.'
          : 'Saved the completed sets. Unfinished work was not recorded.'
        : 'Session saved to history.',
    );
  };

  /** An empty session on Finish: close it and move the plan to the next day, recorded as a skip (#184). */
  const skipFromSession = () => {
    if (!current || !slot || current.slotSeq === undefined) return;
    const offered = cursorFor(state);
    const id = current.id;
    const next = nextSlotName;
    setState((currentState) => skipCurrentSlot(applyCancel(currentState, id), new Date().toISOString(), offered));
    setSheet({ kind: 'none' });
    setView('tabs');
    setTab('today');
    setNotice(`${slot.name} skipped${next ? `; ${next} is next` : ''}. A skip is not a workout and earns no progression.`);
  };

  const discardSession = () => {
    if (!current) return;
    setState((currentState) => applyCancel(currentState, current.id));
    setSheet({ kind: 'none' });
    setView('tabs');
    setTab('today');
    setNotice('Session discarded. Nothing was added to history.');
  };

  const correctSet = (
    workoutId: string,
    exerciseIndex: number,
    setIndex: number,
    patch: Partial<PerformedSet>,
    refused?: string,
  ) => {
    // A refused history load or reps arrives as the focus value the field reverts to; say why (#101, #109).
    if (refused) setNotice(refused);
    setState((currentState) =>
      applyCorrection(currentState, workoutId, exerciseIndex, setIndex, patch, new Date().toISOString()),
    );
  };

  const deleteWorkout = (id: string) => {
    closeSheet();
    setState((currentState) => ({
      ...currentState,
      history: currentState.history.filter((workout) => workout.id !== id),
    }));
    setNotice('Workout deleted.');
  };

  /** (#225) A file that left the app is a backup: the reminder counts it. */
  const recordBackup = () => setState((currentState) => ({ ...currentState, lastBackupAt: new Date().toISOString() }));

  const exportData = () => {
    try {
      downloadText(serializeExport(state), exportFilename());
    } catch {
      setNotice('Backup not saved, so nothing was recorded. Try again.');
      return;
    }
    recordBackup();
    setNotice('Backup downloaded.');
  };

  /** (#225) Same file as Export, through the Share sheet; a cancel or failure records nothing. */
  const backupNow = async (): Promise<{ ok: boolean; message: string | null }> => {
    const result = await shareBackup(serializeExport(state), exportFilename(), {
      nav: typeof navigator === 'undefined' ? undefined : navigator,
      download: downloadText,
    });
    // Returned too, for a sheet that covers the notice (#263).
    const message = result.ok ? (result.via === 'share' ? 'Backup shared.' : 'Backup downloaded.') : result.message ?? null;
    if (result.ok) recordBackup();
    if (message) setNotice(message);
    return { ok: result.ok, message };
  };

  /** (#263) Erase this browser's data, then boot as a first launch; a refusal is returned to the sheet. */
  const startOver = () => {
    const result = startOverErase(state);
    if (result.ok) onStartOver();
    return result;
  };

  const restoreFile = async (file: File | undefined) => {
    if (!file) return false;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice('The file could not be read. Nothing changed.');
      return false;
    }
    const parsed = parseState(text);
    if (!parsed.ok) {
      setNotice(`Restore rejected: ${parsed.error}`);
      return false;
    }
    const merged = mergeImport(state, parsed.state);
    setState({ ...merged.state, todayOverride: state.todayOverride ?? null });
    setNotice(
      `Restored ${merged.summary.newWorkouts} workout${merged.summary.newWorkouts === 1 ? '' : 's'}; ${merged.summary.duplicateWorkouts} already present.` +
        (merged.summary.activeSessionConflict
          ? ' Both files had the same open session; the copy with more logged sets was kept.'
          : '') +
        // Restore must not drop an answer the backup simply predates, and it
        // must say so rather than keeping it quietly.
        (merged.summary.feedbackPreserved > 0
          ? ` Kept your saved workout feedback on ${merged.summary.feedbackPreserved} workout${
              merged.summary.feedbackPreserved === 1 ? '' : 's'
            } the backup did not contain.`
          : ''),
    );
    return Boolean(merged.state.profile);
  };

  const swapExercise = (exerciseIndex: number, nextExerciseId: string) => {
    if (!profile) return;
    const target = EXERCISES.find((exercise) => exercise.id === nextExerciseId);
    if (!target) return;
    // The replacement's own prescription only; the session action decides how
    // many sets it receives and keeps every completed set where it is. A
    // program movement with nothing logged keeps the program's own numbers,
    // so a swap-back cannot render as bodyweight with a first-time target.
    const swapped = state.current?.exercises[exerciseIndex]?.exerciseId;
    const lead = state.current !== null && swapped !== undefined && leadSlotIds(state.current.exercises).includes(swapped);
    const candidate = swapCandidateFor(target, profile, state.history, state.current, lead, state.current?.exercises[exerciseIndex]?.setup);
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: swapPendingExercise(currentState.current, exerciseIndex, candidate) }
        : currentState,
    );
    setSheet({ kind: 'none' });
    setNotice(`${target.name} swapped in for the remaining sets. Completed sets stay put.`);
  };

  const skipCurrentExercise = (exerciseIndex: number) => {
    const notice = removeTodayNotice(current?.exercises[exerciseIndex]);
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const skipped = skipExercise(currentState.current, exerciseIndex);
      return skipped === currentState.current ? currentState : { ...currentState, current: skipped };
    });
    setNotice(notice);
  };

  const returnToExercise = (exerciseIndex: number) => {
    const name = current?.exercises[exerciseIndex]?.name ?? 'That exercise';
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const restored = unskipExercise(currentState.current, exerciseIndex);
      return restored === currentState.current
        ? currentState
        : { ...currentState, current: restored };
    });
    setNotice(`${name} is back in today's session. Nothing else changed.`);
  };

  /**
   * Record the user's explicit choice. The answer is kept in state immediately
   * (so a failed write is recoverable and retryable), and the recap only calls
   * it saved once the persistence boundary has confirmed it. A stale id never
   * attaches an answer to another workout.
   */
  const saveFeedback = (workoutId: string, value: WorkoutFeedback | null) => {
    if (!state.history.some((workout) => workout.id === workoutId)) return;
    setFeedbackWrite({ key: `${workoutId}:${value ?? 'none'}`, kind: 'saving' });
    setState((currentState) => setWorkoutFeedback(currentState, workoutId, value));
  };

  /* ---------- render ---------- */

  if (recovery) {
    return (
      <PhoneFrame>
        <Recovery
          error={recovery.message}
          raw={recovery.raw}
          onDownload={() => downloadText(recovery.raw, 'strength-original-state.json')}
          onRestore={(next: AppState, summary: ImportSummary) => {
            setState(next);
            // Corrupt data loads with no profile, so the splash was armed; a restored profile
            // opens straight on Today (#285).
            setShowSplash(opensOnSplash(next));
            setRecovery(null);
            setNotice(`Restored ${summary.newWorkouts} workouts.`);
          }}
          onStartFresh={() => {
            if (recovery.raw) backupRaw(recovery.raw);
            revisionRef.current = 0;
            forceSaveRef.current = true;
            setState({ ...EMPTY_STATE });
            setShowSplash(opensOnSplash(EMPTY_STATE));
            setRecovery(null);
            setNotice('Started with empty data.');
          }}
        />
      </PhoneFrame>
    );
  }

  // A resumed session must never wait behind the splash.
  if (showSplash && !current) {
    return (
      <PhoneFrame>
        {/* (#258) A rejected restore from the installed-app prompt must say why. */}
        {notice && (
          <div className="app-alerts" role="status">
            <div className="banner" style={{ margin: '8px 0 0' }}>
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss message">
                Dismiss
              </button>
            </div>
          </div>
        )}
        <SplashScreen
          onStart={() => setShowSplash(false)}
          installed={typeof window !== 'undefined' && currentDevice().standalone}
          onRestore={(file) => void restoreFile(file).then((restored) => { if (restored) setShowSplash(false); })}
        />
      </PhoneFrame>
    );
  }

  if (!profile) {
    return (
      <PhoneFrame>
        <Onboarding onComplete={completeOnboarding} />
      </PhoneFrame>
    );
  }

  const recapLines = recap ? progressionLines(recap, profile, state.history, unit) : [];
  const activeScreen =
    view === 'train' && current ? (
      <TrainScreen
        session={current}
        history={state.history}
        now={now}
        loadOptions={loadOptions(constraints.equipment, constraints.loads)}
        profileLoads={profile?.loads}
        calibrationLoads={confirmedLoads(constraints.equipment, constraints.loads)}
        experience={state.profile?.experience}
        skippedCalibrations={calibrationSkips}
        onSkipCalibration={(key) => setCalibrationSkips((keys) => [...keys, key])}
        targetNotes={targetNotes}
        rests={current ? sessionRests(current.exercises.map((item) => item.exerciseId), profile?.goal, current.durationMin) : []}
        goHeavier={goHeavier}
        unit={unit}
        onMinimize={() => {
          setView('tabs');
          setTab('today');
        }}
        onFinish={requestFinish}
        onUpdateSet={updateSet}
        onConfirmWeight={confirmFirstWeight}
        onLogSet={logOneSet}
        onToggleRestPause={() => {
          const stamp = new Date().toISOString();
          setState((currentState) =>
            currentState.current
              ? { ...currentState, current: toggleRestPause(currentState.current, stamp) }
              : currentState,
          );
        }}
        onExtendRest={() =>
          setState((currentState) =>
            currentState.current
              ? { ...currentState, current: extendRest(currentState.current, 30) }
              : currentState,
          )
        }
        onReplace={(exerciseIndex) => setSheet({ kind: 'swap', exerciseIndex })}
        onOpenActions={(exerciseIndex, mode) =>
          setSheet({
            kind: 'actions',
            exerciseId: current?.exercises[exerciseIndex]?.exerciseId ?? '',
            exerciseIndex,
            mode,
          })
        }
        onReturn={returnToExercise}
      />
    ) : view === 'recap' && recap ? (
      <RecapScreen
        workout={recap}
        feedbackWrite={feedbackWrite}
        onFeedback={saveFeedback}
        onRetryFeedback={attemptSave}
        progression={recapLines}
        highlight={recapHighlight(recap, state.history, recapLines, unit, profile)}
        onViewHistory={() => {
          setView('tabs');
          setTab('progress');
        }}
        onBackToday={() => {
          setView('tabs');
          setTab('today');
        }}
        offerBackup={offerFirstBackup(state) && state.history.some((workout) => workout.id === recap.id)}
        onBackup={backupNow}
      />
    ) : view === 'library' ? (
      <LibraryScreen
        profile={profile}
        onSave={patchProfile}
        onBack={() => setView('tabs')}
      />
    ) : view === 'adapt' && pendingAdapted && pending ? (
      <AdaptScreen
        profile={profile}
        originalSets={todayDay.sets}
        adapted={
          profile ? liveAdapted(pendingAdapted, profile, state.history) : pendingAdapted
        }
        constraints={pending.constraints}
        described={pendingDescribed}
        // Before is what Today shows now; after is the change; both by the timer's model (#203).
        before={todayDay}
        after={todayGlance(pendingAdapted, null, false, profile?.goal)}
        notices={pendingNotices}
        unit={unit}
        loads={profile?.loads}
        history={state.history}
        onStart={() => acceptAdaptation(pending)}
        onEdit={() => {
          setView('tabs');
          setSheet({ kind: 'adjust' });
        }}
        onOpenSettings={() => {
          setView('tabs');
          setSheet({ kind: 'settings' });
        }}
        onKeep={() => {
          setPending(null);
          setPendingNotices([]);
          setView(current ? 'train' : 'tabs');
          setTab('today');
          setSheet({ kind: 'none' });
        }}
      />
    ) : (
      <>
        {tab === 'today' && (
          <TodayScreen
            profile={profile}
            program={program}
            slotLabel={slotLabel}
            onSkipSlot={skipTodaySlot}
            adapted={liveProgram}
            equipment={constraints.equipment}
            adjusted={Boolean(override)}
            history={state.history}
            current={current}
            now={today}
            onPreview={() => setSheet({ kind: 'preview' })}
            onResume={openWorkout}
            onAdjust={() => setSheet({ kind: 'adjust' })}
            onOpenLength={() => setSheet({ kind: 'length' })}
            onOpenGym={() => setSheet({ kind: 'gym' })}
            onOpenSwitch={slot ? () => setSheet({ kind: 'switch' }) : undefined}
            alternativeDay={alternativeDay}
            composer={slot && talkBase ? (
              <TodayTalk
                profile={profile}
                plannedName={slot.name}
                plannedAreas={areasOf(slot.focus)}
                savedGear={savedSetup(profile)}
                savedMinutes={profile.sessionMinutes ?? 35}
                base={talkBase}
                preview={talkPreview}
                onStart={startTalk}
                onActive={setComposing}
              />
            ) : undefined}
            composing={composing}
            canRestore={!describedSession}
            described={described}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: todayExercises[0]?.exerciseId ?? '', exerciseIndex: 0 })
            }
            onRestore={() => restoreOriginal()}
            todayBar={todayOnly(state, today)}
            usualGear={usualGear(profile)}
            onUndo={() => restoreOriginal(undoToast(profile))}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onOpenExercise={(exerciseId, exerciseIndex) => setSheet({ kind: 'actions', exerciseId, exerciseIndex })}
            onReviewChange={(change) => setSheet({ kind: 'confirm', change })}
            backup={backupReminder(state, today)}
            onBackup={backupNow}
            fresher={fresher}
            onPickFresher={pickDay}
            onKeepNext={() => slot && setKeptFresher(keepKey(slot.id, today))}
          />
        )}
        {tab === 'plan' && (            <PlanScreen
            profile={profile}
            upcoming={upcoming}
            focus={slot?.focus}
            program={program}
            today={todayDay}
            equipment={constraints.equipment}
            slotLabel={slotLabel}
            history={state.history}
            unit={unit}
            now={today}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onViewDay={(dayIndex) => setSheet({ kind: 'day', dayIndex })}
            onOpenLibrary={() => setView('library')}
            onReviewChange={(change) => setSheet({ kind: 'confirm', change })}
            described={described}
          />
        )}
        {tab === 'progress' && (
          <ProgressScreen
            history={state.history}
            unit={unit}
            loads={profile?.loads}
            onExport={exportData}
            onCorrect={correctSet}
            onDelete={(workoutId) => setSheet({ kind: 'delete-workout', workoutId })}
            onFeedback={saveFeedback}
            onGoTrain={() => setTab('today')}
          />
        )}
        {tab === 'coach' && (
          <CoachScreen
            profile={profile}
            history={state.history}
            program={todayDay}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: todayExercises[0]?.exerciseId ?? '', exerciseIndex: 0 })
            }
            onEdit={() => setSheet({ kind: 'settings' })}
          />
        )}
        {/* (#256) While the planner is open, its own action bar replaces the tab bar, as a sheet would. */}
        {!(tab === 'today' && composing && !current) && <TabBar
          active={tab}
          onChange={(next) => {
            setTab(next);
            setView('tabs');
          }}
          workoutAction={{
            ...tabBarAction(current, adapted),
            onActivate: openWorkout,
            progress: current
              ? (() => {
                  const sets = current.exercises.flatMap((exercise) => exercise.performed);
                  return sets.length ? sets.filter((set) => set.done).length / sets.length : 0;
                })()
              : undefined,
          }}
        />}
      </>
    );

  return (
    <PhoneFrame>
      {notice && (
        // (#276) Float only on Today, where it would push the planner entry under the dock, and
        // never over a save-error or conflict alert's buttons.
        <div className={view === 'tabs' && tab === 'today' && !conflict && saveUi.kind !== 'error' ? 'app-alerts app-alerts--toast' : 'app-alerts'} role="status">
          <div className="banner" style={{ margin: '8px 0 0' }}>
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss message">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {conflict && (
        <div className="app-alerts" role="alert">
          <div className="banner error" style={{ margin: '8px 0 0' }}>
            <span>{conflict} Reload to load the newer data, or export this tab first.</span>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )}

      {saveUi.kind === 'error' && !conflict && (
        <div className="app-alerts" role="alert">
          <div className="banner error" style={{ margin: '8px 0 0' }}>
            <span>
              <strong>Not saved.</strong> {saveUi.message}
            </span>
            <button onClick={attemptSave}>Retry</button>
            <button onClick={() => setSheet({ kind: 'settings' })}>Data</button>
          </div>
        </div>
      )}

      {activeScreen}

      {sheet.kind === 'length' && profile && (
        <DurationSheet
          options={lengthOptions(defaultProgram, constraints, profile.exclusions ?? [], profile.sessionMinutes ?? 35, (minutes) => programFor({ ...constraints, minutes }), profile.goal)}
          current={constraints.minutes}
          onClose={closeSheet}
          onPick={pickLength}
        />
      )}

      {sheet.kind === 'gym' && profile && (
        <GymSheet
          options={setupOptions(program, constraints, profile.exclusions ?? [], profile.goal, (choice) => (choice === 'home' && !constraints.focus ? homeProgram : programFor({ ...constraints, equipment: choice })))}
          current={constraints.equipment}
          dayName={program.name}
          savedGear={isGymKit(profile) ? 'full gym' : [...profile.equipment, ...profile.support].join(', ') || 'none'}
          gymKit={isGymKit(profile)}
          usual={savedSetup(profile)}
          onPick={pickSetup}
          onEditSaved={() => setSheet({ kind: 'settings' })}
          onClose={closeSheet}
        />
      )}

      {sheet.kind === 'switch' && profile && (
        <SwitchSheet
          options={switchOptions(profile, state, state.history, plainConstraints)}
          onPick={pickDay}
          onClose={closeSheet}
        />
      )}

      {sheet.kind === 'adjust' && (
        <AdjustSheet
          constraints={pending?.constraints ?? constraints}
          originalMinutes={program.minutes}
          unit={unit}
          profile={profile}
          onClose={() => {
            setPending(null);
            setPendingNotices([]);
            closeSheet();
          }}
          onPreview={(next, notices) => {
            setPending(createProposal(next, proposalBase()));
            setPendingNotices(withCeiling(notices, adaptFor(next)));
            setSheet({ kind: 'none' });
            setView('adapt');
          }}
        />
      )}

      {sheet.kind === 'confirm' && (
        <Sheet title={sheet.change.title} onClose={closeSheet}>
          <ConfirmChange
            change={sheet.change}
            onConfirm={(patch) => {
              closeSheet();
              patchProfile(patch);
            }}
            onCancel={closeSheet}
          />
        </Sheet>
      )}

      {sheet.kind === 'delete-workout' && (
        <ConfirmSheet
          title="Delete this workout?"
          confirmLabel="Delete workout"
          cancelLabel="Keep workout"
          onConfirm={() => deleteWorkout(sheet.workoutId)}
          onCancel={closeSheet}
        >
          It is removed from your history and progress. This cannot be undone.
        </ConfirmSheet>
      )}

      {sheet.kind === 'settings' && state.profile && (
        <SettingsSheet
          profile={state.profile}
          onChange={patchProfile}
          onExport={exportData}
          onBackup={backupNow}
          onRestore={restoreFile}
          onStartOver={() => setSheet({ kind: 'startOver' })}
          onClose={closeSheet}
          storageNote={storageNote}
        />
      )}

      {sheet.kind === 'startOver' && (
        <StartOverSheet
          sessionOpen={Boolean(state.current)}
          lastBackupAt={state.lastBackupAt}
          onBackup={backupNow}
          onErase={startOver}
          onClose={() => setSheet({ kind: 'settings' })}
        />
      )}

      {sheet.kind === 'actions' &&
        (() => {
          const exercise = todayExercises[sheet.exerciseIndex];
          // A shifted segment or a discarded session closes the menu rather than
          // letting an action land on whichever exercise now sits at that index.
          if (!exercise || exercise.exerciseId !== sheet.exerciseId || !profile) return null;
          const pending = exercise.performed.filter((set) => !set.done).length;
          const done = exercise.performed.filter((set) => set.done).length;
          return (
            <ExerciseActionsSheet
              exerciseId={exercise.exerciseId}
              exerciseName={exercise.name}
              exerciseIndex={sheet.exerciseIndex}
              exerciseCount={todayExercises.length}
              initialMode={sheet.mode}
              planned={exercise.planned}
              pending={pending}
              done={done}
              history={state.history}
              unit={unit}
              profile={profile}
              inSession={Boolean(current)}
              skipped={Boolean(exercise.skipped)}
              onReplace={() => setSheet({ kind: 'swap', exerciseIndex: sheet.exerciseIndex })}
              onSaveProfile={(patch) => {
                // Closing first: a saved preference can reorder today's preview under the sheet.
                closeSheet();
                patchProfile(patch);
                setNotice('Saved for future workouts. Logged sets are unchanged.');
              }}
              onRemoveToday={() => {
                const index = sheet.exerciseIndex;
                closeSheet();
                skipCurrentExercise(index);
              }}
              onReturn={() => {
                const index = sheet.exerciseIndex;
                closeSheet();
                returnToExercise(index);
              }}
              onClose={closeSheet}
            />
          );
        })()}

      {sheet.kind === 'why' &&
        (() => {
          const exercise = todayExercises[sheet.exerciseIndex];
          if (!exercise || exercise.exerciseId !== sheet.exerciseId) return null;
          return (
            <WhySheet
              exerciseId={exercise.exerciseId}
              exerciseName={exercise.name}
              planned={exercise.planned}
              history={state.history}
              unit={unit}
              loads={profile?.loads}
              reason={targetNotes[exercise.exerciseId]}
              onClose={closeSheet}
            />
          );
        })()}

      {(sheet.kind === 'day' || sheet.kind === 'preview') && (
        <DaySheet
          name={todayDay.name}
          minutes={todayDay.minutes}
          approx={todayDay.approx}
          exercises={todayExercises}
          unit={unit}
          history={state.history}
          loads={profile?.loads}
          // The tab bar's start: the one validated path (startSession).
          onStart={sheet.kind === 'preview' && !current ? () => { closeSheet(); startWorkout(); } : undefined}
          onClose={closeSheet}
        />
      )}

      {sheet.kind === 'finish' && current && (
        <FinishSheet
          done={sessionProgress(current).done}
          total={sessionProgress(current).total}
          onSave={saveFinish}
          onContinue={closeSheet}
          onDiscard={discardSession}
          onClose={closeSheet}
          // A described day (#193) has no slot to skip; keeping it leaves the planned day next.
          slotName={current.slotSeq === undefined ? undefined : slot?.name}
          nextName={current.slotSeq === undefined ? undefined : nextSlotName}
          onSkip={skipFromSession}
        />
      )}

      {sheet.kind === 'swap' && current &&
        (() => {
          const exercise = current.exercises[sheet.exerciseIndex];
          if (!exercise) return null;
          const meta = exerciseById(exercise.exerciseId);
          // The rest of today's workout: never offer a duplicate, an incompatible pair, or a third of a pattern (#177).
          const inDay = current.exercises
            .filter((_, index) => index !== sheet.exerciseIndex)
            .map((item) => exerciseById(item.exerciseId))
            .filter((item): item is NonNullable<typeof item> => item !== undefined);
          // A described day's swaps keep its skip (#193): nothing that works a skipped area.
          const swapProfile = describedSession && state.todayOverride?.skip ? withSkipped(profile, state.todayOverride.skip) : profile;
          const options = (meta ? rankedReplacements(meta, swapProfile, inDay, 6) : []).map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            meta: `${candidate.equipment} · ${candidate.muscles.slice(0, 2).join(', ')}`,
          }));
          return (
            <SwapSheet
              currentName={exercise.name}
              options={options}
              onPick={(nextId) => swapExercise(sheet.exerciseIndex, nextId)}
              onClose={closeSheet}
            />
          );
        })()}

      {replacePrompt && current && (
        <DiscardSessionSheet
          currentName={current.name}
          nextName={adaptFor(replacePrompt).name}
          onDiscard={discardAndBegin}
          onKeep={() => setReplacePrompt(null)}
        />
      )}
    </PhoneFrame>
  );
}
