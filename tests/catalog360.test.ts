import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES, exerciseById } from '../src/data/exercises.ts';
import { GYM_ITEMS, GYM_ITEM_IDS, gymPatch, initialTicks } from '../src/data/gymItems.ts';
import { ADDITION_ID, BODYWEIGHT, applyRows, additionCredits, mediaUrl, resetAdditions, toExercise, validRow, type ExerciseRow, type Row } from '../src/lib/additions.ts';
import { BUILT_IN_IDS, appearsIn, draftOf, emptyDraft, fieldsOf, fileProblem, idFor, publishProblems, rowOf, unpublishProblems, type Draft, type Entry } from '../src/lib/adminCatalog.ts';
import { capabilitiesFor } from '../src/lib/capabilities.ts';
import { CATALOG_CACHE, loadCatalog, nextCopy, plain, publishedRows, refreshCatalog } from '../src/lib/catalogSync.ts';
import { equipmentTitle } from '../src/lib/coachLabels.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { exerciseFrames, exercisePhoto, exerciseVideo } from '../src/lib/media.ts';
import { isGymKit, ownedLoads, savedSetup } from '../src/lib/progression.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { gearLabel } from '../src/lib/todayTalk.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, Profile } from '../src/types.ts';

/* #360: exercises and equipment added from /admin join the built-in catalog on the phone. */

const LANDMINE: ExerciseRow = {
  kind: 'exercise', id: 'add-landmine-press', name: 'Landmine Press', muscles: ['Chest', 'Shoulders', 'Triceps'],
  pattern: 'horizontal_push', item: 'barbell', instructions: 'Press the end of the bar up and forward.', cues: ['Brace', 'Elbow at 45 degrees'],
  photo: 'catalog/add-landmine-press/photo-1731580000000.jpg', source: 'https://example.org/landmine', licence: 'cc-by', credit: 'Jo Lifter',
};
const BELT: Row = { kind: 'equipment', id: 'add-belt-squat', name: 'Belt squat', family: 'Machine', group: 'Legs machines' };
const BELT_SQUAT: ExerciseRow = {
  kind: 'exercise', id: 'add-belt-squat-squat', name: 'Belt Squat', muscles: ['Quads', 'Glutes'], pattern: 'squat',
  item: 'add-belt-squat', instructions: 'Squat with the belt at your hips.', cues: [],
};

const profileOf = (extra: Partial<Profile> = {}): Profile => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, unit: 'kg', sessionMinutes: 45,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'],
  exclusions: [], loads: {}, ...extra,
} as Profile);

test.afterEach(() => resetAdditions());

test('#360 no built-in exercise or gym item id can be an addition id', () => {
  for (const id of BUILT_IN_IDS) assert.ok(!ADDITION_ID.test(id) && !id.startsWith('add-'), id);
});

test('#360 a valid exercise row passes; every drift is dropped, never thrown', () => {
  assert.deepEqual(validRow(LANDMINE), LANDMINE);
  assert.deepEqual(validRow(BELT), BELT);
  const bad: Record<string, unknown>[] = [
    { ...LANDMINE, pattern: undefined },
    { ...LANDMINE, pattern: 'banana' },
    { ...LANDMINE, muscles: 'Chest' },
    { ...LANDMINE, muscles: [] },
    { ...LANDMINE, muscles: ['Chest', 'Chest'] },
    { ...LANDMINE, muscles: ['Pecs'] },
    { ...LANDMINE, id: 'push-up' },
    { ...LANDMINE, id: 'landmine-press' },
    { ...LANDMINE, id: 'add-Landmine' },
    { ...LANDMINE, kind: 'stretch' },
    { ...LANDMINE, item: 'treadmill' },
    { ...LANDMINE, instructions: '' },
    { ...LANDMINE, cues: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { ...LANDMINE, cues: 'Brace' },
    { ...LANDMINE, licence: undefined },
    { ...LANDMINE, licence: 'all-rights-reserved' },
    { ...LANDMINE, credit: ' ' },
    { ...LANDMINE, source: undefined },
    { ...LANDMINE, photo: 'https://evil.example/x.jpg' },
    { ...LANDMINE, photo: 'catalog/add-other/photo-1.jpg' },
    { ...LANDMINE, photo: 'catalog/add-landmine-press/photo-1.gif' },
    { ...LANDMINE, video: 'catalog/add-landmine-press/video-1.mov' },
    { ...LANDMINE, name: 'X' },
    { ...BELT, family: 'Bodyweight' },
    { ...BELT, group: 'Stations' },
  ];
  for (const row of [...bad, null, 'row', 42, [], {}]) assert.equal(validRow(row), null, JSON.stringify(row));
});

test('#360 the download keeps published rows, drops bad ones, and ignores a reply that is not a list', () => {
  const doc = (fields: Record<string, unknown>) => ({ document: { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    Array.isArray(value) ? { arrayValue: { values: value.map((v) => ({ stringValue: v })) } } : { stringValue: value }])) } });
  const reply = [
    doc({ ...LANDMINE, status: 'published' }),
    doc({ ...LANDMINE, id: 'add-draft', status: 'draft' }),
    doc({ ...LANDMINE, id: 'push-up', status: 'published' }),
    doc({ ...LANDMINE, id: 'add-bad', pattern: 'banana', status: 'published' }),
    { readTime: '2026-11-14T10:00:00Z' },
  ];
  assert.deepEqual(publishedRows(reply), [LANDMINE]);
  assert.equal(publishedRows({ error: { code: 403 } }), null);
  assert.equal(publishedRows(null), null);
  assert.deepEqual(publishedRows([{ readTime: 'x' }]), []);
  assert.deepEqual(plain({ s: { stringValue: 'x' }, l: { arrayValue: {} }, n: { integerValue: '3' } as never }), { s: 'x', l: [], n: undefined });
});

test('#360 an unpublished row moves to retired and stays there; a republished one comes back', () => {
  const one = nextCopy(null, [LANDMINE, BELT]);
  assert.deepEqual(one, { published: [LANDMINE, BELT], retired: [] });
  const two = nextCopy(one, [BELT]);
  assert.deepEqual(two, { published: [BELT], retired: [LANDMINE] });
  assert.deepEqual(nextCopy(two, []), { published: [], retired: [BELT, LANDMINE] });
  assert.deepEqual(nextCopy(nextCopy(two, []), [LANDMINE]), { published: [LANDMINE], retired: [BELT] });
});

test('#360 equipment items map to the families the app already reads', () => {
  const row = (item: string) => toExercise({ ...LANDMINE, item })!;
  assert.deepEqual([row('dumbbells').equipment, row('dumbbells').needs, row('dumbbells').stations], ['Dumbbell', ['dumbbell'], undefined]);
  assert.deepEqual([row('pull-up-bar').equipment, row('pull-up-bar').needs], ['Bodyweight', ['pull-up-bar']]);
  assert.deepEqual([row('cable-stack').equipment, row('cable-stack').needs, row('cable-stack').stations], ['Cable', ['cable'], ['cable-stack']]);
  assert.deepEqual([row(BODYWEIGHT).equipment, row(BODYWEIGHT).needs], ['Bodyweight', []]);
  assert.equal(toExercise({ ...LANDMINE, item: 'add-unknown' }), null);
  // Every capability an item can need is one the profile's own gear provides.
  const caps = capabilitiesFor(profileOf());
  for (const item of GYM_ITEMS) for (const need of row(item.id).needs) assert.ok(caps.has(need), `${item.id} needs ${need}`);
  assert.match(row('barbell').instructions, /Press the end of the bar up and forward\. Brace\. Elbow at 45 degrees\.$/);
});

test('#360 published: planned on a fresh day, offered by Replace; unpublished: history keeps it, planning does not', () => {
  applyRows([LANDMINE], []);
  assert.ok(EXERCISES.some((e) => e.id === LANDMINE.id));
  assert.equal(exercisePhoto(LANDMINE.id), mediaUrl(LANDMINE.photo!));
  assert.deepEqual(additionCredits(), ['Landmine Press: Jo Lifter (CC BY).']);

  const profile = profileOf({ preferences: { [LANDMINE.id]: 'more' } });
  const push = buildPlan(profile)[0];
  const day = generateWorkout(profile, push, 0, []);
  assert.ok(day.exercises.some((e) => e.exerciseId === LANDMINE.id), 'planned on a Push day');
  const bench = exerciseById('barbell-bench-press')!;
  assert.ok(rankedReplacements(bench, profileOf(), [], EXERCISES.length).some((e) => e.id === LANDMINE.id), 'Replace offers it');

  // Logged and finished.
  const index = day.exercises.findIndex((e) => e.exerciseId === LANDMINE.id);
  let session = createSession({ id: 'w1', name: push.name, dayIndex: 0, now: '2026-11-14T10:00:00.000Z', exercises: day.exercises });
  session = updatePerformedSet(session, index, 0, { done: true, weight: 30, reps: 8 }, '2026-11-14T10:05:00.000Z');
  const record = completeSession(session, { early: true, now: '2026-11-14T10:30:00.000Z' });

  // Next open: the owner unpublished it.
  resetAdditions();
  const copy = nextCopy(nextCopy(null, [LANDMINE]), []);
  applyRows(copy.published, copy.retired);
  assert.ok(!EXERCISES.some((e) => e.id === LANDMINE.id), 'not planned');
  assert.equal(exerciseById(LANDMINE.id)?.name, 'Landmine Press', 'history still reads it');
  assert.equal(exercisePhoto(LANDMINE.id), mediaUrl(LANDMINE.photo!), 'and its photo');
  assert.deepEqual(additionCredits(), []);
  assert.ok(!generateWorkout(profile, push, 0, [record]).exercises.some((e) => e.exerciseId === LANDMINE.id));
  assert.ok(!rankedReplacements(bench, profileOf(), [], EXERCISES.length).some((e) => e.id === LANDMINE.id), 'Replace no longer offers it');

  // Export and restore keep the workout, its name and its sets.
  const state: AppState = { ...EMPTY_STATE, profile, history: [record] } as AppState;
  const parsed = parseState(serializeExport(state));
  assert.ok(parsed.ok);
  const entry = parsed.ok ? parsed.state.history[0].exercises.find((e) => e.exerciseId === LANDMINE.id) : undefined;
  assert.equal(entry?.name, 'Landmine Press');
  assert.deepEqual(entry?.performed[0], record.exercises[index].performed[0]);
  // The same backup restores on a phone that never saw the addition.
  resetAdditions();
  assert.ok(parseState(serializeExport(state)).ok);
});

test('#360 an exercise on unpublished equipment is history only; the item stays readable but off the My gym list', () => {
  applyRows([BELT_SQUAT], [BELT]);
  assert.ok(!EXERCISES.some((e) => e.id === BELT_SQUAT.id));
  assert.equal(exerciseById(BELT_SQUAT.id)?.equipment, 'Machine');
  assert.equal(GYM_ITEMS.find((item) => item.id === BELT.id)?.hidden, true);
  resetAdditions();
  applyRows([BELT, BELT_SQUAT], []);
  assert.deepEqual(exerciseById(BELT_SQUAT.id)?.stations, [BELT.id]);
  assert.ok(EXERCISES.some((e) => e.id === BELT_SQUAT.id));
});

test('#360 every saved-kit shape reads the same through every gear reader after an equipment addition (lesson 37)', () => {
  const KITS: Record<string, Partial<Profile>> = {
    gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack'] },
    'gym without barbell': gymPatch(['leg-press', 'cable-stack', 'dumbbells', 'bench']),
    garage: { equipment: ['Barbell', 'Dumbbell'], support: ['Rack', 'Bench'], loads: { Dumbbell: [10, 20] } },
    'home with cables': { equipment: ['Dumbbell', 'Cable'], support: ['Bench'], loads: { Dumbbell: [10, 20] } },
    'dumbbells only': { equipment: ['Dumbbell'], support: [], loads: { Dumbbell: [5, 10, 15] } },
  };
  const read = (profile: Profile) => ({
    isGymKit: isGymKit(profile), ownedLoads: ownedLoads(profile), savedSetup: savedSetup(profile),
    gearLabel: gearLabel('home', profile), equipmentTitle: equipmentTitle(profile),
  });
  const before = Object.fromEntries(Object.entries(KITS).map(([name, kit]) => [name, read(profileOf(kit))]));
  applyRows([BELT], []);
  for (const [name, kit] of Object.entries(KITS)) {
    assert.deepEqual(read(profileOf(kit)), before[name], `${name} reads the same`);
    // Ticking the new machine reads exactly like ticking a built-in machine.
    const start = initialTicks(profileOf(kit));
    const withNew = profileOf({ ...kit, ...gymPatch([...start, 'add-belt-squat' as never]) });
    const withBuiltIn = profileOf({ ...kit, ...gymPatch([...start, 'hack-squat']) });
    assert.deepEqual(read(withNew), read(withBuiltIn), `${name} + new machine reads like + hack squat`);
  }
});

test('#360 a saved gym list keeps a known addition and drops an unknown one instead of failing the profile', () => {
  applyRows([BELT], []);
  const state = (gymItems: unknown[]) => ({ ...EMPTY_STATE, profile: profileOf({ gymItems: gymItems as never }) });
  const items = (gymItems: unknown[]) => {
    const result = validateState(state(gymItems));
    return result.ok ? result.state.profile?.gymItems : `refused: ${result.error}`;
  };
  assert.deepEqual(items(['leg-press', 'add-belt-squat']), ['leg-press', 'add-belt-squat']);
  resetAdditions();
  assert.deepEqual(items(['leg-press', 'add-belt-squat']), ['leg-press']);
  assert.match(String(items(['leg-press', 'treadmill'])), /^refused/, 'built-in ids keep the strict check');
  assert.ok(!GYM_ITEM_IDS.includes('add-belt-squat' as never));
});

const draft = (patch: Partial<Draft>): Draft => ({
  ...emptyDraft('exercise'), name: 'Landmine Press', primary: 'Chest', secondary: ['Shoulders'], pattern: 'horizontal_push', item: 'barbell',
  instructions: 'Press it.', ...patch,
});

test('#360 publish is blocked with a reason: built-in name, taken id, no pattern, no muscle, no rights, unpublished gear', () => {
  assert.deepEqual(publishProblems(draft({}), [], true), []);
  assert.equal(idFor('Landmine Press'), 'add-landmine-press');
  assert.deepEqual(publishProblems(draft({ name: 'Push-Up' }), [], true), ['Push-Up is already built in. Pick another name.']);
  assert.deepEqual(publishProblems(draft({ name: 'barbell' }), [], true), ['barbell is already built in. Pick another name.']);
  const taken: Entry[] = [{ row: LANDMINE, status: 'draft' }];
  assert.deepEqual(publishProblems(draft({}), taken, true), ['Landmine Press is already in this list.']);
  assert.deepEqual(publishProblems(draftOf(taken[0]), taken, false), []);
  assert.deepEqual(publishProblems(draft({ pattern: '' }), [], true), ['Pick the movement pattern.']);
  assert.deepEqual(publishProblems(draft({ primary: '' }), [], true), ['Pick the primary muscle.']);
  assert.deepEqual(publishProblems(draft({ photo: 'catalog/add-landmine-press/photo-1.jpg' }), [], true),
    ['Add the source, licence and credit for the photo or video. No rights, no publish.']);
  assert.deepEqual(publishProblems(draft({ photo: 'catalog/add-landmine-press/photo-1.jpg', source: 'mine', licence: 'own-work', credit: 'Me' }), [], true), []);
  const gear: Entry[] = [{ row: BELT, status: 'draft' }];
  assert.deepEqual(publishProblems(draft({ item: BELT.id }), gear, true), ['Publish Belt squat first.']);
  assert.deepEqual(publishProblems(draft({ item: BELT.id }), [{ row: BELT, status: 'published' }], true), []);
  assert.deepEqual(publishProblems({ ...emptyDraft('equipment'), name: 'Belt squat' }, [], true), ['Pick the equipment family.', 'Pick the My gym group.']);
  // Equipment a published exercise uses can't be unpublished.
  assert.deepEqual(unpublishProblems(BELT, [{ row: BELT_SQUAT, status: 'published' }]), ['Unpublish Belt Squat first: it uses this equipment.']);
  assert.deepEqual(unpublishProblems(BELT, [{ row: BELT_SQUAT, status: 'unpublished' }]), []);
});

test('#360 files: type, size and length caps', () => {
  assert.equal(fileProblem('photo', { type: 'image/jpeg', size: 1024 * 1024 }), null);
  assert.equal(fileProblem('photo', { type: 'image/jpeg', size: 1024 * 1024 + 1 }), 'This photo is over 1 MB.');
  assert.equal(fileProblem('photo', { type: 'image/gif', size: 10 }), 'Photos must be JPG, PNG or WebP.');
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 10 }, 15), null);
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 10 }, 15.2), 'This video is over 15 seconds.');
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 10 * 1024 * 1024 + 1 }, 5), 'This video is over 10 MB.');
  assert.equal(fileProblem('video', { type: 'video/quicktime', size: 10 }, 5), 'Videos must be MP4.');
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 10 }, Number.NaN), "Couldn't read the video's length.");
});

test('#360 coach check reads the planner: which split days take the exercise', () => {
  assert.deepEqual(appearsIn(['Chest', 'Shoulders'], 'horizontal_push'), ['Push', 'Upper', 'Full body']);
  assert.deepEqual(appearsIn(['Biceps'], 'elbow_flexion'), ['Pull', 'Upper', 'Full body']);
  assert.deepEqual(appearsIn(['Calves'], 'calf_raise'), ['Legs', 'Lower', 'Full body']);
  assert.deepEqual(appearsIn([], 'squat'), []);
  assert.deepEqual(appearsIn(['Quads'], ''), []);
});

test('#360 the admin writes the same row the phone validates', () => {
  const row = validRow(rowOf(draftOf({ row: LANDMINE, status: 'published' })));
  assert.deepEqual(row, LANDMINE);
  const fields = fieldsOf(LANDMINE, 'published', new Date('2026-11-14T10:00:00Z'));
  assert.equal((fields.status as { stringValue: string }).stringValue, 'published');
  const decoded = plain(fields as never);
  assert.deepEqual(publishedRows([{ document: { fields } }]), [LANDMINE]);
  assert.equal(decoded.updatedAt, undefined, 'a timestamp is not a row field');
});

test('#360 the phone cache: load applies the last good copy, a bad reply keeps it, deploys keep the cache', async () => {
  const store = new Map<string, Map<string, Response>>();
  (globalThis as Record<string, unknown>).caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const cache = store.get(name)!;
      return { match: async (key: string) => cache.get(key)?.clone(), put: async (key: string, value: Response) => void cache.set(key, value) };
    },
  };
  (globalThis as Record<string, unknown>).location = { hostname: 'localhost' };
  (globalThis as Record<string, unknown>).__catalogTest = true;
  const fields = fieldsOf(LANDMINE, 'published', new Date());
  let reply: unknown = [{ document: { fields } }];
  (globalThis as Record<string, unknown>).fetch = async () => new Response(JSON.stringify(reply), { status: 200 });

  await loadCatalog();
  assert.ok(!EXERCISES.some((e) => e.id === LANDMINE.id), 'first visit: built-in list only');
  await refreshCatalog();
  assert.deepEqual([...store.keys()], [CATALOG_CACHE]);
  resetAdditions();
  await loadCatalog();
  assert.ok(EXERCISES.some((e) => e.id === LANDMINE.id), 'next open: the addition is in');

  reply = { error: { code: 500 } };
  await refreshCatalog();
  (globalThis as Record<string, unknown>).fetch = async () => { throw new TypeError('offline'); };
  await refreshCatalog();
  resetAdditions();
  await loadCatalog();
  assert.ok(EXERCISES.some((e) => e.id === LANDMINE.id), 'a bad reply or no connection keeps the last good copy');

  // sw.js deletes only fitbod-clone-* caches on activate, and keeps Storage photos in this one.
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /key\.startsWith\('fitbod-clone-'\) && key !== CACHE && key !== MEDIA/);
  assert.match(sw, new RegExp(`const CATALOG = '${CATALOG_CACHE}';`));
  assert.ok(!CATALOG_CACHE.startsWith('fitbod-clone-'));
});

test('#360 media: a video addition plays like a built-in one', () => {
  applyRows([{ ...LANDMINE, video: 'catalog/add-landmine-press/video-1.mp4' }], []);
  assert.equal(exerciseVideo(LANDMINE.id), mediaUrl('catalog/add-landmine-press/video-1.mp4'));
  assert.deepEqual(exerciseFrames(LANDMINE.id), [mediaUrl(LANDMINE.photo!)]);
});

test('#360 uploads are multipart with the content type in the metadata (a plain upload loses it)', async () => {
  const { uploadBody } = await import('../src/admin/api.ts');
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  const { type, body } = uploadBody('catalog/add-x/photo-1.webp', file, 'B');
  assert.equal(type, 'multipart/related; boundary=B');
  const text = await body.text();
  assert.ok(text.startsWith('--B\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{"name":"catalog/add-x/photo-1.webp","contentType":"image/webp"}\r\n--B\r\nContent-Type: image/webp\r\n\r\n'));
  assert.ok(text.endsWith('\r\n--B--'));
  assert.equal(body.size, text.length);
});
