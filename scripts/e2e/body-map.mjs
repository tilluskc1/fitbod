// Body map (#302): front and back line drawing above the body-part chips in Switch workout and in
// Plan today with me. Checks: Chest + Arms lights chest, biceps and triceps (back: triceps) only; a
// Legs day yesterday shades the legs and shows the legend, no history shows neither; a region tap
// toggles the same chip; targets 44px+, figures 140px+ side by side, no sideways scroll; no animation;
// never in the logger. 390x844, 360x780 and 390x650; screenshots only when E2E_SHOTS is set.
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
  // The map's own section at the top of the view: Switch's "Or train something else", the planner's question.
  await page.locator('.sw-else__title, .tt h2').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({ path: join(shots, `302-${name}-${where}.png`) });
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

const openSwitch = async (page) => {
  await page.getByRole('button', { name: 'Switch workout' }).click();
  await page.locator('.sheet--switch').waitFor();
  await settle(page);
};
const closeSheet = async (page) => {
  await page.keyboard.press('Escape');
  await page.locator('.sheet--switch').waitFor({ state: 'detached' });
};
const swChip = (page, name) => page.locator('.sw-chip--part', { hasText: new RegExp(`^${name}`) });
const ttChip = (page, name) => page.locator('.tt-chip', { hasText: new RegExp(`^${name}$`) });
/** The lit muscles of a view, in drawing order. */
const lit = (page, view) => page.locator(`.bm-svg[data-view="${view}"] .bm-r[data-on="true"]`)
  .evaluateAll((els) => els.map((el) => el.dataset.muscle));
const shaded = (page, tone) => page.locator(`.bm-r--${tone}`).evaluateAll((els) => [...new Set(els.map((el) => el.dataset.muscle))].sort());
const summary = async (page) => squash(await page.locator('.bm .sr-only').innerText());
const zone = (page, view, area) => page.locator(`.bm-svg[data-view="${view}"] .bm-zone[data-area="${area}"]`).first();
const toPlanTrain = async (page) => {
  await page.locator('.tt-open').click();
  await page.getByText('How long do you have?').waitFor();
  await page.locator('.tt-nav .pill-primary').click();
  await page.getByText('Anything sore or hurting?').waitFor();
  await page.locator('.tt-nav .pill-primary').click();
  await page.getByText('What do you want to train?').waitFor();
  await settle(page);
};

/** Every target 44px or more, each figure at least 140px wide, nothing scrolls sideways. */
async function sizes(page, where, label) {
  const boxes = await page.locator('.bm-zone').evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    return { area: el.dataset.area, w: box.width, h: box.height };
  }));
  check(boxes.length > 0, `${where} ${label}: no map targets`);
  for (const box of boxes) check(box.w >= 44 && box.h >= 44, `${where} ${label}: ${box.area} target is ${box.w.toFixed(1)}x${box.h.toFixed(1)}px`);
  const figs = await page.locator('.bm-svg').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  check(figs.length === 2 && figs.every((fig) => fig.width >= 140), `${where} ${label}: figures ${figs.map((fig) => fig.width).join(', ')}px wide`);
  check(figs.length === 2 && Math.abs(figs[0].top - figs[1].top) < 1, `${where} ${label}: front and back are not side by side`);
  // The page, and the map inside its card (the planner card's own bar already overhangs by 2px on main).
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth
    || [...document.querySelectorAll('.bm-figs')].some((el) => el.scrollWidth > el.clientWidth));
  check(!wide, `${where} ${label}: something scrolls sideways`);
}

const noon = new Date();
noon.setHours(12, 0, 0, 0);
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    // A fixed local noon, so "yesterday" is a calendar day whenever this runs (lesson 35).
    await page.clock.setFixedTime(noon);
    await onboard(page);

    // No history: the map draws, nothing is shaded, no legend.
    await openSwitch(page);
    check(await page.locator('.sheet--switch .bm-svg').count() === 2, `${where}: no front and back map in Switch`);
    check((await shaded(page, 'recent')).length + (await shaded(page, 'earlier')).length === 0, `${where}: shading with no history`);
    check(await page.getByText('Darker = trained recently').count() === 0, `${where}: legend with no history`);
    check(await summary(page) === 'Nothing selected.', `${where}: summary with nothing picked reads "${await summary(page)}"`);
    await sizes(page, where, 'switch');
    await shot(page, 'switch-none', where);
    await closeSheet(page);
    await toPlanTrain(page);
    check(await page.locator('.tt .bm-svg').count() === 2, `${where}: no map on Plan today's Train question`);
    check(await page.getByText('Darker = trained recently').count() === 0, `${where}: Plan today legend with no history`);
    await sizes(page, where, 'plan');
    await shot(page, 'plan-none', where);

    // A Legs workout yesterday (squat, leg curl, calf raise; no hinge, so the back stays fresh).
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      const ended = new Date(Date.now() - 26 * 3_600_000).toISOString();
      const set = (weight) => ({ weight, reps: 8, done: true, completedAt: ended });
      saved.state.history = [{
        id: 'w-legs', date: ended, endedAt: ended, name: 'Legs', dayIndex: 1, status: 'completed', completedEarly: false,
        exercises: ['back-squat', 'leg-curl', 'standing-calf-raise'].map((exerciseId) => (
          { exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 95 }], performed: [set(95)] })),
      }];
      localStorage.setItem(key, JSON.stringify(saved));
    }, KEY);
    await page.reload();
    await page.waitForSelector('.t7-hero');

    await openSwitch(page);
    const legs = ['Calves', 'Glutes', 'Hamstrings', 'Quads'];
    check(JSON.stringify(await shaded(page, 'recent')) === JSON.stringify(legs), `${where}: shaded ${JSON.stringify(await shaded(page, 'recent'))}`);
    check(await page.getByText('Darker = trained recently').count() === 1, `${where}: no legend after a Legs day`);
    check(await summary(page) === 'Nothing selected. Trained recently: legs.', `${where}: summary reads "${await summary(page)}"`);
    await shot(page, 'switch-history', where);

    // Chest + Arms: the front lights chest, biceps and triceps, the back triceps, nothing else.
    await swChip(page, 'Chest').click();
    await swChip(page, 'Arms').click();
    check(JSON.stringify(await lit(page, 'front')) === JSON.stringify(['Chest', 'Biceps', 'Triceps']), `${where}: front lights ${JSON.stringify(await lit(page, 'front'))}`);
    check(JSON.stringify(await lit(page, 'back')) === JSON.stringify(['Triceps']), `${where}: back lights ${JSON.stringify(await lit(page, 'back'))}`);
    check(await summary(page) === 'Selected: chest, arms. Trained recently: legs.', `${where}: summary reads "${await summary(page)}"`);
    check(await page.locator('.bm-figs').getAttribute('aria-hidden') === 'true', `${where}: the picture is not hidden from screen readers`);
    await sizes(page, where, 'switch');
    await shot(page, 'switch-picked', where);

    // A tap on a region toggles the same chip, both ways, on both views.
    await zone(page, 'front', 'Chest').click();
    check(await swChip(page, 'Chest').getAttribute('aria-pressed') === 'false', `${where}: tapping the chest did not clear the Chest chip`);
    await zone(page, 'front', 'Chest').click();
    check(await swChip(page, 'Chest').getAttribute('aria-pressed') === 'true', `${where}: tapping the chest did not set the Chest chip`);
    await zone(page, 'back', 'Back').click();
    check(await swChip(page, 'Back').getAttribute('aria-pressed') === 'true', `${where}: tapping the back did not set the Back chip`);
    await zone(page, 'front', 'Legs').click();
    check(await swChip(page, 'Legs').getAttribute('aria-pressed') === 'true', `${where}: tapping the legs did not set the Legs chip`);
    check(JSON.stringify(await lit(page, 'back')) === JSON.stringify(['Back', 'Triceps', 'Glutes', 'Hamstrings', 'Calves']), `${where}: back lights ${JSON.stringify(await lit(page, 'back'))}`);
    // (#302 review 1) All six parts pressed: every part lit, arms included, as the chips read.
    await swChip(page, 'Shoulders').click();
    await swChip(page, 'Core').click();
    check(JSON.stringify(await lit(page, 'front')) === JSON.stringify(['Shoulders', 'Chest', 'Biceps', 'Triceps', 'Core', 'Quads', 'Calves']), `${where}: all six light ${JSON.stringify(await lit(page, 'front'))}`);
    check(await summary(page) === 'Selected: chest, back, shoulders, arms, legs, core. Trained recently: legs.', `${where}: all-six summary reads "${await summary(page)}"`);
    const box = await page.locator('.sw-build').boundingBox();
    check(box && box.y + box.height <= height, `${where}: Build is not in view with the map (${JSON.stringify(box)})`);
    // Reduced motion: the map never animates.
    check(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.bm')).length) === 0, `${where}: the map animates`);
    await closeSheet(page);

    // Plan today with me: the same map on Train; a tap toggles the Train chip.
    await toPlanTrain(page);
    check(await page.getByText('Darker = trained recently').count() === 1, `${where}: no legend on Plan today after a Legs day`);
    // (#302 review 1) "My planned day (Push)" lights Push's own muscles, as Switch's Push does: no biceps.
    check(await page.locator('.tt-chip', { hasText: /^My planned day/ }).getAttribute('aria-pressed') === 'true', `${where}: the planned day is not the Train default`);
    check(JSON.stringify(await lit(page, 'front')) === JSON.stringify(['Shoulders', 'Chest', 'Triceps']), `${where}: planned Push lights ${JSON.stringify(await lit(page, 'front'))}`);
    check(JSON.stringify(await shaded(page, 'recent')) === JSON.stringify(legs), `${where}: Plan today shaded ${JSON.stringify(await shaded(page, 'recent'))}`);
    await shot(page, 'plan-history', where);
    await zone(page, 'front', 'Core').click();
    check(await ttChip(page, 'Core').getAttribute('aria-pressed') === 'true', `${where}: tapping the core did not set the Core chip`);
    check((await lit(page, 'front')).includes('Core'), `${where}: Core is not lit after its tap`);
    await zone(page, 'front', 'Core').click();
    check(await ttChip(page, 'Core').getAttribute('aria-pressed') === 'false', `${where}: tapping the core again did not clear it`);
    await sizes(page, where, 'plan');
    await page.close();
  }

  // A running session: the logger never shows the map.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await onboard(page);
  await page.locator('.tab-action').click();
  await page.getByRole('button', { name: 'Minimize workout' }).waitFor();
  check(await page.locator('.bm').count() === 0, '390x844: the body map shows in the logger');
  await page.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

if (failures.length) {
  console.error(`body-map: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('body-map: ok');
