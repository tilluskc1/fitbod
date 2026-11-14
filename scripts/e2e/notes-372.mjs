// (#372) A short note per exercise: write "use pin 6" from the exercise's ⋯ menu, finish the workout, and
// the next session with that same exercise shows "Last time: use pin 6" under its name, on one line. A
// reload keeps it. 390x844 and 360x780. Shots only with E2E_SHOTS (372-*.png).
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
const server = await preview({ preview: { port: 4187, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const MONDAY = new Date('2026-11-02T12:00:00');
const day = (n) => new Date(MONDAY.getTime() + n * 864e5);
const NOTE = 'use pin 6';
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
// Lesson 29: wait for finite animations; a Done toast's own 4 s life is skipped, its fade-in is not.
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime) && !a.effect?.target?.closest?.('.done-toast'))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name) => {
  if (!shots) return;
  await settle(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/372-${name}.png` });
};

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'lb', exact: true }).click();
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Beginner/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^3\s*days$/ }).click();
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

const current = async (page) => (await page.locator('.aw-exercise__name').innerText()).trim();
const noteLine = (page) => page.locator('.lg-coach--note');

/** Log every set at its prefilled weight (#309), finish, back to Today. */
async function logAllAndFinish(page) {
  for (let guard = 0; guard < 120; guard += 1) {
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.t7-hero');
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(day(0));
    await onboard(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const noted = await current(page);
    check((await noteLine(page).count()) === 0, `${where}: a first session shows a "Last time" line`);

    // ⋯ → Add note → type → Save note.
    await page.getByRole('button', { name: `More actions for ${noted}` }).click();
    const dialog = page.getByRole('dialog');
    const add = dialog.getByRole('button', { name: 'Add note' });
    if ((await add.count()) !== 1) {
      // Nothing to write a note with: the rest of the run would only time out.
      check(false, `${where}: the ⋯ menu has no Add note`);
      await page.close();
      continue;
    }
    {
      await add.click();
      await dialog.getByLabel('Note', { exact: true }).fill(NOTE);
      await shot(page, `${width}-note-sheet`);
      await dialog.getByRole('button', { name: 'Save note' }).click();
      const toast = (await page.locator('.done-toast__text').innerText().catch(() => '')).trim();
      check(toast === 'Note saved for next time.', `${where}: save toast reads "${toast}"`);
      await page.getByRole('button', { name: `More actions for ${noted}` }).click();
      check((await dialog.getByRole('button', { name: 'Edit note' }).count()) === 1, `${where}: the menu does not offer Edit note after saving`);
      await dialog.getByRole('button', { name: /close/i }).first().click().catch(() => page.keyboard.press('Escape'));
      await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 3000 }).catch(() => {});
    }
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.current?.exercises[0]?.note);
    check(stored === NOTE, `${where}: the session stores note ${JSON.stringify(stored)}`);
    // This session's own note is not "last time".
    check((await noteLine(page).count()) === 0, `${where}: the session that wrote the note shows it as "Last time"`);
    await logAllAndFinish(page);

    // Train on until the noted exercise leads a session again (the plan's day 1 comes back).
    let found = false;
    for (let offset = 1; offset <= 8 && !found; offset += 1) {
      await page.clock.setFixedTime(day(offset * 2));
      await page.getByRole('button', { name: 'Start workout' }).click();
      await page.waitForSelector('.lg-ex');
      if ((await current(page)) === noted) found = true;
      else {
        const shown = (await noteLine(page).count()) ? await noteLine(page).innerText() : '';
        check(shown === '', `${where}: ${await current(page)} shows "${shown}"; the note belongs to ${noted}`);
        await logAllAndFinish(page);
      }
    }
    check(found, `${where}: ${noted} never led a session again`);
    if (found) {
      const text = (await noteLine(page).innerText().catch(() => '')).trim();
      check(text === `Last time: ${NOTE}`, `${where}: next time reads "${text}"`);
      const box = await noteLine(page).evaluate((el) => ({ h: el.clientHeight, lh: parseFloat(getComputedStyle(el).lineHeight) })).catch(() => null);
      check(box !== null && box.h <= box.lh + 1, `${where}: the note line is not one line (${JSON.stringify(box)})`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}: the page scrolls sideways`);
      await shot(page, `${width}-last-time`);

      await page.reload();
      const resume = page.getByRole('button', { name: 'Resume workout', exact: true });
      await Promise.race([page.waitForSelector('.lg-ex'), resume.waitFor()]);
      if (!(await page.locator('.lg-ex').count())) await resume.click();
      await page.waitForSelector('.lg-ex');
      const after = (await noteLine(page).innerText().catch(() => '')).trim();
      check(after === `Last time: ${NOTE}`, `${where}: after reload reads "${after}"`);
    }

    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`notes-372: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('notes-372: a note written in one session shows as "Last time" on the same exercise next time, at 390 and 360');
