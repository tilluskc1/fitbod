import { EXERCISES, MUSCLE_GROUPS } from '../data/exercises.ts';
import { GYM_ITEMS } from '../data/gymItems.ts';
import { ABOUT_CREDITS } from '../lib/about.ts';
import { BODYWEIGHT, LICENCES, isAdditionId, mediaUrl, type Licence } from '../lib/additions.ts';
import { PATTERNS, appearsIn, type Entry, type Status } from '../lib/adminCatalog.ts';
import { exercisePhoto } from '../lib/media.ts';
import type { Equipment, MovementPattern, MuscleGroup } from '../types.ts';

/**
 * (#377) /admin "All exercises": every built-in exercise plus every addition, read-only. Pure functions;
 * `AllExercises.tsx` only renders. Additions come from the page's catalog read: the rows `validRow`
 * accepts, and also any well-formed `add-` exercise whose saved data is partial (lesson 41), so nothing
 * the owner saved vanishes from the list.
 */

export type Tag = 'Built-in' | 'Added' | 'Draft' | 'Unpublished';
const TAG: Record<Status, Tag> = { published: 'Added', draft: 'Draft', unpublished: 'Unpublished' };

export interface ListRow {
  id: string;
  name: string;
  tag: Tag;
  /** Primary first. Only muscles the app knows. */
  muscles: MuscleGroup[];
  secondaryPatterns: MovementPattern[];
  pattern: MovementPattern | null;
  /** The family the planner reads it as (Bodyweight for none or a support item). */
  equipment: Equipment | 'Unknown';
  /** What it needs, in words: a built-in's capabilities or an addition's My gym item. */
  needs: string;
  photo: string | null;
  instructions: string;
  cues: string[];
  /** Who the photo or video is credited to, or null without media. */
  credit: string | null;
  source: string | null;
  /** Saved data the phone would refuse: listed anyway, flagged. */
  partial: boolean;
}

export const EQUIPMENT_ORDER: Array<ListRow['equipment']> = ['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Bodyweight', 'Unknown'];
/** Built-in photos' credit, from About's own line ("free-exercise-db (public domain)"). */
const BUILT_IN_CREDIT = ABOUT_CREDITS[0].replace(/^Exercise photos: /, '').replace(/\.$/, '');

export const patternLabel = (pattern: string) => pattern[0].toUpperCase() + pattern.slice(1).replace(/_/g, ' ');

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function builtInRows(): ListRow[] {
  return EXERCISES.filter((exercise) => !isAdditionId(exercise.id)).map((exercise) => {
    const photo = exercisePhoto(exercise.id);
    return {
      id: exercise.id, name: exercise.name, tag: 'Built-in', muscles: exercise.muscles, pattern: exercise.pattern,
      secondaryPatterns: exercise.secondaryPatterns ?? [], equipment: exercise.equipment,
      needs: exercise.needs.length ? exercise.needs.join(', ').replace(/-/g, ' ') : 'nothing',
      photo, instructions: exercise.instructions, cues: [], credit: photo ? BUILT_IN_CREDIT : null, source: null, partial: false,
    };
  });
}

/** One addition from its saved fields (a valid row or a partial one). */
function additionRow(fields: Record<string, unknown>, status: Status, gear: Map<string, { name: string; family: Equipment }>, partial: boolean): ListRow {
  const id = fields.id as string;
  const item = text(fields.item);
  const builtInItem = GYM_ITEMS.find((entry) => entry.id === item);
  const added = gear.get(item);
  const equipment: ListRow['equipment'] = !item || item === BODYWEIGHT || builtInItem?.support ? 'Bodyweight'
    : builtInItem?.equipment ?? added?.family ?? 'Unknown';
  const pattern = PATTERNS.includes(fields.pattern as MovementPattern) ? (fields.pattern as MovementPattern) : null;
  const photo = text(fields.photo);
  const licence = LICENCES[fields.licence as Licence];
  const credit = text(fields.credit);
  return {
    id, name: text(fields.name) || id, tag: TAG[status], pattern, secondaryPatterns: [],
    muscles: strings(fields.muscles).filter((muscle): muscle is MuscleGroup => MUSCLE_GROUPS.includes(muscle as MuscleGroup)),
    equipment, needs: item === BODYWEIGHT || !item ? 'nothing' : builtInItem?.label ?? added?.name ?? item,
    photo: photo ? mediaUrl(photo) : null, instructions: text(fields.instructions), cues: strings(fields.cues),
    credit: credit ? (licence ? `${credit} (${licence})` : credit) : null, source: text(fields.source) || null, partial,
  };
}

/**
 * Every exercise, sorted by name. `entries`: the catalog rows the page holds (valid, with any saved this
 * visit). `raw`: every catalog document's plain fields as read, so a partial addition still lists.
 */
export function allExercises(entries: Entry[], raw: Array<Record<string, unknown>>): ListRow[] {
  const gear = new Map(entries.flatMap(({ row }) => (row.kind === 'equipment' ? [[row.id, { name: row.name, family: row.family as Equipment }] as const] : [])));
  const rows = builtInRows();
  const seen = new Set<string>();
  for (const { row, status } of entries) {
    if (row.kind !== 'exercise' || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(additionRow(row as unknown as Record<string, unknown>, status, gear, false));
  }
  for (const fields of raw) {
    if (!isAdditionId(fields.id) || seen.has(fields.id) || fields.kind === 'equipment') continue;
    seen.add(fields.id);
    // Phones only ever read `published`; anything else is not on a phone, so it reads as a draft.
    const status = fields.status === 'published' || fields.status === 'unpublished' ? fields.status : 'draft';
    rows.push(additionRow(fields, status, gear, true));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Unpublished additions list (tagged) but are not counted: phones no longer plan them. */
export function countOf(rows: ListRow[]) {
  const of = (tag: Tag) => rows.filter((row) => row.tag === tag).length;
  const [builtIn, added, draft, unpublished] = [of('Built-in'), of('Added'), of('Draft'), of('Unpublished')];
  return { total: builtIn + added + draft, builtIn, added, draft, unpublished };
}

export interface Filter {
  query: string;
  muscle: MuscleGroup | '';
  pattern: MovementPattern | '';
  equipment: ListRow['equipment'] | '';
}
export const NO_FILTER: Filter = { query: '', muscle: '', pattern: '', equipment: '' };

/** Search matches every typed word in the name, any case. Muscle is the primary one, as the planner reads it. */
export function filterRows(rows: ListRow[], filter: Filter): ListRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => words.every((word) => row.name.toLowerCase().includes(word))
    && (!filter.muscle || row.muscles[0] === filter.muscle)
    && (!filter.pattern || row.pattern === filter.pattern)
    && (!filter.equipment || row.equipment === filter.equipment));
}

/** The filters' pick lists: the app's own vocabularies, equipment as the rows hold it. */
export function filterOptions(rows: ListRow[]) {
  const held = new Set(rows.map((row) => row.equipment));
  return { muscles: [...MUSCLE_GROUPS], patterns: [...PATTERNS], equipment: EQUIPMENT_ORDER.filter((family) => held.has(family)) };
}

/** The planner's days for this exercise: #360's coach check, with a built-in's secondary patterns. */
export const daysFor = (row: ListRow): string[] => appearsIn(row.muscles, row.pattern ?? '', row.secondaryPatterns);
