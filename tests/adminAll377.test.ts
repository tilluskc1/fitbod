import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { exercisePhoto } from '../src/lib/media.ts';
import { ABOUT_CREDITS } from '../src/lib/about.ts';
import { mediaUrl, type Row } from '../src/lib/additions.ts';
import { appearsIn, type Entry } from '../src/lib/adminCatalog.ts';
import { isRelevantToDay } from '../src/lib/feasibility.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { allExercises, countOf, daysFor, filterRows, filterOptions, NO_FILTER } from '../src/admin/allExercises.ts';
import type { Exercise, PlanDay, Profile } from '../src/types.ts';

/* #377: /admin lists every exercise, built-in and added, read-only, with search, filters and the planner's days. */

const LANDMINE: Row = {
  kind: 'exercise', id: 'add-landmine-press', name: 'Landmine Press', muscles: ['Chest', 'Shoulders'], pattern: 'horizontal_push',
  item: 'barbell', instructions: 'Press the bar end up and forward.', cues: ['Brace', 'Elbow at 45 degrees'],
  photo: 'catalog/add-landmine-press/photo-1.jpg', source: 'https://example.org/landmine', licence: 'cc-by', credit: 'Jo Lifter',
};
const T_BAR: Row = {
  kind: 'exercise', id: 'add-t-bar-row', name: 'T-Bar Row', muscles: ['Back', 'Biceps'], pattern: 'horizontal_pull',
  item: 'add-t-bar', instructions: 'Row the bar end to your chest.', cues: [],
};
const OLD: Row = {
  kind: 'exercise', id: 'add-old-curl', name: 'Old Curl', muscles: ['Biceps'], pattern: 'elbow_flexion',
  item: 'bodyweight', instructions: 'Curl.', cues: [],
};
const T_BAR_GEAR: Row = { kind: 'equipment', id: 'add-t-bar', name: 'T-bar', family: 'Barbell', group: 'Free weights' };
const ENTRIES: Entry[] = [
  { row: LANDMINE, status: 'published' },
  { row: T_BAR, status: 'draft' },
  { row: OLD, status: 'unpublished' },
  { row: T_BAR_GEAR, status: 'published' },
];
/** Firestore rows as the page reads them (plain fields), including the ones `validRow` drops. */
const PARTIAL = { id: 'add-half-squat', kind: 'exercise', status: 'draft', name: 'Half Squat', muscles: ['Quads', 'Neck'], pattern: 'squat', item: 'bodyweight' };
const NO_STATUS = { id: 'add-wall-sit', kind: 'exercise', name: 'Wall Sit', muscles: ['Quads'], pattern: 'mystery', instructions: 'Sit on the wall.' };
const RAW: Record<string, unknown>[] = [
  ...ENTRIES.map(({ row, status }) => ({ ...row, status })),
  PARTIAL,
  NO_STATUS,
  { id: 'add-broken-gear', kind: 'equipment', status: 'published', name: 'Broken' },
  { id: 'bench', kind: 'exercise', status: 'published', name: 'Not an addition id' },
  { kind: 'exercise', status: 'published', name: 'No id' },
];

const builtIns = EXERCISES.filter((exercise) => !exercise.id.startsWith('add-'));

test('#377 the count is every built-in in exercises.ts plus published and draft additions', () => {
  // Counted from the source file's text too, so the list can't quietly drop or add a built-in.
  const source = readFileSync(new URL('../src/data/exercises.ts', import.meta.url), 'utf8');
  const listed = source.slice(source.indexOf('export const EXERCISES'), source.indexOf('export const INCOMPATIBLE_GROUPS'));
  const inFile = (listed.match(/^\s*\{ id: '/gm) ?? []).length;
  assert.equal(inFile, builtIns.length);
  assert.ok(inFile > 50);

  const rows = allExercises(ENTRIES, RAW);
  const count = countOf(rows);
  // Landmine (published), T-Bar (draft), Half Squat (draft, partial), Wall Sit (no status: draft). Old Curl is unpublished.
  assert.deepEqual(count, { total: inFile + 4, builtIn: inFile, added: 1, draft: 3, unpublished: 1 });
  assert.equal(rows.length, inFile + 5, 'unpublished additions still list, tagged, outside the count');
  assert.deepEqual(rows.filter((row) => row.tag === 'Built-in').map((row) => row.id).sort(), builtIns.map((e) => e.id).sort());
});

test('#377 each addition carries its tag; equipment and malformed ids are not exercises', () => {
  const rows = allExercises(ENTRIES, RAW);
  const tag = (id: string) => rows.find((row) => row.id === id)?.tag;
  assert.equal(tag('add-landmine-press'), 'Added');
  assert.equal(tag('add-t-bar-row'), 'Draft');
  assert.equal(tag('add-old-curl'), 'Unpublished');
  assert.equal(tag('barbell-bench-press'), 'Built-in');
  assert.equal(tag('add-t-bar'), undefined, 'equipment is not an exercise');
  assert.equal(tag('add-broken-gear'), undefined);
  assert.equal(rows.filter((row) => row.id === 'bench').length, 0, 'a non-addition id from Firestore is not listed');
  assert.equal(rows.filter((row) => row.name === 'No id').length, 0);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'one row per exercise');
  // Sorted by name, built-in and added together.
  const names = rows.map((row) => row.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('#377 an addition whose saved data is partial still lists (lesson 41)', () => {
  const rows = allExercises(ENTRIES, RAW);
  const half = rows.find((row) => row.id === 'add-half-squat');
  assert.ok(half, 'partial draft listed');
  assert.equal(half.partial, true);
  assert.deepEqual(half.muscles, ['Quads'], 'only the muscles the app knows');
  assert.equal(half.pattern, 'squat');
  assert.equal(half.instructions, '');
  const wall = rows.find((row) => row.id === 'add-wall-sit');
  assert.ok(wall);
  assert.equal(wall.tag, 'Draft');
  assert.equal(wall.pattern, null, 'an unknown pattern reads as none');
  assert.equal(wall.partial, true);
  assert.equal(rows.find((row) => row.id === 'add-landmine-press')?.partial, false);
  // A row saved later in this visit (the page's entries) wins over the raw read.
  const fixed = allExercises([...ENTRIES, { row: { ...LANDMINE, id: 'add-half-squat', name: 'Half Squat' }, status: 'published' }], RAW);
  assert.equal(fixed.filter((row) => row.id === 'add-half-squat').length, 1);
  assert.equal(fixed.find((row) => row.id === 'add-half-squat')?.tag, 'Added');
  assert.equal(fixed.find((row) => row.id === 'add-half-squat')?.partial, false);
  // Nothing from Firestore at all: the built-ins alone.
  assert.equal(allExercises([], []).length, builtIns.length);
});

test('#377 each row shows photo, pattern, muscles and equipment', () => {
  const rows = allExercises(ENTRIES, RAW);
  const bench = rows.find((row) => row.id === 'barbell-bench-press')!;
  assert.equal(bench.photo, exercisePhoto('barbell-bench-press'));
  assert.deepEqual(bench.muscles, ['Chest', 'Triceps', 'Shoulders']);
  assert.equal(bench.pattern, 'horizontal_push');
  assert.equal(bench.equipment, 'Barbell');
  assert.equal(bench.credit, `${ABOUT_CREDITS[0].replace(/^Exercise photos: /, '').replace(/\.$/, '')}`);
  const landmine = rows.find((row) => row.id === 'add-landmine-press')!;
  assert.equal(landmine.photo, mediaUrl(LANDMINE.photo!));
  assert.equal(landmine.credit, 'Jo Lifter (CC BY)');
  assert.deepEqual(landmine.cues, ['Brace', 'Elbow at 45 degrees']);
  assert.equal(rows.find((row) => row.id === 'add-t-bar-row')!.equipment, 'Barbell', 'an added item reads as its family');
  assert.equal(rows.find((row) => row.id === 'add-old-curl')!.equipment, 'Bodyweight');
  assert.equal(rows.find((row) => row.id === 'add-old-curl')!.photo, null);
  // A built-in's equipment is one of the filter's options; every row's is.
  const options = filterOptions(rows);
  for (const row of rows) assert.ok(options.equipment.includes(row.equipment), row.equipment);
});

test('#377 search and each filter narrow the list; nothing matching gives an empty list', () => {
  const rows = allExercises(ENTRIES, RAW);
  assert.equal(filterRows(rows, NO_FILTER).length, rows.length);

  const press = filterRows(rows, { ...NO_FILTER, query: 'press' });
  assert.ok(press.length > 1 && press.length < rows.length);
  assert.ok(press.every((row) => row.name.toLowerCase().includes('press')));
  assert.ok(press.some((row) => row.id === 'add-landmine-press'), 'additions are searched too');
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, query: '  BENCH barbell ' }).map((row) => row.id), ['barbell-bench-press'], 'every word, any case');

  const chest = filterRows(rows, { ...NO_FILTER, muscle: 'Chest' });
  assert.ok(chest.length > 1 && chest.length < rows.length);
  assert.ok(chest.every((row) => row.muscles[0] === 'Chest'), 'the primary muscle, as the planner reads it');
  assert.equal(chest.length, builtIns.filter((e) => e.muscles[0] === 'Chest').length + 1);

  const hinge = filterRows(rows, { ...NO_FILTER, pattern: 'hinge' });
  assert.ok(hinge.length > 0 && hinge.length < rows.length && hinge.every((row) => row.pattern === 'hinge'));

  const machine = filterRows(rows, { ...NO_FILTER, equipment: 'Machine' });
  assert.ok(machine.length > 0 && machine.length < rows.length && machine.every((row) => row.equipment === 'Machine'));

  const both = filterRows(rows, { ...NO_FILTER, muscle: 'Chest', equipment: 'Dumbbell' });
  assert.ok(both.length > 0 && both.length < chest.length);

  assert.deepEqual(filterRows(rows, { ...NO_FILTER, query: 'zzzz' }), []);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, muscle: 'Calves', pattern: 'horizontal_push' }), []);
});

test('#377 "would appear in" is the planner\'s own placement for known exercises', () => {
  const planner = (exercise: Exercise) => {
    const days = new Set<string>();
    for (let daysPerWeek = 2; daysPerWeek <= 6; daysPerWeek += 1) {
      for (const day of buildPlan({ daysPerWeek } as Profile) as PlanDay[]) {
        if (isRelevantToDay(exercise, day)) days.add(day.name.replace(/ [AB]$/, '').replace('Full Body', 'Full body'));
      }
    }
    return days;
  };
  const rows = allExercises(ENTRIES, RAW);
  for (const id of ['barbell-bench-press', 'deadlift', 'pull-up', 'goblet-squat', 'cable-crunch']) {
    const exercise = EXERCISES.find((e) => e.id === id)!;
    const row = rows.find((r) => r.id === id)!;
    assert.deepEqual(new Set(daysFor(row)), planner(exercise), id);
  }
  assert.deepEqual(daysFor(rows.find((r) => r.id === 'barbell-bench-press')!), ['Push', 'Upper', 'Full body']);
  assert.deepEqual(daysFor(rows.find((r) => r.id === 'pull-up')!), ['Pull', 'Upper', 'Full body']);
  assert.deepEqual(daysFor(rows.find((r) => r.id === 'add-landmine-press')!), appearsIn(['Chest', 'Shoulders'], 'horizontal_push'));
  // Every built-in: the same answer as the planner with the real exercise (secondary patterns included).
  for (const exercise of builtIns) {
    assert.deepEqual(new Set(daysFor(rows.find((r) => r.id === exercise.id)!)), planner(exercise), exercise.id);
  }
  assert.deepEqual(daysFor(rows.find((r) => r.id === 'add-wall-sit')!), [], 'no pattern: no day');
});

test('#377 the list is read-only and lives in the admin chunk', () => {
  const page = readFileSync(new URL('../src/admin/AllExercises.tsx', import.meta.url), 'utf8');
  assert.ok(!/writeCatalog|uploadMedia|<input type="file"|<textarea/.test(page), 'no write path on the All exercises page');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.ok(!/allExercises|AllExercises/.test(app + main), 'the training app does not import it');
});
