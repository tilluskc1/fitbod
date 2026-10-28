import type { AppState, PerformedSet, WorkoutExercise, WorkoutRecord } from '../types.ts';

function cleanNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function copyExercise(exercise: WorkoutExercise): WorkoutExercise {
  return {
    ...exercise,
    planned: exercise.planned.map((set) => ({ ...set })),
    performed: exercise.performed.map((set) => ({ ...set })),
  };
}

function copyRecord(workout: WorkoutRecord): WorkoutRecord {
  return { ...workout, exercises: workout.exercises.map(copyExercise) };
}

export function createSession(args: {
  id: string;
  name: string;
  dayIndex: number;
  exercises: WorkoutExercise[];
  now: string;
  durationMin?: number;
}): WorkoutRecord {
  return {
    id: args.id,
    date: args.now,
    name: args.name,
    dayIndex: args.dayIndex,
    status: 'active',
    completedEarly: false,
    endedAt: null,
    durationMin: args.durationMin,
    pausedMs: 0,
    pausedAt: null,
    restStartedAt: null,
    restSeconds: 75,
    restPausedAt: null,
    restPausedMs: 0,
    exercises: args.exercises.map(copyExercise),
  };
}

/** Milliseconds since the session started, excluding paused time. */
export function elapsedMs(session: WorkoutRecord, nowMs: number): number {
  const started = Date.parse(session.date);
  if (Number.isNaN(started)) return 0;
  const paused = session.pausedMs ?? 0;
  const pausedAt = session.pausedAt ? Date.parse(session.pausedAt) : null;
  const currentPause = pausedAt !== null && !Number.isNaN(pausedAt) ? Math.max(0, nowMs - pausedAt) : 0;
  return Math.max(0, nowMs - started - paused - currentPause);
}


export function startRest(session: WorkoutRecord, now: string, seconds = 75): WorkoutRecord {
  const next = copyRecord(session);
  next.restStartedAt = now;
  next.restSeconds = Math.max(15, Math.min(600, Math.round(seconds)));
  next.restPausedAt = null;
  next.restPausedMs = 0;
  return next;
}

export function extendRest(session: WorkoutRecord, extraSeconds: number): WorkoutRecord {
  const next = copyRecord(session);
  next.restSeconds = Math.max(0, Math.min(900, (next.restSeconds ?? 75) + extraSeconds));
  return next;
}


/** Pause or resume only the rest countdown, not the session clock. */
export function toggleRestPause(session: WorkoutRecord, now: string): WorkoutRecord {
  if (!session.restStartedAt) return session;
  const next = copyRecord(session);
  if (next.restPausedAt) {
    const pausedFor = Math.max(0, Date.parse(now) - Date.parse(next.restPausedAt));
    next.restPausedMs = (next.restPausedMs ?? 0) + pausedFor;
    next.restPausedAt = null;
  } else {
    next.restPausedAt = now;
  }
  return next;
}

/** Seconds left on the rest clock, or 0 when idle or finished. */
export function restRemaining(session: WorkoutRecord, nowMs: number): number {
  if (!session.restStartedAt) return 0;
  const started = Date.parse(session.restStartedAt);
  if (Number.isNaN(started)) return 0;
  const pausedNow = session.pausedAt ? Math.max(0, nowMs - Date.parse(session.pausedAt)) : 0;
  const restPausedNow = session.restPausedAt
    ? Math.max(0, nowMs - Date.parse(session.restPausedAt))
    : 0;
  const elapsed = (nowMs - started - pausedNow - (session.restPausedMs ?? 0) - restPausedNow) / 1000;
  return Math.max(0, Math.round((session.restSeconds ?? 75) - elapsed));
}

/** Mark a set done and start the rest clock in one immutable step. */
export function logSet(
  session: WorkoutRecord,
  exerciseIndex: number,
  setIndex: number,
  now: string,
  seconds = 75,
): WorkoutRecord {
  const updated = updatePerformedSet(session, exerciseIndex, setIndex, { done: true }, now);
  if (updated === session) return session;
  return startRest(updated, now, seconds);
}

export function updatePerformedSet(
  session: WorkoutRecord,
  exerciseIndex: number,
  setIndex: number,
  patch: Partial<PerformedSet>,
  now: string,
): WorkoutRecord {
  if (!session.exercises[exerciseIndex]?.performed[setIndex]) return session;
  const next = copyRecord(session);
  const set = next.exercises[exerciseIndex].performed[setIndex];
  if (patch.weight !== undefined) set.weight = cleanNumber(patch.weight);
  if (patch.reps !== undefined) set.reps = cleanNumber(patch.reps);
  if (patch.done !== undefined) {
    set.done = patch.done;
    if (patch.done) set.completedAt = patch.completedAt ?? now;
    else set.completedAt = null;
  } else if (patch.completedAt !== undefined) {
    set.completedAt = patch.completedAt;
  }
  return next;
}

export function addPerformedSet(session: WorkoutRecord, exerciseIndex: number): WorkoutRecord {
  if (!session.exercises[exerciseIndex]) return session;
  const next = copyRecord(session);
  const exercise = next.exercises[exerciseIndex];
  const lastPlanned = exercise.planned[exercise.planned.length - 1] ?? { weight: 0, reps: 10 };
  const lastPerformed = exercise.performed[exercise.performed.length - 1];
  exercise.planned.push({ ...lastPlanned });
  exercise.performed.push({
    weight: lastPerformed?.weight ?? lastPlanned.weight,
    reps: lastPerformed?.reps ?? lastPlanned.reps,
    done: false,
    completedAt: null,
  });
  return next;
}

export function removePerformedSet(
  session: WorkoutRecord,
  exerciseIndex: number,
  setIndex: number,
): WorkoutRecord {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise || exercise.planned.length <= 1 || !exercise.performed[setIndex]) return session;
  const next = copyRecord(session);
  next.exercises[exerciseIndex].planned.splice(setIndex, 1);
  next.exercises[exerciseIndex].performed.splice(setIndex, 1);
  return next;
}

export interface SessionProgress {
  total: number;
  done: number;
  volume: number;
  complete: boolean;
}

export function sessionProgress(session: WorkoutRecord): SessionProgress {
  let total = 0;
  let done = 0;
  let volume = 0;
  for (const exercise of session.exercises) {
    for (const set of exercise.performed) {
      total += 1;
      if (set.done) {
        done += 1;
        volume += set.weight * set.reps;
      }
    }
  }
  return { total, done, volume, complete: total > 0 && done === total };
}

/**
 * Turning a session into a completed record is idempotent at the state level:
 * `applyFinish` only accepts the currently active session id, and only
 * prepends history when that id is not already present.
 */
export function completeSession(
  session: WorkoutRecord,
  options: { early: boolean; now: string },
): WorkoutRecord {
  const next = copyRecord(session);
  const progress = sessionProgress(next);
  next.status = 'completed';
  next.endedAt = options.now;
  next.completedEarly = options.early || !progress.complete;
  for (const exercise of next.exercises) {
    for (const set of exercise.performed) {
      if (set.done && !set.completedAt) set.completedAt = options.now;
    }
  }
  return next;
}

export function applyFinish(
  state: AppState,
  sessionId: string,
  options: { early: boolean; now: string },
): AppState {
  if (!state.current || state.current.id !== sessionId) return state;
  const completed = completeSession(state.current, options);
  const alreadyStored = state.history.some((workout) => workout.id === completed.id);
  return {
    ...state,
    history: alreadyStored ? state.history : [completed, ...state.history],
    current: null,
  };
}

export function applyCancel(state: AppState, sessionId: string): AppState {
  if (!state.current || state.current.id !== sessionId) return state;
  return { ...state, current: null };
}

export function applyCorrection(
  state: AppState,
  workoutId: string,
  exerciseIndex: number,
  setIndex: number,
  patch: Partial<PerformedSet>,
  now: string,
): AppState {
  const workout = state.history.find((item) => item.id === workoutId);
  if (!workout) return state;
  const corrected = updatePerformedSet(workout, exerciseIndex, setIndex, patch, now);
  return {
    ...state,
    history: state.history.map((item) => (item.id === workoutId ? corrected : item)),
  };
}
