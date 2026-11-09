// The Progress backup check (#293): the download icon asks first. Nothing leaves the app until
// Back up now; Not now and a cancelled Share sheet record nothing; a backup saves the same file as
// Settings, holds the workouts the sheet counted, and sets the stored backup date. Runs at
// 390x844 and 360x780.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4189, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const work = mkdtempSync(join(tmpdir(), 'e2e-293-'));
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const TITLE = 'Back up your workouts?';
const completed = (history) => history.filter((workout) => workout.status === 'completed');

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

async function finishWorkout(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  for (let guard = 0; guard < 120; guard += 1) {
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) { await confirm.click(); continue; }
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  await page.getByRole('button', { name: 'Finish workout' }).click();
  // Leave the recap's own backup offer alone: this check is about Progress.
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.t7-hero');
}

/** What is stored, read the way a reload would. */
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1') ?? '{}').state ?? {});

/** Run `action`; return the download it caused within `ms`, or null. */
async function downloadDuring(page, action, ms = 1200) {
  const seen = page.waitForEvent('download', { timeout: ms }).catch(() => null);
  await action();
  return seen;
}

const openSheet = async (page) => {
  await page.getByRole('button', { name: 'Progress' }).click();
  return downloadDuring(page, () => page.getByRole('button', { name: 'Back up workouts' }).click());
};
const sheet = (page) => page.getByRole('dialog', { name: TITLE });

/** Make the Share sheet available, answering with `outcome` ('share' or 'cancel'). */
const fakeShare = (page, outcome) =>
  page.evaluate((how) => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => Boolean(data?.files?.length) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => {
        if (how === 'cancel') throw new DOMException('closed', 'AbortError');
        window.__shared.push({ name: data.files[0].name, text: await data.files[0].text() });
      },
    });
  }, outcome);

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await context.newPage();
    await onboard(page);

    // 1. No workouts yet: the sheet says so and offers nothing to tap; nothing downloads.
    check(!(await openSheet(page)), `${where}: the icon downloaded with no workouts`);
    check(await sheet(page).isVisible(), `${where}: no sheet with no workouts`);
    check(await sheet(page).getByText('Nothing to back up yet').isVisible(), `${where}: empty sheet does not say "Nothing to back up yet"`);
    check(!(await sheet(page).getByRole('button', { name: 'Back up now' }).count()), `${where}: empty sheet offers Back up now`);
    if (shots) await page.screenshot({ path: join(shots, `293-empty-${where}.png`) });
    await sheet(page).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Today' }).click();

    // 2. One workout: the icon asks first. Not now records nothing.
    await finishWorkout(page);
    check(!(await openSheet(page)), `${where}: the icon downloaded before asking`);
    check(await sheet(page).isVisible(), `${where}: tapping the icon did not open the backup sheet`);
    const body = await sheet(page).innerText();
    const counted = Number(/your (\d+) workouts?/.exec(body)?.[1]);
    check(counted === 1, `${where}: sheet counts ${counted} workouts, expected 1 ("${body}")`);
    for (const name of ['Back up now', 'Not now']) {
      const box = await sheet(page).getByRole('button', { name }).boundingBox();
      check(box && box.height >= 44 && box.width >= 44, `${where}: ${name} is under 44px`);
      check(box && box.y + box.height <= height, `${where}: ${name} is below the screen`);
    }
    if (shots) await page.screenshot({ path: join(shots, `293-sheet-${where}.png`) });
    check(!(await downloadDuring(page, () => sheet(page).getByRole('button', { name: 'Not now' }).click())), `${where}: Not now downloaded a file`);
    check(!(await sheet(page).count()), `${where}: Not now left the sheet open`);
    check(!(await stored(page)).lastBackupAt, `${where}: Not now recorded a backup`);

    // 3. Share sheet cancelled: sheet stays, nothing recorded, no error.
    await fakeShare(page, 'cancel');
    await openSheet(page);
    await sheet(page).getByRole('button', { name: 'Back up now' }).click();
    await page.waitForTimeout(300);
    check(await sheet(page).isVisible(), `${where}: a cancelled Share closed the sheet`);
    check(!(await stored(page)).lastBackupAt, `${where}: a cancelled Share recorded a backup`);
    check(!(await sheet(page).getByRole('alert').count()), `${where}: a cancelled Share showed an error`);
    await sheet(page).getByRole('button', { name: 'Not now' }).click();

    // 4. Share sheet used: the shared file holds what the sheet counted; the date is stored.
    await fakeShare(page, 'share');
    await openSheet(page);
    await sheet(page).getByRole('button', { name: 'Back up now' }).click();
    await sheet(page).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    check(!(await sheet(page).count()), `${where}: the sheet stayed open after a backup`);
    const shared = await page.evaluate(() => window.__shared);
    check(shared.length === 1, `${where}: Back up now shared ${shared.length} files`);
    const sharedHistory = shared[0] ? completed(JSON.parse(shared[0].text).state.history) : [];
    check(sharedHistory.length === counted, `${where}: shared file has ${sharedHistory.length} workouts, sheet said ${counted}`);
    const afterShare = (await stored(page)).lastBackupAt;
    check(Boolean(afterShare), `${where}: a shared backup was not recorded`);
    check(await page.getByText('Backup shared.').isVisible().catch(() => false), `${where}: no "Backup shared." after the sheet closed`);

    // 5. No Share sheet (desktop, most Android browsers): Back up now downloads the file.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await openSheet(page);
    const download = await downloadDuring(page, () => sheet(page).getByRole('button', { name: 'Back up now' }).click(), 3000);
    check(Boolean(download), `${where}: Back up now did not download without a Share sheet`);
    if (download) {
      const file = join(work, `progress-${where}.json`);
      await download.saveAs(file);
      const history = completed(JSON.parse(readFileSync(file, 'utf8')).state.history);
      check(history.length === counted, `${where}: downloaded file has ${history.length} workouts, sheet said ${counted}`);
      check(/^strength-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(download.suggestedFilename()), `${where}: file name "${download.suggestedFilename()}"`);
      check(shared[0] && download.suggestedFilename().slice(0, 26) === shared[0].name.slice(0, 26), `${where}: Progress names its file differently from the Share path`);
    }
    check(!(await sheet(page).count()), `${where}: the sheet stayed open after a download`);

    // 6. Settings' Back up now saves the same kind of file (one path).
    await page.getByRole('button', { name: 'Today' }).click();
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    const fromSettings = await downloadDuring(page, () => page.getByRole('button', { name: 'Back up now' }).click(), 3000);
    check(fromSettings && download && fromSettings.suggestedFilename().slice(0, 26) === download.suggestedFilename().slice(0, 26), `${where}: Settings and Progress name the file differently`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`progress-backup: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('progress-backup: pass at 390x844 and 360x780');
