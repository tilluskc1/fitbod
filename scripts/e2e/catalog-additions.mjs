// #360: exercises added from /admin reach phones. Firestore and Storage are mocked with context.route,
// so nothing reaches Google. The phone keeps its built-in list and adds the published rows on the next
// open; bad rows are dropped; the copy in the `catalog-v1` cache survives offline and a deploy; an
// unpublished exercise leaves planning, Replace and the exercise list but stays in Session history.
//   A. First open online: built-in list only; the download is cached.
//   B. Next open: Landmine Press is in the list (bad rows are not), Replace offers it with its photo,
//      it is swapped in, one set logged, the workout finished; the saved gym list keeps the added
//      machine and the addition's preference through that save.
//   C. Offline reload: the app opens and still lists it.
//   D. A deploy (every fitbod-clone-* cache dropped, worker gone) with Firestore down: still listed.
//   E. Unpublished: two opens later it is gone from the list; Session history still names it.
//   F. A first visit whose download fails, then offline: the built-in list, no errors.
// 390x844 and 360x780; nothing scrolls sideways.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { preview } from 'vite';
import { EXERCISES } from '../../src/data/exercises.ts';

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
const server = await preview({ preview: { port: 4211, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const BUILT_IN = EXERCISES.length;
const PHOTO = readFileSync(new URL('../../public/exercises/barbell-bench-press/0.jpg', import.meta.url));
const cors = { 'Access-Control-Allow-Origin': '*' };

const s = (value) => ({ stringValue: value });
const list = (values) => ({ arrayValue: { values: values.map(s) } });
const row = (fields) => ({ document: { name: `projects/home-strength/databases/(default)/documents/catalog/${fields.id.stringValue}`, fields } });
const LANDMINE = row({
  id: s('add-landmine-press'), kind: s('exercise'), status: s('published'), name: s('Landmine Press'),
  muscles: list(['Chest', 'Shoulders', 'Triceps']), pattern: s('horizontal_push'), item: s('barbell'),
  instructions: s('Wedge one end of a barbell in a corner. Press the other end up and forward from your chest.'),
  cues: list(['Brace your trunk', 'Finish with your arm long']),
  photo: s('catalog/add-landmine-press/photo-1731580000000.jpg'), source: s('Own photo, Home Strength team'),
  licence: s('own-work'), credit: s('Home Strength team'), updatedAt: { timestampValue: '2026-11-14T10:00:00Z' },
});
const BELT = row({ id: s('add-belt-squat'), kind: s('equipment'), status: s('published'), name: s('Belt squat'), family: s('Machine'),
  group: s('Legs machines'), updatedAt: { timestampValue: '2026-11-14T10:00:00Z' } });
const BAD = [
  row({ ...LANDMINE.document.fields, id: s('add-bad-pattern'), name: s('Bad Pattern Press'), pattern: s('banana') }),
  row({ ...LANDMINE.document.fields, id: s('barbell-bench-press'), name: s('Fake Bench') }),
  row({ ...LANDMINE.document.fields, id: s('add-no-rights'), name: s('No Rights Press'), licence: { nullValue: null } }),
  { readTime: '2026-11-14T10:00:00Z' },
];

/** One phone. `reply` is what the mock Firestore answers next: rows, 'down' or 'odd'. */
async function phone(browser, size) {
  const context = await browser.newContext({ viewport: size });
  const state = { reply: [LANDMINE, BELT, ...BAD], queries: 0, photos: 0 };
  await context.route('https://firestore.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (!request.url().includes(':runQuery')) return route.fulfill({ status: 404, headers: cors, body: '{}' });
    const where = request.postDataJSON()?.structuredQuery?.where?.fieldFilter;
    check(where?.field?.fieldPath === 'status' && where?.value?.stringValue === 'published', 'the phone asks for published rows only');
    state.queries += 1;
    if (state.reply === 'down') return route.abort('internetdisconnected');
    const body = state.reply === 'odd' ? { error: { code: 500 } } : state.reply;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
  await context.route('https://firebasestorage.googleapis.com/**', (route) => {
    state.photos += 1;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: cors, body: PHOTO });
  });
  await context.addInitScript(() => { window.__catalogTest = true; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, state, errors };
}

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** The cached copy as the phone holds it, once the download after the first render has landed. */
const cached = (page) => page.evaluate(async () => {
  for (let i = 0; i < 50; i += 1) {
    const hit = await (await caches.open('catalog-v1')).match('/catalog-v1.json');
    if (hit) return hit.json();
    await new Promise((done) => setTimeout(done, 100));
  }
  return null;
});

/** Plan > Equipment's "Browse all N exercises" count. */
async function listed(page) {
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('tab', { name: 'Equipment' }).click();
  const text = await page.getByText(/Browse all \d+ exercises/).first().innerText();
  return Number(/(\d+)/.exec(text)[1]);
}

async function reopen(page) {
  await page.reload();
  await page.waitForSelector('.t7-hero, .lg-ex');
}

async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
    .map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
}

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const browser = await chromium.launch();
try {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const where = `${size.width}x${size.height}`;
    const { context, page, state, errors } = await phone(browser, size);

    // A. First open: built-in only; the download lands in the cache for next time.
    await onboard(page);
    const first = await cached(page);
    check(first && first.published.map((r) => r.id).join() === 'add-landmine-press,add-belt-squat' && first.retired.length === 0,
      `${where}: cache after the first open ${JSON.stringify(first)?.slice(0, 200)}`);
    check((await listed(page)) === BUILT_IN, `${where}: first open lists only the built-in ${BUILT_IN}`);

    // B. Next open: it joins the list; Replace offers it with its photo; swap it in, log a set, finish.
    await reopen(page);
    check((await listed(page)) === BUILT_IN + 1, `${where}: next open lists ${BUILT_IN + 1}`);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const lead = (await page.locator('.lg-ex .lg-name, .lg-ex h2').first().innerText().catch(() => '')).trim();
    await page.locator('.lg-acts').getByRole('button', { name: 'Replace' }).click();
    const sheet = page.locator('[role="dialog"]');
    const option = sheet.locator('button.context-row', { hasText: 'Landmine Press' });
    check(await option.count() === 1, `${where}: Replace for ${lead || 'the lead'} offers Landmine Press`);
    for (const name of ['Bad Pattern Press', 'Fake Bench', 'No Rights Press']) {
      check(!(await sheet.getByText(name).count()), `${where}: a bad row (${name}) reached the phone`);
    }
    if (await option.count()) {
      await option.scrollIntoViewIfNeeded();
      if (shots) {
        await settle(page);
        await page.screenshot({ path: join(shots, `360-app-replace-${where}.png`) });
      }
      await option.click();
      await page.waitForSelector('.lg-ex');
      check((await page.locator('.lg-ex').first().innerText()).includes('Landmine Press'), `${where}: the logger now runs Landmine Press`);
      // Its photo shows where a built-in one does, from Storage.
      const img = page.locator('.lg-ex img[src*="firebasestorage.googleapis.com"]').first();
      check(await img.count() === 1, `${where}: Landmine Press shows its Storage photo in the logger`);
      if (await img.count()) await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle());
      if (shots) {
        await settle(page);
        await page.screenshot({ path: join(shots, `360-app-logger-${where}.png`) });
      }
      // (#379) Its photo opens the how-to player: the Storage photo, no clip yet, its own cues.
      await page.locator('.lg-thumb').click();
      const player = page.getByRole('dialog');
      check(await player.locator('.howto-media img[src*="firebasestorage.googleapis.com"]').count() >= 1, `${where}: the player shows Landmine Press's Storage photo`);
      check(await player.getByText('No video yet').count() === 1, `${where}: the player does not say "No video yet" for Landmine Press`);
      const cueText = (await player.locator('.howto-cues').innerText()).trim();
      check(cueText.includes('Wedge one end') && cueText.includes('Brace your trunk'), `${where}: the player's cues read "${cueText}"`);
      await page.keyboard.press('Escape');
      await page.locator('button.lg-check:not([disabled])').first().click();
      await page.getByRole('button', { name: 'Finish', exact: true }).click();
      await page.getByRole('button', { name: /Save completed work/ }).click();
      await page.getByRole('button', { name: 'Back to Today' }).click();
      await page.waitForSelector('.t7-hero');
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.history
      .flatMap((w) => w.exercises).find((e) => e.exerciseId === 'add-landmine-press'));
    check(saved?.name === 'Landmine Press' && saved.performed.some((set) => set.done), `${where}: the finished workout holds Landmine Press with a logged set`);
    check(state.photos > 0, `${where}: the photo was fetched from Storage`);
    const photoKept = await page.evaluate(async () => {
      for (let i = 0; i < 30; i += 1) {
        const keys = await (await caches.open('catalog-v1')).keys();
        if (keys.some((request) => request.url.includes('firebasestorage.googleapis.com'))) return true;
        await new Promise((done) => setTimeout(done, 100));
      }
      return false;
    });
    check(photoKept, `${where}: the worker kept the Storage photo in catalog-v1 for offline`);

    // The saved gym list holds the new machine and a "more" for the new exercise (as the My gym
    // sheet and the exercise list would save them). The next open must read both before it validates
    // the profile, or the next save (here a units change and back) drops them.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fitbod-clone-v1'));
      saved.state.profile.gymItems = ['leg-press', 'cable-stack', 'add-belt-squat', 'dumbbells', 'barbell', 'squat-rack', 'bench'];
      saved.state.profile.preferences = { ...(saved.state.profile.preferences ?? {}), 'add-landmine-press': 'more' };
      localStorage.setItem('fitbod-clone-v1', JSON.stringify(saved));
    });

    await reopen(page);
    {
      const settings = await (async () => {
        await page.getByRole('button', { name: 'Open profile and settings' }).click();
        const dialog = page.getByRole('dialog', { name: 'Training settings' });
        await dialog.waitFor();
        return dialog;
      })();
      const units = settings.getByRole('group', { name: /units/i });
      await units.getByRole('button', { name: 'lb' }).click();
      await units.getByRole('button', { name: 'kg' }).click();
      // About > Credits names the published addition's credit and licence (#254).
      const row = settings.getByRole('button', { name: 'About Home Strength' });
      await row.scrollIntoViewIfNeeded();
      await row.click();
      const about = page.getByRole('dialog', { name: 'About Home Strength' });
      await about.waitFor();
      const credits = about.locator('.about__credits');
      await credits.scrollIntoViewIfNeeded();
      check((await credits.innerText()).includes('Landmine Press: Home Strength team (own work).'), `${where}: About credits ${await credits.innerText()}`);
      if (shots) {
        await settle(page);
        await page.screenshot({ path: join(shots, `360-app-about-credits-${where}.png`) });
      }
      const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.profile);
      check(profile.unit === 'kg' && profile.gymItems?.includes('add-belt-squat') && profile.preferences?.['add-landmine-press'] === 'more',
        `${where}: a save dropped the lifter's added gym item or preference (${JSON.stringify({ unit: profile.unit, gymItems: profile.gymItems, preferences: profile.preferences })})`);
      await page.reload();
      await page.waitForSelector('.t7-hero');
    }

    // C. Offline: the app opens from the worker and still lists it.
    await context.setOffline(true);
    await reopen(page);
    check((await listed(page)) === BUILT_IN + 1, `${where}: offline still lists ${BUILT_IN + 1}`);
    await context.setOffline(false);

    // D. A deploy: activate drops every fitbod-clone-* cache; catalog-v1 stays. Firestore is down.
    state.reply = 'down';
    const dropped = await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      const names = (await caches.keys()).filter((name) => name.startsWith('fitbod-clone-'));
      await Promise.all(names.map((name) => caches.delete(name)));
      return { dropped: names.length, left: await caches.keys() };
    });
    check(dropped.left.includes('catalog-v1'), `${where}: a deploy left ${dropped.left}`);
    await reopen(page);
    check((await listed(page)) === BUILT_IN + 1, `${where}: after a deploy with Firestore down, still ${BUILT_IN + 1}`);
    // An odd reply keeps the last good copy too.
    state.reply = 'odd';
    await reopen(page);
    await page.waitForTimeout(400);
    await reopen(page);
    check((await listed(page)) === BUILT_IN + 1, `${where}: an odd reply keeps the last good copy`);

    // E. Unpublished: the next download moves it to retired; the open after that drops it from planning.
    state.reply = [];
    const queries = state.queries;
    await reopen(page);
    for (let i = 0; i < 50 && state.queries === queries; i += 1) await page.waitForTimeout(100);
    const after = await cached(page);
    await page.waitForFunction(async () => {
      const hit = await (await caches.open('catalog-v1')).match('/catalog-v1.json');
      return hit && (await hit.json()).published.length === 0;
    });
    await reopen(page);
    check((await listed(page)) === BUILT_IN, `${where}: unpublished, the list is back to ${BUILT_IN}`);
    await page.getByRole('button', { name: 'Progress' }).click();
    await page.getByRole('tab', { name: 'Session history' }).click();
    await page.locator('.history-row').first().click();
    const history = await page.locator('.history-detail').innerText();
    check(history.includes('Landmine Press'), `${where}: Session history still names Landmine Press`);
    check(await fitsWidth(page), `${where}: history scrolls sideways`);
    if (shots) {
      await settle(page);
      await page.screenshot({ path: join(shots, `360-app-history-${where}.png`) });
    }
    check(after !== null, `${where}: the cache survived the unpublish download`);
    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();

    // F. A first visit whose download fails, then offline: the built-in list, no errors.
    {
      const { context: fresh, page: p, state: st, errors: errs } = await phone(browser, size);
      st.reply = 'down';
      await onboard(p);
      await p.waitForTimeout(300);
      check(!(await p.evaluate(() => caches.has('catalog-v1').then((has) => has && caches.open('catalog-v1').then((c) => c.match('/catalog-v1.json')).then(Boolean)))),
        `${where}: a failed first download wrote a copy`);
      await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 }).catch(() => {});
      await fresh.setOffline(true);
      await reopen(p);
      check((await listed(p)) === BUILT_IN, `${where}: offline first visit plans from the built-in ${BUILT_IN}`);
      check(errs.length === 0, `${where}: page errors ${errs.join(' | ')}`);
      await fresh.close();
    }
    console.log(`${where}: first open ${BUILT_IN}, next open ${BUILT_IN + 1}, Replace swapped in Landmine Press, offline and after a deploy kept, unpublished back to ${BUILT_IN} with history kept`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('PASS: published additions join on the next open, bad rows never do, the copy survives offline and deploys, and unpublishing keeps history');
