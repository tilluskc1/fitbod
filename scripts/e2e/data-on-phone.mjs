// The data-on-phone check (#258): onboarding says where workouts live; the first recap offers a
// backup once; an installed Home Screen app with no data offers to restore, and restoring the
// file the recap produced brings the workout back. Runs at 390x844 and 360x780.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
const server = await preview({ preview: { port: 4187, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const work = mkdtempSync(join(tmpdir(), 'e2e-258-'));
const MONDAY = new Date('2026-11-02T08:00:00');
const day = (n) => new Date(MONDAY.getTime() + n * 864e5);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const DATA_LINE = 'Your workouts stay on this phone. Back up from Settings now and then.';

async function onboard(page, where) {
  await page.goto(url);
  check(!(await page.getByText('restore your backup here').count()), `${where}: restore offer shown in a plain browser tab`);
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
  const notice = page.locator('.onboarding-safety');
  check((await notice.innerText()).includes(DATA_LINE), `${where}: onboarding does not say where workouts live`);
  const box = await notice.boundingBox();
  const build = await page.getByRole('button', { name: 'Build my plan' }).boundingBox();
  check(box && build && box.y >= 0 && box.y + box.height <= build.y, `${where}: data line not fully above Build my plan`);
  if (shots) await page.screenshot({ path: join(shots, `258-onboarding-${where}.png`) });
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** One workout through to the recap; returns on the recap screen. */
async function finishToRecap(page) {
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
  await page.getByRole('button', { name: 'Back to Today' }).waitFor();
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;

    // 1. A browser tab: onboarding line, then the first recap offers a backup.
    const tab = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await tab.newPage();
    await page.goto(url);
    const plainTitle = (await page.locator('.splash__title').boundingBox()).y;
    await page.clock.setFixedTime(day(0));
    await onboard(page, where);
    await finishToRecap(page);
    const offer = page.getByRole('region', { name: 'Back up' });
    check(await offer.isVisible(), `${where}: first recap does not offer a backup`);
    if (shots) {
      await offer.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots, `258-recap-${where}.png`) });
    }
    const downloaded = page.waitForEvent('download');
    await offer.getByRole('button', { name: 'Back up now' }).click();
    const file = join(work, `backup-${where}.json`);
    await (await downloaded).saveAs(file);
    check(!(await offer.count()), `${where}: offer stays after backing up`);
    const workoutName = (await page.locator('.recap-sub').innerText()).split(' · ')[0];
    await page.getByRole('button', { name: 'Back to Today' }).click();

    // A second workout's recap never offers again (a backup exists and it is not the first).
    await page.clock.setFixedTime(day(1));
    await finishToRecap(page);
    check(!(await page.getByRole('region', { name: 'Back up' }).count()), `${where}: second recap offers a backup again`);
    await tab.close();

    // 2. "Installed" (iOS Home Screen: navigator.standalone), empty storage: offer to restore.
    const installed = await browser.newContext({ viewport: { width, height } });
    await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    const app = await installed.newPage();
    await app.goto(url);
    const restore = app.getByText('Starting fresh? If you used the browser before, restore your backup here.');
    check(await restore.isVisible(), `${where}: installed app with no data does not offer a restore`);
    // The headline keeps its place on the photo: within a line of where a plain tab shows it.
    const title = await app.locator('.splash__title').boundingBox();
    check(title && Math.abs(title.y - plainTitle) <= 24, `${where}: headline moved from y ${Math.round(plainTitle)} to ${title && Math.round(title.y)} with the restore offer`);
    const get = await app.getByRole('button', { name: 'Get started' }).boundingBox();
    check(get && get.y + get.height <= height, `${where}: Get started pushed off screen by the restore offer`);
    if (shots) await app.screenshot({ path: join(shots, `258-installed-${where}.png`) });

    // A bad file is rejected by the validated restore, and says so on this screen.
    const bad = join(work, 'bad.json');
    writeFileSync(bad, 'not json at all');
    await app.locator('.splash__restore input[type=file]').setInputFiles(bad);
    const said = await app.locator('.app-alerts .banner').waitFor({ timeout: 3000 }).then(() => app.locator('.app-alerts .banner').innerText(), () => '');
    check(/^Restore rejected/.test(said), `${where}: bad file not rejected on the splash ("${said}")`);
    check(await restore.isVisible(), `${where}: splash left after a file with no profile`);

    await app.locator('.splash__restore input[type=file]').setInputFiles(file);
    const today = await app.waitForSelector('.t7-hero', { timeout: 5000 }).then(() => true, () => false);
    check(today, `${where}: restoring the recap's backup did not open Today`);
    if (today) {
      await app.getByRole('button', { name: 'Progress' }).click();
      check(await app.getByText(workoutName).first().isVisible().catch(() => false), `${where}: restored history lacks "${workoutName}"`);
    }
    await app.reload();
    check(!(await app.getByText('restore your backup here').count()), `${where}: restore offer shown again once there is data`);
    await installed.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`data-on-phone: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('data-on-phone: pass at 390x844, 360x780 and 390x650');
