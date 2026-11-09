// The wrap and tap-target check (#136): the controls the issue lists keep their labels on one line
// (or stack on purpose) and are at least 44x44, with no sideways scroll. 390x844 and 360x780.
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
const server = await preview({ preview: { port: 4190, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/** Box size and the number of text lines (icons ignored) of an element. */
const box = (locator) => locator.evaluate((el) => {
  el.scrollIntoView({ block: 'center' }); // clear of sticky bars, as a user would scroll it
  const tops = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || node.parentElement.closest('.ms')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 8)) tops.push(rect.top);
    }
  }
  const { left, top, width, height } = el.getBoundingClientRect();
  // The box only counts where a tap lands on it: probe its top and bottom edges.
  const hits = [top + 2, top + height - 2].every((y) => el.contains(document.elementFromPoint(left + width / 2, y)));
  return { width: Math.round(width), height: Math.round(height), lines: tops.length, hits };
});

async function target(page, locator, name, where, { wraps = false } = {}) {
  check((await locator.count()) > 0, `${where}: "${name}" not found`);
  if (!(await locator.count())) return;
  const { width, height, lines, hits } = await box(locator.first());
  check(wraps || lines === 1, `${where}: "${name}" wraps to ${lines} lines`);
  check(width >= 44 && height >= 44, `${where}: "${name}" is ${width}x${height}, under 44x44`);
  check(hits, `${where}: "${name}" does not receive taps at its top and bottom edges`);
}

async function noOverflow(page, where) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${where}: scrolls sideways by ${over}px`);
}

const shot = (page, name, where) => shots && page.screenshot({ path: join(shots, `136-${name}-${where}.png`) });

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await page.goto(url);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByPlaceholder('Your first name').fill('Sam');
    await page.getByRole('button', { name: /Build muscle/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Intermediate/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /^4\s*days$/ }).click();
    // #262: the four session lengths share one row (60 min never wraps alone), each a 44px target.
    const lengths = page.getByRole('group', { name: 'Session length' }).getByRole('button');
    check((await lengths.count()) === 4, `${where} Onboarding: ${await lengths.count()} length chips, expected 4`);
    const lengthTops = new Set();
    for (let index = 0; index < (await lengths.count()); index += 1) {
      const chip = lengths.nth(index);
      await target(page, chip, (await chip.innerText()).trim(), `${where} Onboarding`);
      lengthTops.add(Math.round((await chip.boundingBox()).y));
      // The label fits inside the pill's padding box (a padding rule that loses the cascade spills it).
      const fit = await chip.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const style = getComputedStyle(el);
        const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return { text: Math.ceil(range.getBoundingClientRect().width), inner };
      });
      check(fit.text <= fit.inner, `${where} Onboarding: "${await chip.innerText()}" label is ${fit.text}px in a ${fit.inner}px pill`);
    }
    check(lengthTops.size === 1, `${where} Onboarding: length chips sit on ${lengthTops.size} rows, expected 1`);
    await noOverflow(page, `${where} Onboarding`);
    await lengths.first().scrollIntoViewIfNeeded();
    await shot(page, 'onboarding-length', where);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Build my plan' }).click();
    await page.waitForSelector('.t7-hero');

    // Today's coach card.
    await target(page, page.locator('.coach-card__actions').getByRole('button', { name: 'Why this target' }), 'Why this target', `${where} Today`);
    await target(page, page.locator('.coach-card__actions').getByRole('button', { name: 'Skip this session' }), 'Skip this session', `${where} Today`);
    await noOverflow(page, `${where} Today`);
    await page.locator('.coach-card__actions').scrollIntoViewIfNeeded();
    await shot(page, 'today', where);

    // Plan: View session, then the Equipment tab's Edit.
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await target(page, page.getByRole('button', { name: 'View session' }), 'View session', `${where} Plan`);
    await noOverflow(page, `${where} Plan`);
    await page.locator('.plan-foot').first().scrollIntoViewIfNeeded();
    await shot(page, 'plan', where);
    await page.getByRole('tab', { name: 'Equipment' }).click();
    await target(page, page.getByRole('button', { name: 'Edit', exact: true }), 'Edit', `${where} Plan equipment`);
    await shot(page, 'plan-equipment', where);

    // Train: the exercise title, the set editor's Done, Swap rows, then Discard.
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    // A long exercise name may wrap like any heading; the button must still be a full target.
    await target(page, page.locator('.aw-exercise__name-btn'), 'exercise title', `${where} Train`, { wraps: true });
    await noOverflow(page, `${where} Train`);
    await shot(page, 'train', where);

    await page.locator('button.lg-cell[aria-label^="Edit reps for set 1"]').click();
    const done = page.locator('.lg-edit').getByRole('button', { name: 'Done', exact: true });
    await target(page, done, 'set editor Done', `${where} Train`);
    const [doneWidth, rowWidth] = await done.evaluate((el) => [el.offsetWidth, el.parentElement.clientWidth]);
    check(doneWidth >= rowWidth - 1, `${where} Train: set editor Done is ${doneWidth}px of a ${rowWidth}px row, not full width`);
    await done.scrollIntoViewIfNeeded();
    await shot(page, 'set-editor', where);
    await done.click();

    await page.locator('.lg-acts').getByRole('button', { name: 'Replace' }).click();
    const rows = page.locator('[role="dialog"] button.context-row');
    check((await rows.count()) > 0, `${where} Swap: no rows to measure`);
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      const name = (await row.locator('span').first().innerText()).trim();
      for (const part of [row.locator('span').first(), row.locator('span').last()]) {
        const { lines } = await box(part);
        check(lines === 1, `${where} Swap: "${(await part.innerText()).trim()}" (row ${name}) wraps to ${lines} lines`);
      }
      const size = await box(row);
      check(size.height >= 44, `${where} Swap: row ${name} is ${size.height}px tall`);
    }
    await noOverflow(page, `${where} Swap`);
    await shot(page, 'swap', where);
    await page.getByRole('dialog').getByRole('button', { name: /^Keep / }).click();

    // Log one set so Finish offers to save or discard (an empty session offers a skip instead).
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) await confirm.click();
    await page.locator('button.lg-check:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await target(page, page.getByRole('button', { name: 'Discard this session' }), 'Discard this session', `${where} Finish sheet`);
    await shot(page, 'finish', where);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`tap-targets: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('tap-targets: pass at 390x844 and 360x780');
