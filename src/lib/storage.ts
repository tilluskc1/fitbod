import type { AppState, WorkoutRecord } from '../types.ts';
import { APP_MARKER, SCHEMA_VERSION, validateState } from './validate.ts';
export { SCHEMA_VERSION } from './validate.ts';

export const STORAGE_KEY = 'fitbod-clone-v1';
export const LEGACY_BACKUP_KEY = 'fitbod-clone-v1:legacy-backup';

export const EMPTY_STATE: AppState = {
  profile: null,
  plan: [],
  history: [],
  current: null,
  todayOverride: null,
  planRevision: 0,
  programCursor: { revision: 0, seq: 0 },
  slotSkips: [],
};

interface Envelope {
  app: typeof APP_MARKER;
  schemaVersion: number;
  revision: number;
  savedAt: string;
  state: unknown;
}

export interface LoadedState {
  status: 'ok' | 'empty' | 'migrated' | 'corrupt' | 'unavailable';
  state: AppState;
  revision: number;
  error?: string;
  /** Original text, kept so a corrupt blob can be downloaded instead of lost. */
  raw?: string;
}

export type SaveFailureReason = 'stale' | 'quota' | 'unavailable' | 'verify';

export type SaveResult =
  | { ok: true; revision: number; savedAt: string }
  | { ok: false; reason: SaveFailureReason; error: string; remoteRevision?: number; pendingWrite?: string };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    isRecord(value) &&
    value.app === APP_MARKER &&
    typeof value.schemaVersion === 'number' &&
    typeof value.revision === 'number' &&
    typeof value.savedAt === 'string' &&
    'state' in value
  );
}

function parseEnvelope(raw: string | null): Envelope | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
}

/**
 * Read persisted state. Never overwrites unreadable data: a corrupt blob is
 * returned as-is so the UI can offer a download instead of silently resetting.
 * A valid v1 blob is migrated in place, with the original kept under a
 * separate backup key.
 */
export function loadState(): LoadedState {
  const store = storage();
  if (!store) {
    return {
      status: 'unavailable',
      state: EMPTY_STATE,
      revision: 0,
      error: 'Browser storage is unavailable. Changes will not survive a reload.',
    };
  }

  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {
      status: 'unavailable',
      state: EMPTY_STATE,
      revision: 0,
      error: 'Browser storage could not be read. Changes will not survive a reload.',
    };
  }

  if (raw === null) {
    return { status: 'empty', state: EMPTY_STATE, revision: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'corrupt',
      state: EMPTY_STATE,
      revision: 0,
      error: 'Saved data is not valid JSON. Nothing has been overwritten.',
      raw,
    };
  }

  if (isEnvelope(parsed)) {
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return {
        status: 'corrupt',
        state: EMPTY_STATE,
        revision: parsed.revision,
        error: `Saved data uses schema version ${parsed.schemaVersion}; this app understands version ${SCHEMA_VERSION}. Nothing has been overwritten.`,
        raw,
      };
    }
    const result = validateState(parsed.state);
    if (!result.ok) {
      return {
        status: 'corrupt',
        state: EMPTY_STATE,
        revision: parsed.revision,
        error: `Saved data failed validation (${result.error}). Nothing has been overwritten.`,
        raw,
      };
    }
    return { status: 'ok', state: result.state, revision: parsed.revision };
  }

  const result = validateState(parsed);
  if (!result.ok) {
    return {
      status: 'corrupt',
      state: EMPTY_STATE,
      revision: 0,
      error: `Saved data could not be migrated (${result.error}). Nothing has been overwritten.`,
      raw,
    };
  }

  try {
    if (store.getItem(LEGACY_BACKUP_KEY) === null) {
      store.setItem(LEGACY_BACKUP_KEY, raw);
    }
  } catch {
    // Backup is best-effort; the original key is still untouched until the write below.
  }

  const savedAt = new Date().toISOString();
  const migrated: Envelope = {
    app: APP_MARKER,
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    savedAt,
    state: result.state,
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(migrated));
  } catch (error) {
    return {
      status: 'migrated',
      state: result.state,
      revision: 0,
      error: isQuotaError(error)
        ? 'Data was migrated in memory but could not be written (storage quota reached). Export a backup now.'
        : 'Data was migrated in memory but could not be written. Export a backup now.',
      raw,
    };
  }

  return { status: 'migrated', state: result.state, revision: 1, raw };
}

/**
 * Save with an expected revision. A newer stored revision means another tab
 * (or a previous session) wrote data we have not seen; the write is refused
 * rather than clobbering it.
 */
export interface SaveOptions {
  /**
   * Explicit overwrite after the user chose to recover from unreadable data.
   * Revision still moves forward monotonically.
   */
  force?: boolean;
  /** Exact unverified write from this caller; never persisted separately. */
  pendingWrite?: string;
}

export function saveState(
  state: AppState,
  expectedRevision: number,
  options: SaveOptions = {},
): SaveResult {
  const store = storage();
  if (!store) {
    return { ok: false, reason: 'unavailable', error: 'Browser storage is unavailable.' };
  }

  let currentRaw: string | null = null;
  try {
    currentRaw = store.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Browser storage could not be read.' };
  }

  const current = parseEnvelope(currentRaw);
  const ownWrite = current !== null && currentRaw === options.pendingWrite &&
    current.revision > expectedRevision;
  if (ownWrite && JSON.stringify(current.state) === JSON.stringify(state)) {
    return { ok: true, revision: current.revision, savedAt: current.savedAt };
  }
  const acknowledgedRevision = ownWrite ? current.revision : expectedRevision;
  if (!options.force) {
    if (current && current.revision !== acknowledgedRevision) {
      return {
        ok: false,
        reason: 'stale',
        error: 'Another tab saved newer data.',
        remoteRevision: current.revision,
      };
    }
    if (!current && expectedRevision > 0) {
      return {
        ok: false,
        reason: 'stale',
        error: 'Stored data was changed or cleared by another tab.',
        remoteRevision: 0,
      };
    }
  }

  const baseRevision = options.force
    ? Math.max(expectedRevision, current?.revision ?? 0)
    : acknowledgedRevision;
  const savedAt = new Date().toISOString();
  const envelope: Envelope = {
    app: APP_MARKER,
    schemaVersion: SCHEMA_VERSION,
    revision: baseRevision + 1,
    savedAt,
    state,
  };

  const pendingWrite = JSON.stringify(envelope);
  try {
    store.setItem(STORAGE_KEY, pendingWrite);
  } catch (error) {
    return {
      ok: false,
      reason: isQuotaError(error) ? 'quota' : 'unavailable',
      error: isQuotaError(error)
        ? 'Storage is full. This change is only in this tab until you free space and retry.'
        : 'The browser refused the write. This change is only in this tab until you retry.',
    };
  }

  let verified = false;
  try {
    verified = store.getItem(STORAGE_KEY) === pendingWrite;
  } catch {
    // The write may exist; only an exact read on Retry may acknowledge it.
  }
  if (!verified) {
    return {
      ok: false,
      reason: 'verify',
      pendingWrite,
      error: 'The write could not be verified. Treat this change as unsaved.',
    };
  }

  return { ok: true, revision: envelope.revision, savedAt };
}

export interface ImportSummary {
  newWorkouts: number;
  duplicateWorkouts: number;
  localOnlyWorkouts: number;
  profileReplaced: boolean;
  planReplaced: boolean;
  activeSessionKept: boolean;
  /**
   * True when both copies held the same active session id, so the merge had
   * to pick one. Exposed so the restore notice is never silent about which
   * logged work survived.
   */
  activeSessionConflict: boolean;
  /**
   * Duplicate workouts where the imported copy carried no answer but the local
   * copy did. Counted so an older backup keeping retained feedback is visible
   * in the restore notice instead of happening silently.
   */
  feedbackPreserved: number;
}

export interface MergeResult {
  state: AppState;
  summary: ImportSummary;
}

/**
 * Merge a validated import into current state. History is de-duplicated by
 * workout id (restoring the same file twice is a no-op), imported data wins
 * for ids it contains, and an unrelated active session is never discarded.
 */
export function mergeImport(current: AppState, imported: AppState): MergeResult {
  const importedIds = new Set(imported.history.map((workout) => workout.id));
  const currentIds = new Set(current.history.map((workout) => workout.id));
  const duplicateWorkouts = imported.history.filter((workout) => currentIds.has(workout.id)).length;
  const localOnly = current.history.filter((workout) => !importedIds.has(workout.id));
  const localById = new Map(current.history.map((workout) => [workout.id, workout]));
  // An older backup of a workout the user has since rated carries no answer for
  // it. Imported data still wins for every other field, but silently dropping a
  // retained answer is the one thing restore must not do.
  const feedbackPreserved = imported.history.filter((workout) => {
    const local = localById.get(workout.id);
    return Boolean(local && local.feedback !== undefined && workout.feedback === undefined);
  }).length;
  const history: WorkoutRecord[] = [
    ...imported.history.map((workout) => {
      const local = localById.get(workout.id);
      if (!local || local.feedback === undefined || workout.feedback !== undefined) return workout;
      return { ...workout, feedback: local.feedback };
    }),
    ...localOnly,
  ];

  // Completed history disqualifies candidates before choosing which active session to keep.
  const completedIds = new Set(history.map((workout) => workout.id));
  const localActive = current.current && !completedIds.has(current.current.id) ? current.current : null;
  const importedActive = imported.current && !completedIds.has(imported.current.id) ? imported.current : null;
  const activeSessionKept = Boolean(localActive && importedActive && localActive.id !== importedActive.id);
  const activeSessionConflict = Boolean(
    localActive && importedActive && localActive.id === importedActive.id,
  );
  // A backup of the same open session must not roll back sets logged since the
  // export: More above means the older copy only wins when it holds more work.
  const loggedSets = (session: WorkoutRecord | null) =>
    session === null
      ? -1
      : session.exercises.reduce((total, exercise) => total + exercise.performed.filter((set) => set.done).length, 0);
  const active = activeSessionKept
    ? localActive
    : loggedSets(importedActive) > loggedSets(localActive)
      ? importedActive ?? localActive
      : localActive ?? importedActive;

  // The sequence travels with the plan it belongs to. A backup of the same
  // revision can only move the cursor forward; a different plan brings its own.
  const cursorSeq = Math.max(
    current.programCursor?.seq ?? 0,
    imported.programCursor?.seq ?? 0,
  );
  const sameRevision = (current.planRevision ?? 0) === (imported.planRevision ?? 0);

  return {
    state: {
      profile: imported.profile ?? current.profile,
      plan: imported.plan.length > 0 ? imported.plan : current.plan,
      history,
      current: active,
      todayOverride: current.todayOverride ?? null,
      planRevision: imported.plan.length > 0 ? imported.planRevision ?? 0 : current.planRevision ?? 0,
      programCursor: sameRevision
        ? { revision: imported.planRevision ?? current.planRevision ?? 0, seq: cursorSeq }
        : imported.programCursor ?? current.programCursor ?? { revision: 0, seq: 0 },
      slotSkips: imported.slotSkips?.length ? imported.slotSkips : current.slotSkips ?? [],
    },
    summary: {
      newWorkouts: imported.history.length - duplicateWorkouts,
      duplicateWorkouts,
      localOnlyWorkouts: localOnly.length,
      profileReplaced: imported.profile !== null,
      planReplaced: imported.plan.length > 0,
      activeSessionKept,
      activeSessionConflict,
      feedbackPreserved,
    },
  };
}

export interface ExportFile {
  app: typeof APP_MARKER;
  schemaVersion: number;
  exportedAt: string;
  state: AppState;
}

export function serializeExport(state: AppState, now = new Date().toISOString()): string {
  const file: ExportFile = {
    app: APP_MARKER,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    state,
  };
  return JSON.stringify(file, null, 2);
}

export function exportFilename(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `fitbod-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}


export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
