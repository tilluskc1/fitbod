import
 { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { backupCount, backupReminder, shareBackup } from './lib/backup';
import { offerFirstBackup } from './lib/dataHome';
import { currentDevice, dismissInstallNote, installGuide, showInstallNote } from './lib/install';
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
import { skippedToday } from './lib/planPage';
import { CHANGED_FOR_TODAY, todayDiff, todayOnly, undoToast, usualGear } from './lib/todayOnly';
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
import { keptPairsOf, pairedPendingIndex, restAfterLog, sessionPairs, startPairs, storedPairs, type PairSource } from './lib/supersets';
import { removeTodayNotice } from './lib/exerciseActions';
import { cleanNote, noSetsNotice, setExerciseNote, swapDropsNote, swapNotice } from './lib/notes';
import { leadCompoundId, leadSlotIds, savedSetup } from './lib/progression';
import { areasOf } from './lib/areas';
import
 {
  applyCancel,
  applyCorrection,
  applyFinish,
  createSession,
  extendRest,
  updatePerformedSet,
  logSet,
  sessionProgress,
  skipExercise,
  swapPendingExercise,
  toggleRestPause,
  unskipExercise,
  editSet,
  setRemaining,
  undoCarry,
  revertBurst,
  carryWeight,
  type CarryResult,
  type Followers,
} from './lib/session';
import { bigJumpNote, burstLive, burstMark, carryMessage, heldMessage, overLastTime, setAllMessage } from './lib/carry';
import { loadModeOf, needsLoad, setUnit } from './data/flagship';
import { lastExercisePerformance } from './lib/progression';import { setWorkoutFeedback } from './lib/feedback';
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
  WorkoutRecord,
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
import type { SetEdit } from './screens/TrainScreen';
import FeedbackSheet from './components/FeedbackSheet';
import {
  EMPTY_DRAFT,
  appVersion,
  deviceKind,
  sendFeedback,
  testerId,
  type FeedbackDraft,
  type FeedbackStatus,
} from './lib/sendFeedback';
import { finishedWorkouts } from './lib/progressTotals';
import { dayTypeOf, track } from './lib/events';
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
import { pickConstraints, pickPreview, recoveryLabels } from './lib/switchPick';
import { bodyShade } from './lib/bodyMap';
import type { Picks } from './lib/switchPick';
import { opensOnSplash, splashAfterAdopt } from './lib/firstScreen';
import { done, headsUp, problem, toastShows, claimsSave, dropSaveClaim, TOAST_MS, type Notice } from './lib/notices';
import { DoneToast, MessageCard, NoticeCard } from './components/ui/Notices';
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
  BackupSheet,
  InstallSheet,
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
  | { kind: 'backup' }
  | { kind: 'install'; from: 'today' | 'settings' }
  | { kind: 'feedback'; from: 'settings' | 'recap' }
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

/** An event's timestamp; only ever called from handlers. */
function stampNow(): string {
  return new Date().toISOString();
}

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
/** (#333) Finish's partial-save Heads-up, which a failed save makes untrue. */
const PARTIAL_SAVE = /^Saved the completed sets\./;

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
  // (#255) The feedback note being written, for this visit only: never stored.
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  // The send lives here with the draft, so closing the sheet mid-send never loses or repeats a note.
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>('idle');
  const feedbackSending = useRef(false);
  const [pending, setPending] = useState<Proposal | null>(null);
  const [pendingNotices, setPendingNotices] = useState<ConstraintNotice[]>([]);
  const [recapId, setRecapId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** (#297) Plan's "why days differ" line, tapped away: this app session only, never stored. */
  const [planTipShown, setPlanTipShown] = useState(true);
  // #306: the carry the toast's Undo would reverse; one burst per edited set while its toast is up.
  const [carryUndo, setCarryUndo] = useState<{
    key: string;
    message: string;
    sessionId: string;
    exerciseIndex: number;
    exerciseId: string;
    previous: CarryResult['previous'];
    followers: Followers;
    /** The exercise's sets as this burst left them; see `burstLive`. */
    mark: string;
    /** A logged set this burst edited (#309), as it was before the burst: Undo puts it back. */
    edited?: CarryResult['previous'][number];
    /** The edited set as it was when the burst began: a refused keystroke puts it back (#309 review 2). */
    origin?: CarryResult['previous'][number];
    /** The "Big jump" heads-up this toast carries; it outlives the Undo when a set is logged (#309 review 2). */
    note?: string;
    /** (#371) A − or + tap is in this burst: Undo puts the edited set back to `origin` too. */
    stepped?: boolean;
  } | null>(null);
  // (#369) The exercise a Later toast's Undo brings back; offered only while that very toast shows.
  const [laterUndo, setLaterUndo] = useState<{ message: string; sessionId: string; exerciseIndex: number } | null>(null);
  // A burst whose exercise changed by any other path is over: no Undo, no fixed followers.
  const liveCarry = carryUndo !== null && burstLive(state.current, carryUndo.exerciseIndex, carryUndo.mark) ? carryUndo : null;
  /**
   * (#327) A typed weight more than 10% over last time, held on its own set. Its Heads-up offers
   * "Apply to all" until then, the next edit in any cell, leaving the exercise, or Finish. In memory only.
   */
  const [held, setHeld] = useState<{
    text: string;
    sessionId: string;
    exerciseIndex: number;
    exerciseId: string;
    setIndex: number;
    kg: number;
    /** The sets that followed the typed one when its burst began. */
    followers: number[];
    edited?: CarryResult['previous'][number];
    origin?: CarryResult['previous'][number];
    /** (#371 review 1) The held burst came from − or + taps: Apply to all's Undo puts the tapped set back too. */
    stepped?: boolean;
  } | null>(null);
  const jumpWarned = useRef(new Map<string, string>());
  const jumpBase = useRef(new Map<string, number>());
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
      // (#351) The save a "Workout saved." toast claimed did not happen; a later Retry raises nothing.
      setNotice(dropSaveClaim);
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

  // (#295) Only a Done toast passes on its own, 4 s from when it shows; one fired during a sheet
  // waits for the sheet to close. Heads-up and Problem cards wait for the user.
  const saveFailed = saveUi.kind === 'error';
  const problemUp = saveFailed || conflict !== null;
  // (#332) A Problem appearing clears the Done showing at that moment: the toast goes, the Problem
  // stays (#295). A Done raised while a Problem is already up (an export, an Undo-able carry) shows
  // as usual, below the card. "Appears" is per source: a failed save, then a tab conflict. Adjusted
  // while rendering, so a cleared toast never paints beside the card.
  const [problemWas, setProblemWas] = useState({ saveFailed, conflict });
  if (problemWas.saveFailed !== saveFailed || problemWas.conflict !== conflict) {
    setProblemWas({ saveFailed, conflict });
    const appeared = (saveFailed && !problemWas.saveFailed) || (conflict !== null && problemWas.conflict === null);
    if (appeared && notice?.kind === 'done') setNotice(null);
  }
  // (#351) A Done claiming a save never paints under a standing save error. Hidden here, because the
  // save that may clear the error runs after this render; cleared in attemptSave once it fails.
  const toastUp = !(saveFailed && claimsSave(notice)) && toastShows(notice, sheet.kind !== 'none');
  // Finish's partial-save Heads-up (#333) says the sets were saved, which a failed save makes untrue,
  // so it goes whenever a Problem is up.
  useEffect(() => {
    if (problemUp && notice && PARTIAL_SAVE.test(notice.text)) setNotice(null);
  }, [problemUp, notice]);
  useEffect(() => {
    if (!toastUp) return;
    const timer = window.setTimeout(() => setNotice(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [notice, toastUp]);

  // (#259) A message stays on the screen it was raised on. A new message is stamped with the screen
  // it first shows on, so a handler that sets a message and moves screen in one update stamps the new
  // screen; a later move clears it (or carries it, recap to Today). A layout effect, so a message
  // leaving with the screen is gone before the next screen paints.
  const screen = screenKey(view, tab);
  const onToday = view === 'tabs' && tab === 'today';
  const noticeScreenRef = useRef<string | null>(null);
  const stampedNoticeRef = useRef<Notice | null>(null);
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
  /**
   * (#88) The pairs a change is fitted and priced with: the profile's for a day not started; while a
   * session runs, the pairs it stored, the only ones a rebuild keeps (`keepPairs`), so a shorter length
   * never runs over the minutes it promised.
   */
  const fitPairing = useMemo(
    () => (state.current ? keptPairsOf(state.current.exercises) : profile),
    [state.current, profile],
  );
  /** A proposed adaptation: another setup or a described day is rebuilt, the saved one adapts the saved day. */
  const adaptFor = useCallback(
    // The saved day at another length is the length sheet's rebuild (#193: the composer's time chip).
    (next: Constraints, pairing: PairSource | null = fitPairing) => adaptWorkout(next.equipment === 'home' && !next.focus && next.minutes === constraints.minutes ? homeProgram : programFor(next), next, exclusions, profile?.goal, pairing),
    [homeProgram, programFor, exclusions, constraints.minutes, profile?.goal, fitPairing],
  );
  const adapted = useMemo(
    () => adaptWorkout(program, constraints, exclusions, profile?.goal, profile),
    [program, constraints, exclusions, profile],
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
  /** (#88) The running session's supersets: the pairs stored when it started, never re-derived. */
  const currentPairs = useMemo(() => (current ? storedPairs(current.exercises) : []), [current]);
  // (#327) A held jump's Heads-up lasts while its exercise is the one being logged and its card is up.
  const heldLive = held !== null && view === 'train' && current?.id === held.sessionId && notice?.text === held.text
    && pairedPendingIndex(current, currentPairs) === held.exerciseIndex && current.exercises[held.exerciseIndex]?.exerciseId === held.exerciseId;
  if (held !== null && !heldLive) {
    setHeld(null);
    if (notice?.text === held.text) setNotice(null);
  }
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
  const todayDay = useMemo(() => todayGlance(adapted, current, Boolean(override), profile?.goal, profile), [adapted, current, override, profile]);

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
    // (#359) Supersets on/off counts a change, not a tap on the side already chosen.
    if (patch.pairExercises !== undefined && profile && patch.pairExercises !== (profile.pairExercises !== false)) {
      track(patch.pairExercises ? 'supersets-on' : 'supersets-off');
    }
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
      exercises: startPairs(profile
        ? liveExercises(workout, profile, state.history)
        : toWorkoutExercises(workout), profile, workout.minutes),
      now: new Date().toISOString(),
      durationMin: workout.minutes,
    });
    setState((currentState) => ({ ...currentState, current: session }));
    setView('train');
    track('workout-started', dayTypeOf(workout.name));
  };

  /**
   * Starting is always built from the same engine output the screens showed,
   * so the preview, the review and the logger can never disagree.
   */
  const startSession = (next: Constraints): boolean => {
    const workout = adaptFor(next);
    if (workout.exercises.length === 0) {
      setNotice(problem('No movement in this workout can be done with that setup.'));
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
      setNotice(headsUp('Finish or discard the open session before skipping this one.'));
      return;
    }
    const offered = cursorFor(state);
    setState((currentState) => skipCurrentSlot(currentState, new Date().toISOString(), offered));
    setNotice(done('Session skipped. Skips earn no progression.'));
  };

  /** Explicit discard consent from the in-app sheet (#19) runs the replacement once. */
  const discardAndBegin = () => {
    const next = replacePrompt;
    setReplacePrompt(null);
    if (!next) return;
    // A new session: fitted with the profile's pairs, which Start stores (#88).
    const workout = adaptFor(next, profile);
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
      setNotice(problem('That preview is out of date. Preview again to approve it.'));
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
        setNotice(problem('No movement in this workout can be done with that setup.'));
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
      setNotice(done(`${minutes} min is now your default length.`));
      return;
    }
    // The saved setup is savedSetup(profile): 'bodyweight' for a no-gear profile, else 'home'.
    if (minutes === fallback && (constraints.equipment === 'home' || constraints.equipment === savedSetup(profile)) && !constraints.focus) {
      restoreOriginal();
      setNotice(done('Back to your program.'));
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
    setNotice(done(CHANGED_FOR_TODAY));
  };

  /** (#149) Today's equipment. Today only; the saved setup at the default length restores the original. */
  const pickSetup = (choice: EquipmentChoice) => {
    if (!profile || current) return;
    if ((choice === 'home' || choice === savedSetup(profile)) && constraints.minutes === (profile.sessionMinutes ?? 35) && !constraints.focus) {
      restoreOriginal();
      setNotice(done('Back to your gear.'));
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
    setNotice(done(CHANGED_FOR_TODAY));
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
      .map((other) => ({ name: other.name, sets: adaptWorkout(todayProgram(profile, other, state.history, plainConstraints), plainConstraints, profile.exclusions ?? [], profile.goal, profile).totalSets }))
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
      setNotice(headsUp('Finish or discard the open session before switching days.'));
      return;
    }
    // A planned day picked here replaces a described one (#193).
    setState((currentState) => withoutCustomDay(skipForward(currentState, option.offset, new Date().toISOString())));
    setSheet({ kind: 'none' });
    setNotice(done(`${option.name} is up. Skipped ${option.skips.join(', ')}; a skip earns no progression.`));
  };

  /**
   * (#296) Switch's "Or train something else": today's gear and time with the picked focus, through
   * the path Plan today with me runs (`talkConstraints` → `programFor` → `adaptFor`, lesson 9).
   */
  const switchPickFor = (picks: Picks) =>
    (profile && slot ? pickConstraints(picks, plainConstraints, slot.focus, profile.sessionMinutes ?? 35) : null);
  const previewPick = (picks: Picks) => {
    const next = switchPickFor(picks);
    if (!profile || !next) return null;
    return pickPreview(picks, next, programFor(next), liveAdapted(adaptFor(next, profile), profile, state.history), profile, slot?.name);
  };

  /**
   * (#296) Build the picked day: today's override carries its focus (no new keys), the plan cursor
   * stays (#220), and Today shows the day to Start. Picks equal to the planned day are the planned day.
   */
  const buildPick = (picks: Picks) => {
    const next = switchPickFor(picks);
    if (!profile || !next) return;
    if (current) {
      setNotice(headsUp('Finish or discard the open session before switching days.'));
      return;
    }
    const choice: EquipmentChoice = next.equipment;
    const plain = !next.focus && (choice === 'home' || choice === savedSetup(profile)) && next.minutes === (profile.sessionMinutes ?? 35);
    if (plain) {
      restoreOriginal('Back to your program.');
      return;
    }
    setState((currentState) => ({
      ...currentState,
      todayOverride: {
        date: dayKey(new Date()),
        minutes: next.minutes,
        equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
        support: [],
        appliedAt: new Date().toISOString(),
        choice,
        ...(next.focus ? { focus: next.focus } : {}),
      },
    }));
    proposalRevisionRef.current += 1;
    appliedProposalRef.current = null;
    setPending(null);
    setPendingNotices([]);
    setSheet({ kind: 'none' });
    setNotice(done(CHANGED_FOR_TODAY));
  };
  /** (#296) "Sore or hurt? Plan today with me": Switch closes and the planner opens at its first question. */
  const [planTodayAsk, setPlanTodayAsk] = useState(0);
  const openPlanToday = () => {
    track('plan-today');
    setSheet({ kind: 'none' });
    setPlanTodayAsk((count) => count + 1);
  };

  /** A described session (#193) has no planned work to restore into; it is finished or discarded instead. */
  const describedSession = Boolean(current && isDescribedSession(current));
  /** (#297) Plan's Edit: Settings, scrolled to its Training group. */
  const openTrainingSettings = () => {
    setSheet({ kind: 'settings' });
    requestAnimationFrame(() => document.getElementById('settings-training')?.scrollIntoView({ block: 'start' }));
  };

  const restoreOriginal = (message = 'Back to your plan. Logged sets kept.') => {
    if (describedSession) return;
    setState((currentState) => {
      const original = adaptWorkout(
        savedProgram,
        currentState.profile ? defaultConstraints(currentState.profile) : DEFAULT_CONSTRAINTS,
        currentState.profile?.exclusions ?? [],
        currentState.profile?.goal,
        // (#88) A running session is fitted with the pairs it keeps.
        currentState.current ? keptPairsOf(currentState.current.exercises) : currentState.profile,
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
    setNotice(done(message));
  };

  /** Show what a carry changed, with Undo; typing 1, 13, 135 into one set is one burst with one Undo. */
  const burstKey = (session: WorkoutRecord, exerciseIndex: number, burst: string) =>
    `${session.id}:${exerciseIndex}:${session.exercises[exerciseIndex]?.exerciseId}:${burst}`;
  /** The open burst for this key. Every edit opens its own burst and ends any other (#306 review 2). */
  const openBurst = (key: string) => (liveCarry !== null && liveCarry.key === key ? liveCarry : null);

  const announceCarry = (
    session: WorkoutRecord,
    exerciseIndex: number,
    burst: string,
    result: CarryResult,
    message: (carried: number[]) => string | null,
    jump?: { startKg: number; kg: number },
    edited?: CarryResult['previous'][number],
    origin?: CarryResult['previous'][number],
    stepped = false,
  ) => {
    const exercise = session.exercises[exerciseIndex];
    if (!exercise) return;
    const key = burstKey(session, exerciseIndex, burst);
    const open = openBurst(key);
    // The heads-up compares with the exercise's first prefill this session, not the last keystroke.
    const jumpKey = `${session.id}:${exerciseIndex}:${exercise.exerciseId}`;
    if (jump && jump.startKg > 0 && !jumpBase.current.has(jumpKey)) jumpBase.current.set(jumpKey, jump.startKg);
    const previous = open
      ? [...open.previous, ...result.previous.filter((p) => !open.previous.some((q) => q.index === p.index))]
      : result.previous;
    const followers = result.followers ?? { weight: [], reps: [] };
    const self = open ? open.edited : edited;
    const entry = {
      key, sessionId: session.id, exerciseIndex, exerciseId: exercise.exerciseId, previous, followers,
      mark: burstMark(result.session, exerciseIndex), edited: self, origin: open ? open.origin : origin,
      stepped: Boolean(open?.stepped) || stepped,
    };
    let text = message(previous.map((p) => p.index));
    // Undo has something to put back only while a set differs from what the burst found (#309 review 2):
    // a refused first keystroke, or one that types the old value back, says nothing.
    const sets = result.session.exercises[exerciseIndex]?.performed ?? [];
    const differs = (p: CarryResult['previous'][number]) =>
      sets[p.index] !== undefined && (Math.abs(sets[p.index].weight - p.weight) > 1e-9 || sets[p.index].reps !== p.reps);
    const undoable = previous.some((p) => sets[p.index]?.done === false && differs(p)) || (self !== undefined && differs(self));
    if (!undoable || text === null) {
      // Nothing to say, but the burst still opens (its followers fixed now, even if none), so a later
      // keystroke can never re-read them from a half-typed value. A cleared field drops a stale toast.
      setCarryUndo({ ...entry, message: '' });
      if (open !== null && open.message !== '' && notice?.text === open.message) setNotice(null);
      return;
    }
    if (result.carried.length === 0 && !self) {
      setCarryUndo({ ...entry, message: open !== null ? open.message : '', note: open?.note });
      return;
    }
    const mode = loadModeOf(exercise.exerciseId);
    const firstTime = !lastExercisePerformance(state.history, exercise.exerciseId, exercise.setup)?.done.length;
    const note = jump ? bigJumpNote(firstTime, jumpBase.current.get(jumpKey) ?? 0, jump.kg, unit, mode) : null;
    // Once per exercise: the burst that raised it keeps showing it while the jump holds.
    const warned = note !== null && (jumpWarned.current.get(jumpKey) ?? key) === key;
    if (warned) {
      jumpWarned.current.set(jumpKey, key);
      text = `${text}. ${note}`;
    }
    setCarryUndo({ ...entry, message: text, note: warned ? note : undefined });
    if (warned) setNotice(headsUp(text));
    else setNotice(done(text));
  };

  /**
   * `revert`: the keystroke was refused, or emptied the cell (#309 review 2). The open burst then ends
   * what it did: every set it carried goes back to what Undo would restore, and the edited set to the
   * value it held when the burst began (an emptied set not yet logged stays empty).
   */
  const updateSet = (exerciseIndex: number, setIndex: number, patch: Partial<PerformedSet>, how: SetEdit = {}) => {
    const { revert, prefill = 0, step = false } = how;
    const stamp = stampNow();
    const session = state.current;
    // Typing into one field of one set is a burst whose following sets were fixed at its first keystroke (#306).
    const field = patch.weight !== undefined ? 'weight' : 'reps';
    const open = session ? openBurst(burstKey(session, exerciseIndex, `${setIndex}:${field}`)) : null;
    const fixed = open?.followers;
    const before = session?.exercises[exerciseIndex]?.performed[setIndex];
    // (#327) Any edit ends a held jump's Heads-up; this cell's keystroke may raise it again below.
    if (held !== null) {
      setHeld(null);
      if (notice?.text === held.text) setNotice(null);
    }
    if (revert && session && before) {
      // Nothing open: a refused keystroke changed nothing, and an emptied logged set keeps its value.
      const origin = open?.origin ?? { index: setIndex, weight: before.weight, reps: before.reps };
      const keepsValue = revert === 'refused' || (before.done && (field === 'reps' || needsLoad(session.exercises[exerciseIndex].exerciseId)));
      if (open || keepsValue) {
        const target = keepsValue ? { [field]: origin[field] } : { [field]: 0 };
        const exerciseId = session.exercises[exerciseIndex].exerciseId;
        const previous = open?.previous ?? [];
        setState((currentState) =>
          currentState.current
            ? { ...currentState, current: revertBurst(currentState.current, exerciseIndex, exerciseId, setIndex, target, previous, stamp) }
            : currentState,
        );
        const reverted = revertBurst(session, exerciseIndex, exerciseId, setIndex, target, previous, stamp);
        announceCarry(session, exerciseIndex, `${setIndex}:${field}`, { session: reverted, carried: [], previous: [], followers: fixed },
          () => null, undefined, before.done ? { index: setIndex, weight: before.weight, reps: before.reps } : undefined, origin, step);
        return;
      }
    }
    // (#327) A weight more than 10% over last time applies to this set only: everything this burst
    // carried goes back to its start-of-burst value, and a Heads-up offers "Apply to all".
    const typedKg = patch.weight;
    const exercise = session?.exercises[exerciseIndex];
    const jump = session && before && exercise && typedKg !== undefined && typedKg > 0
      ? overLastTime({ history: state.history, exerciseId: exercise.exerciseId, setup: exercise.setup, kg: typedKg, unit })
      : null;
    if (jump && session && before && exercise && typedKg !== undefined) {
      const exerciseId = exercise.exerciseId;
      // The carry this keystroke would make fixes the burst's followers and their start values.
      const would = editSet(session, exerciseIndex, setIndex, patch, stamp, fixed);
      const carried = open?.previous ?? [];
      const previous = [...carried, ...would.previous.filter((p) => !carried.some((q) => q.index === p.index))];
      setState((currentState) =>
        currentState.current
          ? { ...currentState, current: revertBurst(currentState.current, exerciseIndex, exerciseId, setIndex, { weight: typedKg }, carried, stamp) }
          : currentState,
      );
      const heldSession = revertBurst(session, exerciseIndex, exerciseId, setIndex, { weight: typedKg }, carried, stamp);
      const followers = would.followers ?? { weight: [], reps: [] };
      const edited = open ? open.edited : before.done ? { index: setIndex, weight: before.weight, reps: before.reps } : undefined;
      const origin = open?.origin ?? { index: setIndex, weight: before.weight, reps: before.reps };
      // The burst stays open, silent, so the next keystroke keeps its followers (lesson 26).
      setCarryUndo({
        key: burstKey(session, exerciseIndex, `${setIndex}:weight`), message: '', sessionId: session.id, exerciseIndex, exerciseId,
        previous, followers, mark: burstMark(heldSession, exerciseIndex), edited, origin, stepped: Boolean(open?.stepped) || step,
      });
      const text = heldMessage({ kg: typedKg, percent: jump.percent, setIndex, unit, mode: loadModeOf(exerciseId) });
      setHeld({ text, sessionId: session.id, exerciseIndex, exerciseId, setIndex, kg: typedKg, followers: followers.weight, edited, origin,
        stepped: Boolean(open?.stepped) || step });
      setNotice(headsUp(text));
      return;
    }
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: editSet(currentState.current, exerciseIndex, setIndex, patch, stamp, fixed).session }
        : currentState,
    );
    // The same pure edit on the rendered state names what was carried, for the toast and Undo.
    if (!session || !before) return;
    const result = editSet(session, exerciseIndex, setIndex, patch, stamp, fixed);
    const after = result.session.exercises[exerciseIndex].performed[setIndex];
    const moved = Math.abs(after.weight - before.weight) > 1e-9 ? 'weight' : 'reps';
    const exerciseId = session.exercises[exerciseIndex].exerciseId;
    // An edit to a logged set says so, with Undo, even when nothing follows it (#309).
    const edited = before.done ? { index: setIndex, weight: before.weight, reps: before.reps } : undefined;
    announceCarry(session, exerciseIndex, `${setIndex}:${field}`, result, (carried) => {
      // A cleared field keeps its burst but says nothing until a value is typed.
      const carriedText = (moved === 'weight' ? after.weight : after.reps) <= 0 ? null
        : carryMessage({ field: moved, kg: after.weight, reps: after.reps, carried, unit, mode: loadModeOf(exerciseId), seconds: setUnit(exerciseId) === 'seconds' });
      if (!before.done) return carriedText;
      return `Set ${setIndex + 1} updated${carriedText && carried.length > 0 ? `. ${carriedText}` : ''}`;
    // The heads-up compares with what set 1 showed when the burst began: its load, or the suggested
    // start an empty cell showed (#306), never a half-typed keystroke (#309 review 2).
    }, moved === 'weight' ? { startKg: (open?.origin ?? before).weight > 0 ? (open?.origin ?? before).weight : prefill, kg: after.weight } : undefined, edited,
    { index: setIndex, weight: before.weight, reps: before.reps }, step);
  };

  /** (#327) "Apply to all" on a held jump: it carries as #309 does, with Undo for every set it moved. */
  const applyHeldToAll = () => {
    const h = heldLive ? held : null;
    const session = state.current;
    if (!h || !session) return;
    const stamp = stampNow();
    const matches = (s: WorkoutRecord | null): s is WorkoutRecord =>
      s?.id === h.sessionId && s.exercises[h.exerciseIndex]?.exerciseId === h.exerciseId;
    setState((currentState) =>
      matches(currentState.current)
        ? { ...currentState, current: carryWeight(currentState.current, h.exerciseIndex, h.followers, h.kg, stamp).session }
        : currentState,
    );
    setHeld(null);
    if (!matches(session)) return setNotice(null);
    const result = carryWeight(session, h.exerciseIndex, h.followers, h.kg, stamp);
    // The followers already hold their start-of-burst values (the hold put them back), so Undo restores
    // what Apply to all found, never undoing reps a logged set carried since (#182, #306; #327 review 1).
    const { previous } = result;
    const carriedText = result.carried.length > 0
      ? carryMessage({ field: 'weight', kg: h.kg, reps: 0, carried: result.carried, unit, mode: loadModeOf(h.exerciseId), seconds: false })
      : null;
    const text = h.edited ? `Set ${h.setIndex + 1} updated${carriedText ? `. ${carriedText}` : ''}` : carriedText;
    if (text === null) return setNotice(null);
    setCarryUndo({
      key: burstKey(session, h.exerciseIndex, `${h.setIndex}:weight`), message: text, sessionId: session.id,
      exerciseIndex: h.exerciseIndex, exerciseId: h.exerciseId, previous, followers: { weight: h.followers, reps: [] },
      mark: burstMark(result.session, h.exerciseIndex), edited: h.edited, origin: h.origin, stepped: h.stepped,
    });
    setNotice(done(text));
  };

  /** "Set all remaining sets to…" from the exercise menu (#306). */
  const setAllRemaining = (exerciseIndex: number, exerciseId: string, value: { weight: number; reps: number }) => {
    const stamp = stampNow();
    const session = state.current;
    if (held !== null) {
      setHeld(null);
      if (notice?.text === held.text) setNotice(null);
    }
    if (!session || session.exercises[exerciseIndex]?.exerciseId !== exerciseId) return;
    setState((currentState) =>
      currentState.current?.exercises[exerciseIndex]?.exerciseId === exerciseId
        ? { ...currentState, current: setRemaining(currentState.current, exerciseIndex, value, stamp).session }
        : currentState,
    );
    const result = setRemaining(session, exerciseIndex, value, stamp);
    const first = session.exercises[exerciseIndex].performed.find((set) => !set.done);
    announceCarry(session, exerciseIndex, 'all', result, (carried) =>
      setAllMessage({ kg: value.weight, reps: value.reps, carried, unit, mode: loadModeOf(exerciseId), seconds: setUnit(exerciseId) === 'seconds' }),
      first ? { startKg: first.weight, kg: value.weight } : undefined);
  };

  /** (#372) This session's note on one exercise; blank removes it. Only this session changes. */
  const saveNote = (exerciseIndex: number, exerciseId: string, text: string) => {
    const before = state.current?.exercises[exerciseIndex];
    if (!before || before.exerciseId !== exerciseId) return;
    const after = cleanNote(text);
    if (after === before.note) return;
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const next = setExerciseNote(currentState.current, exerciseIndex, exerciseId, text);
      return next === currentState.current ? currentState : { ...currentState, current: next };
    });
    setNotice(done(after === undefined ? 'Note removed.' : 'Note saved for next time.'));
  };

  const undoLastCarry = () => {
    const undo = liveCarry;
    if (!undo) return;
    const stamp = new Date().toISOString();
    // (#371) A − or + burst is undone whole: the tapped set (not yet logged) goes back to where it began too.
    const previous = undo.stepped && undo.origin ? [undo.origin, ...undo.previous] : undo.previous;
    setState((currentState) =>
      currentState.current?.id === undo.sessionId
        ? { ...currentState, current: undoCarry(currentState.current, undo.exerciseIndex, undo.exerciseId, previous, stamp, undo.edited) }
        : currentState,
    );
    setCarryUndo(null);
    setNotice(null);
  };

  /** `weight`: the suggested start an empty cell showed (#309); it is written to that set as it is logged. */
  const logOneSet = (exerciseIndex: number, setIndex: number, exerciseId: string, weight?: number) => {
    const stamp = new Date().toISOString();
    // A logged set ends any carry burst: Undo must not reverse the reps #182 carries on log (#306).
    // Its toast goes with it, rather than staying up without the Undo it offered (#309 review 1); a
    // "Big jump" heads-up it carried stays, on its own, since the load it warns about is still there.
    if (liveCarry !== null && notice?.text === liveCarry.message) {
      if (liveCarry.note) setNotice(headsUp(liveCarry.note));
      else setNotice(null);
    }
    setCarryUndo(null);
    setState((currentState) => {
      const session = currentState.current;
      const exercise = session?.exercises[exerciseIndex];
      // A tap rendered against another exercise, or on work the user set aside, records nothing.
      if (!session || exercise?.exerciseId !== exerciseId || exercise.skipped) return currentState;
      // Rest by the exercise's role in the day, the same seconds the minutes were fitted with (#132); in a
      // superset the 30 s switch to its partner, or the pair's rest once a round is done (#88).
      const rest = restAfterLog(session, exerciseIndex,
        sessionRests(session.exercises.map((item) => item.exerciseId), currentState.profile?.goal, session.durationMin),
        storedPairs(session.exercises));
      // Only an empty load takes the suggestion; logSet then carries it to later empty sets (#182).
      const filled = weight !== undefined && weight > 0 && exercise.performed[setIndex]?.weight === 0
        ? updatePerformedSet(session, exerciseIndex, setIndex, { weight }, stamp) : session;
      // (#327 review 1) A held jump's set logs without carrying its load: "Applied to set N only" stays true
      // on a day whose later sets are still empty. Reps still carry.
      const holding = held !== null && heldLive && held.sessionId === session.id && held.exerciseIndex === exerciseIndex && held.setIndex === setIndex;
      const logged = logSet(filled, exerciseIndex, setIndex, stamp, rest, { carryWeight: !holding });
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
      setNotice(done(noSetsNotice(current.exercises.some((exercise) => exercise.note))));
      return;
    }
    const early = progress.done < progress.total;
    const id = current.id;
    track(early ? 'workout-cut-short' : 'workout-finished', dayTypeOf(current.name));
    setState((currentState) =>
      applyFinish(currentState, id, { early, now: new Date().toISOString() }),
    );
    setRecapId(id);
    setSheet({ kind: 'none' });
    setView('recap');
    // (#333) Part of the workout was dropped, so a partial save is a Heads-up, not a Done tick.
    if (early) {
      setNotice(headsUp(
        progress.skipped > 0
          ? 'Saved the completed sets. The rest was not recorded.'
          : 'Saved the completed sets. Unfinished work was not recorded.',
      ));
    } else {
      setNotice(done('Workout saved.'));
    }
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
    setNotice(done(`${slot.name} skipped${next ? `; ${next} is next` : ''}. Skips earn no progression.`));
  };

  const discardSession = () => {
    if (!current) return;
    setState((currentState) => applyCancel(currentState, current.id));
    setSheet({ kind: 'none' });
    setView('tabs');
    setTab('today');
    setNotice(done('Session discarded. Nothing was added to history.'));
  };

  const correctSet = (
    workoutId: string,
    exerciseIndex: number,
    setIndex: number,
    patch: Partial<PerformedSet>,
    refused?: string,
  ) => {
    // A refused history load or reps arrives as the focus value the field reverts to; say why (#101, #109).
    if (refused) setNotice(problem(refused));
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
    setNotice(done('Workout deleted.'));
  };

  /** (#307) × on Today's install note: this browser's choice, at most two dates. */
  const dismissInstall = () =>
    setState((currentState) => ({
      ...currentState,
      installNoteDismissals: dismissInstallNote(currentState.installNoteDismissals, new Date()),
    }));

  /** (#225) A file that left the app is a backup: the reminder counts it. */
  const recordBackup = () => {
    track('backup');
    setState((currentState) => ({ ...currentState, lastBackupAt: new Date().toISOString() }));
  };

  const exportData = () => {
    try {
      downloadText(serializeExport(state), exportFilename());
    } catch {
      setNotice(problem('Backup not saved, so nothing was recorded. Try again.'));
      return;
    }
    recordBackup();
    setNotice(done('Backup downloaded.'));
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
    if (message && result.ok) setNotice(done(message));
    else if (message) setNotice(problem(message));
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
      setNotice(problem('The file could not be read. Nothing changed.'));
      return false;
    }
    const parsed = parseState(text);
    if (!parsed.ok) {
      setNotice(problem(`Restore rejected: ${parsed.error}`));
      return false;
    }
    const merged = mergeImport(state, parsed.state);
    setState({ ...merged.state, todayOverride: state.todayOverride ?? null });
    setNotice(done(
      `Restored ${merged.summary.newWorkouts} workout${merged.summary.newWorkouts === 1 ? '' : 's'}; ${merged.summary.duplicateWorkouts} already present.` +
        (merged.summary.activeSessionConflict
          ? ' Kept the open session with more logged sets.'
          : '') +
        // Restore must not drop an answer the backup simply predates, and it
        // must say so rather than keeping it quietly.
        (merged.summary.feedbackPreserved > 0
          ? ` Kept feedback on ${merged.summary.feedbackPreserved} workout${
              merged.summary.feedbackPreserved === 1 ? '' : 's'
            } the backup lacked.`
          : ''),
    ));
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
    const noteDropped = swapDropsNote(state.current?.exercises[exerciseIndex]);
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: swapPendingExercise(currentState.current, exerciseIndex, candidate) }
        : currentState,
    );
    setSheet({ kind: 'none' });
    setNotice(done(swapNotice(target.name, noteDropped)));
  };

  const skipCurrentExercise = (exerciseIndex: number) => {
    const removed = removeTodayNotice(current?.exercises[exerciseIndex]);
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const skipped = skipExercise(currentState.current, exerciseIndex);
      return skipped === currentState.current ? currentState : { ...currentState, current: skipped };
    });
    setNotice(done(removed));
  };

  // (#369) Later: the same skip as Remove today's remaining work, in one tap, with an Undo on its toast.
  const laterExercise = (exerciseIndex: number) => {
    const session = state.current;
    const exercise = session?.exercises[exerciseIndex];
    if (!session || !exercise) return;
    const message = `${exercise.name} moved to later.`;
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const skipped = skipExercise(currentState.current, exerciseIndex);
      return skipped === currentState.current ? currentState : { ...currentState, current: skipped };
    });
    setLaterUndo({ message, sessionId: session.id, exerciseIndex });
    setNotice(done(message));
  };

  const undoLater = () => {
    const undo = laterUndo;
    if (!undo) return;
    setState((currentState) => {
      if (currentState.current?.id !== undo.sessionId) return currentState;
      const restored = unskipExercise(currentState.current, undo.exerciseIndex);
      return restored === currentState.current ? currentState : { ...currentState, current: restored };
    });
    setLaterUndo(null);
    setNotice(null);
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
    setNotice(done(`${name} is back in today's session.`));
  };

  /**
   * Record the user's explicit choice. The answer is kept in state immediately
   * (so a failed write is recoverable and retryable), and the recap only calls
   * it saved once the persistence boundary has confirmed it. A stale id never
   * attaches an answer to another workout.
   */
  // (#330) Opening the sheet clears a leftover "Sent" or "Not sent" line; a send in flight keeps "Sending…".
  const openFeedback = (from: 'settings' | 'recap') => {
    if (!feedbackSending.current) setFeedbackStatus('idle');
    track('feedback');
    setSheet({ kind: 'feedback', from });
  };

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
            setNotice(done(`Restored ${summary.newWorkouts} workouts.`));
          }}
          onStartFresh={() => {
            if (recovery.raw) backupRaw(recovery.raw);
            revisionRef.current = 0;
            forceSaveRef.current = true;
            setState({ ...EMPTY_STATE });
            setShowSplash(opensOnSplash(EMPTY_STATE));
            setRecovery(null);
            setNotice(done('Started with empty data.'));
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
        {notice && notice.kind !== 'done' && (
          <div className="app-alerts">
            <MessageCard notice={notice} onDismiss={() => setNotice(null)} />
          </div>
        )}
        {toastUp && notice && <DoneToast notice={notice} screen="splash" />}
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
        profileLoads={profile?.loads}
        rampLoads={loadOptions(constraints.equipment, constraints.loads)}
        calibrationLoads={confirmedLoads(constraints.equipment, constraints.loads)}
        experience={state.profile?.experience}
        targetNotes={targetNotes}
        rests={current ? sessionRests(current.exercises.map((item) => item.exerciseId), profile?.goal, current.durationMin) : []}
        pairs={currentPairs}
        goHeavier={goHeavier}
        unit={unit}
        onMinimize={() => {
          setView('tabs');
          setTab('today');
        }}
        onFinish={requestFinish}
        onUpdateSet={updateSet}
        held={heldLive ? { exerciseIndex: held.exerciseIndex, setIndex: held.setIndex, text: held.text, onApply: applyHeldToAll, onDismiss: () => setNotice(null) } : null}
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
        onReplace={(exerciseIndex) => { track('replace'); setSheet({ kind: 'swap', exerciseIndex }); }}
        onLater={laterExercise}
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
        onSendFeedback={() => openFeedback('recap')}
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
        after={todayGlance(pendingAdapted, null, false, profile?.goal, fitPairing)}
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
            onOpenSwitch={slot ? () => { track('switch'); setSheet({ kind: 'switch' }); } : undefined}
            alternativeDay={alternativeDay}
            composer={slot && talkBase ? (
              <TodayTalk
                profile={profile}
                plannedName={slot.name}
                todayName={override ? program.name : undefined}
                plannedAreas={areasOf(slot.focus)}
                plannedFocus={slot.focus}
                savedGear={savedSetup(profile)}
                savedMinutes={profile.sessionMinutes ?? 35}
                base={talkBase}
                preview={talkPreview}
                onStart={startTalk}
                onActive={setComposing}
                openAsk={planTodayAsk}
                shade={bodyShade(state.history, today)}
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
            todayDiff={todayDiff(state, today)}
            onUndo={() => restoreOriginal(undoToast(profile))}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onOpenExercise={(exerciseId, exerciseIndex) => setSheet({ kind: 'actions', exerciseId, exerciseIndex })}
            onReviewChange={(change) => setSheet({ kind: 'confirm', change })}
            backup={backupReminder(state, today)}
            onBackup={backupNow}
            install={
              typeof window !== 'undefined' &&
              showInstallNote({
                device: currentDevice(),
                completedWorkouts: backupCount(state.history),
                sessionOpen: Boolean(state.current),
                dismissals: state.installNoteDismissals,
                now: today,
              })
            }
            onInstall={() => setSheet({ kind: 'install', from: 'today' })}
            onDismissInstall={dismissInstall}
            message={notice?.kind === 'headsUp' ? notice.text : null}
            onDismissMessage={() => setNotice(null)}
            fresher={fresher}
            onPickFresher={pickDay}
            onKeepNext={() => slot && setKeptFresher(keepKey(slot.id, today))}
          />
        )}
        {tab === 'plan' && (
          <PlanScreen
            profile={profile}
            upcoming={upcoming}
            focus={slot?.focus}
            program={program}
            today={todayDay}
            todayIds={todayExercises.map((exercise) => exercise.exerciseId)}
            history={state.history}
            unit={unit}
            onOpenSettings={openTrainingSettings}
            onViewDay={(dayIndex) => setSheet({ kind: 'day', dayIndex })}
            onOpenLibrary={() => setView('library')}
            described={described}
            todayBar={todayOnly(state, today)}
            onUndo={describedSession ? undefined : () => restoreOriginal(undoToast(profile))}
            current={current}
            onResume={openWorkout}
            skipped={skippedToday(state.slotSkips, cursorFor(state).revision, today)}
            explainer={planTipShown}
            onDismissExplainer={() => setPlanTipShown(false)}
          />
        )}
        {tab === 'progress' && (
          <ProgressScreen
            history={state.history}
            unit={unit}
            loads={profile?.loads}
            onBackup={() => setSheet({ kind: 'backup' })}
            onCorrect={correctSet}
            onDelete={(workoutId) => setSheet({ kind: 'delete-workout', workoutId })}
            onFeedback={saveFeedback}
            running={Boolean(current)}
            // (#294) The empty state's one action: today's preview, as Today's Preview button, or resume.
            onStartToday={current ? openWorkout : () => setSheet({ kind: 'preview' })}
            startDisabled={liveProgram.exercises.length === 0}
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
      {/* (#295) Problems sit at the top of the screen until resolved; a passing Heads-up joins them
          off Today (Today shows it in its own flow, one card at a time). */}
      {(conflict || (saveUi.kind === 'error' && !conflict) || (notice && !heldLive && (notice.kind === 'problem' || (notice.kind === 'headsUp' && !onToday)))) && (
        <div className="app-alerts">
          {conflict && (
            <NoticeCard
              kind="problem"
              title="Newer data in another tab."
              actions={<button className="notice-card__fix" onClick={() => window.location.reload()}>Reload</button>}
            >
              <p className="notice-card__body">{conflict} Reload to load the newer data, or export this tab first.</p>
            </NoticeCard>
          )}
          {saveUi.kind === 'error' && !conflict && (
            <NoticeCard
              kind="problem"
              title="Not saved."
              actions={
                <>
                  <button className="notice-card__fix" onClick={attemptSave}>Retry</button>
                  <button className="notice-card__alt" onClick={() => setSheet({ kind: 'settings' })}>Data</button>
                </>
              }
            >
              <p className="notice-card__body">{saveUi.message}</p>
            </NoticeCard>
          )}
          {/* (#327) A held jump's Heads-up shows under the row it was typed in, not up here. */}
          {notice && !heldLive && (notice.kind === 'problem' || (notice.kind === 'headsUp' && !onToday)) && (
            <MessageCard
              notice={notice}
              onDismiss={() => setNotice(null)}
              actions={liveCarry !== null && liveCarry.message === notice.text ? <button className="notice-card__fix" onClick={undoLastCarry}>Undo</button> : undefined}
            />
          )}
        </div>
      )}

      {activeScreen}

      {toastUp && notice && (
        <DoneToast
          notice={notice}
          screen={screen}
          top={onToday && !problemUp}
          action={liveCarry !== null && liveCarry.message === notice.text ? { label: 'Undo', onClick: undoLastCarry }
            : laterUndo !== null && laterUndo.message === notice.text ? { label: 'Undo', onClick: undoLater } : undefined}
        />
      )}

      {sheet.kind === 'length' && profile && (
        <DurationSheet
          options={lengthOptions(defaultProgram, constraints, profile.exclusions ?? [], profile.sessionMinutes ?? 35, (minutes) => programFor({ ...constraints, minutes }), profile.goal, fitPairing)}
          current={constraints.minutes}
          onClose={closeSheet}
          onPick={pickLength}
        />
      )}

      {sheet.kind === 'gym' && profile && (
        <GymSheet
          options={setupOptions(program, constraints, profile.exclusions ?? [], profile.goal, (choice) => (choice === 'home' && !constraints.focus ? homeProgram : programFor({ ...constraints, equipment: choice })), fitPairing)}
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
          preview={previewPick}
          recovery={recoveryLabels(state.history, today)}
          shade={bodyShade(state.history, today)}
          onBuild={buildPick}
          onPlanToday={openPlanToday}
          onChangeGear={() => setSheet({ kind: 'gym' })}
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
          onInstall={() => setSheet({ kind: 'install', from: 'settings' })}
          onFeedback={() => openFeedback('settings')}
          onClose={closeSheet}
          storageNote={storageNote}
        />
      )}

      {sheet.kind === 'feedback' && (
        <FeedbackSheet
          draft={feedbackDraft}
          status={feedbackStatus}
          onDraft={(draft) => {
            if (feedbackSending.current) return;
            setFeedbackDraft(draft);
            setFeedbackStatus('idle');
          }}
          onSend={() => {
            if (feedbackSending.current || !feedbackDraft.message.trim()) return;
            feedbackSending.current = true;
            setFeedbackStatus('sending');
            const sent = feedbackDraft;
            let store: Storage | null = null;
            try {
              store = globalThis.localStorage ?? null;
            } catch {
              // Blocked storage: the note still goes with an ID for this send.
            }
            void sendFeedback({
              ...sent,
              appVersion: appVersion(),
              screen: sheet.from,
              device: deviceKind(currentDevice()),
              workoutCount: finishedWorkouts(state.history).length,
              testerId: testerId(store),
            }).then((result) => {
              feedbackSending.current = false;
              if (result.ok) {
                // Fields are read-only while sending; the guard still never clears a different note.
                setFeedbackDraft((current) => (current.message === sent.message ? { ...current, message: '' } : current));
                setFeedbackStatus('sent');
              } else {
                setFeedbackStatus('failed');
              }
            }).catch(() => {
              // (#330) A rejected send ends as "Not sent" with the text kept, never stuck read-only.
              feedbackSending.current = false;
              setFeedbackStatus('failed');
            });
          }}
          onClose={sheet.from === 'settings' ? () => setSheet({ kind: 'settings' }) : closeSheet}
        />
      )}

      {sheet.kind === 'install' && typeof window !== 'undefined' && installGuide(currentDevice()) && (
        <InstallSheet
          guide={installGuide(currentDevice())!}
          workouts={backupCount(state.history)}
          onBackup={backupNow}
          onClose={sheet.from === 'settings' ? () => setSheet({ kind: 'settings' }) : closeSheet}
        />
      )}

      {sheet.kind === 'backup' && (
        <BackupSheet workouts={backupCount(state.history)} onBackup={backupNow} onClose={closeSheet} />
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
          const doneSets = exercise.performed.filter((set) => set.done).length;
          return (
            <ExerciseActionsSheet
              exerciseId={exercise.exerciseId}
              exerciseName={exercise.name}
              exerciseIndex={sheet.exerciseIndex}
              exerciseCount={todayExercises.length}
              initialMode={sheet.mode}
              planned={exercise.planned}
              pending={pending}
              done={doneSets}
              history={state.history}
              unit={unit}
              profile={profile}
              inSession={Boolean(current)}
              skipped={Boolean(exercise.skipped)}
              onReplace={() => { track('replace'); setSheet({ kind: 'swap', exerciseIndex: sheet.exerciseIndex }); }}
              onSaveProfile={(patch) => {
                // Closing first: a saved preference can reorder today's preview under the sheet.
                closeSheet();
                patchProfile(patch);
                setNotice(done('Saved for future workouts. Logged sets are unchanged.'));
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
              remaining={exercise.performed.find((set) => !set.done)}
              onSetAll={(value) => setAllRemaining(sheet.exerciseIndex, sheet.exerciseId, value)}
              note={exercise.note}
              onSaveNote={(text) => saveNote(sheet.exerciseIndex, sheet.exerciseId, text)}
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
          pairs={current ? storedPairs(current.exercises) : sessionPairs(todayExercises, profile, adapted.minutes)}
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
