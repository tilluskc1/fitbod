import { EXERCISES } from './exercises.ts';
import { LIBRARY_FILES } from './libraryFiles.ts';
import type { AppState } from '../types.ts';

/**
 * (#431) The exercise library: free-exercise-db's text and tags (scripts/import-library.mjs), read from
 * two static files in public/library/ after the first render, never from the main bundle or localStorage.
 *
 * Three tiers. Program: the built-in `EXERCISES`, the only rows plans, Switch and Replace use. Promoted:
 * library rows on the reviewed allowlist below, ranked with Program in search (empty at launch). Catalog:
 * every other library row, searchable and browsable only.
 *
 * A library row is a `LibraryExercise`, not an `Exercise`: it lives in `LIBRARY`, never in `EXERCISES`
 * (the generator draws from that list), so no planner path can reach one.
 */

/** How a set of the row would be logged; the app's `LoadMode` plus `free` (reps, optional weight, a note). */
export type LibraryLogType = 'each' | 'total' | 'none' | 'free';

/** The list's muscle chips. Display grouping only, not the planner's `MuscleGroup`. */
export const LIBRARY_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Stretching'] as const;
export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];

export interface LibraryExercise {
  /** `lib-f-<upstream id>`; never changes. */
  id: string;
  name: string;
  /** Primary muscle, as upstream names it ("Middle back"). */
  muscle: string;
  group: LibraryGroup;
  /** Display-only equipment label ("Bands", "Medicine ball"); not the planner's `Equipment`. */
  equipment: string;
  logType: LibraryLogType;
  level: string;
  category: string;
  /** Upstream's raw muscles, equipment, category, force and mechanic, for search. */
  tags: string[];
}

export const LIBRARY = new Map<string, LibraryExercise>();
/** A built-in's library duplicates' names ("Pushups" for Push-Up): searched as the built-in, never listed. */
export const LIBRARY_LINKS = new Map<string, string[]>();

/**
 * Promoted tier: library ids reviewed to rank with the built-ins in search. Empty at launch (#431); a row
 * added here still never joins plans, Switch or Replace.
 */
export const PROMOTED: ReadonlySet<string> = new Set<string>([]);

export type Tier = 'program' | 'promoted' | 'catalog';

export function tierOf(id: string, promoted: ReadonlySet<string> = PROMOTED): Tier {
  if (EXERCISES.some((exercise) => exercise.id === id)) return 'program';
  return promoted.has(id) ? 'promoted' : 'catalog';
}

export const isLibraryId = (id: string): boolean => id.startsWith('lib-');

/** A library row by id, once the index has loaded. Built-in ids are `exerciseById`'s. */
export const libraryExerciseById = (id: string): LibraryExercise | undefined => LIBRARY.get(id);

const GROUPS: readonly string[] = LIBRARY_GROUPS;
const LOG_TYPES: readonly string[] = ['each', 'total', 'none', 'free'];
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

/** A row read from the index file, or null when it is off-shape (skipped, never a crash). */
function validRow(raw: unknown): LibraryExercise | null {
  const r = Object(raw) as Record<string, unknown>;
  if (!text(r.id) || !/^lib-f-[A-Za-z0-9_-]+$/.test(r.id) || !text(r.name) || !text(r.muscle) || !text(r.equipment)
    || !GROUPS.includes(r.group as string) || !LOG_TYPES.includes(r.logType as string) || !text(r.level) || !text(r.category)
    || !Array.isArray(r.tags) || !r.tags.every(text)) return null;
  if (EXERCISES.some((exercise) => exercise.id === r.id)) return null;
  return {
    id: r.id, name: r.name, muscle: r.muscle, group: r.group as LibraryGroup, equipment: r.equipment,
    logType: r.logType as LibraryLogType, level: r.level, category: r.category, tags: r.tags as string[],
  };
}

/** Reads a parsed index file into `LIBRARY`. Returns the rows kept. */
export function applyLibraryIndex(index: unknown): number {
  const raw = Object(index) as { rows?: unknown; links?: unknown };
  if (!Array.isArray(raw.rows)) return 0;
  LIBRARY.clear();
  LIBRARY_LINKS.clear();
  for (const item of raw.rows) {
    const row = validRow(item);
    if (row) LIBRARY.set(row.id, row);
  }
  for (const [id, names] of Object.entries(Object(raw.links) as Record<string, unknown>)) {
    if (Array.isArray(names) && EXERCISES.some((exercise) => exercise.id === id)) LIBRARY_LINKS.set(id, names.filter(text));
  }
  return LIBRARY.size;
}

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'json'>>;
const defaultFetch: Fetcher = (url) => fetch(url);

let indexLoad: Promise<boolean> | null = null;
let textLoad: Promise<Record<string, string[]> | null> | null = null;
let textData: Record<string, string[]> | null = null;

export const libraryLoaded = (): boolean => LIBRARY.size > 0;

/**
 * Fetches the index once (the service worker keeps it in `library-v1` for offline). True once loaded;
 * false when it could not be read (offline before the first load), so a retry fetches again.
 */
export function loadLibraryIndex(get: Fetcher = defaultFetch): Promise<boolean> {
  if (libraryLoaded()) return Promise.resolve(true);
  indexLoad ??= get(LIBRARY_FILES.index)
    .then(async (response) => response.ok && applyLibraryIndex(await response.json()) > 0)
    .catch(() => false)
    .then((ok) => {
      if (!ok) indexLoad = null;
      return ok;
    });
  return indexLoad;
}

/** A row's instructions, or null when the text file could not be read. */
export function loadLibraryText(id: string, get: Fetcher = defaultFetch): Promise<string[] | null> {
  if (textData) return Promise.resolve(textData[id] ?? []);
  textLoad ??= get(LIBRARY_FILES.text)
    .then(async (response) => {
      if (!response.ok) return null;
      const body = Object(await response.json()) as { text?: unknown };
      return body.text && typeof body.text === 'object' ? (body.text as Record<string, string[]>) : null;
    })
    .catch(() => null)
    .then((data) => {
      textData = data;
      if (!data) textLoad = null;
      return data;
    });
  return textLoad.then((data) => (data ? (Array.isArray(data[id]) ? data[id].filter((step) => typeof step === 'string') : []) : null));
}

/** Whether saved workouts (finished or open) name a library row. */
export function referencesLibrary(state: Pick<AppState, 'history' | 'current'>): boolean {
  const named = (workout: AppState['current']) => Boolean(workout?.exercises.some((exercise) => isLibraryId(exercise.exerciseId)));
  return named(state.current) || state.history.some(named);
}

/**
 * At boot: loads the index at idle, after the first render, only when saved data names a library row and
 * the phone has not asked to save data. History never waits on it: a record keeps its stored name.
 * Returns a cancel.
 */
export function prefetchLibraryAtIdle(state: Pick<AppState, 'history' | 'current'>): () => void {
  if (typeof window === 'undefined' || !referencesLibrary(state)) return () => {};
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};
  const run = () => void loadLibraryIndex();
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, 2000);
  return () => window.clearTimeout(timer);
}

/** Tests only: forget everything loaded. */
export function resetLibrary(): void {
  LIBRARY.clear();
  LIBRARY_LINKS.clear();
  indexLoad = null;
  textLoad = null;
  textData = null;
}
