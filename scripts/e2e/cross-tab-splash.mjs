// (#288) A tab on the splash moves to Today when another tab saves a profile, without a reload.
// A tab mid-onboarding adopts the other tab's profile too, so finishing there can never overwrite
// it. Two pages in one browser context share localStorage and get each other's storage events.
// 390x844 and 360x780.
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
const server = await preview({ preview: { port: 4192, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const shot = (page, name, where) => shots && page.screenshot({ path: join(shots, `288-${name}-${where}.png`) });
const KEY = 'fitbod-clone-v1';

/** Onboarding from the splash up to the last step; `finish` builds the plan. */
async function onboard(page, name, { finish = true } = {}) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill(name);
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (!finish) return;
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

const onSplash = async (page) => (await page.getByRole('button', { name: 'Get started' }).count()) > 0;
const onToday = (page) => page.locator('.t7-hero').isVisible().catch(() => false);
const storedName = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state?.profile?.name ?? null, KEY);

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const errors = [];
    const open = async (context) => {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(url);
      return page;
    };
    const options = { viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' };

    // A tab left on the splash follows the other tab's onboarding to Today.
    let context = await browser.newContext(options);
    const idle = await open(context);
    const other = await open(context);
    check(await onSplash(idle), `${where}: the first tab does not start on the splash`);
    await shot(idle, 'splash-before', where);
    await onboard(other, 'Sam');
    await idle.waitForSelector('.t7-hero', { timeout: 5000 }).catch(() => {});
    check(!(await onSplash(idle)), `${where}: the splash tab stays on the splash after another tab saved a profile`);
    check(await onToday(idle), `${where}: the splash tab does not show Today`);
    check(await idle.getByText('Sam.').first().isVisible().catch(() => false), `${where}: the splash tab does not show the saved profile`);
    await shot(idle, 'splash-after', where);
    await context.close();

    // A tab mid-onboarding takes the saved profile too, so it cannot overwrite it by finishing.
    context = await browser.newContext(options);
    const midway = await open(context);
    await onboard(midway, 'Alex', { finish: false });
    await shot(midway, 'onboarding-before', where);
    const saver = await open(context);
    await onboard(saver, 'Sam');
    await midway.waitForSelector('.t7-hero', { timeout: 5000 }).catch(() => {});
    check(await onToday(midway), `${where}: the onboarding tab does not show the saved profile's Today`);
    check(await midway.getByText('Sam.').first().isVisible().catch(() => false), `${where}: the onboarding tab does not show Sam`);
    check((await storedName(midway)) === 'Sam', `${where}: the stored profile is not the one the other tab saved`);
    await shot(midway, 'onboarding-after', where);
    await context.close();

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`cross-tab-splash: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('cross-tab-splash: pass at 390x844 and 360x780');
