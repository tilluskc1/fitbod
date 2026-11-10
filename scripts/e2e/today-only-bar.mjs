// The today-only bar (#298): a gym profile that picks Travel for today sees "Today only: Travel gym"
// with Undo, the gear pill still reads "Gym" with a dot, and Undo puts the usual gear and length
// back with a "Back to your usual" message. The bar stays on one line and Undo is a 44px target.
// 390x844, 360x780 and 390x650.
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

async function onboard(page) {
  await page.goto(url);
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

/** The bar is one line, its label is not cut, and Undo is at least 44x44. */
async function barFits(page, where) {
  const fit = await page.locator('.t7-today-only').evaluate((bar) => {
    const label = bar.querySelector('.t7-today-only__l');
    const undo = bar.querySelector('.t7-today-only__undo').getBoundingClientRect();
    return { height: bar.getBoundingClientRect().height, cut: label.scrollWidth > label.clientWidth, undoW: undo.width, undoH: undo.height };
  });
  check(fit.height <= 48 && !fit.cut, `${where}: the bar wraps or cuts its label (${JSON.stringify(fit)})`);
  check(fit.undoW >= 44 && fit.undoH >= 44, `${where}: Undo is under 44px (${fit.undoW}x${fit.undoH})`);
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    await onboard(page);
    check(!(await page.locator('.t7-today-only').count()), `${where}: a bar shows on the usual day`);
    const pill = page.locator('.t7-pill--gym');
    check((await pill.innerText()).trim().startsWith('Gym'), `${where}: the gear pill does not read Gym before`);

    // Travel for today.
    await pill.click();
    check(await page.getByText('Your gym (usual)').count() > 0, `${where}: the gear menu does not mark the usual gym`);
    await page.getByRole('button', { name: /Travel gym/ }).click();
    await page.waitForSelector('.t7-today-only');
    const bar = (await page.locator('.t7-today-only').innerText()).replace(/\s+/g, ' ');
    check(/Today only: Travel gym Undo/.test(bar), `${where}: bar reads "${bar}"`);
    check((await pill.innerText()).trim().startsWith('Gym'), `${where}: the gear pill no longer reads Gym`);
    check(await pill.locator('.t7-pill__dot').count() === 1, `${where}: the gear pill has no dot`);
    check(!(await page.getByText('Adjusted for today').count()), `${where}: "Adjusted for today" still shows`);
    await barFits(page, `${where} travel`);
    if (shots) await page.screenshot({ path: join(shots, `298-travel-${where}.png`) });

    // And a shorter day: both parts, still one line.
    await page.locator('.t7-controls .t7-pill').first().click();
    await page.getByRole('button', { name: /^30 min/ }).click();
    await page.waitForFunction(() => document.querySelector('.t7-today-only')?.textContent?.includes('30 min'), null, { timeout: 4000 }).catch(() => {});
    const both = (await page.locator('.t7-today-only').innerText()).replace(/\s+/g, ' ');
    check(/Today only: Travel gym · 30 min/.test(both), `${where}: bar reads "${both}"`);
    await barFits(page, `${where} travel and 30 min`);
    if (shots) await page.screenshot({ path: join(shots, `298-travel-30-${where}.png`) });

    // Undo: the usual gear and length, the bar gone, and the message.
    await page.locator('.t7-today-only__undo').click();
    await page.waitForFunction(() => !document.querySelector('.t7-today-only'), null, { timeout: 4000 }).catch(() => {});
    check(!(await page.locator('.t7-today-only').count()), `${where}: the bar is still there after Undo`);
    const alerts = await page.locator('.done-toast').innerText().catch(() => '');
    check(alerts.includes('Back to your usual: Gym · 45 min.'), `${where}: Undo message reads "${alerts}"`);
    // The length pill names the asked length; the hero's figure is the work's own estimate (#203).
    const length = await page.locator('.t7-controls .t7-pill').first().innerText();
    const meta = await page.locator('.t7-hero__meta').innerText();
    check(/45 min/.test(length) && /Gym/.test(meta) && !/Travel/.test(meta), `${where}: after Undo, length "${length}", hero "${meta}"`);
    check(!(await pill.locator('.t7-pill__dot').count()), `${where}: the dot stays after Undo`);
    if (shots) await page.screenshot({ path: join(shots, `298-undo-${where}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`today-only-bar: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('today-only-bar: pass at 390x844, 360x780 and 390x650');
