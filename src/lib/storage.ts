import type { AppState, WorkoutRecord } from '../types.ts';
import { validateState } from './validate.ts';

export const STORAGE_KEY = 'fitbod-clone-v1';
export const LEGACY_BACKUP_KEY = 'fitbod-clone-v1:legacy-backup';
export const SCHEMA_VERSION = 2;

const APP_MARKER = 'fitbod-clone';

export const EMPTY_STATE: AppState = {
  profile: null,
  plan: [],
  history: [],
  current: null,
  todayOverride: null,
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
  | { ok: false; reason: SaveFailureReason; error: string; remoteRevision?: number };

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
  if (!options.force) {
    if (current && current.revision !== expectedRevision) {
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
    : expectedRevision;
  const savedAt = new Date().toISOString();
  const envelope: Envelope = {
    app: APP_MARKER,
    schemaVersion: SCHEMA_VERSION,
    revision: baseRevision + 1,
    savedAt,
    state,
  };

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (error) {
    return {
      ok: false,
      reason: isQuotaError(error) ? 'quota' : 'unavailable',
      error: isQuotaError(error)
        ? 'Storage is full. This change is only in this tab until you free space and retry.'
        : 'The browser refused the write. This change is only in this tab until you retry.',
    };
  }

  const check = parseEnvelope(store.getItem(STORAGE_KEY));
  if (!check || check.revision !== envelope.revision || check.savedAt !== savedAt) {
    return {
      ok: false,
      reason: 'verify',
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
  const history: WorkoutRecord[] = [...imported.history, ...localOnly];

  let active = imported.current ?? current.current;
  let activeSessionKept = false;
  if (imported.current && current.current && imported.current.id !== current.current.id) {
    active = current.current;
    activeSessionKept = true;
  }

  return {
    state: {
      profile: imported.profile ?? current.profile,
      plan: imported.plan.length > 0 ? imported.plan : current.plan,
      history,
      current: active,
      todayOverride: current.todayOverride ?? null,
    },
    summary: {
      newWorkouts: imported.history.length - duplicateWorkouts,
      duplicateWorkouts,
      localOnlyWorkouts: localOnly.length,
      profileReplaced: imported.profile !== null,
      planReplaced: imported.plan.length > 0,
      activeSessionKept,
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
