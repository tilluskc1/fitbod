import { EXERCISES } from '../data/exercises.ts';
import type { Exercise, MovementPattern, MuscleGroup, PlanDay } from '../types.ts';
import {
  BODYWEIGHT,
  FAMILIES,
  LICENCES,
  isAdditionId,
  validRow,
  type EquipmentRow,
  type Licence,
  type Row,
} from './additions.ts';
import { GYM_GROUPS, GYM_ITEMS, GYM_ITEM_IDS } from '../data/gymItems.ts';
import { isRelevantToDay } from './feasibility.ts';
import { buildPlan } from './generator.ts';

/**
 * (#360) The admin's Exercises and Equipment pages, as pure functions: the form's draft, what blocks a
 * publish, the coach check and the Firestore fields. The page (src/admin/CatalogPage.tsx) only renders.
 */

export type Status = 'draft' | 'published' | 'unpublished';

/** The movement patterns the planner knows (the built-in catalog's own): the admin's pick list. */
export const PATTERNS: MovementPattern[] = [...new Set(EXERCISES.map((exercise) => exercise.pattern))];
export const ADDITION_GROUPS = GYM_GROUPS.filter((group) => group !== 'Stations');
export const BUILT_IN_IDS = new Set([...EXERCISES.map((exercise) => exercise.id), ...GYM_ITEM_IDS]);

export interface Draft {
  kind: Row['kind'];
  id: string;
  status: Status;
  name: string;
  primary: MuscleGroup | '';
  secondary: MuscleGroup[];
  pattern: MovementPattern | '';
  item: string;
  instructions: string;
  /** One cue per line. */
  cues: string;
  photo?: string;
  video?: string;
  source: string;
  licence: Licence | '';
  credit: string;
  family: EquipmentRow['family'] | '';
  group: EquipmentRow['group'] | '';
}

export interface Entry {
  row: Row;
  status: Status;
}

export const emptyDraft = (kind: Row['kind']): Draft => ({
  kind, id: '', status: 'draft', name: '', primary: '', secondary: [], pattern: '', item: BODYWEIGHT,
  instructions: '', cues: '', source: '', licence: '', credit: '', family: '', group: '',
});

export function draftOf(entry: Entry): Draft {
  const { row, status } = entry;
  if (row.kind === 'equipment') return { ...emptyDraft('equipment'), id: row.id, status, name: row.name, family: row.family, group: row.group };
  return {
    ...emptyDraft('exercise'), id: row.id, status, name: row.name, primary: row.muscles[0], secondary: row.muscles.slice(1),
    pattern: row.pattern, item: row.item, instructions: row.instructions, cues: row.cues.join('\n'),
    photo: row.photo, video: row.video, source: row.source ?? '', licence: row.licence ?? '', credit: row.credit ?? '',
  };
}

/** `add-` and the name in lower-case words: "Landmine Press" is `add-landmine-press`. */
export const idFor = (name: string) => {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return slug ? `add-${slug}` : '';
};

const cueList = (cues: string) => cues.split('\n').map((cue) => cue.trim()).filter(Boolean);

/** The plain row the draft would publish (validated by `validRow`, like the phone does). */
export function rowOf(draft: Draft): Record<string, unknown> {
  const name = draft.name.trim();
  if (draft.kind === 'equipment') return { kind: 'equipment', id: draft.id, name, family: draft.family, group: draft.group };
  const media = draft.photo || draft.video;
  return {
    kind: 'exercise', id: draft.id, name, muscles: draft.primary ? [draft.primary, ...draft.secondary.filter((m) => m !== draft.primary)] : [],
    pattern: draft.pattern, item: draft.item, instructions: draft.instructions.trim(), cues: cueList(draft.cues),
    ...(draft.photo ? { photo: draft.photo } : {}),
    ...(draft.video ? { video: draft.video } : {}),
    ...(media ? { source: draft.source.trim(), licence: draft.licence, credit: draft.credit.trim() } : {}),
  };
}

const DAY_ORDER = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body'];

/**
 * The coach check: the split days the planner would place this exercise on, from the planner's own
 * `buildPlan` and `isRelevantToDay`, across every split (2 to 6 days). "Upper A" and "Upper B" read Upper.
 */
export function appearsIn(muscles: MuscleGroup[], pattern: MovementPattern | ''): string[] {
  if (!muscles.length || !pattern) return [];
  const exercise = { muscles, pattern, secondaryPatterns: [] } as unknown as Exercise;
  const days = new Set<string>();
  for (let daysPerWeek = 2; daysPerWeek <= 6; daysPerWeek += 1) {
    for (const day of buildPlan({ daysPerWeek } as Parameters<typeof buildPlan>[0]) as PlanDay[]) {
      if (isRelevantToDay(exercise, day)) days.add(day.name.replace(/ [AB]$/, '').replace('Full Body', 'Full body'));
    }
  }
  return DAY_ORDER.filter((day) => days.has(day));
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX = 1024 * 1024;
export const VIDEO_MAX = 10 * 1024 * 1024;
export const VIDEO_SECONDS = 15;

/** Why a chosen file can't be used, or null. `seconds` is the video's length as the browser read it. */
export function fileProblem(kind: 'photo' | 'video', file: { type: string; size: number }, seconds?: number): string | null {
  if (kind === 'photo') {
    if (!PHOTO_TYPES.includes(file.type)) return 'Photos must be JPG, PNG or WebP.';
    return file.size > PHOTO_MAX ? 'This photo is over 1 MB.' : null;
  }
  if (file.type !== 'video/mp4') return 'Videos must be MP4.';
  if (file.size > VIDEO_MAX) return 'This video is over 10 MB.';
  if (seconds === undefined || !Number.isFinite(seconds)) return "Couldn't read the video's length.";
  return seconds > VIDEO_SECONDS ? 'This video is over 15 seconds.' : null;
}

export const extensionOf = (type: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' })[type] ?? '';

const BUILT_IN_NAMES = new Set([...EXERCISES.map((e) => e.name), ...GYM_ITEMS.map((item) => item.label)].map((name) => name.toLowerCase()));

/**
 * Everything that stops this draft from publishing, in the form's order. Empty means it can publish.
 * `isNew`: not saved yet, so its id must be free. `entries`: the catalog as the admin sees it.
 */
export function publishProblems(draft: Draft, entries: Entry[], isNew: boolean): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  const id = isNew ? idFor(name) : draft.id;
  if (name.length < 2) problems.push('Add a name.');
  else if (BUILT_IN_NAMES.has(name.toLowerCase()) || BUILT_IN_IDS.has(id) || !isAdditionId(id)) problems.push(`${name} is already built in. Pick another name.`);
  else if (isNew && entries.some((entry) => entry.row.id === id)) problems.push(`${name} is already in this list.`);
  if (draft.kind === 'equipment') {
    if (!draft.family) problems.push('Pick the equipment family.');
    if (!draft.group) problems.push('Pick the My gym group.');
  } else {
    if (!draft.primary) problems.push('Pick the primary muscle.');
    if (!draft.pattern) problems.push('Pick the movement pattern.');
    if (!draft.instructions.trim()) problems.push('Add instructions.');
    if (cueList(draft.cues).length > 5) problems.push('Keep cues to 5 lines.');
    const gear = entries.find((entry) => entry.row.id === draft.item);
    if (isAdditionId(draft.item) && gear?.status !== 'published') problems.push(`Publish ${gear?.row.name ?? 'its equipment'} first.`);
    if ((draft.photo || draft.video) && (!draft.source.trim() || !draft.licence || !draft.credit.trim())) {
      problems.push('Add the source, licence and credit for the photo or video. No rights, no publish.');
    }
  }
  if (!problems.length && !validRow({ ...rowOf(draft), id })) problems.push('Something in this entry is not valid. Check each field.');
  return problems;
}

/** Equipment that published exercises still use can't be unpublished. */
export function unpublishProblems(row: Row, entries: Entry[]): string[] {
  if (row.kind !== 'equipment') return [];
  const users = entries.filter((entry) => entry.status === 'published' && entry.row.kind === 'exercise' && entry.row.item === row.id);
  return users.length ? [`Unpublish ${users.map((entry) => entry.row.name).join(', ')} first: ${users.length === 1 ? 'it uses' : 'they use'} this equipment.`] : [];
}

type Field = { stringValue: string } | { arrayValue: { values: Field[] } } | { timestampValue: string };
const field = (value: unknown): Field => (Array.isArray(value) ? { arrayValue: { values: value.map(field) } } : { stringValue: String(value) });

/** Firestore fields for a row and its status; `updatedAt` is the save time. */
export function fieldsOf(row: Row, status: Status, at: Date): Record<string, Field> {
  return {
    ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined).map(([key, value]) => [key, field(value)])),
    status: field(status),
    updatedAt: { timestampValue: at.toISOString() },
  };
}

export const LICENCE_LABELS = Object.entries(LICENCES).map(([value, label]) => ({ value: value as Licence, label: label[0].toUpperCase() + label.slice(1) }));
export const FAMILY_LIST = FAMILIES;
