// The Plan page (#297): a header naming the usual setup ("Your usual: Gym · 45 min · 3 days a week"
// with Edit), white rows labelled Today / Next / Then with plain-word focus and one stats line, the
// #298 today-only bar on Today's row only, View (or Resume while a session runs), a status chip only
// when a day is not Ready, and a "why days differ" line that stays dismissed for the app session only
// (nothing stored). Today, Next and Then are fully visible at 390x844 and 360x780, the last row clears
// the Start button at 390x650, no row runs past 3 lines and no label wraps.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//   E2E_SHOTS=<dir>    also writes 297-<state>-<size>.png
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
const server = await preview({ preview: { port: 4197, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const KEY = 'fitbod-clone-v1';
const squash = (text) => text.replace(/\s+/g, ' ').trim();

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^3\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

const openTab = async (page, name) => {
  await page.locator('nav.tabbar .tab', { hasText: name }).click();
  if (name === 'Plan') await page.waitForSelector('.plan-row--today');
};

/** Waits for finite animations (lesson 29) before a shot. */
async function shot(page, name) {
  if (!shots) return;
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: join(shots, `297-${name}.png`) });
}

/** Rows' text: label, title and stats, one entry per row. */
const rows = (page) => page.locator('.plan-row').evaluateAll((list) => list.map((row) => ({
  label: row.querySelector('.plan-row__label').textContent.trim(),
  title: row.querySelector('.plan-row__title').textContent.replace(/\s+/g, ' ').trim(),
  stats: row.querySelector('.plan-row__stats > span').textContent.trim(),
  chip: row.querySelector('.plan-chip')?.textContent.trim() ?? null,
})));

/**
 * Shape: Today, Next and Then fully above the Start button (when `fold`); each row's label, title
 * and stats are one line apiece (3 text lines); no label wraps; nothing scrolls sideways.
 */
async function shape(page, where, fold) {
  const got = await page.evaluate(() => {
    const lines = (el) => {
      if (!el) return 0;
      const range = document.createRange();
      range.selectNodeContents(el);
      // Text on one line can sit at different tops (an 18px name beside 14px focus): a new line starts 8px+ lower.
      const tops = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.bottom).sort((a, b) => a - b);
      return tops.filter((top, i) => i === 0 || top - tops[i - 1] > 8).length;
    };
    const start = document.querySelector('.tab-action__play').getBoundingClientRect().top;
    return {
      start: Math.round(start),
      overflowX: document.documentElement.scrollWidth > window.innerWidth || document.querySelector('.screen').scrollWidth > document.querySelector('.screen').clientWidth,
      rows: [...document.querySelectorAll('.plan-row')].slice(0, 3).map((row) => ({
        label: row.querySelector('.plan-row__label').textContent.trim(),
        top: Math.round(row.getBoundingClientRect().top),
        bottom: Math.round(row.getBoundingClientRect().bottom),
        lines: lines(row.querySelector('.plan-row__label')) + lines(row.querySelector('.plan-row__title')) + lines(row.querySelector('.plan-row__stats > span')),
        labelLines: lines(row.querySelector('.plan-row__label')),
        chipLines: lines(row.querySelector('.plan-chip')),
      })),
      usualLines: lines(document.querySelector('.plan-usual > span')),
    };
  });
  check(!got.overflowX, `${where}: the page scrolls sideways`);
  check(got.usualLines === 1, `${where}: the header line wraps (${got.usualLines} lines)`);
  for (const row of got.rows) {
    check(row.lines <= 3, `${where}: ${row.label} row runs to ${row.lines} text lines`);
    check(row.labelLines === 1 && row.chipLines <= 1, `${where}: ${row.label} label or chip wraps`);
    if (fold) check(row.top >= 0 && row.bottom <= got.start, `${where}: ${row.label} row (y ${row.top}-${row.bottom}) not fully above the Start button (${got.start})`);
  }
}

/** Today's bar as read: its label and Undo, the icon's ligature left out. */
const barText = async (page) => {
  const bar = page.locator('.plan-row--today .t7-today-only');
  if (!(await bar.count())) return '';
  return squash(`${await bar.locator('.t7-today-only__l').innerText()} ${await bar.locator('.t7-today-only__undo').innerText()}`);
};

/** (#298) The bar on Plan is one line, its label never cut, Undo at least 44x44. */
async function barWhole(page, where) {
  const fit = await page.locator('.plan-row--today .t7-today-only').evaluate((bar) => {
    const label = bar.querySelector('.t7-today-only__l');
    const undo = bar.querySelector('.t7-today-only__undo').getBoundingClientRect();
    return { height: Math.round(bar.getBoundingClientRect().height), cut: label.scrollWidth > label.clientWidth, undoW: undo.width, undoH: undo.height };
  });
  check(fit.height <= 48 && !fit.cut, `${where}: the bar wraps or cuts its label (${JSON.stringify(fit)})`);
  check(fit.undoW >= 44 && fit.undoH >= 44, `${where}: Undo is under 44px (${fit.undoW}x${fit.undoH})`);
}

/** Today's row matches View session: minutes, exercises and sets (one helper, lesson 24). */
async function matchesView(page, where) {
  const [today] = await rows(page);
  await page.locator('.plan-row--today .plan-row__view').click();
  const sheet = squash(await page.locator('.sheet').first().innerText());
  const m = sheet.match(/(≈?\d+) min · (\d+) exercises? · (\d+) sets?/);
  const r = today.stats.match(/(\d+) exercises? · (\d+) sets? · (≈?\d+) min/);
  check(m && r && m[1] === r[3] && m[2] === r[1] && m[3] === r[2], `${where}: Today row "${today.stats}" differs from View session "${m?.[0]}"`);
  await page.keyboard.press('Escape');
  await page.locator('.sheet').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  if (await page.locator('.sheet').count()) await page.getByRole('button', { name: /^Close/ }).first().click();
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const fold = height > 700;
    const page = await browser.newPage({ viewport: { width, height } });
    await onboard(page);
    await openTab(page, 'Plan');

    // 1. No change: header, three rows, no bar, no old lines.
    const body = squash(await page.locator('.screen').innerText());
    check(/Your usual: Gym · 45 min · 3 days a week Edit/.test(body), `${where}: header reads "${body.slice(0, 120)}"`);
    for (const gone of ['Your selected equipment', 'Adjusted for today', 'UP NEXT', 'AFTER THAT']) check(!body.includes(gone), `${where}: "${gone}" still shows`);
    check(!(await page.locator('.t7-today-only').count()), `${where}: a today-only bar on the usual day`);
    const plain = await rows(page);
    check(plain.map((row) => row.label).join(',') === 'Today,Next,Then', `${where}: labels ${plain.map((row) => row.label)}`);
    check(plain.every((row) => /^\d+ exercises? · \d+ sets? · ≈?\d+ min$/.test(row.stats)), `${where}: stats ${plain.map((row) => row.stats)}`);
    check(plain.every((row) => !/Quads · |·.*Core/.test(row.title) && row.title === row.title.replace(/[A-Z]/g, (c, i) => i === 0 ? c : c)), `${where}: raw muscle list in ${plain.map((row) => row.title)}`);
    check(plain.every((row) => row.chip === null), `${where}: a chip on a Ready day (${plain.map((row) => row.chip)})`);
    check(await page.locator('.plan-explainer').count() === 1, `${where}: the explainer does not show`);
    await shape(page, `${where} no change`, fold);
    await matchesView(page, `${where} no change`);
    await shot(page, `plain-${where}`);

    // 2. The explainer: tapped away, it stays away across tabs, stores nothing, and a new app session shows it again.
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await page.locator('.plan-explainer__close').click();
    check(!(await page.locator('.plan-explainer').count()), `${where}: the explainer stays after tapping it away`);
    await openTab(page, 'Today');
    await openTab(page, 'Plan');
    check(!(await page.locator('.plan-explainer').count()), `${where}: the explainer came back in the same session`);
    const after = await page.evaluate((key) => localStorage.getItem(key), KEY);
    check(before === after, `${where}: dismissing the explainer changed stored data`);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    await openTab(page, 'Plan');
    check(await page.locator('.plan-explainer').count() === 1, `${where}: the explainer did not come back in a new app session`);

    // 3. Edit opens Settings at Training.
    await page.locator('.plan-usual__edit').click();
    await page.locator('#settings-training').waitFor();
    await page.waitForTimeout(150);
    const training = await page.locator('#settings-training').boundingBox();
    check(training && training.y >= 0 && training.y < height / 2, `${where}: Edit did not open Settings at Training (y ${training?.y})`);
    await page.keyboard.press('Escape');
    await page.locator('#settings-training').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    if (await page.locator('#settings-training').count()) await page.getByRole('button', { name: /^Close/ }).first().click();

    // 4. Today only: Travel gym and 30 min. The bar sits on Today's row; Next and Then keep their figures.
    await openTab(page, 'Today');
    await page.locator('.t7-pill--gym').click();
    await page.getByRole('button', { name: /Travel gym/ }).click();
    await page.waitForSelector('.t7-today-only');
    await page.locator('.t7-controls .t7-pill').first().click();
    await page.getByRole('button', { name: /^30 min/ }).click();
    await page.waitForFunction(() => document.querySelector('.t7-today-only')?.textContent?.includes('30 min'), null, { timeout: 4000 }).catch(() => {});
    await page.waitForSelector('.done-toast', { state: 'detached', timeout: 6000 }).catch(() => {});
    await openTab(page, 'Plan');
    const changed = await rows(page);
    const bar = await barText(page);
    check(bar === 'Today only: Travel gym · 30 min Undo', `${where}: Today's bar reads "${bar}"`);
    await barWhole(page, `${where} today only`);
    check(await page.locator('.t7-today-only').count() === 1, `${where}: the bar shows outside Today's row`);
    check(squash(await page.locator('.plan-usual').innerText()) === 'Your usual: Gym · 45 min · 3 days a week Edit', `${where}: the header moved with today's change`);
    check(changed[1].stats === plain[1].stats && changed[2].stats === plain[2].stats, `${where}: Next/Then changed with today's change (${changed[1].stats}, ${changed[2].stats})`);
    check(changed.slice(1).every((row) => row.chip === null && !/today/i.test(row.label)), `${where}: Next or Then carries an extra label`);
    await shape(page, `${where} today only`, fold);
    await matchesView(page, `${where} today only`);
    await shot(page, `today-only-${where}`);
    // Undo from Plan puts the usual back.
    await page.locator('.plan-row--today .t7-today-only__undo').click();
    await page.waitForFunction(() => !document.querySelector('.t7-today-only'), null, { timeout: 4000 }).catch(() => {});
    check(!(await page.locator('.t7-today-only').count()), `${where}: Undo on Plan left the bar`);
    check((await rows(page))[0].stats === plain[0].stats, `${where}: after Undo, Today reads "${(await rows(page))[0].stats}", want "${plain[0].stats}"`);

    // 5. Dock: scrolled to the end, the last row and the loop line clear the Start button by 16px.
    await page.waitForSelector('.done-toast', { state: 'detached', timeout: 6000 }).catch(() => {});
    await page.locator('.screen').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const dock = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.plan-row, .plan-loop')];
      const last = items[items.length - 1].getBoundingClientRect();
      const ring = 6; // the Start button's surface ring (box-shadow)
      return { last: Math.round(last.bottom), start: Math.round(document.querySelector('.tab-action__play').getBoundingClientRect().top - ring) };
    });
    check(dock.last <= dock.start - 16, `${where}: last item bottom ${dock.last} not 16px above the Start button (${dock.start})`);
    if (height === 650) await shot(page, `dock-${where}`);
    await page.locator('.screen').evaluate((el) => el.scrollTo(0, 0));

    // 6. A described day (#193): its own name, the bar names it, no plain-focus words.
    await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key));
      const { state } = stored;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      state.todayOverride = { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, minutes: 45,
        equipment: state.profile.equipment, support: state.profile.support, appliedAt: now.toISOString(), choice: 'home', focus: ['Chest', 'Back'] };
      localStorage.setItem(key, JSON.stringify(stored));
    }, KEY);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    await openTab(page, 'Plan');
    const described = await rows(page);
    const dbar = await barText(page);
    check(described[0].title === 'Chest + Back', `${where}: described Today row titled "${described[0].title}"`);
    check(dbar === 'Today only: Chest + Back (you chose) Undo', `${where}: described bar reads "${dbar}"`);
    await barWhole(page, `${where} described`);
    await shape(page, `${where} described`, fold);
    await matchesView(page, `${where} described`);
    await shot(page, `described-${where}`);
    await page.locator('.plan-row--today .t7-today-only__undo').click();
    await page.waitForFunction(() => !document.querySelector('.t7-today-only'), null, { timeout: 4000 }).catch(() => {});

    // 7. A running session: "In progress · 1 of N sets" and Resume, no bar, no View.
    await openTab(page, 'Today');
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    await page.locator('button.lg-check:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Minimize workout' }).click();
    await openTab(page, 'Plan');
    const running = await rows(page);
    check(/^In progress · 1 of \d+ sets$/.test(running[0].chip ?? ''), `${where}: running chip reads "${running[0].chip}"`);
    const action = squash(await page.locator('.plan-row--today .plan-row__view').innerText());
    check(action === 'Resume', `${where}: running Today row offers "${action}", want Resume`);
    await shape(page, `${where} running`, fold);
    await shot(page, `running-${where}`);
    await page.locator('.plan-row--today .plan-row__view').click();
    check(await page.locator('.lg-ex').first().waitFor({ timeout: 3000 }).then(() => true, () => false), `${where}: Resume did not open the logger`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`plan-page: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('plan-page: pass at 390x844, 360x780 and 390x650');
