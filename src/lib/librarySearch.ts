import { EXERCISES } from '../data/exercises.ts';
import { loadModeOf, setUnit } from '../data/flagship.ts';
import { LIBRARY, LIBRARY_LINKS, PROMOTED, tierOf, type LibraryGroup, type LibraryLogType, type Tier } from '../data/library.ts';
import type { Exercise, MuscleGroup } from '../types.ts';

/**
 * (#431) The Exercises screen's rows and search: the built-ins (Program tier) and the library rows,
 * one ranked list. Matching is cheap, rendering is not, so the screen computes the whole list once per
 * query and only reveals more of it ("Show more" never searches again).
 */

export interface LibraryEntry {
  id: string;
  name: string;
  muscle: string;
  group: LibraryGroup;
  equipment: string;
  tier: Tier;
  logType: LibraryLogType;
  /** Library rows only: the built-ins carry no level. */
  level?: string;
  /** Built-ins only: the app's own instructions, so their detail needs no download. */
  instructions?: string;
  /** Other names it is found by (a built-in's library duplicates). */
  aliases: string[];
  tags: string[];
}

/** First page and each "Show more". */
export const PAGE = 50;

const PROGRAM_GROUP: Record<MuscleGroup, LibraryGroup> = {
  Chest: 'Chest', Back: 'Back', Shoulders: 'Shoulders', Biceps: 'Arms', Triceps: 'Arms',
  Quads: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs', Calves: 'Legs', Core: 'Core',
};

function programEntry(exercise: Exercise): LibraryEntry {
  return {
    id: exercise.id,
    name: exercise.name,
    muscle: exercise.muscles[0],
    group: PROGRAM_GROUP[exercise.muscles[0]],
    equipment: exercise.equipment,
    tier: 'program',
    logType: loadModeOf(exercise.id),
    instructions: exercise.instructions,
    aliases: LIBRARY_LINKS.get(exercise.id) ?? [],
    tags: [...exercise.muscles, ...exercise.needs],
  };
}

/** Every row the screen lists: the built-ins, then the library once its index has loaded. */
export function libraryEntries(promoted: ReadonlySet<string> = PROMOTED): LibraryEntry[] {
  return [
    ...EXERCISES.map(programEntry),
    ...[...LIBRARY.values()].map((row) => ({
      id: row.id, name: row.name, muscle: row.muscle, group: row.group, equipment: row.equipment,
      tier: tierOf(row.id, promoted), logType: row.logType, level: row.level, aliases: [], tags: [...row.tags, row.category],
    })),
  ];
}

/** Short forms lifters type. */
export const SYNONYMS: Record<string, string> = {
  db: 'dumbbell',
  bb: 'barbell',
  ohp: 'overhead press',
  rdl: 'romanian deadlift',
};

const stem = (word: string) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const words = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(stem);

function queryWords(query: string): string[] {
  return words(query).flatMap((word) => (SYNONYMS[word] ? words(SYNONYMS[word]) : [word]));
}

/** 0 exact name, 1 name starts with the query, 2 every word in the name, 3 every word anywhere; null no match. */
function matchRank(entry: LibraryEntry, query: string[]): number | null {
  if (query.length === 0) return 0;
  const key = query.join(' ');
  const names = [entry.name, ...entry.aliases].map((name) => words(name));
  if (names.some((name) => name.join(' ') === key)) return 0;
  if (names.some((name) => name.join(' ').startsWith(key))) return 1;
  const hasAll = (pool: string[]) => query.every((word) => pool.some((item) => item.startsWith(word)));
  if (names.some(hasAll)) return 2;
  const pool = [...names.flat(), ...[entry.muscle, entry.equipment, ...entry.tags].flatMap(words)];
  return hasAll(pool) ? 3 : null;
}

const TIER_RANK: Record<Tier, number> = { program: 0, promoted: 0, catalog: 1 };

/**
 * The ranked list for a query and a muscle chip: Program and Promoted first, then exact, prefix and
 * all-words matches, then by name.
 */
export function searchLibrary(entries: LibraryEntry[], query: string, group: LibraryGroup | 'All' = 'All'): LibraryEntry[] {
  const q = queryWords(query);
  const ranked: { entry: LibraryEntry; rank: number }[] = [];
  for (const entry of entries) {
    if (group !== 'All' && entry.group !== group) continue;
    const rank = matchRank(entry, q);
    if (rank !== null) ranked.push({ entry, rank });
  }
  ranked.sort((a, b) => TIER_RANK[a.entry.tier] - TIER_RANK[b.entry.tier] || a.rank - b.rank || a.entry.name.localeCompare(b.entry.name));
  return ranked.map((item) => item.entry);
}

/** The detail screen's "You log" fact. */
export const LOG_LABEL: Record<LibraryLogType, string> = {
  each: 'Weight each × reps',
  total: 'Weight × reps',
  none: 'Reps',
  free: 'Reps, optional weight and a note',
};

/** "You log" for a row, as the logger does: a built-in hold and (#432) a Stretching row log seconds. */
export const youLog = (entry: LibraryEntry): string =>
  (entry.tier === 'program' && setUnit(entry.id) === 'seconds') || (entry.tier !== 'program' && entry.group === 'Stretching')
    ? 'Seconds'
    : LOG_LABEL[entry.logType];
