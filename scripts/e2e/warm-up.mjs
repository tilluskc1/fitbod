// The warm-up check (#300): the logger opens on a Warm-up block (5 min, 3 at 30 min) and two ramp
// rows on the lead whose loads come from the working load set 1 shows (lesson 12). Ticking them logs
// nothing; a reload resumes at the warm-up; the first working set ends it.
//
//   npm run e2e        (builds, then runs this against the built app at 390x844 and 360x780)
//   E2E_SHOTS=<dir>    also writes the logger's first screen there
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
const server = await preview({ preview: { port: 4183, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const SHOTS = process.env.E2E_SHOTS;
const MONDAY = new Date('2026-11-09T08:00:00');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

async function onboard(page, minutes) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'kg', exact: true }).click();
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: `${minutes} min`, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** Last week's session of today's lead, 5 sets at 60 kg: today's target holds 60 kg. */
async function seedLead(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  await page.evaluate(() => {
    const key = 'fitbod-clone-v1';
    const stored = JSON.parse(localStorage.getItem(key));
    const current = stored.state.current;
    const lead = current.exercises[0];
    const reps = lead.planned[0].reps;
    const done = lead.planned.map(() => ({ weight: 60, reps: Math.max(1, reps - 1), done: true, completedAt: '2026-11-02T08:30:00.000Z' }));
    const record = {
      ...current, id: 'seed-300', date: '2026-11-02T08:00:00.000Z', status: 'completed', completedEarly: true,
      endedAt: '2026-11-02T09:00:00.000Z', restStartedAt: null,
      exercises: [{ ...lead, planned: lead.planned.map((set) => ({ ...set, weight: 60 })), performed: done }],
    };
    stored.state.history = [...stored.state.history, record];
    stored.state.current = null;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await page.waitForSelector('.t7-hero');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
}

const number = (value) => Number(value.replace(/[^\d.]/g, ''));

const browser = await chromium.launch();
try {
  for (const [width, height, minutes] of [[390, 844, 45], [360, 780, 30]]) {
    const where = `${width}x${height} ${minutes} min`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(MONDAY);
    await onboard(page, minutes);
    await seedLead(page);

    // The block, with the minutes the session already holds.
    const block = page.getByRole('region', { name: 'Warm-up' });
    const expectMin = minutes <= 30 ? 3 : 5;
    check(await block.count() === 1, `${where}: a Warm-up block opens the logger`);
    const blockText = await block.count() ? await text(block) : '';
    check(blockText.includes(`Warm-up · ${expectMin} min`), `${where}: warm-up reads ${expectMin} min (${blockText})`);
    check(blockText.includes('Easy cardio: treadmill walk or jog, bike or rower'), `${where}: cardio copy (${blockText})`);

    // Ramp rows against the working load set 1 shows (lesson 12).
    const working = number(await text(page.locator('table button.lg-cell').first()));
    const rampLoads = await page.locator('tr.lg-row--warm td:nth-child(3)').allInnerTexts();
    const rampReps = await page.locator('tr.lg-row--warm td:nth-child(4)').allInnerTexts();
    const tags = await page.locator('tr.lg-row--warm .lg-warm-tag').allInnerTexts();
    check(working === 60, `${where}: set 1 shows the seeded 60 kg (${working})`);
    check(rampLoads.length === 2, `${where}: two ramp rows (${rampLoads.length})`);
    check(tags.every((tag) => /warm-up/i.test(tag)), `${where}: ramp rows labelled Warm-up (${tags})`);
    const [half, threeQuarter] = rampLoads.map(number);
    const step = (value) => Math.max(20, Math.round(value / 2.5) * 2.5);
    check(half === step(working * 0.5), `${where}: ramp 1 is 50% of ${working}: ${half}`);
    check(threeQuarter === step(working * 0.75), `${where}: ramp 2 is 75% of ${working}: ${threeQuarter}`);
    check(half < threeQuarter && threeQuarter < working, `${where}: ramps climb under the working load`);
    check(rampReps.map(number).join() === '8,3', `${where}: ramp reps 8 then 3 (${rampReps})`);
    check(number(await text(page.locator('td.lg-prev').first())) > 0, `${where}: Previous still reads the working sets`);

    // Ticking the warm-up logs nothing.
    const caption = await text(page.locator('.lg-cap'));
    if (failures.length > 0) break;
    await block.getByRole('button', { name: /Warm-up, \d min easy cardio, done/ }).click();
    await page.getByRole('button', { name: /Warm-up set 1,/ }).click();
    await page.getByRole('button', { name: /Warm-up set 2,/ }).click();
    check(await text(page.locator('.lg-cap')) === caption, `${where}: sets caption unchanged (${caption})`);
    check(await page.getByRole('img', { name: 'Set 1 logged' }).count() === 0, `${where}: no set logged by the warm-up`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.current.exercises[0]);
    check(stored.performed.every((set) => !set.done) && stored.performed.length === stored.planned.length,
      `${where}: the record holds only the working sets`);
    check(stored.performed.every((set) => set.weight === 60), `${where}: no warm-up load in the record`);

    // Reload mid-warm-up resumes at the warm-up.
    await page.reload();
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await page.waitForSelector('.lg-ex');
    check(await page.getByRole('region', { name: 'Warm-up' }).count() === 1, `${where}: warm-up again after reload`);
    check(await page.locator('tr.lg-row--warm').count() === 2, `${where}: ramp rows again after reload`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `warm-up-${width}x${height}.png`) });

    // The first working set ends the warm-up.
    await page.getByRole('button', { name: 'Log set 1' }).first().click();
    check(await page.getByRole('region', { name: 'Warm-up' }).count() === 0, `${where}: warm-up gone after set 1`);
    check(await page.locator('tr.lg-row--warm').count() === 0, `${where}: ramp rows gone after set 1`);
    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: set 1 ${working} kg; ramps ${rampLoads.join(' / ')} × ${rampReps.join(' / ')}; ${caption}`);
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
console.log('PASS: warm-up block and ramp rows follow the working load and log nothing');
