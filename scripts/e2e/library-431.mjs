// The exercise library check (#431), 390x844 and 360x780:
// - a fresh user fetches nothing from /library/ until the Exercises screen opens (Plan > Equipment);
// - the list: loading state, 50 rows with the built-ins first, "Show 50 more" reveals the next 50;
// - search: a linked duplicate ("pushups") finds the built-in and is never listed; "db" expands; a
//   muscle chip with no match shows the empty state and "Clear muscle filter" clears it;
// - detail: loading, instructions, facts and the browse-only footer (library rows only);
// - offline before the first load: the list and the detail say so, and Try again recovers;
// - a saved workout naming a library row opens in Session history with the library file missing,
//   its stored name shown and its stored sets unchanged;
// - with the service worker, a list and detail seen once open again offline from `library-v1`.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//   E2E_SHOTS=<dir>    also writes screenshots there
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { preview } from 'vite';

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

const KEY = 'fitbod-clone-v1';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const flat = (text) => text.replace(/\s+/g, ' ').trim();

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4193, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const shot = async (page, name, where) => {
  if (shots) await page.screenshot({ path: join(shots, `431-${name}-${where}.png`) });
};

const LIB_ROW = 'lib-f-Band_Good_Morning';
const LIB_NAME = 'Band Good Morning';

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

async function openExercises(page) {
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('tab', { name: 'Equipment' }).click();
  await page.getByRole('button', { name: /^Search \d+ exercises$/ }).click();
  await page.getByRole('heading', { name: 'Exercises.' }).waitFor();
}

const rowNames = (page) => page.locator('.ex-row__name').allInnerTexts();
/** Holds a route until released, to see a loading state. */
function hold(page, pattern) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return page.route(pattern, async (route) => {
    await gate;
    await route.continue();
  }).then(() => release);
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const errors = [];

    // 1. List, search, show more, detail. No worker here, so routes see every request.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      const fetched = [];
      page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/library/')) fetched.push(request.url()); });
      await onboard(page);
      await page.waitForTimeout(2500);
      check(fetched.length === 0, `${where}: a fresh user fetched the library at boot (${fetched})`);

      const releaseIndex = await hold(page, '**/library/index.*');
      await openExercises(page);
      const loading = page.getByRole('status').filter({ hasText: 'Loading exercises…' });
      check(await loading.isVisible(), `${where}: list loading status`);
      check(await page.locator('.ex-row--skeleton').count() > 0, `${where}: list skeleton rows`);
      check(await page.locator('#ex-search').isVisible(), `${where}: search shows while loading`);
      await shot(page, 'list-loading', where);
      releaseIndex();
      await page.locator('.ex-row__name').first().waitFor();

      check(flat(await page.getByRole('button', { name: 'Plan', exact: true }).innerText()) === 'Plan', `${where}: back link reads Plan`);
      const chips = (await page.locator('.chip-row .chip').allInnerTexts()).map(flat);
      check(JSON.stringify(chips) === JSON.stringify(['All', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Stretching']), `${where}: chips ${chips}`);
      let names = await rowNames(page);
      check(names.length === 50, `${where}: first page shows 50 rows (${names.length})`);
      const more = page.getByRole('button', { name: /^Show \d+ more$/ });
      check(flat(await more.innerText()) === 'Show 50 more', `${where}: "${flat(await more.innerText())}"`);
      await shot(page, 'list', where);
      await more.click();
      names = await rowNames(page);
      check(names.length === 100, `${where}: Show more reveals 50 more (${names.length})`);
      check(names.length === new Set(names).size || names.filter((n, i) => names.indexOf(n) !== i).length < 3, `${where}: rows repeat`);

      await page.locator('#ex-search').fill('pushups');
      names = await rowNames(page);
      check(names[0] === 'Push-Up', `${where}: "pushups" finds the built-in first (${names.slice(0, 3)})`);
      check(!names.includes('Pushups'), `${where}: the linked duplicate is not listed`);
      await page.locator('#ex-search').fill('db row');
      names = await rowNames(page);
      check(names.length > 0 && names.every((name) => /row/i.test(name)), `${where}: "db row" lists rows (${names.slice(0, 3)})`);
      await shot(page, 'search', where);

      await page.locator('.chip-row .chip', { hasText: 'Chest' }).click();
      await page.locator('#ex-search').fill('zzqx');
      const empty = flat(await page.locator('.ex-state').innerText());
      check(empty.includes('No matches for "zzqx" with Chest selected') && empty.includes('Check the spelling, or search all muscles.'), `${where}: empty copy (${empty})`);
      await shot(page, 'empty', where);
      await page.getByRole('button', { name: 'Clear muscle filter' }).click();
      check(await page.locator('.chip-row .chip', { hasText: 'All' }).getAttribute('aria-pressed') === 'true', `${where}: the filter is cleared`);

      await page.locator('#ex-search').fill(LIB_NAME);
      const releaseText = await hold(page, '**/library/text.*');
      await page.locator('.ex-row', { hasText: LIB_NAME }).first().click();
      check(await page.getByRole('status').filter({ hasText: 'Loading instructions…' }).isVisible(), `${where}: detail loading status`);
      await shot(page, 'detail-loading', where);
      releaseText();
      await page.locator('ol.ex-steps li').first().waitFor();
      const facts = (await page.locator('.ex-facts dt').allInnerTexts()).map(flat);
      check(JSON.stringify(facts) === JSON.stringify(['Muscle', 'Equipment', 'Level', 'You log']), `${where}: facts ${facts}`);
      check(flat(await page.locator('.ex-footer').innerText()) === "Browse only for now. Library exercises aren't used in generated plans.", `${where}: browse-only footer`);
      check(await page.getByRole('heading', { name: LIB_NAME }).isVisible(), `${where}: detail title`);
      await shot(page, 'detail', where);
      await page.getByRole('button', { name: 'Exercises', exact: true }).click();
      check(await page.locator('#ex-search').inputValue() === LIB_NAME, `${where}: back keeps the search`);

      await page.locator('#ex-search').fill('push-up');
      await page.locator('.ex-row', { hasText: 'Push-Up' }).first().click();
      check(await page.locator('.ex-footer').count() === 0, `${where}: a built-in has no browse-only footer`);
      check(await page.locator('ol.ex-steps li').count() > 0, `${where}: a built-in shows its instructions`);
      await page.getByRole('button', { name: 'Exercises', exact: true }).click();
      await page.getByRole('button', { name: 'Plan', exact: true }).first().click();
      check(await page.getByRole('tab', { name: 'Equipment' }).isVisible(), `${where}: back to Plan`);
      await context.close();
    }

    // 2. Offline before the first load: list and detail say so; Try again recovers.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await onboard(page);
      await page.route('**/library/**', (route) => route.abort('internetdisconnected'));
      await openExercises(page);
      const offline = page.locator('.ex-state');
      await offline.waitFor();
      check(flat(await offline.innerText()).startsWith("The exercise list needs a connection once. Your plan and everything you've logged still work."), `${where}: list offline copy (${flat(await offline.innerText())})`);
      await shot(page, 'list-offline', where);
      await page.unroute('**/library/**');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.locator('.ex-row__name').first().waitFor();

      await page.route('**/library/text.*', (route) => route.abort('internetdisconnected'));
      await page.locator('#ex-search').fill(LIB_NAME);
      await page.locator('.ex-row', { hasText: LIB_NAME }).first().click();
      await page.locator('.ex-state').waitFor();
      check(flat(await page.locator('.ex-state').innerText()).startsWith("Instructions aren't saved on this phone yet. Connect once and they stay for offline use."), `${where}: detail offline copy`);
      await shot(page, 'detail-offline', where);
      await page.unroute('**/library/text.*');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.locator('ol.ex-steps li').first().waitFor();
      await context.close();
    }

    // 3. A saved workout naming a library row, library file missing: history shows the stored name; sets unchanged.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await onboard(page);
      const before = await page.evaluate(([key, id, name]) => {
        const saved = JSON.parse(localStorage.getItem(key));
        const record = {
          id: 'w-lib-431', date: '2026-11-20T08:00:00.000Z', endedAt: '2026-11-20T08:40:00.000Z', name: 'Library day',
          durationMin: 40, dayIndex: 0, status: 'completed', completedEarly: false,
          exercises: [{ exerciseId: id, name, planned: [{ weight: 0, reps: 15 }, { weight: 0, reps: 15 }],
            performed: [{ weight: 0, reps: 15, done: true, completedAt: '2026-11-20T08:20:00.000Z' },
              { weight: 0, reps: 12, done: true, completedAt: '2026-11-20T08:22:00.000Z' }] }],
        };
        saved.state.history.push(record);
        localStorage.setItem(key, JSON.stringify(saved));
        return JSON.stringify(record.exercises);
      }, [KEY, LIB_ROW, LIB_NAME]);
      const asked = [];
      await page.route('**/library/**', (route) => { asked.push(route.request().url()); return route.abort('internetdisconnected'); });
      await page.reload();
      await page.waitForSelector('.t7-hero');
      await page.waitForTimeout(2500);
      check(asked.some((u) => u.includes('/library/index.')), `${where}: saved library data asks for the index at idle`);
      await page.getByRole('button', { name: 'Progress', exact: true }).click();
      await page.getByRole('tab', { name: 'Session history' }).click();
      await page.locator('.history-row', { hasText: 'Library day' }).click();
      check(flat(await page.locator('.history-detail').innerText()).includes(LIB_NAME), `${where}: history shows the stored name`);
      await shot(page, 'history-offline', where);
      const after = await page.evaluate(([key, id]) => {
        const { state } = JSON.parse(localStorage.getItem(key));
        return JSON.stringify(state.history.find((w) => w.id === 'w-lib-431').exercises.map((e) => (e.exerciseId === id ? e : null)));
      }, [KEY, LIB_ROW]);
      check(after === before, `${where}: the stored sets are unchanged (${after})`);
      await context.close();
    }

    // 4. With the worker: seen once online, the list and a detail open again offline from library-v1.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'allow' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(url);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload();
      await page.getByRole('button', { name: 'Get started' }).waitFor();
      await onboard(page);
      await openExercises(page);
      await page.locator('.ex-row__name').first().waitFor();
      await page.locator('#ex-search').fill(LIB_NAME);
      await page.locator('.ex-row', { hasText: LIB_NAME }).first().click();
      await page.locator('ol.ex-steps li').first().waitFor();
      const kept = await page.evaluate(async () => (await (await caches.open('library-v1')).keys()).map((r) => new URL(r.url).pathname.split('.')[0]).sort());
      check(JSON.stringify(kept) === JSON.stringify(['/library/index', '/library/text']), `${where}: library-v1 keeps both files (${kept})`);
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('.t7-hero', { timeout: 8000 });
      await openExercises(page);
      await page.locator('.ex-row__name').first().waitFor({ timeout: 8000 });
      await page.locator('#ex-search').fill(LIB_NAME);
      await page.locator('.ex-row', { hasText: LIB_NAME }).first().click();
      await page.locator('ol.ex-steps li').first().waitFor({ timeout: 8000 });
      await shot(page, 'detail-offline-kept', where);
      await context.close();
    }

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    console.log(`${where}: list, search, show more, detail, loading, offline, history, worker cache`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`library-431: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('library-431: pass at 390x844 and 360x780');
