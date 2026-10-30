import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadText } from './lib/download';
import { buildPlan } from './lib/generator';
import { activeOverride, dayKey, minutesOf } from './lib/plan';
import {
  adaptWorkout,
  DEFAULT_CONSTRAINTS,
  loadOptions,
  toWorkoutExercises,
} from './lib/adapt';
import type { Constraints, EquipmentChoice } from './lib/adapt';
import { defaultConstraints } from './lib/constraints';
import type { ConstraintNotice } from './lib/constraints';
import { FULL_BODY_A, programSetCount } from './data/flagship';
import {
  applyCancel,
  applyCorrection,
  applyFinish,
  createSession,
  extendRest,
  latestDoneSet,
  logSet,
  sessionProgress,
  swapPendingExercise,
  toggleRestPause,
  updatePerformedSet,
} from './lib/session';
import type { SwapCandidate } from './lib/session';
import {
  EMPTY_STATE,
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
import { unitOf } from './lib/units';
import { prescribeExercise } from './lib/progression';
import { EXERCISES, exerciseById } from './data/exercises';
import { capabilitiesFor, provides } from './lib/capabilities';
import type {
  AppState,
  PerformedSet,
  Profile,
  TodayOverride,
} from './types';
import { PhoneFrame, TabBar } from './components/ui/Chrome';
import type { Tab } from './components/ui/Chrome';
import TodayScreen from './screens/TodayScreen';
import PlanScreen from './screens/PlanScreen';
import ProgressScreen from './screens/ProgressScreen';
import CoachScreen from './screens/CoachScreen';
import TrainScreen from './screens/TrainScreen';
import RecapScreen from './screens/RecapScreen';
import LibraryScreen from './screens/LibraryScreen';
import AdaptScreen from './screens/AdaptScreen';
import Onboarding from './components/Onboarding';
import SplashScreen from './screens/SplashScreen';
import Recovery from './components/Recovery';
import {
  AdjustSheet,
  DaySheet,
  ExerciseSheet,
  FinishSheet,
  SettingsSheet,
  SwapSheet,
  WhySheet,
} from './screens/Sheets';

type View = 'tabs' | 'train' | 'recap' | 'library' | 'adapt';

type SheetState =
  | { kind: 'none' }
  | { kind: 'adjust' }
  | { kind: 'settings' }
  | { kind: 'exercise'; exerciseId: string }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'why'; exerciseId: string }
  | { kind: 'finish' }
  | { kind: 'swap'; exerciseIndex: number };

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
  const [pending, setPending] = useState<Constraints | null>(null);
  const [pendingNotices, setPendingNotices] = useState<ConstraintNotice[]>([]);
  const [recapId, setRecapId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveUi, setSaveUi] = useState<SaveUi>(() => initialSaveUi(INITIAL));
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

  const revisionRef = useRef(INITIAL.revision);
  const skipSaveRef = useRef(true);
  const adoptingRef = useRef(false);
  const forceSaveRef = useRef(INITIAL.status === 'corrupt');

  /* ---------- persistence ---------- */

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
    const result = saveState(state, revisionRef.current, { force: forceSaveRef.current });
    if (result.ok) {
      forceSaveRef.current = false;
      revisionRef.current = result.revision;
      setSaveUi({ kind: 'saved' });
      setConflict(null);
    } else {
      setSaveUi({ kind: 'error', reason: result.reason, message: result.error });
      if (result.reason === 'stale') setConflict(result.error);
    }
  }, [state, recovery]);

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
      adoptingRef.current = true;
      revisionRef.current = loaded.revision;
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
  const minutes = profile ? minutesOf(profile, override) : 35;

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
    };
  }, [override, profile]);

  const exclusions = profile?.exclusions ?? NO_EXCLUSIONS;
  const adapted = useMemo(
    () => adaptWorkout(FULL_BODY_A, constraints, exclusions),
    [constraints, exclusions],
  );

  const pendingAdapted = useMemo(
    () => (pending ? adaptWorkout(FULL_BODY_A, pending, exclusions) : null),
    [pending, exclusions],
  );

  const current = state.current;
  /**
   * The workout Today is showing, expressed as the logger's model: the live
   * session when one exists, otherwise today's adapted program. Sheets read
   * this instead of the generated plan, so they can never describe a movement
   * that is not on screen.
   */
  const todayExercises = useMemo(
    () => current?.exercises ?? toWorkoutExercises(adapted),
    [current, adapted],
  );
  const recap = recapId ? state.history.find((workout) => workout.id === recapId) ?? null : null;

  const storageNote =
    saveUi.kind === 'error'
      ? saveUi.message ?? 'The last change is not saved.'
      : `Records are stored in this browser. Last write: ${
          saveUi.kind === 'saved' ? 'verified' : 'no changes yet'
        }.`;

  /* ---------- actions ---------- */

  const patchProfile = (patch: Partial<Profile>) => {
    setState((currentState) =>
      currentState.profile
        ? { ...currentState, profile: { ...currentState.profile, ...patch } }
        : currentState,
    );
  };

  const completeOnboarding = (nextProfile: Profile) => {
    setState((currentState) => ({
      ...currentState,
      profile: nextProfile,
      plan: buildPlan(nextProfile),
      current: null,
      todayOverride: null,
    }));
    setTab('today');
  };

  /**
   * Starting is always built from the same engine output the screens showed,
   * so the preview, the review and the logger can never disagree.
   */
  const startSession = (next: Constraints): boolean => {
    const workout = adaptWorkout(FULL_BODY_A, next, profile?.exclusions ?? []);
    if (workout.exercises.length === 0) {
      setNotice('No movement in this workout can be done with that setup.');
      return false;
    }
    if (
      current &&
      !window.confirm(
        `"${current.name}" is still in progress. Discard it and start "${workout.name}"? Logged sets from the active session will be lost.`,
      )
    ) {
      return false;
    }
    const session = createSession({
      id: uid(),
      name: workout.name,
      dayIndex: 0,
      exercises: toWorkoutExercises(workout),
      now: new Date().toISOString(),
      durationMin: workout.minutes,
    });
    setState((currentState) => ({ ...currentState, current: session }));
    setView('train');
    return true;
  };

  const startWorkout = () => {
    startSession(constraints);
  };

  /** Review changes → start: persist today's adaptation, then open the session. */
  const acceptAdaptation = (next: Constraints) => {
    if (!startSession(next)) return;
    setPendingNotices([]);
    const choice: EquipmentChoice = next.equipment;
    const approved: TodayOverride = {
      date: dayKey(new Date()),
      minutes: next.minutes,
      equipment: choice === 'home' || choice === 'hotel' ? ['Dumbbell'] : [],
      support: [],
      appliedAt: new Date().toISOString(),
      choice,
    };
    setState((currentState) => ({ ...currentState, todayOverride: approved }));
    setPending(null);
    setSheet({ kind: 'none' });
  };

  const restoreOriginal = () => {
    setState((currentState) => ({ ...currentState, todayOverride: null }));
    setNotice('Original workout restored. Your program never changed.');
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

  const logNext = () => {
    const stamp = new Date().toISOString();
    setState((currentState) => {
      const session = currentState.current;
      if (!session) return currentState;
      const exerciseIndex = session.exercises.findIndex((exercise) =>
        exercise.performed.some((set) => !set.done),
      );
      if (exerciseIndex === -1) return currentState;
      const setIndex = session.exercises[exerciseIndex].performed.findIndex((set) => !set.done);
      return { ...currentState, current: logSet(session, exerciseIndex, setIndex, stamp) };
    });
  };

  const closeSheet = () => setSheet({ kind: 'none' });

  /** Confirmation only asks when work is still outstanding. */
  const requestFinish = () => {
    if (current) {
      const progress = sessionProgress(current);
      if (progress.total > 0 && progress.done === progress.total) {
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
    setNotice(early ? 'Saved the completed sets. Unfinished work was not recorded.' : 'Session saved to history.');
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
  ) => {
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
      `Restored ${merged.summary.newWorkouts} workout${merged.summary.newWorkouts === 1 ? '' : 's'}; ${merged.summary.duplicateWorkouts} already present.`,
    );
  };

  const toggleExclusion = (exerciseId: string) => {
    if (!profile) return;
    const has = profile.exclusions.includes(exerciseId);
    patchProfile({
      exclusions: has
        ? profile.exclusions.filter((value) => value !== exerciseId)
        : [...profile.exclusions, exerciseId],
    });
  };

  const swapExercise = (exerciseIndex: number, nextExerciseId: string) => {
    if (!profile) return;
    const target = EXERCISES.find((exercise) => exercise.id === nextExerciseId);
    if (!target) return;
    // The replacement's own prescription only; the session action decides how
    // many sets it receives and keeps every completed set where it is.
    // A swap-back first sees the load already logged in the open session, so
    // the segment cannot render as bodyweight with a first-time rep target.
    const open = state.current ? latestDoneSet(state.current, target.id) : null;
    const prescription = open ?? prescribeExercise(target, profile, state.history);
    const candidate: SwapCandidate = {
      exerciseId: target.id,
      name: target.name,
      weight: prescription.weight,
      reps: prescription.reps,
    };
    setState((currentState) =>
      currentState.current
        ? { ...currentState, current: swapPendingExercise(currentState.current, exerciseIndex, candidate) }
        : currentState,
    );
    setSheet({ kind: 'none' });
    setNotice(`${target.name} swapped in for the remaining sets. Completed sets stay put.`);
  };

  /* ---------- render ---------- */

  if (recovery) {
    return (
      <PhoneFrame>
        <Recovery
          error={recovery.message}
          raw={recovery.raw}
          onDownload={() => downloadText(recovery.raw, 'fitbod-original-state.json')}
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

  const activeScreen =
    view === 'train' && current ? (
      <TrainScreen
        session={current}
        history={state.history}
        now={now}
        loadOptions={loadOptions(constraints.equipment)}
        unit={unit}
        onMinimize={() => {
          setView('tabs');
          setTab('today');
        }}
        onFinish={requestFinish}
        onUpdateSet={updateSet}
        onLogNext={logNext}
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
        onSwap={(exerciseIndex) => setSheet({ kind: 'swap', exerciseIndex })}
      />
    ) : view === 'recap' && recap ? (
      <RecapScreen
        workout={recap}
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
        exclusions={profile.exclusions}
        onToggleExclusion={toggleExclusion}
        onBack={() => setView('tabs')}
      />
    ) : view === 'adapt' && pendingAdapted && pending ? (
      <AdaptScreen
        originalSets={programSetCount(FULL_BODY_A)}
        adapted={pendingAdapted}
        constraints={pending}
        notices={pendingNotices}
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
            program={FULL_BODY_A}
            adapted={adapted}
            equipment={constraints.equipment}
            adjusted={Boolean(override)}
            history={state.history}
            current={current}
            now={today}
            onStart={startWorkout}
            onResume={() => setView('train')}
            onAdjust={() => setSheet({ kind: 'adjust' })}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: adapted.exercises[0]?.exerciseId ?? '' })
            }
            onRestore={restoreOriginal}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onOpenExercise={(exerciseId) => setSheet({ kind: 'exercise', exerciseId })}
          />
        )}
        {tab === 'plan' && (            <PlanScreen
            profile={profile}
            history={state.history}
            unit={unit}
            now={today}
            onOpenSettings={() => setSheet({ kind: 'settings' })}
            onViewDay={(dayIndex) => setSheet({ kind: 'day', dayIndex })}
            onOpenLibrary={() => setView('library')}
          />
        )}
        {tab === 'progress' && (
          <ProgressScreen
            history={state.history}
            unit={unit}
            onExport={exportData}
            onCorrect={correctSet}
            onDelete={deleteWorkout}
            onGoTrain={() => setTab('today')}
          />
        )}
        {tab === 'coach' && (
          <CoachScreen
            profile={profile}
            history={state.history}
            program={{ name: adapted.name, minutes: adapted.minutes }}
            onWhy={() =>
              setSheet({ kind: 'why', exerciseId: adapted.exercises[0]?.exerciseId ?? '' })
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
            <button onClick={() => setSheet({ kind: 'settings' })}>Data</button>
          </div>
        </div>
      )}

      {activeScreen}

      {sheet.kind === 'adjust' && (
        <AdjustSheet
          constraints={pending ?? constraints}
          originalMinutes={FULL_BODY_A.minutes}
          onClose={() => {
            setPending(null);
            setPendingNotices([]);
            closeSheet();
          }}
          onPreview={(next, notices) => {
            setPending(next);
            setPendingNotices(notices);
            setSheet({ kind: 'none' });
            setView('adapt');
          }}
        />
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

      {sheet.kind === 'exercise' &&
        (() => {
          const planned =
            todayExercises.find((exercise) => exercise.exerciseId === sheet.exerciseId)?.planned ??
            [];
          return (
            <ExerciseSheet
              exerciseId={sheet.exerciseId}
              planned={planned}
              history={state.history}
              unit={unit}
              onClose={closeSheet}
            />
          );
        })()}

      {sheet.kind === 'why' &&
        (() => {
          const exercise = todayExercises.find((item) => item.exerciseId === sheet.exerciseId);
          if (!exercise) return null;
          return (
            <WhySheet
              exerciseId={exercise.exerciseId}
              exerciseName={exercise.name}
              planned={exercise.planned}
              history={state.history}
              unit={unit}
              onClose={closeSheet}
            />
          );
        })()}

      {sheet.kind === 'day' && (
        <DaySheet
          name={adapted.name}
          minutes={minutes}
          exercises={todayExercises}
          unit={unit}
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
          const caps = capabilitiesFor(profile);
          const options = EXERCISES.filter(
            (candidate) =>
              candidate.id !== exercise.exerciseId &&
              (!meta || candidate.pattern === meta.pattern) &&
              provides(caps, candidate.needs) &&
              !profile.exclusions.includes(candidate.id),
          ).map((candidate) => ({
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
    </PhoneFrame>
  );
}
