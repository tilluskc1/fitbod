// The install note (#307): emulating iPhone Safari and iPhone Chrome. Nothing before the first
// finished workout; then Today shows the note, Show me how opens the three-step sheet whose
// Back up now ticks after a backup, and × hides it for 7 days; two × keep it off Today for good
// while Settings still has it. Installed (standalone): nothing. Runs at 390x844, 360x780, 390x650.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//   E2E_SHOTS=<dir> E2E_BEFORE=1 node scripts/e2e/install-note.mjs   (Today shots only, for main)
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

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4191, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const before = process.env.E2E_BEFORE === '1';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const NOTE = 'Keep Home Strength on your Home Screen. It keeps your workouts safe and opens like an app.';
const KEY = 'fitbod-clone-v1';

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

async function finishWorkout(page, { leaveOpen = false } = {}) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  for (let guard = 0; guard < 120; guard += 1) {
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) { await confirm.click(); continue; }
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  if (leaveOpen) return;
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.t7-hero');
}

const note = (page) => page.locator('.install-note');
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').state ?? {}, KEY);
/** Rewrite the stored dismissal dates, then reload as a later visit would. */
async function setDismissals(page, dates) {
  await page.evaluate(([key, value]) => {
    const raw = JSON.parse(localStorage.getItem(key));
    raw.state.installNoteDismissals = value;
    localStorage.setItem(key, JSON.stringify(raw));
  }, [KEY, dates]);
  await page.reload();
  await page.waitForSelector('.t7-hero');
}
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    for (const [name, userAgent] of [['safari', SAFARI], ['chrome', CHROME]]) {
      if (name === 'chrome' && width !== 390) continue;
      const where = `${name} ${width}x${height}`;
      const context = await browser.newContext({ viewport: { width, height }, userAgent, acceptDownloads: true });
      const page = await context.newPage();
      await onboard(page);
      if (!before) check(!(await note(page).count()), `${where}: note shows before any finished workout`);

      await finishWorkout(page);
      if (shots && name === 'safari') {
        await page.screenshot({ path: join(shots, `307-${before ? 'before' : 'after'}-today-${width}x${height}.png`) });
        if (!before) {
          // Centre the note, clear of the dock and the passing message.
          await note(page).evaluate((element) => element.scrollIntoView({ block: 'center' }));
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(shots, `307-after-today-note-${width}x${height}.png`) });
        }
      }
      if (before) { await context.close(); continue; }

      check(await note(page).getByText(NOTE).isVisible(), `${where}: note missing after the first workout`);

      // Show me how: three steps; Back up now ticks once the file leaves the app (download here).
      await note(page).getByRole('button', { name: 'Show me how' }).click();
      const sheet = page.getByRole('dialog', { name: 'Install on this phone' });
      check(await sheet.isVisible(), `${where}: Show me how did not open the sheet`);
      check((await sheet.locator('.install-step').count()) === 3, `${where}: expected 3 steps`);
      const steps = await sheet.locator('.install-steps').innerText();
      check(
        name === 'chrome' ? /Share\s*in the address bar/.test(steps) : /Share\s*at the bottom/.test(steps),
        `${where}: wrong Add to Home Screen steps: ${steps}`,
      );
      check(/Restore backup on the first screen/.test(steps), `${where}: no restore step`);
      if (shots && name === 'safari') await page.screenshot({ path: join(shots, `307-after-sheet-${width}x${height}.png`) });
      const download = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
      await sheet.getByRole('button', { name: 'Back up now' }).click();
      check(Boolean(await download), `${where}: Back up now saved nothing`);
      await sheet.getByText('Backed up.').waitFor({ timeout: 3000 }).catch(() => {});
      check(await sheet.getByText('Backed up.').isVisible(), `${where}: backup step did not tick`);
      check(await sheet.locator('.install-step--done').count() === 1, `${where}: no done step`);
      if (shots && name === 'safari') await page.screenshot({ path: join(shots, `307-after-sheet-ticked-${width}x${height}.png`) });
      await sheet.getByRole('button', { name: 'Done' }).click();

      // × once: gone, one date stored; back after 7 days.
      await note(page).getByRole('button', { name: 'Dismiss for 7 days' }).click();
      check(!(await note(page).count()), `${where}: × did not hide the note`);
      check((await stored(page)).installNoteDismissals?.length === 1, `${where}: × stored no date`);
      await setDismissals(page, [daysAgo(6)]);
      check(!(await note(page).count()), `${where}: note back inside 7 days`);
      await setDismissals(page, [daysAgo(8)]);
      check(await note(page).isVisible(), `${where}: note not back after 7 days`);

      // × twice: off Today for good; Settings keeps the sheet.
      await note(page).getByRole('button', { name: 'Dismiss for 7 days' }).click();
      check((await stored(page)).installNoteDismissals?.length === 2, `${where}: second × not stored`);
      await setDismissals(page, [daysAgo(60), daysAgo(30)]);
      check(!(await note(page).count()), `${where}: note back after two dismissals`);
      await page.getByRole('button', { name: 'Open profile and settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Training settings' });
      await settings.getByRole('button', { name: 'Install on this phone' }).click();
      check(await page.getByRole('dialog', { name: 'Install on this phone' }).isVisible(), `${where}: Settings did not open the sheet`);
      await context.close();
    }
  }

  // A running session hides it; installed (standalone) never shows it.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: SAFARI });
    const page = await context.newPage();
    await onboard(page);
    await finishWorkout(page);
    await finishWorkout(page, { leaveOpen: true });
    await page.getByRole('button', { name: 'Today', exact: true }).click().catch(() => {});
    check(!(await note(page).count()), 'note shows during a running session');
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: SAFARI });
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    const page = await context.newPage();
    await onboard(page);
    await finishWorkout(page);
    check(!(await note(page).count()), 'note shows in the installed app');
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`install-note: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(before ? 'install-note: before shots taken' : 'install-note: ok');
