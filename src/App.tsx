import
 { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from './lib/adapt';
import
 type { Constraints, EquipmentChoice } from './lib/adapt';
import
 { createProposal, decideProposalApproval } from './lib/proposal';
import
 type { Proposal, ProposalContext } from './lib/proposal';
import
 { defaultConstraints, withCeiling } from './lib/constraints';
import
 type { ConstraintNotice } from './lib/constraints';
import  { FULL_BODY_A, programSetCount } from './data/flagship';
import { cursorFor, planRevisionOf, planSlots, revisePlan, skipCurrentSlot, slotAt, slotProgram, updateProfile } from './lib/sequence';
import {
  liveAdapted,
  liveExercises,
  progressionLines,
  recapHighlight,
  targetReason,
  goHeavierFloor,
} from './lib/liveProgression';
import { sessionRests } from './lib/sessionTime';
import { leadCompoundId, leadSlotIds } from './lib/progression';
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
import { skipForward, switchOptions } from './lib/switchDay';
import type { SwitchOption } from './lib/switchDay';
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
  DiscardSessionSheet,
  ExerciseActionsSheet,
  FinishSheet,
  SettingsSheet,
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
  | { kind: 'actions'; exerciseId: string; exerciseIndex: number; mode?: 'instructions' | 'history' }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'preview' }
  | { kind: 'why'; exerciseId: string; exerciseIndex: number }
  | { kind: 'finish' }
  | { kind: 'swap'; exerciseIndex: number }
  | { kind: 'confirm'; change: ProfileChange };

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

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL.state);
  const [view, setView] = useState<View>('tabs');
  const [tab, setTab] = useState<Tab>('today');
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const [pending, setPending] = useState<Proposal | null>(null);
  const [pendingNotices, setPendingNotices] = useState<ConstraintNotice[]>([]);
  const [recapId, setRecapId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveUi, setSaveUi] = useState<SaveUi>(() => initialSaveUi(INITIAL));
  // The one feedback write the screens can speak about. It only becomes "saved"
  // when saveState verified the write that carried this answer.
  const [feedbackWrite, setFeedbackWrite] = useState<
    { key: string; kind: 'saving' | 'saved' | 'error' } | null
  >(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // A stored profile means onboarding already happened: a reload must never
  // drop a resumed or just-finished session behind the splash again.
  const [showSplash, setShowSplash] = useState(() => INITIAL.state.profile === null);
  const [recovery, setRecovery] = useState<{ message: string; raw: string } | null>(
    INITIAL.status === 'corrupt'
      ? { message: INITIAL.error ?? 'Saved data could not be read.', raw: INITIAL.raw ?? '' }
      : null,
  );
  // Active-session replacement asks in-app (#19); the native prompt blocked
  // automated renderers and deadlocked a tab.
  const [replacePrompt, setReplacePrompt] = useState<Constraints | null>(null);
  /** First-weight steps skipped in this tab; in memory only, never stored. */
  const [calibrationSkips, setCalibrationSkips] = useState<string[]>([]);

  const appliedProposalRef = useRef<string | null>(null);
  const proposalRevisionRef = useRef(0);
  const revisionRef = useRef(INITIAL.revision);
  const pendingWriteRef = useRef<string | undefined>(undefined);
  const skipSaveRef = useRef(true);
  const adoptingRef = useRef(false);
  const forceSaveRef = useRef(INITIAL.status === 'corrupt');

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
    if (recovery) {
      skipSaveRef.current = false;
      return;
    }
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (adoptingRef.current) {
      adoptingRef.current = false;
      return;
    }
    attemptSave();
  }, [state, recovery, attemptSave]);

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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* ---------- derived ---------- */

  const profile = state.profile;
  const unit = unitOf(profile);
  const today = useMemo(() => new Date(now), [now]);
  const override = useMemo(() => activeOverride(state, today), [state, today]);

  /**
   * Today's constraint state: the approved adaptation, the saved equipment
   * and session length, or the home default before onboarding finishes.
   */
  const constraints: Constraints = useMemo(() => {
    if (!override) return profile ? defaultConstraints(profile) : DEFAULT_CONSTRAINTS;
    return {
      minutes: override.minutes,
      equipment:
        override.choice ?? (override.equipment.includes('Dumbbell') ? 'home' : 'bodyweight'),
      loads: profile && profile.loads.Dumbbell?.length ? profile.loads.Dumbbell : undefined,
    };
  }, [override, profile]);

  const exclusions = profile?.exclusions ?? NO_EXCLUSIONS;
  /** The slot the sequence is up to: the real A/B/C day, not a repeated fixture. */
  const slot = useMemo(
    () => slotAt(state.plan, state.planRevision, state.programCursor),
    [state.plan, state.planRevision, state.programCursor],
  );
  const slotLabel = useMemo(() => {
    const slots = planSlots(state.plan);
    return slot && slots.length > 1 ? `Slot ${slot.index + 1} of ${slots.length}` : undefined;
  }, [slot, state.plan]);
  /**
   * The slot's own program, prescribed from this user's plan and history. One
   * value feeds Today, the review, the logger and the sheets, so no screen can
   * describe work the next one will not ask for.
   */
  /** The slot's day built for a length; longer than the saved length adds work (#17). */
  const programAt = useCallback(
    (minutes?: number) => (profile && slot
      ? slotProgram(minutes ? { ...profile, sessionMinutes: minutes } : profile, slot, state.history)
      : FULL_BODY_A),
    [profile, slot, state.history],
  );
  // A today-only length above the saved one rebuilds the day at that length; a shorter one trims it.
  const longerToday = override && profile && override.minutes > (profile.sessionMinutes ?? 35) ? override.minutes : undefined;
  const program = useMemo(() => programAt(longerToday), [programAt, longerToday]);
  const defaultProgram = useMemo(() => programAt(), [programAt]);
  const adapted = useMemo(
    () => adaptWorkout(program, constraints, exclusions),
    [program, constraints, exclusions],
  );

  /**
   * Today's numbers come from the recorded history, not the program fixture.
   * The shape of the session still comes from the adaptation.
   */
  const liveProgram = useMemo(
    () => (profile ? liveAdapted(adapted, profile, state.history) : adapted),
    [adapted, profile, state.history],
  );

  const pendingAdapted = useMemo(
    () => (pending ? adaptWorkout(program, pending.constraints, exclusions) : null),
    [pending, program, exclusions],
  );

  const current = state.current;
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

  /** The one-line reason behind each computed target, keyed by exercise. */
  const targetNotes = useMemo(() => {
    const notes: Record<string, string> = {};
    if (!profile) return notes;
    const lead = leadCompoundId(liveProgram.exercises.map((exercise) => exercise.exerciseId));
    for (const exercise of liveProgram.exercises) {
      const reason = targetReason(exercise.exerciseId, profile, state.history, unit, exercise.exerciseId === lead);
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
      const floor = goHeavierFloor(exercise.exerciseId, profile, state.history, exercise.exerciseId === lead);
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
  const beginSession = (workout: ReturnType<typeof adaptWorkout>) => {
    // The link back to the slot is what makes completion advance once, and
    // only for the plan it was started under.
    const revision = planRevisionOf(state);
    const cursor = state.programCursor;
    const session = createSession({
      id: uid(),
      name: workout.name,
      dayIndex: slot?.index ?? 0,
      slotId: slot?.id,
      slotSeq: cursor && cursor.revision === revision ? cursor.seq : 0,
      planRevision: revision,
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
    const workout = adaptWorkout(program, next, profile?.exclusions ?? []);
    if (workout.exercises.length === 0) {
      setNotice('No movement in this workout can be done with that setup.');
      return false;
    }
    if (current) {
      // Ask in-app; only an explicit discard reaches the replacement below.
      setReplacePrompt(next);
      return false;
    }
    beginSession(workout);
    return true;
  };

  const startWorkout = () => {
    startSession(constraints);
  };

  /**
   * Skip the slot on offer. Explicit only: nothing skips because a date passed,
   * and a skip is recorded apart from history so it counts as no training.
   */  const skipTodaySlot = () => {
    if (!slot) return;
    if (current) {
      setNotice('Finish or discard the open session before skipping to the next slot.');
      return;
    }
    const offered = cursorFor(state);
    setState((currentState) => skipCurrentSlot(currentState, new Date().toISOString(), offered));
    setNotice('Slot skipped. A skip is not a workout and earns no progression.');
  };

  /** Explicit discard consent from the in-app sheet (#19) runs the replacement once. */
  const discardAndBegin = () => {
    const next = replacePrompt;
    setReplacePrompt(null);
    if (!next) return;
    const workout = adaptWorkout(program, next, profile?.exclusions ?? []);
    if (workout.exercises.length > 0) beginSession(workout);
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
    };
    // An open session keeps its completed sets: the adaptation replaces only
    // the pending prescriptions, so adjusting mid-workout never discards work.
    const workout = adaptWorkout(program, next, profile?.exclusions ?? []);
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
    if (minutes === fallback) {
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
    if (choice === 'home' && constraints.minutes === (profile.sessionMinutes ?? 35)) {
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
      .map((other) => ({ name: other.name, sets: adaptWorkout(slotProgram(profile, other, state.history), constraints, profile.exclusions ?? []).totalSets }))
      .filter((other) => other.sets > 0);
    const chip = SETUPS[constraints.equipment].chip.toLowerCase();
    return fits.length
      ? fits.map((other) => `${other.name} works with ${chip}: ${other.sets} sets.`).join(' ') + ' Switch day to train it.'
      : `No day in your split works with ${chip}.`;
  })();

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
    setState((currentState) => skipForward(currentState, option.offset, new Date().toISOString()));
    setSheet({ kind: 'none' });
    setNotice(`${option.name} is up. Skipped ${option.skips.join(', ')}; a skip earns no progression.`);
  };

  const restoreOriginal = () => {
    setState((currentState) => {
      const original = adaptWorkout(
        program,
        currentState.profile ? defaultConstraints(currentState.profile) : DEFAULT_CONSTRAINTS,
        currentState.profile?.exclusions ?? [],
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
    setNotice('Original remaining work restored. Logged sets were kept.');
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
    if (!window.confirm('Delete this workout? This cannot be undone.')) return;
    setState((currentState) => ({
      ...currentState,
      history: currentState.history.filter((workout) => workout.id !== id),
    }));
    setNotice('Workout deleted.');
  };

  const exportData = () => {
    downloadText(serializeExport(state), exportFilename());
    setNotice('Backup downloaded.');
  };

  const restoreFile = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice('The file could not be read. Nothing changed.');
      return;
    }
    const parsed = parseState(text);
    if (!parsed.ok) {
      setNotice(`Restore rejected: ${parsed.error}`);
      return;
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
    const candidate = swapCandidateFor(target, profile, state.history, state.current, lead);
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: swapPendingExercise(currentState.current, exerciseIndex, candidate) }
        : currentState,
    );
    setSheet({ kind: 'none' });
    setNotice(`${target.name} swapped in for the remaining sets. Completed sets stay put.`);
  };

  const skipCurrentExercise = (exerciseIndex: number) => {
    const name = current?.exercises[exerciseIndex]?.name ?? 'That exercise';
    setState((currentState) => {
      if (!currentState.current) return currentState;
      const skipped = skipExercise(currentState.current, exerciseIndex);
      return skipped === currentState.current ? currentState : { ...currentState, current: skipped };
    });
    setNotice(`${name} skipped for today. Nothing was recorded for it.`);
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
            setRecovery(null);
            setNotice(`Restored ${summary.newWorkouts} workouts.`);
          }}
          onStartFresh={() => {
            if (recovery.raw) backupRaw(recovery.raw);
            revisionRef.current = 0;
            forceSaveRef.current = true;
            setState({ ...EMPTY_STATE });
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
        <SplashScreen onStart={() => setShowSplash(false)} />
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
        profileLoads={state.profile?.loads}
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
        highlight={recapHighlight(recap, state.history, recapLines, unit, state.profile ?? undefined)}
        onViewHistory={() => {
          setView('tabs');
          setTab('progress');
        }}
        onBackToday={() => {
          setView('tabs');
          setTab('today');
        }}
      />
    ) : view === 'library' ? (
      <LibraryScreen
        profile={profile}
        onSave={patchProfile}
        onBack={() => setView('tabs')}
      />
    ) : view === 'adapt' && pendingAdapted && pending ? (
      <AdaptScreen
        originalSets={programSetCount(program)}
        adapted={
          profile ? liveAdapted(pendingAdapted, profile, state.history) : pendingAdapted
        }
        constraints={pending.constraints}
        notices={pendingNotices}
        unit={unit}
        loads={state.profile?.loads}
        history={state.history}
        onStart={() => acceptAdaptation(pending)}
        onEdit={() => {
          setView('tabs');
          setSheet({ kind: 'adjust' });
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
            onAdjust={() => setSheet({ kind: 'adjust' })}
            onOpenLength={() => setSheet({ kind: 'length' })}
            onOpenGym={() => setSheet({ kind: 'gym' })}
            onOpenSwitch={slot ? () => setSheet({ kind: 'switch' }) : undefined}
            alternativeDay={alternativeDay}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: todayExercises[0]?.exerciseId ?? '', exerciseIndex: 0 })
            }
            onRestore={restoreOriginal}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onOpenExercise={(exerciseId, exerciseIndex) => setSheet({ kind: 'actions', exerciseId, exerciseIndex })}
            onReviewChange={(change) => setSheet({ kind: 'confirm', change })}
          />
        )}
        {tab === 'plan' && (            <PlanScreen
            profile={profile}
            program={program}
            slotLabel={slotLabel}
            history={state.history}
            unit={unit}
            now={today}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onViewDay={(dayIndex) => setSheet({ kind: 'day', dayIndex })}
            onOpenLibrary={() => setView('library')}
            onReviewChange={(change) => setSheet({ kind: 'confirm', change })}
          />
        )}
        {tab === 'progress' && (
          <ProgressScreen
            history={state.history}
            unit={unit}
            loads={state.profile?.loads}
            onExport={exportData}
            onCorrect={correctSet}
            onDelete={deleteWorkout}
            onFeedback={saveFeedback}
            onGoTrain={() => setTab('today')}
          />
        )}
        {tab === 'coach' && (
          <CoachScreen
            profile={profile}
            history={state.history}
            program={{ name: current?.name ?? adapted.name, minutes: current?.durationMin ?? adapted.minutes }}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: todayExercises[0]?.exerciseId ?? '', exerciseIndex: 0 })
            }
            onEdit={() => setSheet({ kind: 'settings' })}
          />
        )}
        <TabBar
          active={tab}
          onChange={(next) => {
            setTab(next);
            setView('tabs');
          }}
          workoutAction={{
            ...tabBarAction(current, adapted),
            onActivate: current ? () => setView('train') : startWorkout,
            progress: current
              ? (() => {
                  const sets = current.exercises.flatMap((exercise) => exercise.performed);
                  return sets.length ? sets.filter((set) => set.done).length / sets.length : 0;
                })()
              : undefined,
          }}
        />
      </>
    );

  return (
    <PhoneFrame>
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
          options={lengthOptions(defaultProgram, constraints, profile.exclusions ?? [], profile.sessionMinutes ?? 35, (minutes) => programAt(minutes))}
          current={constraints.minutes}
          onClose={closeSheet}
          onPick={pickLength}
        />
      )}

      {sheet.kind === 'gym' && profile && (
        <GymSheet
          options={setupOptions(program, constraints, profile.exclusions ?? [])}
          current={constraints.equipment}
          dayName={program.name}
          savedGear={isGymKit(profile) ? 'full gym' : [...profile.equipment, ...profile.support].join(', ') || 'none'}
          gymKit={isGymKit(profile)}
          onPick={pickSetup}
          onEditSaved={() => setSheet({ kind: 'settings' })}
          onClose={closeSheet}
        />
      )}

      {sheet.kind === 'switch' && profile && (
        <SwitchSheet
          options={switchOptions(profile, state, state.history, constraints)}
          onPick={pickDay}
          onClose={closeSheet}
        />
      )}

      {sheet.kind === 'adjust' && (
        <AdjustSheet
          constraints={pending?.constraints ?? constraints}
          originalMinutes={program.minutes}
          unit={unit}
          onClose={() => {
            setPending(null);
            setPendingNotices([]);
            closeSheet();
          }}
          onPreview={(next, notices) => {
            setPending(createProposal(next, proposalBase()));
            setPendingNotices(withCeiling(notices, adaptWorkout(program, next, profile?.exclusions ?? [])));
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

      {sheet.kind === 'settings' && (
        <SettingsSheet
          profile={profile}
          onChange={patchProfile}
          onExport={exportData}
          onRestore={restoreFile}
          onClose={closeSheet}
          storageNote={storageNote}
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
              loads={state.profile?.loads}
              reason={targetNotes[exercise.exerciseId]}
              onClose={closeSheet}
            />
          );
        })()}

      {(sheet.kind === 'day' || sheet.kind === 'preview') && (
        <DaySheet
          name={current?.name ?? adapted.name}
          minutes={current?.durationMin ?? adapted.minutes}
          exercises={todayExercises}
          unit={unit}
          history={state.history}
          loads={state.profile?.loads}
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
          const options = (meta ? rankedReplacements(meta, profile, inDay, 6) : []).map((candidate) => ({
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
          nextName={adaptWorkout(program, replacePrompt, profile?.exclusions ?? []).name}
          onDiscard={discardAndBegin}
          onKeep={() => setReplacePrompt(null)}
          onClose={() => setReplacePrompt(null)}
        />
      )}
    </PhoneFrame>
  );
}
