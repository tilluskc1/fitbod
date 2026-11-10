// Notices by meaning (#295): a today-only change says so in a dark Done toast for 4 s, with nothing
// beige on screen; the toast is gone in the logger; a toast never takes a tap meant for Start, Log or
// Finish and never covers Start; a failed save is a red Problem card that stays until Retry works;
// the install note is Today's one Heads-up card. Runs at 390x844, 360x780 and 390x650.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//   E2E_SHOTS=<dir> node scripts/e2e/notice-kinds.mjs   (one shot of each kind per size)
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

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TOAST = '.done-toast';

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

/** Every animation but the toast's own 4 s life has finished, so a shot is never mid-slide. */
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime) && !a.effect?.target?.closest?.('.done-toast'))
  .map((a) => a.finished.catch(() => {}))));

const shot = async (page, name, where) => {
  if (!shots) return;
  await settle(page);
  await page.waitForTimeout(250); // the toast's fade-in (5% of 4 s)
  await page.screenshot({ path: join(shots, `295-${name}-${where}.png`) });
};

/** A tap at the button's centre lands on the button itself, not on a toast or card over it. */
async function tapLands(page, locator, label, where) {
  const ok = await locator.first().evaluate((button) => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (hit === button || button.contains(hit)));
  }).catch(() => false);
  check(ok, `${where}: a tap on ${label} does not land on it`);
}

/** The toast's box stays clear of the button's box. */
async function clearOf(page, locator, label, where) {
  const [a, b] = [await page.locator(`${TOAST} .done-toast__pill`).boundingBox(), await locator.first().boundingBox()];
  if (!a || !b) return;
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  check(!overlap, `${where}: the toast covers ${label} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
}

/** No element on screen wears the old beige banner fill. */
const beige = (page) => page.evaluate(() => [...document.querySelectorAll('body *')]
  .some((node) => getComputedStyle(node).backgroundColor === 'rgb(251, 240, 221)'));

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, userAgent: SAFARI });
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.__failSaves && key === 'fitbod-clone-v1') throw new Error('blocked');
        return setItem.call(this, key, value);
      };
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page);

    // Done: today at 45 min says so in a dark toast, nothing beige, gone after 4 s.
    await page.locator('.t7-controls .t7-pill').first().click();
    await page.getByRole('button', { name: /^45 min/ }).click();
    const toast = page.locator(TOAST);
    await toast.waitFor({ timeout: 3000 }).catch(() => {});
    const text = (await toast.innerText().catch(() => '')).trim();
    check(text === 'Changed for today. Your plan stays the same.', `${where}: toast reads "${text}"`);
    check(await toast.getAttribute('role') === 'status', `${where}: the toast is not role=status`);
    check(!(await beige(page)), `${where}: something beige is on screen`);
    check(!(await page.getByRole('button', { name: 'Dismiss message' }).count()), `${where}: the toast has a Dismiss link`);
    const fill = await page.locator(`${TOAST} .done-toast__pill`).evaluate((n) => getComputedStyle(n).backgroundColor);
    check(fill === 'rgb(18, 21, 21)', `${where}: toast fill is ${fill}, not --btn`);
    await clearOf(page, page.locator('.tab-action'), 'Start', where);
    await clearOf(page, page.locator('.tabbar'), 'the tab bar', where);
    await tapLands(page, page.locator('.tab-action'), 'Start', where);
    await shot(page, 'done', where);
    await page.waitForTimeout(4300);
    check(!(await toast.count()), `${where}: the toast is still up after 4 s`);

    // A toast on Today is gone in the logger (#259).
    await page.locator('.t7-today-only__undo').click();
    await toast.waitFor({ timeout: 3000 }).catch(() => {});
    check(await toast.count() === 1, `${where}: no toast after Undo`);
    await clearOf(page, page.locator('.flow-dock .pill-primary'), 'Preview workout', where);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    check(!(await toast.count()), `${where}: the Today toast followed into the logger`);

    // In the logger a toast never takes a tap meant for Log or Finish.
    await page.locator('button.lg-check:not([disabled])').first().click();
    await page.locator('[aria-label^="More actions for"]').first().click();
    await page.getByRole('button', { name: "Remove today's remaining work" }).click();
    await page.getByRole('button', { name: "Remove from today's workout" }).click();
    await toast.waitFor({ timeout: 3000 }).catch(() => {});
    check(await toast.count() === 1, `${where}: no toast in the logger`);
    await tapLands(page, page.locator('.finish-btn'), 'Finish', where);
    await tapLands(page, page.locator('button.lg-check:not([disabled])'), 'Log', where);
    await clearOf(page, page.locator('.lg-dock'), 'the logger dock', where);
    await shot(page, 'done-logger', where);

    // Problem: a failed save is a red card with Retry, and stays until Retry succeeds.
    const toastBefore = await toast.count();
    await page.evaluate(() => { window.__failSaves = true; });
    await page.locator('button.lg-check:not([disabled])').first().click();
    const card = page.locator('.app-alerts .notice-card--problem');
    await card.waitFor({ timeout: 3000 }).catch(() => {});
    check(await card.getByText('Not saved.').isVisible().catch(() => false), `${where}: no Problem card on a failed save`);
    check(await card.getAttribute('role') === 'alert', `${where}: the Problem card is not role=alert`);
    // A Problem while a toast shows: the toast goes, the Problem stays (review 1).
    check(toastBefore === 1, `${where}: no toast was up before the failed save, so the check below proves nothing`);
    check(!(await toast.count()), `${where}: a Done toast still shows beside the Problem card`);
    const title = await card.locator('.notice-card__title').evaluate((n) => getComputedStyle(n).color);
    check(title === 'rgb(160, 50, 36)', `${where}: Problem title is ${title}, not --danger`);
    await shot(page, 'problem', where);
    await page.waitForTimeout(4300);
    check(await card.count() === 1, `${where}: the Problem card left before it was resolved`);
    await page.evaluate(() => { window.__failSaves = false; });
    await card.getByRole('button', { name: 'Retry' }).click();
    await page.waitForTimeout(300);
    check(!(await card.count()), `${where}: the Problem card stayed after Retry worked`);

    // Heads-up: after the workout, Today shows one card, the install note, white with an amber title.
    await page.locator('.finish-btn').click();
    await page.getByRole('button', { name: /Save completed work|Finish workout/ }).first().click();
    // On the recap, scrolling its buttons up never puts them under the toast (review 1).
    await page.locator('.recap-actions').waitFor({ timeout: 3000 });
    await toast.waitFor({ timeout: 3000 }).catch(() => {});
    check(await toast.count() === 1, `${where}: no toast on the recap`);
    await page.locator('.recap-actions').evaluate((n) => n.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(150);
    await clearOf(page, page.locator('.recap-actions'), 'the recap buttons', where);
    await page.getByRole('button', { name: 'Back to Today' }).click();
    await page.waitForSelector('.t7-hero');
    await page.waitForTimeout(100);
    check(await toast.count() === 1, `${where}: "Workout saved." (the finish toast) did not follow the recap to Today`);
    await clearOf(page, page.locator('.tabbar'), 'the tab bar (toast carried from the recap)', where);
    await clearOf(page, page.locator('.tab-action'), 'Start (toast carried from the recap)', where);
    const cards = page.locator(".notice-card--headsUp");
    check(await cards.count() === 1, `${where}: Today shows ${await cards.count()} Heads-up cards`);
    check(await page.locator('.install-note').count() === 1, `${where}: the install note is not the one card`);
    const amber = await page.locator('.install-note .notice-card__title').evaluate((n) => getComputedStyle(n).color).catch(() => '');
    check(amber === 'rgb(138, 83, 0)', `${where}: Heads-up title is ${amber}, not --amber`);
    const white = await page.locator('.install-note').evaluate((n) => getComputedStyle(n).backgroundColor).catch(() => '');
    check(white === 'rgb(255, 255, 255)', `${where}: Heads-up card is ${white}, not white`);
    const x = await page.getByRole('button', { name: 'Dismiss for 7 days' }).boundingBox();
    check(x && x.width >= 44 && x.height >= 44, `${where}: × is under 44px`);
    await page.locator('.install-note').evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await shot(page, 'heads-up', where);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`notice-kinds: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('notice-kinds: pass at 390x844, 360x780 and 390x650');
