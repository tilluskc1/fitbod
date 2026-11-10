// The second-workout check (#245): finish a real week through the UI, come back a week later, and
// start the same day with last week's loads and the progressed target already there.
//
//   npm run e2e        (builds, then runs this against the built app at 390x844 and 360x780)
//
// Uses an installed Playwright (local, global, or NODE_PATH); it is not a project dependency.
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
const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const MONDAY = new Date('2026-11-02T08:00:00');
const day = (n) => new Date(MONDAY.getTime() + n * 864e5);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'lb', exact: true }).click();
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

/** One whole workout: log every set at its prefilled weight (#309), finish, back to Today. */
async function finishWorkout(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
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
    const firstDay = await page.locator('.t7-hero__title').innerText();
    // Week 1: the four days of the plan, one a day.
    for (const offset of [0, 1, 3, 4]) {
      await page.clock.setFixedTime(day(offset));
      await finishWorkout(page);
    }
    const lastWeek = await page.evaluate(() => {
      const { state } = JSON.parse(localStorage.getItem('fitbod-clone-v1'));
      const workout = state.history.find((item) => item.dayIndex === 0) ?? state.history.at(-1);
      const lead = workout.exercises[0];
      return { name: lead.name, done: lead.performed.filter((set) => set.done).length, kg: lead.performed[0].weight };
    });

    // A week later, a cold open.
    await page.clock.setFixedTime(day(7));
    await page.reload();
    await page.waitForSelector('.t7-hero');
    check(await page.locator('.t7-hero__title').innerText() === firstDay, `${where}: the week's first day is up again`);
    const card = (await page.locator('.t7-workout .compare-block').first().innerText()).replace(/\s+/g, ' ');
    const last = card.match(/Last session (\d+)[\d · ]* @ ([\d.]+) lb (?:total|each)/);
    const target = card.match(/Today’s target (\d+)[\d · ]* @ ([\d.]+) lb (?:total|each)/);
    check(Boolean(last), `${where}: Last session shows the load (${card})`);
    check(Boolean(target), `${where}: the target carries its load (${card})`);

    // Two taps and nothing in between: Start, then set 1's check, with no step and no typing.
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    check(await page.getByText(/Suggested start/).count() === 0, `${where}: no suggested start the second time`);
    const row = (await page.locator('td.lg-prev').first().innerText()).replace(/\s+/g, ' ').trim();
    const weight = (await page.locator('table input.lg-cell').first().inputValue()).trim();
    if (last) check(row === `${last[2]} × ${last[1]}`, `${where}: previous is last week's ${last[2]} × ${last[1]} (${row})`);
    if (target) check(weight === target[2], `${where}: set 1 is prefilled with the target's ${target[2]} (${weight})`);
    const log = page.getByRole('button', { name: 'Log set 1' }).first();
    check(await log.isEnabled(), `${where}: set 1 can be logged without typing`);
    await log.click();
    check(await page.getByRole('img', { name: 'Set 1 logged' }).count() === 1, `${where}: set 1 logged`);
    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${firstDay} again; ${lastWeek.name} last week ${lastWeek.done} sets @ ${lastWeek.kg} kg; card "${card}"; previous "${row}"; set 1 "${weight}"`);
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}

if (failures.length > 0) {
  console.error(`FAIL\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('PASS: second workout starts in 2 taps with last week\'s loads and the progressed target');
