// The Progress and Coach first-run check (#294), 390x844 and 360x780:
// - a fresh user sees one empty-state card on Progress and one line on Coach, never a "0" tile or row;
// - "Start today's workout" opens the same preview as Today's Preview workout;
// - with a workout running, the button reads "Resume workout" and opens the logger;
// - after a finished workout, and after a restored legacy record, the tiles and Coach's count equal
//   what the stored history holds (lesson 12: values across screens, not the script's own clicks).
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
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
const server = await preview({ preview: { port: 4191, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const START = new Date('2026-11-02T08:00:00');
const minutesLater = (n) => new Date(START.getTime() + n * 60000);

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

/** What the stored history says the tiles should read: finished workouts with a logged set. */
const stored = (page) => page.evaluate((key) => {
  const { state } = JSON.parse(localStorage.getItem(key));
  const worked = state.history.filter((w) => w.exercises.some((e) => e.performed.some((s) => s.done)));
  let minutes = 0;
  let approx = false;
  for (const w of worked) {
    const span = w.endedAt ? (Date.parse(w.endedAt) - Date.parse(w.date)) / 60000 : NaN;
    if (Number.isFinite(span) && span > 0) minutes += Math.max(1, Math.round(span));
    else { minutes += w.durationMin ?? 0; approx = true; }
  }
  const sets = worked.reduce((sum, w) => sum + w.exercises.reduce((n, e) => n + e.performed.filter((s) => s.done).length, 0), 0);
  return { workouts: worked.length, sets, minutes, approx, running: Boolean(state.current) };
}, KEY);

const tiles = async (page) => {
  const labels = (await page.locator('.stats-3 .stat-label').allInnerTexts()).map(flat);
  const values = (await page.locator('.stats-3 .stat-value').allInnerTexts()).map((v) => Number(flat(v)));
  return { labels, values };
};

async function coachCount(page, where) {
  await page.getByRole('button', { name: 'Coach' }).click();
  const row = page.locator('.context-row', { hasText: 'Sessions recorded' });
  check(await row.count() === 1, `${where}: Coach shows its Sessions recorded row once there is a workout`);
  return Number(flat(await row.locator('span').nth(1).innerText()));
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(START);
    await onboard(page);
    const todayTitle = flat(await page.locator('.t7-hero__title').innerText());

    // Today's own preview, to compare with the one Progress opens.
    await page.getByRole('button', { name: 'Preview workout' }).click();
    const todayPreview = flat(await page.getByRole('dialog').innerText());
    await page.getByRole('dialog').locator('button.secondary', { hasText: 'Close' }).click();

    // 1. A fresh user: one card, no tiles, no zero.
    await page.getByRole('button', { name: 'Progress' }).click();
    const empty = page.locator('.progress-empty');
    check(await empty.count() === 1, `${where}: Progress shows the empty-state card`);
    check(await page.locator('.stat-value').count() === 0, `${where}: Progress shows no stat tiles`);
    const progressText = flat(await page.locator('.screen').innerText());
    check(!/\b0\b/.test(progressText), `${where}: Progress shows no "0" (${progressText.slice(0, 200)})`);
    check(progressText.includes('Your progress starts with your first workout.'), `${where}: empty-state title`);
    check(!progressText.includes('Your first session starts the story'), `${where}: the chart empty state is gone`);
    const box = await empty.boundingBox();
    check(box && box.y + box.height <= height, `${where}: the empty-state card and its button fit on screen`);
    if (shots) await page.screenshot({ path: join(shots, `294-progress-new-${where}.png`) });

    await page.getByRole('tab', { name: 'Session history' }).click();
    check(flat(await page.locator('.screen').innerText()).includes('No workouts yet. Your first one will appear here.'), `${where}: Session history empty line`);
    if (shots) await page.screenshot({ path: join(shots, `294-history-new-${where}.png`) });
    await page.getByRole('tab', { name: 'Overview' }).click();

    await page.getByRole('button', { name: 'Coach' }).click();
    check(await page.locator('.context-row').count() === 0, `${where}: Coach hides its context rows for a new user`);
    const coachText = flat(await page.locator('.screen').innerText());
    check(coachText.includes('After your first workout I’ll show what changed and why.'), `${where}: Coach's one line`);
    check(!/\b0\b/.test(coachText), `${where}: Coach shows no "0"`);
    if (shots) {
      await page.locator('.card', { hasText: 'Your recent context' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots, `294-coach-new-${where}.png`) });
    }

    // 2. Start today's workout opens the same preview as Today.
    await page.getByRole('button', { name: 'Progress' }).click();
    await page.getByRole('button', { name: "Start today's workout" }).click();
    const dialog = page.getByRole('dialog');
    check(await dialog.count() === 1, `${where}: the button opens a preview`);
    check(flat(await dialog.innerText()) === todayPreview, `${where}: Progress opens Today's preview (${todayTitle})`);

    // 3. Start it from the preview; with it running, Progress resumes it.
    await dialog.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    for (let guard = 0; guard < 6; guard += 1) {
      const confirm = page.getByRole('button', { name: 'Confirm' });
      if (await confirm.count()) { await confirm.click(); continue; }
      const log = page.locator('button.lg-check:not([disabled])').first();
      if (!(await log.count())) break;
      await log.click();
    }
    await page.getByRole('button', { name: 'Minimize workout' }).click();
    await page.getByRole('button', { name: 'Progress' }).click();
    check((await stored(page)).running, `${where}: a workout is running`);
    check(await page.locator('.stat-value').count() === 0, `${where}: a running workout is not counted`);
    check(await page.locator('.progress-empty').getByRole('button', { name: 'Resume workout' }).count() === 1, `${where}: the button reads Resume workout`);
    if (shots) await page.screenshot({ path: join(shots, `294-progress-running-${where}.png`) });
    await page.locator('.progress-empty').getByRole('button', { name: 'Resume workout' }).click();
    check(await page.locator('.lg-ex').first().isVisible(), `${where}: resume opens the logger`);

    // 4. Finish 41 minutes later: tiles and Coach equal the stored history.
    await page.clock.setFixedTime(minutesLater(41));
    await page.locator('button.finish-btn').click();
    const save = page.getByRole('dialog').getByRole('button', { name: 'Save completed work' });
    if (await save.count()) await save.click();
    await page.getByRole('button', { name: 'Back to Today' }).click();
    await page.waitForSelector('.t7-hero');
    await page.getByRole('button', { name: 'Progress' }).click();
    const want = await stored(page);
    const seen = await tiles(page);
    check(JSON.stringify(seen.labels) === JSON.stringify(['Workouts', 'Sets', 'Minutes']), `${where}: labels ${JSON.stringify(seen.labels)}`);
    check(JSON.stringify(seen.values) === JSON.stringify([want.workouts, want.sets, want.minutes]), `${where}: tiles ${seen.values} vs stored ${JSON.stringify(want)}`);
    check(want.workouts === 1 && want.minutes === 41 && want.sets > 0, `${where}: one 41-minute workout stored (${JSON.stringify(want)})`);
    for (const label of await page.locator('.stats-3 .stat-label').all()) {
      const { height: h } = await label.boundingBox();
      check(h <= 20, `${where}: a tile label wraps (${h}px)`);
    }
    check(flat(await page.locator('.screen').innerText()).includes('all time'), `${where}: "all time" under the tiles`);
    check(await page.locator('.progress-empty').count() === 0, `${where}: no empty state with a workout`);
    if (shots) await page.screenshot({ path: join(shots, `294-progress-one-${where}.png`) });
    check(await coachCount(page, where) === want.workouts, `${where}: Coach's count equals the stored history`);
    if (shots) {
      await page.locator('.card', { hasText: 'Your recent context' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots, `294-coach-one-${where}.png`) });
    }

    // 5. A restored legacy record (no times, only its planned length) adds its planned minutes, with the note.
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      const first = saved.state.history[0];
      const legacy = { ...structuredClone(first), id: 'legacy-294', date: '2026-10-20T08:00:00.000Z', endedAt: null, durationMin: 30 };
      delete legacy.feedback;
      saved.state.history.push(legacy);
      localStorage.setItem(key, JSON.stringify(saved));
    }, KEY);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    await page.getByRole('button', { name: 'Progress' }).click();
    const legacyWant = await stored(page);
    const legacySeen = await tiles(page);
    check(legacyWant.workouts === 2 && legacyWant.approx, `${where}: the legacy record is stored (${JSON.stringify(legacyWant)})`);
    check(JSON.stringify(legacySeen.values) === JSON.stringify([legacyWant.workouts, legacyWant.sets, legacyWant.minutes]), `${where}: legacy tiles ${legacySeen.values} vs stored ${JSON.stringify(legacyWant)}`);
    check(flat(await page.locator('.screen').innerText()).includes('≈ includes planned time for older workouts.'), `${where}: the planned-time note`);
    if (shots) await page.screenshot({ path: join(shots, `294-progress-legacy-${where}.png`) });
    check(await coachCount(page, where) === legacyWant.workouts, `${where}: Coach's count equals the stored history after restore`);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    console.log(`${where}: empty state, preview "${todayTitle}", resume, tiles ${seen.values.join(' / ')}, legacy ${legacySeen.values.join(' / ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`progress-empty: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('progress-empty: pass at 390x844 and 360x780');
