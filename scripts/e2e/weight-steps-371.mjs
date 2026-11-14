// (#371) − and + under the logger's set table move the next set to log by one real step (5 lb plates on
// a pound barbell), carrying to later unlogged sets exactly as typing does. Three quick taps are one burst
// with one toast and one Undo, and Undo puts every set back. − is disabled at the empty bar. The two
// buttons sit on one line, 44px tall, with no sideways scroll. 390x844 and 360x780. Shots only with E2E_SHOTS.
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
const server = await preview({ preview: { port: 4186, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
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
  await page.waitForTimeout(250); // the toast's fade-in (5% of 4 s)
  await page.screenshot({ path: `${shots}/371-${name}.png` });
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

/** The weight each set row shows, read from the cells the lifter sees. */
const weights = (page) => page.locator('table.lg-table tbody tr:not(.lg-note):not(.lg-row--warm) input.lg-cell[aria-label*="weight"]')
  .evaluateAll((cells) => cells.map((cell) => cell.value.trim()));
const group = (page) => page.locator('.lg-steps[role="group"][aria-label^="Weight steps for set "]');
const minus = (page) => group(page).getByRole('button', { name: '− 5 lb', exact: true });
const plus = (page) => group(page).getByRole('button', { name: '+ 5 lb', exact: true });
const taps = (page) => page.evaluate(() => window.__taps);

/** The step row: each button's top and height, whether the row or the page scrolls sideways. */
async function stepRow(page) {
  return group(page).evaluate((row) => {
    const buttons = [...row.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect();
      return { top: box.top, right: box.right, height: box.height };
    });
    return {
      buttons,
      rowScrolls: row.scrollWidth > row.clientWidth + 0.5,
      rowRight: row.getBoundingClientRect().right,
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    // Real clicks only: a capture listener counts every tap the lifter makes from here.
    await page.evaluate(() => { window.__taps = 0; document.addEventListener('click', (event) => { if (event.isTrusted) window.__taps += 1; }, true); });

    // A first-time pound barbell: every set shows the 45 lb empty bar.
    const start = await weights(page);
    check(start.length >= 2 && start.every((value) => value === '45'), `${where}: sets start at ${JSON.stringify(start)}, not the 45 lb bar`);
    check((await group(page).count()) === 1, `${where}: no − / + row under the set table`);
    if ((await group(page).count()) !== 1) { await page.close(); continue; }
    check((await group(page).getAttribute('aria-label')) === 'Weight steps for set 1', `${where}: the step row acts on "${await group(page).getAttribute('aria-label')}", not set 1`);

    // Layout: one line, 44px targets, nothing scrolls sideways.
    const row = await stepRow(page);
    check(row.buttons.length === 2, `${where}: the step row holds ${row.buttons.length} buttons`);
    const tops = row.buttons.map((button) => button.top);
    check(Math.max(...tops) - Math.min(...tops) <= 1, `${where}: − and + not on one line (tops ${tops.join(', ')})`);
    check(row.buttons.every((button) => button.height >= 44 && button.height < 64), `${where}: a step button is under 44px or wraps (${row.buttons.map((b) => b.height).join(', ')})`);
    check(row.buttons.every((button) => button.right <= row.rowRight + 0.5), `${where}: a step button runs past the row`);
    check(!row.rowScrolls, `${where}: the step row scrolls sideways`);
    check(!row.pageScrolls, `${where}: the page scrolls sideways`);

    // The floor: − is disabled at the empty bar, + is not.
    check(await minus(page).isDisabled(), `${where}: − is enabled at the 45 lb bar`);
    check(await plus(page).isEnabled(), `${where}: + is disabled at 45 lb`);
    await shot(page, `${width}-before`);

    // + three times: one burst, set 1 and every later unlogged set at 60 lb, one toast with one Undo.
    for (let tap = 0; tap < 3; tap += 1) await plus(page).click();
    check((await taps(page)) === 3, `${where}: three + took ${await taps(page)} taps`);
    const after = await weights(page);
    check(after.every((value) => value === '60'), `${where}: after + + + the sets read ${JSON.stringify(after)}, not 60`);
    const toast = page.locator('.done-toast');
    check((await toast.count()) === 1, `${where}: ${await toast.count()} toasts after + + +`);
    const toastText = (await toast.locator('.done-toast__text').innerText().catch(() => '')).trim();
    check(/60 lb/.test(toastText), `${where}: the toast reads "${toastText}"`);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    check((await undo.count()) === 1, `${where}: ${await undo.count()} Undo buttons after + + +`);
    check(await minus(page).isEnabled(), `${where}: − is disabled at 60 lb`);
    await shot(page, `${width}-after-plus`);

    // Undo puts all of it back: set 1 included, at the bar again.
    if ((await undo.count()) === 1) {
      await undo.click();
      const back = await weights(page);
      check(JSON.stringify(back) === JSON.stringify(start), `${where}: after Undo the sets read ${JSON.stringify(back)}, not ${JSON.stringify(start)}`);
      check((await page.locator('.done-toast').count()) === 0, `${where}: the toast stayed after Undo`);
      check(await minus(page).isDisabled(), `${where}: − is enabled after Undo put the bar back`);
      await shot(page, `${width}-after-undo`);
    }

    // − steps back down by one real step, and the row follows the next set to log.
    await plus(page).click();
    await plus(page).click();
    await minus(page).click();
    const down = await weights(page);
    check(down.every((value) => value === '50'), `${where}: + + − reads ${JSON.stringify(down)}, not 50`);
    await page.getByRole('button', { name: 'Log set 1' }).click();
    check((await group(page).getAttribute('aria-label')) === 'Weight steps for set 2', `${where}: after logging set 1 the step row acts on "${await group(page).getAttribute('aria-label')}"`);
    await plus(page).click();
    const next = await weights(page);
    check(next[0] === '50' && next.slice(1).every((value) => value === '55'), `${where}: + on set 2 reads ${JSON.stringify(next)}, not 50 then 55`);

    check(errors.length === 0, `${where}: page errors ${errors.join('; ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL weight-steps-371:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('PASS: − and + step the next set by 5 lb, carry like typing, one burst with one Undo, − stops at the bar, one line at 390 and 360');
