// /admin Exercises > All exercises (#377). Google sign-in and Firestore are mocked with context.route, as in
// admin-catalog.mjs, so nothing reaches Google.
//   The count and the rows equal every built-in in src/data/exercises.ts plus the published and draft
//   additions; an unpublished addition lists, tagged, outside the count; a partial addition still lists.
//   Search and each filter narrow the list to exactly what `filterRows` gives (lesson 12); no match says so.
//   A row opens a read-only detail whose "Would appear in" equals the planner's `daysFor`.
//   Nothing here writes: no Firestore PATCH, no upload.
// 390x844, 360x780 and 1280x800; nothing scrolls sideways. E2E_SHOTS=<dir> saves list, filtered, empty
// and detail shots as <view>-<size>.png.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { preview } from 'vite';
import { EXERCISES } from '../../src/data/exercises.ts';
import { validRow } from '../../src/lib/additions.ts';
import { plain } from '../../src/lib/catalogSync.ts';
import { NO_FILTER, allExercises, countOf, daysFor, filterRows } from '../../src/admin/allExercisesData.ts';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
      return createRequire(join(root, 'noop.js'))('playwright');
    } catch {
      console.error('Playwright is not installed. Install it (npm i -g playwright) and run again.');
      process.exit(2);
    }
  }
}

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4213, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const DB = 'projects/home-strength/databases/(default)/documents';
const cors = { 'Access-Control-Allow-Origin': '*' };
const PHOTO = readFileSync(new URL('../../public/exercises/push-up/0.jpg', import.meta.url));

const GIS_STUB = `window.google = { accounts: { id: {
  initialize(options) { window.__gis = options; },
  renderButton(el) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Sign in with Google';
    b.onclick = () => window.__gis.callback({ credential: 'owner' });
    el.appendChild(b);
  },
} } };`;

const s = (value) => ({ stringValue: value });
const list = (values) => ({ arrayValue: { values: values.map(s) } });
const ts = { timestampValue: '2026-11-13T10:00:00Z' };
const SEED = [
  { id: s('add-landmine-press'), kind: s('exercise'), status: s('published'), name: s('Landmine Press'), muscles: list(['Chest', 'Shoulders']),
    pattern: s('horizontal_push'), item: s('barbell'), instructions: s('Press the bar end up and forward.'), cues: list(['Brace', 'Elbow at 45 degrees']),
    photo: s('catalog/add-landmine-press/photo-1.jpg'), source: s('https://example.org/landmine'), licence: s('cc-by'), credit: s('Jo Lifter'), updatedAt: ts },
  { id: s('add-belt-squat'), kind: s('equipment'), status: s('published'), name: s('Belt squat'), family: s('Machine'), group: s('Legs machines'), updatedAt: ts },
  { id: s('add-belt-squat-squat'), kind: s('exercise'), status: s('published'), name: s('Belt Squat'), muscles: list(['Quads', 'Glutes']),
    pattern: s('squat'), item: s('add-belt-squat'), instructions: s('Squat with the belt at your hips.'), cues: list([]), updatedAt: ts },
  { id: s('add-t-bar-row'), kind: s('exercise'), status: s('draft'), name: s('T-Bar Row'), muscles: list(['Back', 'Biceps']),
    pattern: s('horizontal_pull'), item: s('barbell'), instructions: s('Row the bar end to your chest.'), cues: list([]), updatedAt: ts },
  { id: s('add-old-curl'), kind: s('exercise'), status: s('unpublished'), name: s('Old Curl'), muscles: list(['Biceps']),
    pattern: s('elbow_flexion'), item: s('bodyweight'), instructions: s('Curl.'), cues: list([]), updatedAt: ts },
  // Partial (lesson 41): no instructions and a muscle the app does not know. validRow refuses it; the list keeps it.
  { id: s('add-half-squat'), kind: s('exercise'), status: s('draft'), name: s('Half Squat'), muscles: list(['Quads', 'Neck']),
    pattern: s('squat'), item: s('bodyweight'), updatedAt: ts },
];
const RAW = SEED.map((fields) => plain(fields));
check(validRow(RAW.at(-1)) === null, 'the partial seed row is valid; it tests nothing');
// What the page should hold, from the same pure functions over the same rows.
const ENTRIES = RAW.flatMap((fields) => { const row = validRow(fields); return row ? [{ row, status: fields.status }] : []; });
const ROWS = allExercises(ENTRIES, RAW);
const COUNT = countOf(ROWS);
const BUILT_INS = EXERCISES.filter((exercise) => !exercise.id.startsWith('add-')).length;
check(COUNT.builtIn === BUILT_INS && COUNT.total === BUILT_INS + 4 && COUNT.unpublished === 1, `fixture count ${JSON.stringify(COUNT)}`);

async function open(browser, size) {
  const context = await browser.newContext({ viewport: size });
  const log = { writes: [] };
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: GIS_STUB }));
  await context.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ idToken: 'tok-owner' }) }));
  await context.route('https://firestore.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
    if (request.headers().authorization !== 'Bearer tok-owner') return reply(401, {});
    const url = request.url();
    if (request.method() !== 'GET' && !url.includes(':runQuery')) {
      log.writes.push(`${request.method()} ${url}`);
      return reply(200, {});
    }
    if (url.includes('/catalog?')) return reply(200, { documents: SEED.map((fields) => ({ name: `${DB}/catalog/${fields.id.stringValue}`, fields })) });
    if (url.includes(':runQuery')) return reply(200, [{ readTime: '2026-11-14T10:00:00Z' }]);
    if (url.includes('/feedback?')) return reply(200, {});
    failures.push(`unexpected Firestore call ${request.method()} ${url}`);
    return reply(404, {});
  });
  await context.route('https://firebasestorage.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET') log.writes.push(`${request.method()} ${request.url()}`);
    return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: cors, body: PHOTO });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}admin`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('tab', { name: 'Exercises' }).click();
  await page.getByRole('button', { name: 'All exercises' }).click();
  await page.locator('.adm-all__row').first().waitFor();
  return { context, page, errors, log };
}

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Settle every finite animation and every image in view, then shoot the screen (lesson 29); the detail shoots whole. */
const shot = async (page, name, where, fullPage = false) => {
  if (!shots) return;
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForFunction(() => [...document.images].every((img) => {
    const box = img.getBoundingClientRect();
    return box.bottom < 0 || box.top > innerHeight || (img.complete && img.naturalWidth > 0);
  }), null, { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: join(shots, `${name}-${where}.png`), fullPage });
};
const names = (page) => page.locator('.adm-all__name').allInnerTexts();
const select = (page, label) => page.getByRole('combobox', { name: label });

const browser = await chromium.launch();
try {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 780 }, { width: 1280, height: 800 }]) {
    const where = `${size.width}x${size.height}`;
    const { context, page, errors, log } = await open(browser, size);

    // The list: every built-in plus every addition exercise, once each, in the page's order.
    const listed = await names(page);
    check(listed.length === ROWS.length && listed.join('|') === ROWS.map((row) => row.name).join('|'), `${where}: ${listed.length} rows listed, expected ${ROWS.length}`);
    const counted = await page.locator('.adm-all__count').innerText();
    const expected = `${COUNT.total} exercises: ${COUNT.builtIn} built-in, ${COUNT.added} added, ${COUNT.draft} draft. Also ${COUNT.unpublished} unpublished, not counted.`;
    check(counted === expected, `${where}: count "${counted}" vs "${expected}"`);
    const tagOf = (name) => page.locator('.adm-all__row').filter({ has: page.locator('.adm-all__name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).locator('.adm-chip').innerText();
    for (const [name, tag] of [['Barbell Bench Press', 'Built-in'], ['Landmine Press', 'Added'], ['T-Bar Row', 'Draft'], ['Old Curl', 'Unpublished'], ['Half Squat', 'Draft']]) {
      check((await tagOf(name)) === tag, `${where}: ${name} tag ${await tagOf(name)}, expected ${tag}`);
    }
    check(!listed.includes('Belt squat'), `${where}: equipment listed as an exercise`);
    const thumbs = await page.locator('.adm-all__row img').count();
    check(thumbs >= BUILT_INS - 2, `${where}: only ${thumbs} rows have a photo`);
    check(await fitsWidth(page), `${where}: list scrolls sideways`);
    await shot(page, 'list', where);

    // Search and each filter narrow the list to exactly the pure filter's rows.
    const expectNames = (filter) => filterRows(ROWS, { ...NO_FILTER, ...filter }).map((row) => row.name).join('|');
    const steps = [
      [{ query: 'press' }, async () => page.getByRole('searchbox', { name: 'Search' }).fill('press')],
      [{ muscle: 'Chest' }, async () => select(page, 'Primary muscle').selectOption('Chest')],
      [{ pattern: 'hinge' }, async () => select(page, 'Pattern').selectOption('hinge')],
      [{ equipment: 'Machine' }, async () => select(page, 'Equipment').selectOption('Machine')],
    ];
    for (const [filter, apply] of steps) {
      await apply();
      const now = await names(page);
      const want = expectNames(filter);
      check(now.length > 0 && now.length < ROWS.length && now.join('|') === want, `${where}: ${JSON.stringify(filter)} shows ${now.length}: ${now.join('|')} vs ${want}`);
      check((await page.locator('.adm-all__showing .adm-muted').innerText()) === `Showing ${now.length} of ${ROWS.length}`, `${where}: ${JSON.stringify(filter)} showing line`);
      await page.getByRole('button', { name: 'Clear filters' }).click();
      check((await names(page)).length === ROWS.length, `${where}: Clear filters after ${JSON.stringify(filter)}`);
    }
    await select(page, 'Primary muscle').selectOption('Chest');
    await select(page, 'Equipment').selectOption('Dumbbell');
    const both = await names(page);
    check(both.join('|') === expectNames({ muscle: 'Chest', equipment: 'Dumbbell' }) && both.length > 0, `${where}: Chest + Dumbbell ${both}`);
    check(await fitsWidth(page), `${where}: filtered list scrolls sideways`);
    await shot(page, 'filtered', where);

    // No match says so.
    await page.getByRole('searchbox', { name: 'Search' }).fill('zercher');
    check((await names(page)).length === 0, `${where}: rows under a search that matches nothing`);
    check(await page.getByText('No exercise matches this search and these filters.').isVisible(), `${where}: empty result not said`);
    check(await fitsWidth(page), `${where}: empty result scrolls sideways`);
    await shot(page, 'empty', where);
    await page.getByRole('button', { name: 'Clear filters' }).click();

    // Detail: read-only, and "Would appear in" is the planner's own answer.
    for (const name of ['Deadlift', 'Pull-Up', 'Landmine Press', 'Barbell Bench Press']) {
      await page.getByRole('searchbox', { name: 'Search' }).fill(name);
      await page.locator('.adm-all__row').filter({ has: page.locator('.adm-all__name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
      const row = ROWS.find((item) => item.name === name);
      const coach = await page.locator('.adm-coach p').first().innerText();
      check(coach === `Would appear in: ${daysFor(row).join(', ')}.`, `${where}: ${name} coach "${coach}" vs planner ${daysFor(row)}`);
      check(!(await page.locator('.adm-all__detail input:not(.adm-media input), .adm-all__detail textarea, .adm-all__detail select:not(.adm-media select)').count()), `${where}: ${name} detail has a form control outside the Video panel (#387)`);
      check(!(await page.locator('.adm-all__detail button').filter({ hasText: /Publish|Save|Edit/ }).filter({ hasNot: page.locator('.adm-media') }).evaluateAll((buttons) => buttons.filter((button) => !button.closest('.adm-media')).length)), `${where}: ${name} detail can write outside the Video panel (#387)`);
      check((await page.locator('.adm-all__detail').innerText()).includes(row.instructions), `${where}: ${name} instructions`);
      if (name === 'Landmine Press') {
        const text = await page.locator('.adm-all__detail').innerText();
        check(text.includes('Jo Lifter (CC BY)') && text.includes('Elbow at 45 degrees'), `${where}: Landmine credit or cues missing`);
      }
      if (name === 'Barbell Bench Press') {
        check((await page.locator('.adm-all__detail').innerText()).includes('free-exercise-db (public domain)'), `${where}: built-in credit missing`);
        check(await fitsWidth(page), `${where}: detail scrolls sideways`);
        await shot(page, 'detail', where, true);
      }
      await page.getByRole('button', { name: '‹ Back to all exercises' }).click();
    }
    // The partial addition opens too, and says why phones skip it.
    await page.getByRole('searchbox', { name: 'Search' }).fill('Half Squat');
    await page.locator('.adm-all__row').first().click();
    check(await page.getByText('Some saved data is missing or not valid.', { exact: false }).isVisible(), `${where}: partial row not flagged`);
    await page.getByRole('button', { name: '‹ Back to all exercises' }).click();

    // Back on "Added here", the #360 list is unchanged: additions only.
    await page.getByRole('button', { name: 'Added here' }).click();
    await page.getByRole('button', { name: 'Add exercise' }).waitFor();
    check(!(await page.getByText('Barbell Bench Press').count()), `${where}: built-ins leaked into the Added list`);

    check(log.writes.length === 0, `${where}: the read-only list wrote ${log.writes.join(', ')}`);
    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();
    console.log(`${where}: ${ROWS.length} rows (${COUNT.total} counted), search and 3 filters, empty result, 4 details match the planner, no writes`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('PASS: /admin All exercises lists every built-in and addition, filters narrow it, details read the planner, nothing writes');
