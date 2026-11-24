// (#431) free-exercise-db rows -> the app's exercise library (text and tags only). Pure functions, so
// tests run them on fixture rows; scripts/import-library.mjs feeds them the pinned upstream file.
import { guardRow } from './guard.mjs';

export const SOURCE = {
  repo: 'yuhonas/free-exercise-db',
  commit: 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5',
  licence: 'Unlicense',
};
export const SOURCE_FILE = `https://raw.githubusercontent.com/${SOURCE.repo}/${SOURCE.commit}/dist/exercises.json`;

/** Ids are immutable: `lib-f-<upstream id>`. */
export const libraryId = (upstreamId) => `lib-f-${upstreamId}`;

const title = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Display-only equipment labels. The planner's `Equipment` type is not widened (rule 3). */
const EQUIPMENT_LABEL = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebells: 'Kettlebell',
  'body only': 'Bodyweight',
  bands: 'Bands',
  'medicine ball': 'Medicine ball',
  'exercise ball': 'Exercise ball',
  'foam roll': 'Foam roller',
  'e-z curl bar': 'EZ bar',
  other: 'Other',
};
export const equipmentLabel = (raw) => (raw ? EQUIPMENT_LABEL[raw] ?? title(raw) : 'No equipment');

/** The list's muscle chips: All, Chest, Back, Legs, Shoulders, Arms, Core, Cardio, Stretching. */
const MUSCLE_GROUP = {
  chest: 'Chest',
  lats: 'Back', 'middle back': 'Back', 'lower back': 'Back', traps: 'Back',
  quadriceps: 'Legs', hamstrings: 'Legs', glutes: 'Legs', calves: 'Legs', adductors: 'Legs', abductors: 'Legs',
  shoulders: 'Shoulders', neck: 'Shoulders',
  biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
  abdominals: 'Core',
};
export function groupOf(row) {
  if (row.category === 'cardio') return 'Cardio';
  if (row.category === 'stretching') return 'Stretching';
  return MUSCLE_GROUP[row.primaryMuscles?.[0]] ?? 'Core';
}

/**
 * How a set of this row would be logged (rule 4), named as the app's `LoadMode` plus `free`:
 * `each` weight each x reps (dumbbell), `total` total weight x reps (barbell, EZ bar, machine, cable,
 * kettlebell and medicine ball, as the app logs a kettlebell), `none` reps only (bodyweight, bands, balls,
 * foam roller, other, none), `free` reps + optional weight + a note (cardio, stretching).
 * PR #432 reads it; nothing logs a library row yet.
 */
export function logTypeOf(row) {
  if (row.category === 'cardio' || row.category === 'stretching') return 'free';
  switch (row.equipment) {
    case 'dumbbell':
      return 'each';
    case 'barbell':
    case 'e-z curl bar':
    case 'machine':
    case 'cable':
    case 'kettlebells':
    case 'medicine ball':
      return 'total';
    default:
      return 'none';
  }
}

const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (token) => (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token);
const tokens = (text) => new Set(norm(text).split(' ').filter(Boolean).map(stem));
const compact = (text) => [...tokens(text)].join('');
/** Shared words over the longer name's word count (as `tokenScore` in scripts/fetch-media.mjs). */
const tokenScore = (a, b) => {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.max(1, a.size, b.size);
};
/** Our equipment -> free-exercise-db's (as `eqMap` in scripts/fetch-media.mjs). */
const OUR_EQUIPMENT = {
  Barbell: 'barbell', Dumbbell: 'dumbbell', Machine: 'machine', Cable: 'cable', Kettlebell: 'kettlebells', Bodyweight: 'body only',
};

/**
 * The built-in a row duplicates, or null. A true duplicate is the same name (ignoring case, punctuation
 * and plurals: "Pushups" = "Push-Up"), or the row scripts/fetch-media.mjs already took a built-in's
 * photos from (`media.json` `source`) when it names the same movement on the same equipment: more than
 * half the words shared ("Leverage Chest Press" = "Machine Chest Press"). A variation ("One-Arm Kettlebell
 * Swings" for "Kettlebell Swing") stays its own catalog row.
 */
export function builtInDuplicate(row, builtIns, media) {
  const name = tokens(row.name);
  for (const builtIn of builtIns) {
    if (compact(builtIn.name) === compact(row.name)) return builtIn.id;
  }
  for (const builtIn of builtIns) {
    if (media[builtIn.id]?.source !== row.id) continue;
    if (tokenScore(tokens(builtIn.name), name) > 0.5 && (row.equipment ?? '') === OUR_EQUIPMENT[builtIn.equipment]) return builtIn.id;
  }
  return null;
}

/**
 * The upstream rows -> { rows, text, links, report }. `rows` is the index (sorted by name), `text` the
 * instructions by id, `links` each built-in's duplicates' names (searched as the built-in), `report`
 * kept / linked / rejected with reasons. Nothing is dropped for its equipment or category.
 */
export function buildLibrary(upstream, builtIns, media) {
  const rows = [];
  const text = {};
  const links = {};
  const report = { total: upstream.length, kept: 0, linked: [], rejected: [] };
  const seen = new Set();
  for (const raw of upstream) {
    const reject = (reason) => report.rejected.push({ id: raw?.id ?? '(no id)', reason });
    if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw.id)) { reject('missing or malformed id'); continue; }
    if (seen.has(raw.id)) { reject('duplicate id'); continue; }
    seen.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) { reject('no name'); continue; }
    // The one media field the import knows: upstream's photo paths, dropped here. Any other media field,
    // a link or a file name anywhere in the rest rejects the whole row.
    const { images: _photos, ...rest } = raw;
    const problem = guardRow(rest);
    if (problem) { reject(problem); continue; }
    const steps = Array.isArray(rest.instructions) ? rest.instructions.filter((step) => typeof step === 'string' && step.trim()) : [];
    if (steps.length === 0) { reject('no instructions'); continue; }
    const duplicate = builtInDuplicate(rest, builtIns, media);
    if (duplicate) {
      report.linked.push({ id: rest.id, builtIn: duplicate });
      (links[duplicate] ??= []).push(rest.name.trim());
      continue;
    }
    const primary = rest.primaryMuscles?.[0];
    const tags = [...new Set([
      ...(rest.primaryMuscles ?? []), ...(rest.secondaryMuscles ?? []),
      rest.equipment, rest.category, rest.force, rest.mechanic,
    ].filter((tag) => typeof tag === 'string' && tag))];
    const row = {
      id: libraryId(rest.id),
      name: rest.name.trim(),
      muscle: primary ? title(primary) : title(rest.category ?? 'Full body'),
      group: groupOf(rest),
      equipment: equipmentLabel(rest.equipment),
      logType: logTypeOf(rest),
      level: title(rest.level ?? 'beginner'),
      category: title(rest.category ?? 'strength'),
      tags,
    };
    const clean = steps.map((step) => step.trim());
    const outProblem = guardRow(row) ?? guardRow(clean);
    if (outProblem) { reject(outProblem); continue; }
    rows.push(row);
    text[row.id] = clean;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  report.kept = rows.length;
  return { rows, text, links, report };
}

/** One line per count, as the import prints it. */
export function reportLines(report) {
  const reasons = {};
  for (const { reason } of report.rejected) reasons[reason] = (reasons[reason] ?? 0) + 1;
  return [
    `free-exercise-db @ ${SOURCE.commit}: ${report.total} rows`,
    `kept: ${report.kept}`,
    `linked (duplicates of a built-in, searchable as it): ${report.linked.length}`,
    `rejected: ${report.rejected.length}${Object.keys(reasons).length ? ` (${Object.entries(reasons).map(([reason, n]) => `${reason}: ${n}`).join('; ')})` : ''}`,
  ];
}
