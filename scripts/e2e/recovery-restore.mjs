// After a Recovery restore the app opens on Today with the restored plan, not the splash (#285);
// Start fresh still opens on the splash. 390x844 and 360x780.
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

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4191, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };


const shot = (page, name, where) => shots && page.screenshot({ path: join(shots, `285-${name}-${where}.png`) });
const KEY = 'fitbod-clone-v1';

async function onboard(page) {
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

/** Corrupt the stored data and reload, so the app opens on Recovery. */
async function corrupt(page) {
  await page.evaluate((key) => localStorage.setItem(key, '{not json'), KEY);
  await page.reload();
  await page.waitForSelector('.recovery');
}

const onSplash = async (page) => (await page.getByRole('button', { name: 'Get started' }).count()) > 0;

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await onboard(page);
    const backup = await page.evaluate((key) => localStorage.getItem(key), KEY);

    // A restore from Recovery opens on Today with the restored plan, never the splash (#285).
    await corrupt(page);
    await shot(page, 'recovery', where);
    await page.locator('.recovery-restore input[type=file]').setInputFiles({ name: 'strength-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await page.waitForSelector('.t7-hero, .splash, .onboarding-top', { timeout: 5000 }).catch(() => {});
    check(!(await onSplash(page)), `${where}: the splash shows after a Recovery restore`);
    check(await page.locator('.t7-hero').isVisible().catch(() => false), `${where}: Today is not showing after a Recovery restore`);
    check(await page.getByText('Sam.').first().isVisible().catch(() => false), `${where}: the restored profile is not on Today`);
    check(await page.getByText(/^Restored \d+ workouts?\.$/).first().isVisible().catch(() => false), `${where}: the restore message is not showing`);
    await shot(page, 'restored-today', where);

    // The restore was saved: a reload stays on Today.
    await page.reload();
    await page.waitForSelector('.t7-hero, .recovery, .splash', { timeout: 5000 }).catch(() => {});
    check(!(await onSplash(page)) && (await page.locator('.t7-hero').isVisible().catch(() => false)), `${where}: a reload after the restore does not open on Today`);

    // Start fresh still begins at the splash: the data is empty, so onboarding comes next.
    await corrupt(page);
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start fresh' }).click();
    await page.waitForTimeout(300);
    check(await onSplash(page), `${where}: Start fresh does not open on the splash`);
    await shot(page, 'start-fresh', where);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`recovery-restore: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('recovery-restore: pass at 390x844 and 360x780');
