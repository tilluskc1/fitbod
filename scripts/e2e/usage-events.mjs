// The usage-events check (#359). Anonymous events queue in `fitbod-clone-v1:events-outbox` and go to
// Firestore in one batchWrite. Firestore is mocked with context.route, so this never writes to the real
// database. The page opts in to sending with `__eventsTest` (localhost never sends otherwise).
//   A. First visit online, then offline (lesson 13): a full workout offline queues started + finished,
//      nothing is sent, nothing shows; back online, the queue goes in one batch with only the six fields.
//   B. Network blocked (every Firestore call aborted) while online: training runs exactly as on the
//      unblocked run (same screens, no error line), and the events stay queued.
//   C. 500 queued plus one tap: still 500, the oldest dropped.
//   D. Backup then restore: the file holds no outbox, and the outbox is untouched afterwards.
// 390x844 and 360x780.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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

const OUTBOX = 'fitbod-clone-v1:events-outbox';
const FIELDS = ['appVersion', 'createdAt', 'date', 'dayType', 'event', 'testerId'];
const BATCH = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/home-strength\/databases\/\(default\)\/documents:batchWrite\?key=/;

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4196, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0].replace('127.0.0.1', 'localhost');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const outbox = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), OUTBOX);

async function onboard(page) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^3\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** Switch (open, close), then a whole workout to the recap. Returns what the lifter saw on the way. */
async function train(page) {
  const seen = [];
  await page.getByRole('button', { name: 'Switch workout' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Close/ }).click();
  seen.push(await page.locator('.t7-hero').innerText());
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  for (let guard = 0; guard < 120; guard += 1) {
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).waitFor();
  seen.push((await page.locator('main, body').first().innerText()).replace(/\d+:\d+|\d+ min/g, '#'));
  return seen;
}

const errorLine = (page) => page.getByText(/not sent|couldn't|failed|network/i).count();

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    // Fix the clock: the day type, the date and the recap must not move with the time of day (lesson 35).
    const fixed = new Date(2026, 10, 12, 12, 0, 0);

    // A. First visit online, then offline; back online sends one batch.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'allow' });
      await context.addInitScript(() => { window.__eventsTest = true; });
      const batches = [];
      await context.route('https://firestore.googleapis.com/**', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST' || !BATCH.test(request.url())) {
          failures.push(`${where} A: unexpected Firestore call ${request.method()} ${request.url()}`);
          return route.abort();
        }
        const body = request.postDataJSON();
        batches.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ writeResults: body.writes.map(() => ({})), status: body.writes.map(() => ({})) }) });
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(fixed);
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(url);
      await page.getByRole('button', { name: 'Get started' }).waitFor();
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await context.setOffline(true);
      await page.reload();
      await onboard(page);
      await train(page);
      const queued = await outbox(page);
      const names = queued.map((item) => item.event.event);
      check(names.join() === 'switch,workout-started,workout-finished', `${where} A: offline queue ${names}`);
      check(queued.every((item) => Object.keys(item.event).sort().join() === FIELDS.join()), `${where} A: a queued event has other fields`);
      check(queued.find((item) => item.event.event === 'workout-finished')?.event.dayType === 'push', `${where} A: finished day type ${JSON.stringify(queued.at(-1)?.event)}`);
      check(queued.every((item) => item.event.date === '2026-11-12'), `${where} A: dates ${queued.map((item) => item.event.date)}`);
      check(batches.length === 0, `${where} A: sent while offline`);
      check((await errorLine(page)) === 0, `${where} A: an error line showed offline`);

      await context.setOffline(false);
      await page.waitForFunction((key) => (localStorage.getItem(key) ?? '[]') === '[]', OUTBOX, { timeout: 8000 }).catch(() => undefined);
      check(batches.length === 1, `${where} A: ${batches.length} batches after coming online`);
      const writes = batches[0]?.writes ?? [];
      check(writes.length === 3, `${where} A: batch held ${writes.length} writes`);
      for (const write of writes) {
        check(Object.keys(write.update.fields).sort().join() === FIELDS.join(), `${where} A: sent fields ${Object.keys(write.update.fields)}`);
        check(write.currentDocument?.exists === false, `${where} A: a write is not create-only`);
      }
      check(!/Sam|"weight"|"reps"/.test(JSON.stringify(batches)), `${where} A: the batch carries a name, a load or reps`);
      check((await outbox(page)).length === 0, `${where} A: the queue was not emptied`);
      check(errors.length === 0, `${where} A: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // B. Network blocked vs open: the same screens, no error line; events stay queued.
    {
      const runs = [];
      for (const blocked of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addInitScript(() => { window.__eventsTest = true; });
        await context.route('https://firestore.googleapis.com/**', (route) => blocked
          ? route.abort('internetdisconnected')
          : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: route.request().postDataJSON().writes.map(() => ({})) }) }));
        const page = await context.newPage();
        await page.clock.setFixedTime(fixed);
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(url);
        await onboard(page);
        const started = Date.now();
        const seen = await train(page);
        runs.push({ seen, ms: Date.now() - started, left: (await outbox(page)).length, errors, errorLine: await errorLine(page) });
        await context.close();
      }
      const [open, blocked] = runs;
      check(JSON.stringify(open.seen) === JSON.stringify(blocked.seen), `${where} B: blocked network changed what the lifter saw`);
      check(blocked.errorLine === 0 && blocked.errors.length === 0, `${where} B: blocked network showed an error (${blocked.errors.join(' | ')})`);
      check(blocked.left === 3, `${where} B: blocked network kept ${blocked.left} events, expected 3`);
      check(open.left === 0, `${where} B: open network left ${open.left} queued`);
    }

    // C. 500 queued, one more tap: 500, the oldest dropped. D. Backup and restore leave the outbox alone.
    {
      const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
      const page = await context.newPage();
      await page.goto(url);
      await onboard(page);
      await page.evaluate((key) => {
        const queue = Array.from({ length: 500 }, (_, i) => ({
          id: `seed${String(i).padStart(20, '0')}`,
          event: { testerId: 'seed-tester-0001', event: 'replace', dayType: null, appVersion: 'old', date: '2026-11-01', createdAt: '2026-11-01T10:00:00.000Z' },
        }));
        localStorage.setItem(key, JSON.stringify(queue));
      }, OUTBOX);
      await page.getByRole('button', { name: 'Switch workout' }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Close/ }).click();
      let queue = await outbox(page);
      check(queue.length === 500, `${where} C: queue length ${queue.length}`);
      check(queue[0]?.id === `seed${String(1).padStart(20, '0')}`, `${where} C: oldest not dropped (${queue[0]?.id})`);
      check(queue.at(-1)?.event.event === 'switch', `${where} C: newest is ${queue.at(-1)?.event.event}`);

      await page.getByRole('button', { name: 'Open profile and settings' }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up now' }).click()]);
      const file = join(tmpdir(), `usage-events-${where}.json`);
      await download.saveAs(file);
      const text = readFileSync(file, 'utf8');
      check(!/events-outbox|seed-tester|"switch"/.test(text), `${where} D: the backup carries the outbox`);
      queue = await outbox(page);
      const before = JSON.stringify(queue.slice(0, -1));
      check(queue.at(-1)?.event.event === 'backup', `${where} D: the backup was not counted`);
      await page.locator('.settings-row input[type=file]').setInputFiles(file);
      // The Done line shows on Today once Settings closes.
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
      await page.getByText(/^Restored \d+ workouts?/).first().waitFor({ timeout: 5000 }).catch(() => failures.push(`${where} D: restore message missing`));
      const after = await outbox(page);
      check(JSON.stringify(after.slice(0, -1)) === before, `${where} D: restore changed the outbox`);
      check(after.length === 500, `${where} D: outbox length after restore ${after.length}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`usage events: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('usage events: offline queue then send, blocked network, cap, backup round trip (390x844, 360x780)');
