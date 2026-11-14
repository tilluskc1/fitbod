// (#369) Later: one tap on the logger's chip row moves the exercise to "Skipped today" and the logger
// shows the next exercise with work left; the toast's Undo brings it back as the current exercise.
// The four chips (How-to, History, Replace, Later) sit on one line, nothing overflows sideways, and
// Later hides on the only exercise with work left. 390x844 and 360x780. Shots only with E2E_SHOTS.
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
const server = await preview({ preview: { port: 4185, strictPort: false }, logLevel: 'silent' });
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
  await page.screenshot({ path: `${shots}/369-${name}.png` });
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
const skippedNames = async (page) => {
  const section = page.locator('section[aria-label="Skipped today"]');
  if ((await section.count()) === 0) return [];
  return (await section.locator('.context-row > span').allInnerTexts()).map((text) => text.split(' · ')[0].trim());
};
const later = (page) => page.locator('.lg-acts').getByRole('button', { name: 'Later', exact: true });

/** The chip row: every chip's top, whether any chip or the row scrolls sideways, and the page's width. */
async function chipRow(page) {
  return page.locator('.lg-acts').evaluate((row) => {
    const chips = [...row.querySelectorAll('.lg-act')].map((chip) => {
      const box = chip.getBoundingClientRect();
      const icon = chip.querySelector('.ms')?.getBoundingClientRect();
      return { text: chip.textContent, top: box.top, right: box.right, height: box.height, icon: icon?.width ?? 0 };
    });
    return {
      chips,
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

    const first = await current(page);
    const row = await chipRow(page);
    const labels = row.chips.map((chip) => chip.text.replace(/^[a-z_]+/, ''));
    check(JSON.stringify(labels) === JSON.stringify(['How-to', 'History', 'Replace', 'Later']), `${where}: chip row reads ${JSON.stringify(labels)}`);
    const tops = row.chips.map((chip) => chip.top);
    check(Math.max(...tops) - Math.min(...tops) <= 1, `${where}: chips not on one line (tops ${tops.join(', ')})`);
    check(!row.rowScrolls, `${where}: chip row scrolls sideways`);
    check(row.chips.every((chip) => chip.right <= row.rowRight + 0.5), `${where}: a chip runs past the row (${row.chips.map((c) => c.right).join(', ')} > ${row.rowRight})`);
    check(!row.pageScrolls, `${where}: the page scrolls sideways`);
    check(row.chips.every((chip) => chip.height >= 44), `${where}: a chip is under 44px tall`);
    // A ligature missing from the subset font renders as its name, far wider than 16px.
    check(row.chips.every((chip) => chip.icon > 0 && chip.icon <= 20), `${where}: a chip icon did not render as a glyph (${row.chips.map((c) => c.icon).join(', ')})`);
    await shot(page, `${width}-before`);

    // One tap: Later.
    await later(page).click();
    const taps = await page.evaluate(() => window.__taps);
    check(taps === 1, `${where}: Later took ${taps} taps`);
    await page.waitForFunction((name) => document.querySelector('.aw-exercise__name')?.textContent?.trim() !== name, first, { timeout: 3000 }).catch(() => {});
    const second = await current(page);
    check(second !== first, `${where}: logger still shows ${first} after Later`);
    const exerciseNo = (await page.locator('.lg-ex__meta').innerText()).match(/Exercise (\d+) of/)?.[1];
    check(exerciseNo === '2', `${where}: logger shows exercise ${exerciseNo} after Later, not the 2nd`);
    const skipped = await skippedNames(page);
    check(skipped.includes(first), `${where}: ${first} not under Skipped today (${JSON.stringify(skipped)})`);
    const toast = page.locator('.done-toast');
    const toastText = (await toast.locator('.done-toast__text').innerText().catch(() => '')).trim();
    check(toastText === `${first} moved to later.`, `${where}: toast reads "${toastText}"`);
    await shot(page, `${width}-after-later`);

    // Undo on the toast brings it back as the current exercise.
    const undo = toast.getByRole('button', { name: 'Undo' });
    check((await undo.count()) === 1, `${where}: no Undo on the Later toast`);
    if ((await undo.count()) === 1) {
      await undo.click();
      await page.waitForFunction((name) => document.querySelector('.aw-exercise__name')?.textContent?.trim() === name, first, { timeout: 3000 }).catch(() => {});
      check((await current(page)) === first, `${where}: Undo did not bring ${first} back as current (${await current(page)})`);
      check(!(await skippedNames(page)).includes(first), `${where}: ${first} still under Skipped today after Undo`);
      check((await toast.count()) === 0, `${where}: the Later toast stayed after Undo`);
      await shot(page, `${width}-after-undo`);
    }

    // Undo is the Later toast's own: another Done toast carries none.
    await later(page).click();
    await page.locator('section[aria-label="Skipped today"]').getByRole('button', { name: 'Return to exercise' }).first().click();
    const returned = (await toast.locator('.done-toast__text').innerText().catch(() => '')).trim();
    check(/is back in today's session\.$/.test(returned), `${where}: Return's toast reads "${returned}"`);
    check((await toast.getByRole('button', { name: 'Undo' }).count()) === 0, `${where}: Return's toast offers the Later Undo`);

    // Later hides on the only exercise with work left: move every other one to later.
    for (let guard = 0; guard < 20 && (await later(page).count()) === 1; guard += 1) await later(page).click();
    const total = Number((await page.locator('.lg-ex__meta').innerText()).match(/of (\d+)/)?.[1]);
    const left = await skippedNames(page);
    check(left.length === total - 1, `${where}: Later hid with ${left.length} of ${total - 1} others skipped`);
    check((await later(page).count()) === 0, `${where}: Later shows on the last exercise with work left`);
    await shot(page, `${width}-last-exercise`);

    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`later-369: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('later-369: Later moves on in one tap, Undo brings it back, chips on one line at 390 and 360');
