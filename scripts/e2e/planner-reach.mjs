// The planner reach check (#256): the "Plan today with me" entry and every planner step's main
// action are fully on screen and take the tap themselves (nothing from the nav or dock on top),
// at 390x844, 360x780 and 390x650 (iPhone Chrome's visible area), with and without the backup
// reminder, and with the keyboard open on the text box.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//
// Set E2E_SHOTS=<dir> to also save a screenshot of every step.
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
const server = await preview({ preview: { port: 4184, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const MONDAY = new Date('2026-11-02T08:00:00');
const day = (n) => new Date(MONDAY.getTime() + n * 864e5);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

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

/** One whole workout, so the backup reminder (#243) shows on Today afterwards. */
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
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.t7-hero');
}

/**
 * Fully inside the viewport, and the element at its centre is the button (or inside it):
 * a real tap there lands on it, not on the tab bar, the Start button or the dock.
 * No scrolling first: "reachable" means where the screen puts it.
 */
async function reachable(page, locator, label, where) {
  const ok = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const inside = box.top >= 0 && box.left >= 0 && box.bottom <= vh && box.right <= vw && box.height > 0;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { inside, hits: Boolean(hit && (hit === el || el.contains(hit))), top: Math.round(box.top), bottom: Math.round(box.bottom), vh, on: hit ? `${hit.tagName}.${hit.className}` : 'none' };
  });
  check(ok.inside && ok.hits, `${where}: ${label} not reachable (y ${ok.top}-${ok.bottom} of ${ok.vh}, centre hits ${ok.on})`);
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `256-${name}.png`) });
}

async function walkPlanner(page, where) {
  const entry = page.locator('.tt-open');
  await reachable(page, entry, 'Plan today with me', where);
  await shot(page, `${where}-entry`);
  await entry.click();

  const next = page.locator('.tt-nav .pill-primary');
  const build = page.locator('.tt-skip');
  const back = page.locator('.tt-nav .secondary');
  for (let step = 1; step <= 4; step += 1) {
    await page.locator('.tt h2').waitFor();
    await reachable(page, next, `step ${step} primary`, where);
    await reachable(page, back, `step ${step} Back/Cancel`, where);
    if (step < 4) await reachable(page, build, `step ${step} Build with these answers`, where);
    check((await page.locator('nav.tabbar').count()) === 0 || !(await page.locator('nav.tabbar').isVisible()), `${where}: tab bar still shown on step ${step}`);
    await shot(page, `${where}-step${step}`);
    if (step === 1) {
      // Keyboard open, as a phone does it: the layout keeps its height and the keyboard covers the
      // bottom 330px (the visual viewport shrinks). The browser then scrolls the focused box into
      // the part still visible. Next and the box must both sit inside that visible band.
      const size = page.viewportSize();
      const band = size.height - 330;
      await page.locator('#tt-say').focus();
      await page.evaluate((h) => window.__fakeKeyboard(h), band);
      await page.locator('#tt-say').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
      const say = await page.locator('#tt-say').boundingBox();
      const bar = await page.locator('.tt-bar').boundingBox();
      const nb = await next.boundingBox();
      check(nb && nb.y >= 0 && nb.y + nb.height <= band, `${where}: Next under the keyboard (y ${nb && Math.round(nb.y)}-${nb && Math.round(nb.y + nb.height)}, visible to ${band})`);
      check(say && bar && say.y >= 0 && say.y + say.height <= bar.y, `${where}: text box hidden behind the action bar with the keyboard open`);
      const hit = await next.evaluate((el) => { const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return Boolean(h && (h === el || el.contains(h))); });
      check(hit, `${where}: Next does not own its tap with the keyboard open`);
      await shot(page, `${where}-step1-keyboard`);
      await page.locator('#tt-say').blur();
      await page.evaluate(() => window.__fakeKeyboard(null));
    }
    const heading = await page.locator('.tt h2').innerText();
    await next.click();
    if (step < 4) {
      const moved = await page.waitForFunction((was) => document.querySelector('.tt h2')?.textContent !== was, heading, { timeout: 3000 }).then(() => true, () => false);
      check(moved, `${where}: Next on step ${step} did not move to the next question`);
    }
  }
  const start = page.getByRole('button', { name: 'Start this workout' });
  await start.waitFor();
  await reachable(page, start, 'summary Start this workout', where);
  await shot(page, `${where}-summary`);
  await page.getByRole('button', { name: 'Change answers' }).click();
  await page.locator('.tt-nav .secondary').click(); // Cancel on step 1 closes the planner
  await page.locator('.tt-open').waitFor();
  const navBack = await page.locator('nav.tabbar').waitFor({ timeout: 3000 }).then(() => true, () => false);
  check(navBack, `${where}: tab bar did not come back after closing the planner`);
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    // Chromium cannot shrink the visual viewport without shrinking the layout, so stand in a
    // controllable visualViewport; the app reads only height, offsetTop and its events.
    await page.addInitScript(() => {
      const real = window.visualViewport;
      const fake = new EventTarget();
      let covered = null;
      Object.defineProperty(fake, 'height', { get: () => covered ?? window.innerHeight });
      Object.defineProperty(fake, 'offsetTop', { get: () => 0 });
      Object.defineProperty(fake, 'width', { get: () => real?.width ?? window.innerWidth });
      Object.defineProperty(window, 'visualViewport', { get: () => fake });
      window.__fakeKeyboard = (visible) => { covered = visible; fake.dispatchEvent(new Event('resize')); };
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(day(0));
    await onboard(page);
    await walkPlanner(page, `${width}x${height}`);

    // With the backup reminder: one finished workout, then the next day.
    await finishWorkout(page);
    await page.clock.setFixedTime(day(1));
    await page.reload();
    await page.waitForSelector('.t7-hero');
    const reminder = await page.getByText(/back up/i).first().isVisible().catch(() => false);
    check(reminder, `${width}x${height}: backup reminder did not show after a finished workout`);
    await walkPlanner(page, `${width}x${height}-reminder`);
    check(errors.length === 0, `${width}x${height}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`planner-reach: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('planner-reach: pass at 390x844, 360x780 and 390x650, with and without the backup reminder');
