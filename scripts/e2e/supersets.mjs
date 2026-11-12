// #88: supersets. An Intermediate 45-minute gym Upper A pairs Overhead Press with Chin-Up for 3 rounds.
// Preview lists them in one bracket; the logger alternates A1, B1, A2, B2 with a 30 s switch and the
// full rest after each round, says "Round 2 of 3", resumes mid-round after a reload, and the Settings
// toggle (read live) turns the next set straight without touching logged sets.
//
//   npm run e2e        (builds, then runs this at 390x844, 360x780 and 390x650, kg and lb)
//   E2E_SHOTS=<dir>    also writes the preview, the logger mid-pair and the Settings row
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
const server = await preview({ preview: { port: 4191, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const SHOTS = process.env.E2E_SHOTS;
const MONDAY = new Date('2026-11-09T08:00:00');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function onboard(page, unit) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: unit, exact: true }).click();
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: '45 min', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** Every finite animation done (lesson 29), fonts loaded. */
const settle = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime)).map((a) => a.finished.catch(() => {})));
});
const shot = async (page, name) => {
  if (!SHOTS) return;
  await settle(page);
  await page.screenshot({ path: join(SHOTS, name) });
};

/** The exercise on screen, its band ("Round 2 of 3 · with …") and the rest clock. */
const text = async (page, selector) => {
  const locator = page.locator(selector);
  return (await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, ' ').trim() : '';
};
const screen = async (page) => ({
  name: await text(page, '.lg-ex .aw-exercise__name'),
  band: await text(page, '.ss-band'),
  rest: await text(page, '.lg-rest__time'),
  next: await text(page, '.lg-next'),
});

/** Logs the next set of the exercise on screen, typing a load first when its cell is empty. */
async function logNext(page) {
  const button = page.locator('.lg-table button.lg-check:not(:disabled)').first();
  if (!(await button.count())) {
    const cell = page.locator('.lg-row--current input.lg-input').first();
    await cell.fill('20');
    await cell.press('Enter');
  }
  await page.locator('.lg-table button.lg-check:not(:disabled)').first().click();
}

const browser = await chromium.launch();
try {
  for (const [width, height, unit] of [[390, 844, 'kg'], [360, 780, 'lb'], [390, 650, 'kg']]) {
    const where = `${width}x${height} ${unit}`;
    const size = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(MONDAY);
    await onboard(page, unit);

    // Today's hero names the day's minutes; the preview must name the same figure (lesson 12).
    const hero = Number((await page.locator('section.t7-hero').getAttribute('aria-label'))?.match(/(\d+) minutes$/)?.[1]);
    // 1. Preview: the pair in one bracket, the minutes within the 45 asked.
    await page.getByRole('button', { name: 'Preview workout' }).click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'Start workout' });
    await sheet.waitFor();
    const group = sheet.getByRole('group', { name: /^Superset:/ });
    check(await group.count() === 1, `${where}: preview shows ${await group.count()} superset brackets, want 1`);
    const groupText = (await group.count()) ? (await group.first().innerText()).replace(/\s+/g, ' ') : '';
    check(/Superset · 3 rounds/.test(groupText) && /Overhead Press/.test(groupText) && /Chin-Up/.test(groupText),
      `${where}: preview bracket reads "${groupText}"`);
    const minutes = Number((await sheet.locator('.sheet-copy').innerText()).match(/(\d+) min/)?.[1]);
    check(minutes > 0 && minutes <= 45, `${where}: preview promises ${minutes} min for a 45 min day`);
    check(minutes === hero, `${where}: preview reads ${minutes} min, Today ${hero} min`);
    if (size !== '390x650') await shot(page, `88-preview-${size}.png`);
    await sheet.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');

    // 2. Lead and the row run straight; then Overhead Press and Chin-Up alternate.
    const order = [];
    for (let step = 0; step < 8; step += 1) {
      order.push((await screen(page)).name);
      await logNext(page);
    }
    const seen = await screen(page);
    check(order.slice(0, 5).every((name) => /Bench Press/.test(name)) && order.slice(5, 8).every((name) => /Row/.test(name)),
      `${where}: lead then row run straight (${order.join(', ')})`);
    check(/Overhead Press/.test(seen.name) && /Round 1 of 3 · with Chin-Up/.test(seen.band), `${where}: OHP opens round 1 (${JSON.stringify(seen)})`);
    check(/Up next · Chin-Up/.test(seen.next), `${where}: Up next is the partner (${seen.next})`);
    await logNext(page); // A1
    const b1 = await screen(page);
    check(/Chin-Up/.test(b1.name) && /Round 1 of 3/.test(b1.band) && b1.rest === '00:30', `${where}: after A1, Chin-Up with a 30 s switch (${JSON.stringify(b1)})`);
    await logNext(page); // B1
    const a2 = await screen(page);
    check(/Overhead Press/.test(a2.name) && /Round 2 of 3/.test(a2.band) && a2.rest !== '00:30' && a2.rest !== '',
      `${where}: after B1, Overhead Press round 2 with the full rest (${JSON.stringify(a2)})`);
    await logNext(page); // A2
    const b2 = await screen(page);
    check(/Chin-Up/.test(b2.name) && /Round 2 of 3 · with Overhead Press/.test(b2.band) && b2.rest === '00:30',
      `${where}: after A2, Chin-Up round 2 (${JSON.stringify(b2)})`);
    const loggedA = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.current.exercises
      .find((entry) => entry.exerciseId === 'overhead-press').performed.filter((set) => set.done).length);
    check(loggedA === 2, `${where}: Overhead Press holds 2 logged sets (${loggedA})`);
    await shot(page, `88-logger-round2-${size}.png`);

    // 3. A reload mid-round resumes at B2.
    await page.reload();
    const resume = page.getByRole('button', { name: 'Resume workout', exact: true });
    if (await resume.count()) await resume.click();
    await page.waitForSelector('.lg-ex');
    const back = await screen(page);
    check(/Chin-Up/.test(back.name) && /Round 2 of 3/.test(back.band), `${where}: reload resumes at Chin-Up round 2 (${JSON.stringify(back)})`);

    // 4. Settings: the toggle, read live. Off runs the next set straight; logged sets stay.
    await page.getByRole('button', { name: 'Minimize workout' }).click();
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Training settings' });
    const toggle = settings.getByRole('group', { name: 'Pair exercises to save time' });
    await toggle.scrollIntoViewIfNeeded();
    check(await toggle.getByRole('button', { name: 'On' }).getAttribute('aria-pressed') === 'true', `${where}: the toggle starts On`);
    if (size !== '390x650') await shot(page, `88-settings-${size}.png`);
    await toggle.getByRole('button', { name: 'Off' }).click();
    check(await toggle.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed') === 'true', `${where}: Off is pressed`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.profile.pairExercises);
    check(stored === false, `${where}: profile stores pairExercises false (${stored})`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await page.waitForSelector('.lg-ex');
    const straight = await screen(page);
    check(/Overhead Press/.test(straight.name) && straight.band === '', `${where}: Off, Overhead Press runs straight (${JSON.stringify(straight)})`);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbod-clone-v1')).state.current.exercises
      .filter((entry) => ['overhead-press', 'chin-up'].includes(entry.exerciseId)).map((entry) => entry.performed.filter((set) => set.done).length));
    check(kept.join() === '2,1', `${where}: logged sets untouched by the toggle (${kept})`);

    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: preview ${minutes} min with "${groupText.slice(0, 40)}"; A1 B1 A2 then "${b2.band}" rest ${b2.rest}; reload resumes; Off runs ${straight.name} straight`);
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
console.log('PASS: supersets preview, alternate with a 30 s switch, say the round, resume after a reload, and the toggle reads live');
