// (#371) − and + under the logger's set table move the next set to log by one real step (5 lb plates on
// a pound barbell), carrying to later unlogged sets exactly as typing does. Three quick taps are one burst
// with one toast and one Undo, and Undo puts every set back. − is disabled at the empty bar. The two
// buttons sit on one line, 44px tall, with no sideways scroll. 390x844 and 360x780. Shots only with E2E_SHOTS.
// Review 1: at a Travel gym a dumbbell steps the hotel rack (18 → 22 kg, "+ 4 kg" / "− 3 kg", + disabled at 25),
// and "Apply to all" on a Big-jump hold reached by taps keeps the burst's Undo whole (set 1 back to 60 kg).
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

const KEY = 'fitbod-clone-v1';

async function onboard(page, unit = 'lb') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: unit, exact: true }).click();
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
const stepButton = (page, sign) => group(page).getByRole('button', { name: new RegExp(`^\\${sign} `) });
const label = async (page, sign) => (await stepButton(page, sign).innerText()).replace(/\s+/g, ' ').trim();
const minus = (page) => group(page).getByRole('button', { name: '− 5 lb', exact: true });
const plus = (page) => group(page).getByRole('button', { name: '+ 5 lb', exact: true });
/** Type a load into a set's weight cell one key at a time, then leave the cell. */
async function typeWeight(page, set, value) {
  const input = page.getByRole('textbox', { name: new RegExp(`^Set ${set} weight`) });
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  for (const key of String(value)) await page.keyboard.press(key);
  await input.blur();
}

/** (From big-jump.mjs) The lead lift was last done at 60 kg a week ago, and today's sets all show 60. */
async function seed(page) {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const { state } = saved;
    const current = state.current;
    const lead = current.exercises.findIndex((exercise) => !exercise.skipped);
    const week = new Date(Date.parse(current.date) - 7 * 864e5).toISOString();
    const done = structuredClone(current);
    done.id = `${current.id}-last-week`;
    done.date = week;
    done.status = 'completed';
    done.endedAt = week;
    done.completedEarly = true;
    done.exercises = [done.exercises[lead]];
    done.exercises[0].performed = done.exercises[0].performed.map((set) => ({ ...set, weight: 60, done: true, completedAt: week }));
    done.exercises[0].planned = done.exercises[0].planned.map((set) => ({ ...set, weight: 60 }));
    state.history = [done];
    current.exercises[lead].performed = current.exercises[lead].performed.map((set) => ({ ...set, weight: 60, done: false, completedAt: null }));
    current.exercises[lead].planned = current.exercises[lead].planned.map((set) => ({ ...set, weight: 60 }));
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  const resume = page.getByRole('button', { name: 'Resume workout', exact: true });
  await Promise.race([page.waitForSelector('.lg-ex'), resume.waitFor()]);
  if (!(await page.locator('.lg-ex').count())) await resume.click();
  await page.waitForSelector('.lg-ex');
}

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

    // Review 1, bug 1 and risk 3: a Travel gym day steps the hotel rack, each button reading its own difference.
    const travel = await browser.newPage({ viewport: { width, height } });
    travel.on('pageerror', (error) => errors.push(String(error)));
    await onboard(travel, 'kg');
    await travel.locator('.t7-pill--gym').click();
    await travel.getByRole('button', { name: /Travel gym/ }).click();
    await travel.waitForSelector('.t7-today-only');
    await travel.getByRole('button', { name: 'Start workout' }).click();
    await travel.waitForSelector('.lg-ex');
    for (let guard = 0; guard < 10 && !/kg each/i.test(await travel.locator('table.lg-table thead').innerText()); guard += 1) {
      await travel.locator('.lg-acts').getByRole('button', { name: 'Later', exact: true }).click();
    }
    check(/kg each/i.test(await travel.locator('table.lg-table thead').innerText()), `${where} travel: no dumbbell exercise found`);
    await typeWeight(travel, 1, 18);
    check((await weights(travel))[0] === '18', `${where} travel: set 1 reads ${(await weights(travel))[0]} after typing 18`);
    check(await label(travel, '+') === '+ 4 kg' && await label(travel, '\u2212') === '\u2212 3 kg',
      `${where} travel: at 18 kg the buttons read "${await label(travel, '\u2212')}" and "${await label(travel, '+')}", not − 3 kg and + 4 kg`);
    await stepButton(travel, '+').click();
    check((await weights(travel))[0] === '22', `${where} travel: + from 18 reads ${(await weights(travel))[0]}, not the hotel's 22`);
    await typeWeight(travel, 1, 25);
    check(await stepButton(travel, '+').isDisabled(), `${where} travel: + is enabled at the hotel's heaviest, 25 kg`);
    check(await label(travel, '\u2212') === '\u2212 3 kg', `${where} travel: at 25 kg − reads "${await label(travel, '\u2212')}"`);
    await shot(travel, `${width}-travel`);
    await travel.close();

    // Review 1, risk 4: + + + from last time's 60 kg reaches 67.5 (12% over): held on set 1, Apply to all
    // carries it, and that toast's Undo puts every set back, set 1 included.
    const jump = await browser.newPage({ viewport: { width, height } });
    jump.on('pageerror', (error) => errors.push(String(error)));
    await onboard(jump, 'kg');
    await jump.getByRole('button', { name: 'Start workout' }).click();
    await jump.waitForSelector('.lg-ex');
    await seed(jump);
    const seeded = await weights(jump);
    check(seeded.every((value) => value === '60'), `${where} jump: seeded sets read ${JSON.stringify(seeded)}`);
    for (let tap = 0; tap < 3; tap += 1) await stepButton(jump, '+').click();
    const held = await weights(jump);
    check(held[0] === '67.5' && held.slice(1).every((value) => value === '60'), `${where} jump: + + + reads ${JSON.stringify(held)}, not 67.5 held on set 1`);
    const apply = jump.locator('.lg-note--held').getByRole('button', { name: 'Apply to all' });
    check((await apply.count()) === 1, `${where} jump: no Apply to all after the held jump`);
    if ((await apply.count()) === 1) {
      await apply.click();
      check((await weights(jump)).every((value) => value === '67.5'), `${where} jump: Apply to all reads ${JSON.stringify(await weights(jump))}`);
      const undoAll = jump.locator('.done-toast').getByRole('button', { name: 'Undo' });
      check((await undoAll.count()) === 1, `${where} jump: no Undo after Apply to all`);
      if ((await undoAll.count()) === 1) {
        await undoAll.click();
        const back = await weights(jump);
        check(back.every((value) => value === '60'), `${where} jump: Undo after Apply to all reads ${JSON.stringify(back)}, not 60 on every set`);
      }
    }
    await jump.close();
    check(errors.length === 0, `${where}: page errors ${errors.join('; ')}`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL weight-steps-371:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('PASS: − and + step the next set by 5 lb, carry like typing, one burst with one Undo, − stops at the bar, one line at 390 and 360; Travel gym steps the hotel rack; Apply to all keeps a tapped burst Undo whole');
