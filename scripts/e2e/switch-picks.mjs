// Switch workout's "Or train something else" (#296): presets and body parts build a today-only day
// through Plan today with me's path; the plan's own day stays next. Checks the chips' layout (at most
// two lines per row, no wrapped label), Build pinned in view at 390x650, "Pick at least one", the
// recovery label, a Limited pick with its reason and gear fix, the pain link, and Undo back to the
// planned day. 390x844, 360x780 and 390x650; screenshots only when E2E_SHOTS is set.
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
const server = await preview({ preview: { port: 4199, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const KEY = 'fitbod-clone-v1';

const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime) && !a.effect?.target?.closest?.('.done-toast'))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name, where) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: join(shots, `296-${name}-${where}.png`) });
};

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
const heroTitle = async (page) => squash(await page.locator('.t7-hero__title').innerText());
const openSwitch = async (page) => {
  await page.getByRole('button', { name: 'Switch workout' }).click();
  await page.locator('.sheet--switch').waitFor();
  await settle(page);
};
const chip = (page, name) => page.locator('.sw-chip', { hasText: new RegExp(`^${name}`) }).first();
/** The sheet scrolled to its end: chips, the consequence and its note above the pinned Build. */
const toBottom = (page) => page.locator('.sheet--switch').evaluate((sheet) => { sheet.scrollTop = sheet.scrollHeight; });
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state ?? null, KEY);

/** Each chip row takes at most two lines and no chip's label wraps or is cut. */
async function chipsFit(page, where) {
  const fit = await page.locator('.sw-chips').evaluateAll((rows) => rows.map((row) => {
    const chips = [...row.querySelectorAll('.sw-chip')];
    const tops = new Set(chips.map((el) => Math.round(el.getBoundingClientRect().top)));
    const wrapped = chips.filter((el) => [...el.children].length
      ? [...el.children].some((part) => part.getClientRects().length > 1 || part.scrollWidth > part.clientWidth + 1)
      : el.getClientRects().length > 1 || el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > 46);
    const small = chips.filter((el) => el.getBoundingClientRect().height < 44);
    return { lines: tops.size, wrapped: wrapped.map((el) => el.textContent), small: small.length };
  }));
  fit.forEach((row, index) => {
    check(row.lines <= 2, `${where}: chip row ${index + 1} takes ${row.lines} lines`);
    check(row.wrapped.length === 0, `${where}: chip labels wrap or are cut: ${row.wrapped.join(', ')}`);
    check(row.small === 0, `${where}: a chip is under 44px`);
  });
}

/** Build sits inside the visible viewport, not under the fold. */
async function buildInView(page, where) {
  const box = await page.locator('.sw-build').boundingBox();
  const height = page.viewportSize().height;
  check(box && box.y >= 0 && box.y + box.height <= height, `${where}: Build is not in view (${JSON.stringify(box)} of ${height})`);
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    await onboard(page);
    const planned = await heroTitle(page);
    check(/Push/.test(planned), `${where}: a 3-day plan does not start on Push ("${planned}")`);

    // A finished chest session yesterday: the Chest chip says so and stays selectable.
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      const { state } = saved;
      const ended = new Date(Date.now() - 26 * 3_600_000).toISOString();
      // Two calendar days back whatever the hour: 23:00 two days ago, or 40 h ago if that is later.
      const back = new Date(); back.setDate(back.getDate() - 2); back.setHours(23, 0, 0, 0);
      const twoDays = new Date(Math.max(back.getTime(), Date.now() - 40 * 3_600_000)).toISOString();
      state.history = [{
        id: 'w-yesterday', date: ended, endedAt: ended, name: 'Earlier', dayIndex: 0, status: 'completed', completedEarly: false,
        exercises: [{ exerciseId: 'barbell-bench-press', name: 'Bench Press', planned: [{ reps: 8, weight: 95 }], performed: [{ weight: 95, reps: 8, done: true, completedAt: ended }] }],
      }, {
        // (#296 review 1) 40 h ago, so a chip carries the longest label, "trained 2 days ago", at every size.
        id: 'w-two-days', date: twoDays, endedAt: twoDays, name: 'Earlier', dayIndex: 1, status: 'completed', completedEarly: false,
        exercises: [{ exerciseId: 'back-squat', name: 'Back Squat', planned: [{ reps: 8, weight: 135 }], performed: [{ weight: 135, reps: 8, done: true, completedAt: twoDays }] }],
      }];
      localStorage.setItem(key, JSON.stringify(saved));
    }, KEY);
    await page.reload();
    await page.waitForSelector('.t7-hero');

    // Default: nothing picked, Build disabled with its hint, Build pinned in view.
    await openSwitch(page);
    await shot(page, 'default', where);
    check(await page.locator('.sw-build').isDisabled(), `${where}: Build is enabled with nothing picked`);
    check(await page.getByText('Pick at least one').count() === 1, `${where}: no "Pick at least one" hint`);
    await buildInView(page, where);
    const chest = squash(await chip(page, 'Chest').innerText());
    check(/trained (yesterday|today)/.test(chest), `${where}: the Chest chip reads "${chest}"`);
    check(await chip(page, 'Chest').isEnabled(), `${where}: the recovering Chest chip is not selectable`);
    const legs = squash(await chip(page, 'Legs').innerText());
    check(legs === 'Legs trained 2 days ago', `${where}: the Legs chip reads "${legs}"`);
    await chipsFit(page, where);

    // A preset fills its parts; the consequence line names it.
    await chip(page, 'Pull').click();
    check(await chip(page, 'Back').getAttribute('aria-pressed') === 'true', `${where}: Pull did not fill Back`);
    const pullLine = squash(await page.locator('.sw-line').innerText());
    check(/^Pull · \d+ exercises · \d+ sets · ≈?\d+ min$/.test(pullLine), `${where}: Pull line reads "${pullLine}"`);
    await chipsFit(page, where);
    await buildInView(page, where);
    await toBottom(page);
    await shot(page, 'preset', where);

    // Body parts: editing a part clears the preset.
    await chip(page, 'Pull').click(); // off
    await chip(page, 'Shoulders').click();
    await chip(page, 'Arms').click();
    check(await chip(page, 'Pull').getAttribute('aria-pressed') === 'false', `${where}: a preset stays on after editing parts`);
    const partsLine = squash(await page.locator('.sw-line').innerText());
    check(/^Shoulders \+ Arms · \d+ exercises · \d+ sets · ≈?\d+ min$/.test(partsLine), `${where}: parts line reads "${partsLine}"`);
    await chipsFit(page, where);
    await buildInView(page, where);
    await toBottom(page);
    await shot(page, 'parts', where);

    // Pull → Build: Today is Pull, nothing stored but the override's focus, the plan stays on Push.
    await chip(page, 'Shoulders').click();
    await chip(page, 'Arms').click();
    await chip(page, 'Pull').click();
    const before = await stored(page);
    await page.locator('.sw-build').click();
    await page.locator('.sheet--switch').waitFor({ state: 'detached' });
    check(/Pull/.test(await heroTitle(page)) && !/Push/.test(await heroTitle(page)), `${where}: Today reads "${await heroTitle(page)}" after building Pull`);
    const after = await stored(page);
    check(JSON.stringify(after.programCursor) === JSON.stringify(before.programCursor), `${where}: the plan cursor moved`);
    check(JSON.stringify(after.todayOverride?.focus) === JSON.stringify(['Back', 'Biceps']), `${where}: override focus ${JSON.stringify(after.todayOverride)}`);
    check(Object.keys(after).sort().join() === Object.keys(before).sort().join(), `${where}: stored keys changed`);
    const bar = squash(await page.locator('.t7-today-only__l').innerText());
    check(/^Today only: Pull \(you chose\)/.test(bar), `${where}: bar reads "${bar}"`);
    await shot(page, 'built', where);

    // Undo returns to the planned day.
    await page.locator('.t7-today-only__undo').click();
    check(await heroTitle(page) === planned, `${where}: Undo left "${await heroTitle(page)}"`);

    // Limited: bodyweight today, Arms (no biceps work without gear); the reason and the gear fix show.
    await page.locator('.t7-pill--gym').click();
    await page.getByRole('button', { name: /^Bodyweight/ }).click();
    await openSwitch(page);
    await chip(page, 'Arms').click();
    const limited = squash(await page.locator('.sw-out').innerText());
    check(/Limited/.test(limited) && /Not possible here: no biceps exercise with this gear/.test(limited), `${where}: limited pick reads "${limited}"`);
    check(await page.getByRole('button', { name: "Change today's gear" }).count() === 1, `${where}: no gear fix on a gear gap`);
    await buildInView(page, where);
    await toBottom(page);
    await shot(page, 'limited', where);
    await chip(page, 'Arms').click();
    await chip(page, 'Back').click();
    check(await page.locator('.sw-build').isDisabled(), `${where}: Build is enabled for a bodyweight Back day with nothing in it`);

    // The pain link opens Plan today with me; Switch never asks about pain itself.
    check(!/pain|hurt/i.test(squash(await page.locator('.sw-chips').first().innerText())), `${where}: Switch asks about pain`);
    await page.getByRole('button', { name: /Sore or hurt\? Plan today with me/ }).click();
    await page.getByText('How long do you have?').waitFor({ timeout: 3000 }).catch(() => {});
    check(await page.getByText('How long do you have?').count() === 1, `${where}: the pain link did not open the planner`);
    await page.close();
  }

  // A running session disables Switch.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await onboard(page);
  await page.locator('.tab-action').click();
  await page.waitForTimeout(300);
  await page.locator('nav.tabbar .tab', { hasText: 'Today' }).click().catch(() => {});
  const switchPill = page.getByRole('button', { name: 'Switch workout' });
  if (await switchPill.count()) check(await switchPill.isDisabled(), '390x844: Switch is enabled while a session runs');
  await page.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

if (failures.length) {
  console.error(`switch-picks: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('switch-picks: ok');
