// (#259) A passing message stays on the screen that raised it: a Today banner never follows the user
// into the logger, a recap message never follows them into Coach, and a message raised while moving
// screen (leaving the logger for Today) still shows where it lands. 390x844 and 360x780.
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
const server = await preview({ preview: { port: 4193, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const shot = (page, name, where) => shots && page.screenshot({ path: join(shots, `259-${name}-${where}.png`) });

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

const messages = (page) => page.locator('.done-toast, .app-alerts .notice-card').allInnerTexts();
const showing = async (page, pattern) => (await messages(page)).some((text) => pattern.test(text));

async function logOneSet(page) {
  await page.locator('button.lg-check:not([disabled])').first().click();
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await onboard(page);

    // A Today banner does not follow the user into the logger.
    await page.getByRole('button', { name: /Switch/ }).first().click();
    await page.locator('[role="dialog"] button.len-opt:not([aria-current])').first().click();
    check(await showing(page, /is up\. Skipped/), `${where}: the Switch message does not show on Today`);
    await shot(page, 'today-message', where);
    await page.getByRole('button', { name: /Start workout/ }).first().click();
    await page.waitForSelector('.lg-header');
    check(!(await showing(page, /is up\. Skipped/)), `${where}: the Switch message followed the user into the logger`);
    const header = await page.locator('.lg-header').boundingBox();
    check(header && header.y < 20, `${where}: the logger header is pushed down to ${header && Math.round(header.y)}px`);
    await shot(page, 'logger', where);

    // A message raised while leaving the logger shows where it lands (Today).
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const skipOrDiscard = page.getByRole('dialog').getByRole('button', { name: /Discard|Skip/ }).first();
    await skipOrDiscard.click();
    const confirmDiscard = page.getByRole('dialog').getByRole('button', { name: /Discard/ }).first();
    if (await confirmDiscard.count()) await confirmDiscard.click();
    await page.waitForSelector('.t7-hero');
    check(await showing(page, /discarded|skipped/i), `${where}: leaving the logger for Today lost its message`);

    // A recap message does not follow the user into Coach.
    await page.getByRole('button', { name: /Start workout/ }).first().click();
    await page.waitForSelector('.lg-header');
    await logOneSet(page);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: /Save completed work/ }).click();
    check(await showing(page, /Saved the completed sets/), `${where}: the recap message does not show on the recap`);
    // (#333) Part of the workout was dropped: a Heads-up card, not a Done toast.
    check(await page.locator('.notice-card--headsUp', { hasText: 'Saved the completed sets' }).count() === 1, `${where}: the partial save is not a Heads-up card`);
    check(!(await page.locator('.done-toast').count()), `${where}: the partial save shows as a Done toast`);
    await shot(page, 'recap-message', where);
    const leave = page.getByRole('button', { name: /^Done$|Back to Today/ }).first();
    if (await leave.count()) await leave.click();
    await page.getByRole('button', { name: 'Coach', exact: true }).click();
    check(!(await showing(page, /Saved the completed sets/)), `${where}: the recap message followed the user into Coach`);
    await shot(page, 'coach', where);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`notice-screen: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('notice-screen: pass at 390x844 and 360x780');
