import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EXERCISES, exerciseById } from '../src/data/exercises.ts';
import {
  LIBRARY, LIBRARY_LINKS, PROMOTED, applyLibraryIndex, libraryExerciseById, loadLibraryIndex, loadLibraryText,
  referencesLibrary, resetLibrary, tierOf,
} from '../src/data/library.ts';
import { LIBRARY_FILES, LIBRARY_ROWS } from '../src/data/libraryFiles.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { libraryEntries, PAGE, searchLibrary, youLog } from '../src/lib/librarySearch.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';
import { guardRow } from '../scripts/library/guard.mjs';
import { buildLibrary, libraryId } from '../scripts/library/transform.mjs';
import { checkLibrary } from '../scripts/library-check.mjs';

/* #431: the exercise library (free-exercise-db text and tags), phase 1: browse and search only. */

const root = new URL('..', import.meta.url).pathname;
const indexFile = JSON.parse(readFileSync(join(root, 'public', LIBRARY_FILES.index), 'utf8'));
const textFile = JSON.parse(readFileSync(join(root, 'public', LIBRARY_FILES.text), 'utf8'));
const media = JSON.parse(readFileSync(join(root, 'src/data/media.json'), 'utf8'));
const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });
const offline = async () => { throw new TypeError('Failed to fetch'); };

const UPSTREAM = {
  id: 'Band_Pull_Apart', name: 'Band Pull Apart', force: 'pull', level: 'beginner', mechanic: 'isolation', equipment: 'bands',
  primaryMuscles: ['shoulders'], secondaryMuscles: ['middle back'], instructions: ['Hold the band.', 'Pull it apart.'],
  category: 'strength', images: ['Band_Pull_Apart/0.jpg', 'Band_Pull_Apart/1.jpg'],
};

test('#431 guard: a row with a media field, a link, a media file name or gymvisual is rejected', () => {
  const clean = { id: 'lib-f-X', name: 'Band Pull Apart', tags: ['bands'], instructions: ['Pull the band apart.'] };
  assert.equal(guardRow(clean), null);
  for (const key of ['image', 'images', 'gif_url', 'gifUrl', 'media_id', 'attribution', 'video', 'video_url', 'videoUrl', 'youtubeVideo']) {
    assert.match(guardRow({ ...clean, [key]: 'x' }) ?? '', /media field/, key);
  }
  assert.match(guardRow({ ...clean, instructions: ['See https://example.org/how'] }) ?? '', /URL/);
  assert.match(guardRow({ ...clean, instructions: ['See www.example.org'] }) ?? '', /URL/);
  assert.match(guardRow({ ...clean, name: 'Curl.gif' }) ?? '', /media file/);
  assert.match(guardRow({ ...clean, tags: ['clip.mp4'] }) ?? '', /media file/);
  assert.match(guardRow({ ...clean, tags: ['GymVisual'] }) ?? '', /gymvisual/);
  assert.match(guardRow({ ...clean, nested: { deeper: [{ image: 'a' }] } }) ?? '', /media field "image"/);
});

test('#431 import: upstream photo paths are dropped, any other media field rejects the row, with its reason', () => {
  const rows = [
    UPSTREAM,
    { ...UPSTREAM, id: 'With_Image', name: 'With Image', image: 'x.jpg' },
    { ...UPSTREAM, id: 'With_Gif', name: 'With Gif', gif_url: 'https://x/y.gif' },
    { ...UPSTREAM, id: 'With_Video', name: 'With Video', video: 'clip' },
    { ...UPSTREAM, id: 'With_Link', name: 'With Link', instructions: ['Watch https://example.org first.'] },
  ];
  const { rows: kept, text, report } = buildLibrary(rows, EXERCISES, media);
  assert.deepEqual(kept.map((row: { id: string }) => row.id), ['lib-f-Band_Pull_Apart']);
  assert.equal(JSON.stringify(kept).includes('jpg'), false, 'no photo path survives');
  assert.deepEqual(text['lib-f-Band_Pull_Apart'], ['Hold the band.', 'Pull it apart.']);
  assert.deepEqual(report.rejected, [
    { id: 'With_Image', reason: 'media field "image"' },
    { id: 'With_Gif', reason: 'media field "gif_url"' },
    { id: 'With_Video', reason: 'media field "video"' },
    { id: 'With_Link', reason: 'URL in instructions[0]' },
  ]);
});

test('#431 import: nothing is dropped for equipment or category; labels and log type follow the family', () => {
  const variants = [
    ['bands', 'strength', 'Bands', 'none'], ['medicine ball', 'plyometrics', 'Medicine ball', 'total'],
    ['e-z curl bar', 'strength', 'EZ bar', 'total'], ['dumbbell', 'strength', 'Dumbbell', 'each'],
    ['barbell', 'powerlifting', 'Barbell', 'total'], ['body only', 'strength', 'Bodyweight', 'none'],
    [null, 'cardio', 'No equipment', 'free'], ['foam roll', 'stretching', 'Foam roller', 'free'],
    ['exercise ball', 'strength', 'Exercise ball', 'none'], ['other', 'strongman', 'Other', 'none'],
  ] as const;
  const rows = variants.map(([equipment, category], i) => ({ ...UPSTREAM, id: `Row_${i}`, name: `Made Up Move ${i}`, equipment, category }));
  const { rows: kept, report } = buildLibrary(rows, EXERCISES, media);
  assert.equal(report.rejected.length, 0);
  assert.deepEqual(kept.map((row: { equipment: string; logType: string }) => [row.equipment, row.logType]),
    variants.map(([, , label, log]) => [label, log]));
  assert.equal(libraryId('Row_0'), 'lib-f-Row_0');
});

test('#431 import: a true duplicate of a built-in is linked, not listed; a variation stays its own row', () => {
  const rows = [
    { ...UPSTREAM, id: 'Pushups', name: 'Pushups', equipment: 'body only' },
    { ...UPSTREAM, id: 'One-Arm_Kettlebell_Swings', name: 'One-Arm Kettlebell Swings', equipment: 'kettlebells' },
  ];
  const { rows: kept, links, report } = buildLibrary(rows, EXERCISES, media);
  assert.deepEqual(report.linked, [{ id: 'Pushups', builtIn: 'push-up' }]);
  assert.deepEqual(links, { 'push-up': ['Pushups'] });
  assert.deepEqual(kept.map((row: { id: string }) => row.id), ['lib-f-One-Arm_Kettlebell_Swings']);
});

test('#431 build check: the committed library passes; a row with an image field fails the build', () => {
  assert.deepEqual(checkLibrary(root, EXERCISES.map((exercise) => exercise.id)), []);
  const temp = mkdtempSync(join(tmpdir(), 'library431-'));
  try {
    mkdirSync(join(temp, 'src/data'), { recursive: true });
    mkdirSync(join(temp, 'public/library'), { recursive: true });
    const bad = { ...indexFile, rows: [{ ...indexFile.rows[0], image: 'photo.jpg' }] };
    const name = (kind: string, body: string) => `${kind}.${createHash('sha256').update(body).digest('hex').slice(0, 10)}.json`;
    const indexBody = JSON.stringify(bad);
    const textBody = JSON.stringify({ text: { [indexFile.rows[0].id]: ['Step.'] } });
    writeFileSync(join(temp, 'public/library', name('index', indexBody)), indexBody);
    writeFileSync(join(temp, 'public/library', name('text', textBody)), textBody);
    writeFileSync(join(temp, 'src/data/libraryFiles.ts'),
      `export const LIBRARY_FILES = { index: '/library/${name('index', indexBody)}', text: '/library/${name('text', textBody)}' } as const;\n`);
    const problems = checkLibrary(temp, []);
    assert.ok(problems.some((problem: string) => problem.includes('media field "image"')), problems.join('\n'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('#431 the committed files: lib-f- ids, every row clean, sizes within budget', () => {
  assert.equal(indexFile.rows.length, LIBRARY_ROWS);
  assert.ok(LIBRARY_ROWS > 800, 'phase 1 ships the whole free-exercise-db list less duplicates');
  for (const row of indexFile.rows) {
    assert.match(row.id, /^lib-f-[A-Za-z0-9_-]+$/);
    assert.equal(guardRow(row), null, row.id);
    assert.ok(Array.isArray(textFile.text[row.id]), `${row.id} has instructions`);
  }
  const linked = Object.values(indexFile.links as Record<string, string[]>).flat().length;
  assert.ok(indexFile.rows.length + linked <= 876);
  assert.ok(readFileSync(join(root, 'public', LIBRARY_FILES.index)).length > 0);
});

const BUILT_IN_IDS = [
  'barbell-bench-press', 'dumbbell-floor-press', 'dumbbell-bench-press', 'incline-dumbbell-press', 'machine-chest-press', 'cable-fly',
  'push-up', 'dip', 'deadlift', 'barbell-row', 'pull-up', 'lat-pulldown', 'seated-cable-row', 'dumbbell-row', 'face-pull',
  'overhead-press', 'dumbbell-shoulder-press', 'lateral-raise', 'rear-delt-fly', 'arnold-press', 'barbell-curl', 'dumbbell-curl',
  'hammer-curl', 'cable-curl', 'chin-up', 'triceps-pushdown', 'overhead-triceps-extension', 'dumbbell-overhead-triceps-extension',
  'skull-crusher', 'close-grip-bench', 'diamond-push-up', 'back-squat', 'front-squat', 'leg-press', 'bulgarian-split-squat',
  'walking-lunge', 'leg-extension', 'goblet-squat', 'kettlebell-goblet-squat', 'dumbbell-romanian-deadlift', 'dumbbell-calf-raise',
  'dumbbell-pullover', 'kettlebell-swing', 'kettlebell-row', 'kettlebell-press', 'bodyweight-squat', 'bodyweight-lunge',
  'romanian-deadlift', 'leg-curl', 'good-morning', 'nordic-curl', 'hip-thrust', 'glute-bridge', 'cable-kickback', 'step-up',
  'standing-calf-raise', 'seated-calf-raise', 'plank', 'hanging-leg-raise', 'cable-crunch', 'russian-twist', 'ab-wheel',
];

test('#431 ids: the 62 built-in ids are unchanged, and loading the library adds none to EXERCISES', () => {
  resetLibrary();
  assert.equal(BUILT_IN_IDS.length, 62);
  assert.deepEqual(EXERCISES.map((exercise) => exercise.id), BUILT_IN_IDS);
  applyLibraryIndex(indexFile);
  assert.equal(LIBRARY.size, LIBRARY_ROWS);
  assert.deepEqual(EXERCISES.map((exercise) => exercise.id), BUILT_IN_IDS);
  const anyRow = indexFile.rows[0].id;
  assert.equal(exerciseById(anyRow), undefined, 'the planner lookup never returns a library row');
  assert.equal(libraryExerciseById(anyRow)?.name, indexFile.rows[0].name);
  assert.equal(tierOf(anyRow), 'catalog');
  assert.equal(tierOf('push-up'), 'program');
  assert.equal(PROMOTED.size, 0, 'the Promoted allowlist ships empty');
  resetLibrary();
});

const profileOf = (extra: Partial<Profile>): Profile => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, unit: 'kg', sessionMinutes: 45,
  equipment: [], support: [], exclusions: [], loads: {}, ...extra,
} as Profile);
const PROFILES: Profile[] = [
  profileOf({ equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] }),
  profileOf({ equipment: ['Dumbbell'], support: ['Bench'], daysPerWeek: 3, goal: 'Get Stronger' }),
  profileOf({ equipment: [], support: [], daysPerWeek: 5, experience: 'Beginner' }),
  profileOf({ equipment: ['Kettlebell'], support: ['Pull-up bar'], daysPerWeek: 2, sessionMinutes: 20 }),
];

function plannerOutput(): string {
  return JSON.stringify(PROFILES.map((profile) => {
    const plan = buildPlan(profile);
    return {
      plan,
      days: plan.map((day, i) => generateWorkout(profile, day, i)),
      replace: EXERCISES.map((exercise) => rankedReplacements(exercise, profile, [], 6).map((item) => item.id)),
    };
  }));
}

test('#431 planner unchanged: plans, days and Replace lists are identical with the library loaded, and name no library row', () => {
  resetLibrary();
  const before = plannerOutput();
  applyLibraryIndex(indexFile);
  // Even a row on the Promoted allowlist stays out of the planner.
  const after = plannerOutput();
  assert.equal(after, before);
  assert.doesNotMatch(after, /lib-/);
  resetLibrary();
});

test('#431 v1: a more/less choice for a library row is dropped on load, like any id the catalog does not know', () => {
  const state = {
    ...EMPTY_STATE,
    profile: profileOf({ preferences: { 'lib-f-Band_Pull_Apart': 'more', 'push-up': 'less' } }),
  } as AppState;
  const result = validateState(JSON.parse(serializeExport(state)).state);
  assert.ok(result.ok);
  assert.deepEqual(result.ok && result.state.profile?.preferences, { 'push-up': 'less' });
});

const LIB_WORKOUT: WorkoutRecord = {
  id: 'w-lib-1', date: '2026-11-20T08:00:00.000Z', endedAt: '2026-11-20T08:40:00.000Z', name: 'Push', durationMin: 40,
  dayIndex: 0, status: 'completed', completedEarly: false,
  exercises: [
    { exerciseId: 'push-up', name: 'Push-Up', planned: [{ weight: 0, reps: 10 }],
      performed: [{ weight: 0, reps: 10, done: true, completedAt: '2026-11-20T08:10:00.000Z' }] },
    { exerciseId: 'lib-f-Band_Pull_Apart', name: 'Band Pull Apart', planned: [{ weight: 0, reps: 15 }, { weight: 0, reps: 15 }],
      performed: [{ weight: 0, reps: 15, done: true, completedAt: '2026-11-20T08:20:00.000Z' },
        { weight: 0, reps: 12, done: true, completedAt: '2026-11-20T08:22:00.000Z' }] },
  ],
} as WorkoutRecord;

const plainJson = (value: unknown) => JSON.parse(JSON.stringify(value));

test('#431 a saved workout naming a library row loads with the library file missing: name and sets unchanged', async () => {
  resetLibrary();
  const state = { ...EMPTY_STATE, profile: PROFILES[0], history: [LIB_WORKOUT] } as AppState;
  const parsed = parseState(serializeExport(state));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  const loaded = parsed.ok ? parsed.state : null;
  assert.deepEqual(plainJson(loaded?.history[0].exercises), LIB_WORKOUT.exercises);
  assert.equal(referencesLibrary(loaded!), true);
  // Offline, first load: the index cannot be read. Nothing throws, nothing is rewritten.
  assert.equal(await loadLibraryIndex(offline), false);
  assert.equal(await loadLibraryText('lib-f-Band_Pull_Apart', offline), null);
  assert.equal(LIBRARY.size, 0);
  assert.equal(libraryExerciseById('lib-f-Band_Pull_Apart'), undefined);
  assert.deepEqual(plainJson(loaded?.history[0].exercises), LIB_WORKOUT.exercises);
  // Back online, a retry fetches again.
  assert.equal(await loadLibraryIndex(ok(indexFile)), true);
  assert.equal(LIBRARY.size, LIBRARY_ROWS);
  const first = indexFile.rows[0].id;
  assert.deepEqual(await loadLibraryText(first, ok(textFile)), textFile.text[first]);
  assert.equal(referencesLibrary({ history: [], current: null }), false);
  resetLibrary();
});

test('#431 index rows off-shape are skipped, never a crash; a row may not take a built-in id', () => {
  resetLibrary();
  const good = indexFile.rows[0];
  assert.equal(applyLibraryIndex({ rows: [good, { ...good, id: 'push-up' }, { ...good, id: 'lib-f-x', group: 'Nope' }, null, 7] }), 1);
  assert.equal(applyLibraryIndex(null), 0);
  resetLibrary();
});

test('#431 search: every library row is found by its name; a linked duplicate finds its built-in', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const entries = libraryEntries();
  const missing = indexFile.rows.filter((row: { id: string; name: string }) =>
    !searchLibrary(entries, row.name).some((entry) => entry.id === row.id));
  assert.deepEqual(missing, []);
  for (const [builtIn, names] of LIBRARY_LINKS) {
    for (const name of names) assert.ok(searchLibrary(entries, name).some((entry) => entry.id === builtIn), `${name} -> ${builtIn}`);
  }
  assert.ok(searchLibrary(entries, 'Pushups').slice(0, 3).some((entry) => entry.id === 'push-up'));
  resetLibrary();
});

test('#431 search ranking: built-ins first, then exact, prefix and all-words; synonyms; muscle chips', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const entries = libraryEntries();
  const ids = (query: string, group?: Parameters<typeof searchLibrary>[2]) => searchLibrary(entries, query, group).map((entry) => entry.id);
  const tiers = (query: string) => searchLibrary(entries, query).map((entry) => entry.tier);
  for (const query of ['', 'press', 'curl', 'squat']) {
    const list = tiers(query);
    assert.equal(list.indexOf('program') <= list.indexOf('catalog'), true);
    assert.equal(list.lastIndexOf('program') < list.indexOf('catalog') || !list.includes('catalog'), true, query);
  }
  assert.equal(ids('ohp')[0], 'overhead-press');
  assert.equal(ids('rdl')[0], 'romanian-deadlift');
  assert.ok(ids('db press').includes('dumbbell-bench-press'));
  assert.ok(ids('bb curl').includes('barbell-curl'));
  // Exact before prefix before all-words, within a tier.
  assert.deepEqual(ids('Plank').slice(0, 1), ['plank']);
  const lunge = searchLibrary(entries, 'lunge').filter((entry) => entry.tier === 'catalog');
  const exact = lunge.findIndex((entry) => /^lunge/i.test(entry.name));
  const wordOnly = lunge.findIndex((entry) => !/^lunge/i.test(entry.name));
  if (exact >= 0 && wordOnly >= 0) assert.ok(exact < wordOnly);
  // Chips.
  assert.ok(searchLibrary(entries, '', 'Cardio').every((entry) => entry.group === 'Cardio'));
  assert.ok(searchLibrary(entries, '', 'Stretching').length > 50);
  assert.ok(searchLibrary(entries, '', 'Arms').some((entry) => entry.id === 'barbell-curl'));
  assert.deepEqual(ids('zzzz'), []);
  assert.ok(searchLibrary(entries, '').length > PAGE);
  // Bands, balls and the rest are listed, not dropped.
  for (const label of ['Bands', 'Medicine ball', 'EZ bar', 'Exercise ball', 'Foam roller']) {
    assert.ok(entries.some((entry) => entry.equipment === label), label);
  }
  resetLibrary();
});

test('#431 Promoted allowlist: a listed library row ranks with the built-ins in search', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const target = indexFile.rows.find((row: { name: string }) => /curl/i.test(row.name));
  const promoted = new Set([target.id]);
  const list = searchLibrary(libraryEntries(promoted), 'curl');
  const at = list.findIndex((entry) => entry.id === target.id);
  assert.equal(list[at].tier, 'promoted');
  // Curated (Program and Promoted) rank together, by match, ahead of every catalog row.
  assert.ok(list.slice(0, at).every((entry) => entry.tier !== 'catalog'));
  const firstCatalog = list.findIndex((entry) => entry.tier === 'catalog');
  assert.ok(firstCatalog > at);
  assert.equal(searchLibrary(libraryEntries(), 'curl').find((entry) => entry.id === target.id)?.tier, 'catalog', 'empty allowlist: catalog');
  resetLibrary();
});

test('#431 You log: the family decides, and a built-in hold logs seconds', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const entries = libraryEntries();
  const by = (id: string) => entries.find((entry) => entry.id === id)!;
  assert.equal(youLog(by('dumbbell-curl')), 'Weight each × reps');
  assert.equal(youLog(by('barbell-curl')), 'Weight × reps');
  assert.equal(youLog(by('push-up')), 'Reps');
  assert.equal(youLog(by('plank')), 'Seconds');
  const stretch = entries.find((entry) => entry.group === 'Stretching')!;
  // (#432) A Stretching row logs seconds held, as the logger records it.
  assert.equal(youLog(stretch), 'Seconds');
  const cardio = entries.find((entry) => entry.group === 'Cardio')!;
  assert.equal(youLog(cardio), 'Reps, optional weight and a note');
  resetLibrary();
});

test('#431 service worker: library files go in library-v1, which a deploy never deletes', () => {
  const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
  assert.match(sw, /const LIBRARY = 'library-v1';/);
  assert.match(sw, /key\.startsWith\('fitbod-clone-'\)/, 'activate only clears fitbod-clone- caches');
  assert.match(sw, /url\.pathname\.startsWith\('\/library\/'\)/);
});
