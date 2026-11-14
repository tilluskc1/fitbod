import { EXERCISES, MUSCLE_GROUPS, RETIRED_EXERCISES, exerciseById } from '../data/exercises.ts';
import { GYM_GROUPS, GYM_ITEMS, GYM_ITEM_IDS, type GymGroup } from '../data/gymItems.ts';
import media from '../data/media.json' with { type: 'json' };
import type { Capability, Equipment, Exercise, GymItemId, MovementPattern, MuscleGroup } from '../types.ts';

/**
 * (#360) Exercises and equipment the owner adds from /admin, published to Firestore `catalog`. The app
 * keeps its built-in list and reads these in at start (see `catalogSync.ts`). One validator serves the
 * admin and the phone, so a row the admin can publish is a row the phone accepts, and a row that drifted
 * in shape is dropped, never a crash.
 */

export { ADDITION_ID, isAdditionId } from './additionId.ts';
import { isAdditionId } from './additionId.ts';

/** Rights the owner may publish under (#254). */
export const LICENCES = { 'own-work': 'own work', cc0: 'CC0', 'cc-by': 'CC BY', 'public-domain': 'public domain' } as const;
export type Licence = keyof typeof LICENCES;

/** Families an equipment addition may join; its My gym group must not be Stations. */
export const FAMILIES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as const;
/** An exercise with no equipment item. */
export const BODYWEIGHT = 'bodyweight';

export interface ExerciseRow {
  kind: 'exercise';
  id: string;
  name: string;
  /** Primary first, as `Exercise.muscles`. */
  muscles: MuscleGroup[];
  pattern: MovementPattern;
  /** A My gym item id (built-in or an equipment addition) or `bodyweight`. */
  item: string;
  instructions: string;
  cues: string[];
  photo?: string;
  video?: string;
  source?: string;
  licence?: Licence;
  credit?: string;
}

export interface EquipmentRow {
  kind: 'equipment';
  id: string;
  name: string;
  family: (typeof FAMILIES)[number];
  group: GymGroup;
}

export type Row = ExerciseRow | EquipmentRow;

const text = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;

/** A Storage path the admin writes: `catalog/<id>/photo-<n>.jpg` (png, webp) or `catalog/<id>/video-<n>.mp4`. */
export const mediaPath = (id: string, value: unknown, kind: 'photo' | 'video'): boolean =>
  typeof value === 'string' && new RegExp(`^catalog/${id}/${kind}-\\d{1,15}\\.(${kind === 'photo' ? 'jpg|png|webp' : 'mp4'})$`).test(value);

/**
 * A plain row (Firestore fields already decoded) or null. Rejects anything off-shape: unknown kind, a
 * built-in or malformed id, a muscle, pattern, family or group outside the app's vocabularies, media
 * without its rights.
 */
export function validRow(raw: unknown): Row | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // The `add-` prefix keeps it off every built-in id (tests/catalog360.test.ts checks the built-ins).
  if (!isAdditionId(r.id) || !text(r.name, 2, 60)) return null;
  const base = { id: r.id, name: r.name.trim() };
  if (r.kind === 'equipment') {
    if (!FAMILIES.includes(r.family as never) || r.group === 'Stations' || !GYM_GROUPS.includes(r.group as never)) return null;
    return { kind: 'equipment', ...base, family: r.family as EquipmentRow['family'], group: r.group as GymGroup };
  }
  if (r.kind !== 'exercise') return null;
  const muscles = r.muscles;
  if (!Array.isArray(muscles) || muscles.length < 1 || muscles.length > 4 || new Set(muscles).size !== muscles.length
    || !muscles.every((muscle) => MUSCLE_GROUPS.includes(muscle))) return null;
  // A pattern the planner already knows: one a built-in exercise has (an addition only ever adds those).
  if (!EXERCISES.some((exercise) => exercise.pattern === r.pattern)) return null;
  if (r.item !== BODYWEIGHT && !isAdditionId(r.item) && !GYM_ITEM_IDS.includes(r.item as GymItemId)) return null;
  if (!text(r.instructions, 1, 600)) return null;
  const cues = r.cues ?? [];
  if (!Array.isArray(cues) || cues.length > 5 || !cues.every((cue) => text(cue, 1, 120))) return null;
  const row: ExerciseRow = {
    kind: 'exercise', ...base, muscles: muscles as MuscleGroup[], pattern: r.pattern as MovementPattern,
    item: r.item as string, instructions: (r.instructions as string).trim(), cues: cues as string[],
  };
  if (r.photo !== undefined || r.video !== undefined) {
    if ((r.photo !== undefined && !mediaPath(row.id, r.photo, 'photo')) || (r.video !== undefined && !mediaPath(row.id, r.video, 'video'))
      || !text(r.source, 1, 300) || !text(r.credit, 1, 120) || !(typeof r.licence === 'string' && r.licence in LICENCES)) return null;
    for (const key of ['photo', 'video', 'source', 'licence', 'credit'] as const) if (r[key] !== undefined) (row as unknown as Record<string, unknown>)[key] = r[key];
  }
  return row;
}

/** Firebase Storage's public download URL for a media path. */
export const BUCKET = 'home-strength.firebasestorage.app';
export const mediaUrl = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;

const capability = (name: string) => name.toLowerCase().replace(' ', '-') as Capability;

/** The planner's view of an exercise row; null when its equipment item is unknown here. */
export function toExercise(row: ExerciseRow): Exercise | null {
  const cues = row.cues.length ? ` ${row.cues.map((cue) => cue.replace(/[.!]?$/, '.')).join(' ')}` : '';
  const base = { id: row.id, name: row.name, muscles: row.muscles, pattern: row.pattern, instructions: row.instructions + cues };
  if (row.item === BODYWEIGHT) return { ...base, equipment: 'Bodyweight', needs: [] };
  const item = GYM_ITEMS.find((entry) => entry.id === row.item);
  if (!item) return null;
  if (item.support) return { ...base, equipment: 'Bodyweight', needs: [capability(item.support)] };
  const family = item.equipment as Equipment;
  return {
    ...base, equipment: family, needs: [capability(family)],
    ...(family === 'Machine' || family === 'Cable' ? { stations: [item.id] } : {}),
  };
}

const MEDIA = media as Record<string, { frames: string[]; video?: string }>;
let credits: string[] = [];

/** About > Credits lines for published additions with media (#254). */
export const additionCredits = () => credits;

let applied = false;

/**
 * Reads the cached catalog in, once, before the first render. Published equipment joins the My gym list,
 * then published exercises join the planner's list (`EXERCISES`). Retired rows (unpublished since this
 * phone cached them) only stay readable: `exerciseById`, the media map and hidden gym items, so history
 * keeps their name and photo while planning, Switch and Replace never offer them.
 */
export function applyRows(published: Row[], retired: Row[]): void {
  if (applied) return;
  applied = true;
  // Equipment first: an exercise may stand on an added item.
  for (const row of [...published, ...retired].sort((a, b) => Number(a.kind === 'exercise') - Number(b.kind === 'exercise'))) {
    const hidden = !published.includes(row);
    if (exerciseById(row.id) || GYM_ITEM_IDS.includes(row.id as GymItemId)) continue;
    if (row.kind === 'equipment') {
      GYM_ITEMS.push({ id: row.id as GymItemId, label: row.name, group: row.group, equipment: row.family, hidden });
      GYM_ITEM_IDS.push(row.id as GymItemId);
      continue;
    }
    const exercise = toExercise(row);
    if (!exercise) continue;
    // Unpublished, or standing on unpublished equipment: history only.
    if (hidden || GYM_ITEMS.find((item) => item.id === row.item)?.hidden) RETIRED_EXERCISES.set(row.id, exercise);
    else EXERCISES.push(exercise);
    if (row.photo || row.video) {
      MEDIA[row.id] = { frames: row.photo ? [mediaUrl(row.photo)] : [], ...(row.video ? { video: mediaUrl(row.video) } : {}) };
      if (!hidden) credits.push(`${row.name}: ${row.credit} (${LICENCES[row.licence!]}).`);
    }
  }
}

/** Tests only: puts the built-in lists back. */
export function resetAdditions(): void {
  applied = false;
  credits = [];
  for (const list of [EXERCISES, GYM_ITEMS] as { id: string }[][]) {
    for (let i = list.length - 1; i >= 0; i -= 1) if (isAdditionId(list[i].id)) list.splice(i, 1);
  }
  for (let i = GYM_ITEM_IDS.length - 1; i >= 0; i -= 1) if (isAdditionId(GYM_ITEM_IDS[i])) GYM_ITEM_IDS.splice(i, 1);
  RETIRED_EXERCISES.clear();
  for (const id of Object.keys(MEDIA)) if (isAdditionId(id)) delete MEDIA[id];
}
