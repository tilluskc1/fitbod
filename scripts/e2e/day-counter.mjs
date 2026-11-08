// The day-counter check (#271): Today's hero and Plan's Up next say "Day N of M" (plan position),
// never "Slot" and never a "this week" claim; the two always agree, including after workouts on a
// Saturday and a reload on Sunday; Train never says "slot". 390x844 and 360x780.
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
const server = await preview({ preview: { port: 4189, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const counterOf = (text) => text.match(/\bDay (\d+) of (\d+)\b/i)?.slice(1).join('/') ?? null;
const SAT = new Date('2026-11-07T09:00:00');
const SUN = new Date('2026-11-08T09:00:00');

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

/** One whole workout, back on Today. */
async function finishWorkout(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  for (let guard = 0; guard < 120; guard += 1) {
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) { await confirm.click(); continue; }
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.t7-hero');
}

/** Today's hero and Plan's Up next name the same day, and neither claims "this week". */
async function heroMatchesPlan(page, where) {
  await page.waitForSelector('.t7-hero');
  const hero = await page.locator('.t7-hero').innerText();
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  const plan = await page.locator('body').innerText();
  const upNext = plan.match(/UP NEXT · [^\n]*/)?.[0] ?? '';
  check(counterOf(hero) && counterOf(hero) === counterOf(upNext), `${where}: hero "${counterOf(hero)}" vs Plan "${upNext}"`);
  check(!/\bDay \d+ of \d+ this week/i.test(hero + plan), `${where}: the counter claims "this week"`);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
}

const noSlot = (text, where) => check(!/\bslots?\b/i.test(text), `${where} says "slot": ${text.match(/.{0,30}\bslots?\b.{0,30}/i)?.[0]}`);

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    await onboard(page);

    const hero = await page.locator('.t7-hero').innerText();
    check(/Day 1 of 4(?! this week)/.test(hero), `${where}: Today hero lacks "Day 1 of 4": ${hero.replace(/\n/g, ' | ')}`);
    noSlot(await page.locator('body').innerText(), `${where} Today`);
    if (shots) await page.screenshot({ path: join(shots, `271-today-${where}.png`) });

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    const plan = await page.locator('body').innerText();
    check(/UP NEXT · DAY 1 OF 4(?! THIS WEEK)/.test(plan), `${where}: Plan Up next lacks the day counter`);
    noSlot(plan, `${where} Plan`);
    if (shots) await page.screenshot({ path: join(shots, `271-plan-${where}.png`) });

    // Skip today: the counter moves on and the notice never says "slot".
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Skip this session' }).click();
    await page.waitForFunction(() => document.querySelector('.t7-hero')?.textContent?.includes('Day 2 of 4'), null, { timeout: 4000 }).catch(() => {});
    check((await page.locator('.t7-hero').innerText()).includes('Day 2 of 4'), `${where}: counter did not move to day 2 after a skip`);
    noSlot(await page.locator('body').innerText(), `${where} Today after skip`);
    if (shots) await page.screenshot({ path: join(shots, `271-today-after-skip-${where}.png`) });

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    noSlot(await page.locator('body').innerText(), `${where} Train`);
    await page.close();

    // Calendar vs plan: two workouts on Saturday, reopen on Sunday (a new week starts Sunday).
    const cal = await browser.newPage({ viewport: { width, height } });
    await cal.clock.setFixedTime(SAT);
    await onboard(cal);
    await finishWorkout(cal);
    await finishWorkout(cal);
    await heroMatchesPlan(cal, `${where} Saturday after two workouts`);
    await cal.clock.setFixedTime(SUN);
    await cal.reload();
    await cal.waitForSelector('.t7-hero');
    await heroMatchesPlan(cal, `${where} Sunday`);
    if (shots) await cal.screenshot({ path: join(shots, `271-sunday-${where}.png`) });
    await cal.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`day-counter: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('day-counter: pass at 390x844 and 360x780');
