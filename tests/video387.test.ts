import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { applyRows, additionCredits, mediaUrl, resetAdditions, validMedia, validRow, type MediaRow } from '../src/lib/additions.ts';
import { fieldsOf, fileProblem, overlayPath, overlayProblems, overlayRow, type OverlayDraft } from '../src/lib/adminCatalog.ts';
import { CATALOG_CACHE, loadCatalog, nextCopy, publishedMedia, publishedRows, refreshCatalog } from '../src/lib/catalogSync.ts';
import { exerciseFrames, exerciseVideo } from '../src/lib/media.ts';

/* #387: a video the owner attaches to a built-in exercise. */

const ID = 'barbell-bench-press';
const BENCH: MediaRow = {
  kind: 'media', id: `media-${ID}`, exercise: ID, video: overlayPath(`media-${ID}`.slice(6), 1731580000000),
  source: 'Own footage, Home Strength team', licence: 'own-work', credit: 'Home Strength team',
};
const RIGHTS: OverlayDraft = { source: 'Own footage', licence: 'own-work', credit: 'Home Strength team' };
const fire = (status: string, row: MediaRow = BENCH) => ({ document: { fields: fieldsOf(row, status as 'published', new Date('2026-11-21T10:00:00Z')) } });

test.afterEach(() => resetAdditions());

test('#387 a valid overlay passes; every drift is dropped, never thrown', () => {
  assert.deepEqual(validMedia(BENCH), BENCH);
  const bad: Record<string, unknown>[] = [
    { ...BENCH, kind: 'exercise' },
    { ...BENCH, id: 'barbell-bench-press' },
    { ...BENCH, id: 'media-push-up' },
    { ...BENCH, exercise: 'add-landmine-press', id: 'media-add-landmine-press', video: 'catalog/media-add-landmine-press/video-1.mp4' },
    { ...BENCH, video: undefined },
    { ...BENCH, video: 'https://evil.example/x.mp4' },
    { ...BENCH, video: 'catalog/media-push-up/video-1.mp4' },
    { ...BENCH, video: `catalog/media-${ID}/photo-1.jpg` },
    { ...BENCH, licence: undefined },
    { ...BENCH, licence: 'all-rights-reserved' },
    { ...BENCH, credit: ' ' },
    { ...BENCH, source: '' },
  ];
  for (const row of [...bad, null, 'row', 42, [], {}]) assert.equal(validMedia(row), null, JSON.stringify(row));
  assert.equal(validRow(BENCH), null, 'an overlay is never read as an exercise or equipment row');
});

test('#387 a published overlay gives the built-in its video; the built-in data is untouched', () => {
  const before = JSON.stringify(EXERCISES.find((e) => e.id === ID));
  const frames = [...exerciseFrames(ID)];
  assert.equal(exerciseVideo(ID), null, 'no overlay: no video (today)');
  applyRows([], [], [BENCH]);
  assert.equal(exerciseVideo(ID), mediaUrl(BENCH.video));
  assert.deepEqual(exerciseFrames(ID), frames, 'the photos stay');
  assert.equal(JSON.stringify(EXERCISES.find((e) => e.id === ID)), before);
  assert.deepEqual(additionCredits(), ['Barbell Bench Press video: Home Strength team (own work).']);
  assert.equal(exerciseVideo('push-up'), null, 'other exercises are untouched');
  resetAdditions();
  assert.equal(exerciseVideo(ID), null, 'the test reset puts it back');
});

test('#387 an overlay on an unknown exercise or an addition is ignored', () => {
  applyRows([], [], [{ ...BENCH, exercise: 'no-such-move', id: 'media-no-such-move', video: 'catalog/media-no-such-move/video-1.mp4' }]);
  assert.deepEqual(additionCredits(), []);
});

test('#387 unpublishing returns the exercise to no video; a copy kept before #387 still loads', async () => {
  const published = nextCopy(null, [], [BENCH]);
  assert.deepEqual(published.media, [BENCH]);
  const gone = nextCopy(published, [], []);
  assert.deepEqual(gone.media, [], 'the next copy holds no overlay once it is unpublished');
  applyRows(gone.published, gone.retired, gone.media);
  assert.equal(exerciseVideo(ID), null);

  const store = new Map<string, Response>();
  (globalThis as Record<string, unknown>).caches = { open: async () => ({ match: async (key: string) => store.get(key)?.clone(), put: async (key: string, value: Response) => void store.set(key, value) }) };
  (globalThis as Record<string, unknown>).location = { hostname: 'localhost' };
  (globalThis as Record<string, unknown>).__catalogTest = true;
  store.set('/catalog-v1.json', new Response(JSON.stringify({ published: [], retired: [] })));
  resetAdditions();
  await loadCatalog();
  assert.equal(exerciseVideo(ID), null, 'a copy without overlays: nothing breaks');

  // Published, cached, applied on the next open; then unpublished, refreshed, applied on the one after.
  let reply: unknown = [fire('published')];
  (globalThis as Record<string, unknown>).fetch = async () => new Response(JSON.stringify(reply), { status: 200 });
  await refreshCatalog();
  assert.ok(store.has('/catalog-v1.json') && CATALOG_CACHE === 'catalog-v1');
  resetAdditions();
  await loadCatalog();
  assert.equal(exerciseVideo(ID), mediaUrl(BENCH.video), 'next open: it plays');
  reply = [];
  await refreshCatalog();
  resetAdditions();
  await loadCatalog();
  assert.equal(exerciseVideo(ID), null, 'unpublished: No video yet again');
  // A failed refresh keeps the last good copy.
  reply = [fire('published')];
  await refreshCatalog();
  (globalThis as Record<string, unknown>).fetch = async () => { throw new TypeError('offline'); };
  await refreshCatalog();
  resetAdditions();
  await loadCatalog();
  assert.equal(exerciseVideo(ID), mediaUrl(BENCH.video), 'offline: the kept copy still has it');
});

test('#387 the download splits overlays from additions, and an odd reply gives neither', () => {
  assert.deepEqual(publishedMedia([fire('published'), { readTime: 'x' }]), [BENCH]);
  assert.deepEqual(publishedRows([fire('published')]), []);
  assert.deepEqual(publishedMedia({ error: 1 }), []);
  assert.deepEqual(publishedMedia([{ document: { fields: { ...fire('published').document.fields, licence: { stringValue: 'x' } } } }]), []);
});

test('#387 admin: a clip and its rights are required, the files keep #360 caps, the row matches the phone', () => {
  assert.deepEqual(overlayProblems(RIGHTS, true), []);
  assert.deepEqual(overlayProblems(RIGHTS, false), ['Choose a video.']);
  assert.equal(overlayProblems({ ...RIGHTS, licence: '' }, true).length, 1);
  assert.equal(overlayProblems({ ...RIGHTS, credit: ' ' }, true).length, 1);
  assert.equal(overlayProblems({ ...RIGHTS, source: '' }, true).length, 1);
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 11 * 1024 * 1024 }, 5), 'This video is over 10 MB.');
  assert.equal(fileProblem('video', { type: 'video/mp4', size: 1000 }, 16), 'This video is over 15 seconds.');
  assert.equal(fileProblem('video', { type: 'video/quicktime', size: 1000 }, 5), 'Videos must be MP4.');
  assert.deepEqual(overlayRow(ID, BENCH.video, RIGHTS), { ...BENCH, source: 'Own footage' });
  assert.equal(overlayRow(ID, BENCH.video, { ...RIGHTS, licence: '' }), null);
  assert.equal(overlayRow(ID, `catalog/${ID}/video-1.mp4`, RIGHTS), null, 'the clip must sit in the overlay folder');
});

test('#387 rules: published overlays are public, only the admin writes, and the admin writes exactly what the rules accept', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /allow read: if resource\.data\.status == 'published' \|\| isAdmin\(\);/);
  assert.match(rules, /allow create, update: if isAdmin\(\) && \(catalogRow\(id\) \|\| mediaRow\(id\)\);/);
  assert.doesNotMatch(rules, /allow (delete|write)/);
  assert.doesNotMatch(rules, /@[a-z0-9-]+\.[a-z]/i, 'no real address committed');
  const fn = rules.slice(rules.indexOf('function mediaRow'), rules.indexOf('match /catalog/'));
  // Every field the admin writes is in the rules' list, and the list has nothing the admin never writes.
  const only = [...(fn.match(/hasOnly\(\[([^\]]*)\]\)/)![1].matchAll(/'([^']+)'/g))].map((m) => m[1]).sort();
  const written = Object.keys(fieldsOf(BENCH, 'published', new Date())).sort();
  assert.deepEqual(written, only);
  assert.match(fn, /hasAll\(\['id', 'kind', 'status', 'exercise', 'video', 'source', 'licence', 'credit', 'updatedAt'\]\)/);
  // The id and the clip path the admin builds satisfy the rules' own patterns (RE2 and JS agree on these).
  const idPattern = new RegExp(`^${fn.match(/id\.matches\('([^']+)'\)/)![1]}$`);
  const pathTail = new RegExp(`^${fn.match(/'\/(video[^']+)'\)/)![1]}$`);
  for (const exercise of EXERCISES.map((e) => e.id)) {
    const id = `media-${exercise}`;
    assert.ok(id.length <= 48 && idPattern.test(id), id);
    assert.ok(pathTail.test(overlayPath(exercise, Date.now()).split('/')[2]), exercise);
  }
  assert.equal(idPattern.test('media-Bad'), false);
  for (const status of ['draft', 'published', 'unpublished']) assert.ok(fn.includes(`'${status}'`));
  assert.match(fn, /id == 'media-' \+ d\.exercise/);
  for (const licence of ['own-work', 'cc0', 'cc-by', 'public-domain']) assert.ok(fn.includes(`'${licence}'`));
  // Additions' own rules are unchanged: they still demand an add- id.
  assert.match(rules, /id\.matches\('add-\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*'\)/);
});

test('#387 storage rules: the overlay folder takes an MP4 up to 10 MB, nothing else, admin only', () => {
  const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
  assert.match(rules, /allow read: if true;/);
  assert.match(rules, /id\.matches\('media-\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*'\)\s*&& file\.matches\('video-\[0-9\]\{1,15\}\[\.\]mp4'\)\s*&& request\.resource\.contentType == 'video\/mp4'\s*&& request\.resource\.size <= 10 \* 1024 \* 1024\)\);/);
  assert.match(rules, /allow create, update: if isAdmin\(\)/);
  assert.match(rules, /allow delete: if isAdmin\(\);/);
  assert.doesNotMatch(rules, /@[a-z0-9-]+\.[a-z]/i);
});

/** Runs public/sw.js against fake globals and returns its fetch handler. */
function worker(files: Map<string, Blob>, network: () => Promise<Response>) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = {
    match: async (key: string) => (files.has(key) ? new Response(files.get(key)) : undefined),
    put: async (key: string, response: Response) => void files.set(key, await response.blob()),
  };
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  new Function('self', 'caches', 'fetch', 'URL', 'Response', 'setTimeout', 'clearTimeout', source)(
    { addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn), location: { origin: 'https://app.example' }, skipWaiting() {}, clients: { claim() {} } },
    { open: async () => cache, keys: async () => [] }, network, URL, Response, setTimeout, clearTimeout,
  );
  return async (url: string, range?: string) => {
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers.fetch({
      request: { method: 'GET', url, destination: 'video', mode: 'no-cors', headers: new Headers(range ? { range } : {}) },
      respondWith: (p: Promise<Response>) => { response = p; },
      waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    });
    if (!response) return undefined;
    const done = await response;
    await Promise.all(waits);
    return done;
  };
}

test('#387 the worker keeps a seen clip and answers byte ranges from it offline', async () => {
  const URL_ = mediaUrl(BENCH.video);
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
  const files = new Map<string, Blob>();
  let online = true;
  const serve = worker(files, async () => {
    if (!online) throw new TypeError('offline');
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
  });
  const added = await serve(mediaUrl('catalog/add-landmine-press/video-1.mp4'), 'bytes=0-');
  assert.equal(added, undefined, 'a video on an added exercise is not the worker\'s: network only, as before');
  const first = (await serve(URL_, 'bytes=0-'))!;
  assert.equal(first.status, 200, 'first view goes through the network');
  assert.ok(files.has(URL_), 'and the whole clip is kept');
  online = false;
  const ranged = await serve(URL_, 'bytes=10-19');
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 10-19/100');
  assert.deepEqual([...new Uint8Array(await ranged.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const tail = await serve(URL_, 'bytes=95-');
  assert.equal(tail.headers.get('Content-Range'), 'bytes 95-99/100');
  const whole = await serve(URL_);
  assert.equal(whole.status, 200);
  assert.equal((await whole.arrayBuffer()).byteLength, 100);
  assert.equal((await serve(URL_, 'bytes=500-')).status, 416);
  const unseen = await serve(`${URL_}x`, 'bytes=0-');
  assert.equal(unseen.status, 504, 'a clip never seen online and no connection: the player falls back to the photos');
});
