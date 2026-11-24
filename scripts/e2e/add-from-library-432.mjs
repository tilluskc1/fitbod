// Add from library (#432), 390x844 and 360x780:
// - mid-workout, Ask > Add exercise opens the Add sheet: title, "Adds to this {workout} only. Your plan stays.",
//   search, muscle chips, an "N results" line and rows with an inline Add;
// - Add appends the row to the open workout only: the set being logged, the rest timer and the rest of the
//   saved data stay; the logger stays on the exercise it was on;
// - a Bands row logs reps only (no weight field, no BW, "Bands have no weight to log."), with a note;
//   a Stretching row logs seconds held ("Seconds held", "History shows N sec."); both store weight 0;
// - an added row shows no demo (nothing announced as one), no Replace, no planner preferences;
// - a reload keeps the open workout's added rows exactly;
// - offline before the first load, the Add sheet says so and Try again recovers.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//   E2E_SHOTS=<dir>    also writes screenshots there
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

const KEY = 'fitbod-clone-v1';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const flat = (text) => text.replace(/\s+/g, ' ').trim();

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4194, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const shot = async (page, name, where) => {
  if (!shots) return;
  await page.waitForTimeout(450); // let a sheet finish sliding in
  await page.screenshot({ path: join(shots, `432-${name}-${where}.png`) });
};

const BANDS = { id: 'lib-f-Band_Pull_Apart', name: 'Band Pull Apart' };
const STRETCH = { id: 'lib-f-Seated_Hamstring', name: 'Seated Hamstring' };

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

// (#430) A workout starts from Preview workout -> Start workout.
async function startWorkout(p) {
  const start = p.getByRole('button', { name: 'Start workout' });
  const previewButton = p.getByRole('button', { name: 'Preview workout' });
  await start.or(previewButton).first().waitFor();
  if (!(await start.first().isVisible())) {
    await previewButton.first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Start workout' }).waitFor();
  }
  await p.getByRole('button', { name: 'Start workout' }).first().click();
  await p.locator('.lg-ex').waitFor();
}

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state, KEY);
const exerciseName = (page) => page.locator('.lg-ex .aw-exercise__name').innerText().then(flat);

async function openAdd(page) {
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Add exercise/ }).click();
  await page.getByRole('heading', { name: 'Add exercise' }).waitFor();
}

async function addRow(page, row, chip) {
  await openAdd(page);
  if (chip) await page.locator('.chip-row .chip', { hasText: chip }).click();
  await page.locator('#add-search').fill(row.name);
  await page.getByRole('button', { name: `Add ${row.name}`, exact: true }).first().click();
  await page.getByRole('heading', { name: 'Add exercise' }).waitFor({ state: 'detached' });
}

/** Marks every built-in set done in storage, so the logger opens on the first added row after a reload. */
async function finishBuiltIns(page) {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const entry of saved.state.current.exercises) {
      if (entry.exerciseId.startsWith('lib-')) continue;
      entry.performed = entry.performed.map((set) => ({ ...set, done: true, completedAt: set.completedAt ?? new Date().toISOString() }));
    }
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await resume.or(page.locator('.lg-ex')).first().waitFor();
  if (await resume.first().isVisible()) await resume.first().click();
  await page.locator('.lg-ex').waitFor();
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const errors = [];

    // 1. Add mid-workout: the sheet, then two rows appended; nothing else moves.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await onboard(page);
      await startWorkout(page);
      await page.locator('.lg-log').click();
      const first = await exerciseName(page);
      const before = await stored(page);
      const workout = before.current.name;

      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      const addOpt = page.getByRole('dialog').getByRole('button', { name: /^Add exercise/ });
      check(flat(await addOpt.innerText()).includes('Add exercise To this workout only'), `${where}: Ask row "${flat(await addOpt.innerText())}"`);
      await shot(page, 'ask', where);
      await addOpt.click();
      await page.getByRole('heading', { name: 'Add exercise' }).waitFor();
      const sheet = page.getByRole('dialog');
      check(flat(await sheet.locator('.sheet-sub2').innerText()) === `Adds to this ${workout} only. Your plan stays.`, `${where}: sub line`);
      check(await page.locator('#add-search').isVisible(), `${where}: search box`);
      const chips = (await sheet.locator('.chip-row .chip').allInnerTexts()).map(flat);
      check(JSON.stringify(chips) === JSON.stringify(['All', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Stretching']), `${where}: chips ${chips}`);
      await sheet.locator('.ex-row--add').first().waitFor();
      await page.locator('#add-search').fill('band');
      const count = flat(await sheet.locator('.add-count').innerText());
      check(/^\d+ results?$/.test(count), `${where}: count line "${count}"`);
      const metas = await sheet.locator('.ex-row--add .ex-row__meta').allInnerTexts();
      check(metas.length > 0 && metas.every((meta) => / · /.test(meta)), `${where}: rows show muscle · equipment`);
      check(await sheet.getByRole('button', { name: `Add ${BANDS.name}`, exact: true }).count() === 1, `${where}: Band Pull Apart has an Add`);
      check(await sheet.locator('.ex-row--add', { hasText: 'Push-Up' }).count() === 0, `${where}: built-ins are not listed`);
      await shot(page, 'add-sheet', where);
      await page.getByRole('button', { name: `Add ${BANDS.name}`, exact: true }).click();
      await page.getByRole('heading', { name: 'Add exercise' }).waitFor({ state: 'detached' });
      check(flat(await page.locator('.notice-card, [role="status"]').filter({ hasText: 'added to the end of' }).first().innerText()).includes(`${BANDS.name} added to the end of ${workout}.`), `${where}: add toast`);
      check(await exerciseName(page) === first, `${where}: the logger stays on ${first}`);
      await addRow(page, STRETCH, 'Stretching');

      const after = await stored(page);
      const added = after.current.exercises.slice(-2);
      check(after.current.exercises.length === before.current.exercises.length + 2, `${where}: two rows appended`);
      check(added[0].exerciseId === BANDS.id && added[1].exerciseId === STRETCH.id, `${where}: added ids ${added.map((e) => e.exerciseId)}`);
      check(JSON.stringify(after.current.exercises.slice(0, -2)) === JSON.stringify(before.current.exercises), `${where}: earlier exercises unchanged`);
      check(after.current.restStartedAt === before.current.restStartedAt && after.current.id === before.current.id, `${where}: rest timer and workout kept`);
      check(added[0].performed.every((set) => set.weight === 0 && set.reps === 15 && !set.done), `${where}: Bands prescription`);
      check(added[1].performed.every((set) => set.weight === 0 && set.reps === 30 && !set.done), `${where}: Stretching prescription`);
      const rest = (state) => JSON.stringify({ ...state, current: null });
      check(rest(after) === rest(before), `${where}: nothing outside the open workout changed`);

      // 2. Bands: reps only, a note, no demo, no Replace; Ask offers no Swap for it.
      await finishBuiltIns(page);
      check(await exerciseName(page) === BANDS.name, `${where}: logger on ${BANDS.name} (${await exerciseName(page)})`);
      const meta = flat(await page.locator('.lg-lib-meta').innerText());
      check(meta.includes('Shoulders') && meta.includes('Bands') && /added from library/i.test(meta), `${where}: meta "${meta}"`);
      check(!/in your plans/i.test(await page.locator('.lg-ex').innerText()), `${where}: never "In your plans"`);
      check(await page.locator('.lg-thumb').count() === 0, `${where}: no thumbnail`);
      check(await page.getByRole('img', { name: `${BANDS.name} demonstration` }).count() === 0, `${where}: no demonstration announced`);
      check(await page.locator('.lg-focus input[id$=":weight"]').count() === 0, `${where}: no weight field`);
      check(!/\bBW\b/.test(await page.locator('.lg-fields').innerText()), `${where}: no BW cell`);
      check(flat(await page.locator('.lg-fields small').innerText()) === 'Reps', `${where}: Reps label`);
      check(flat(await page.locator('.lg-help').innerText()) === 'Bands have no weight to log.', `${where}: Bands helper`);
      check(await page.locator('.lg-acts').getByRole('button', { name: /Replace/ }).count() === 0, `${where}: no Replace chip`);
      await page.locator('.lg-libnote input').fill('Light band');
      const reps = page.locator('.lg-focus input[id$=":reps"]');
      await reps.fill('12');
      await reps.blur();
      await shot(page, 'log-bands', where);
      await page.locator('.lg-log').click();
      let now = await stored(page);
      let entry = now.current.exercises.find((e) => e.exerciseId === BANDS.id);
      check(entry.performed[0].done && entry.performed[0].reps === 12 && entry.performed[0].weight === 0, `${where}: Bands set stored ${JSON.stringify(entry.performed[0])}`);
      check(entry.note === 'Light band', `${where}: Bands note stored (${entry.note})`);
      const rowText = flat(await page.locator('.lg-li').first().innerText());
      check(rowText.includes('12 reps') && !rowText.includes('BW'), `${where}: list row "${rowText}"`);

      await page.locator('.aw-exercise__name-btn').click();
      const menu = page.getByRole('dialog');
      const rows = (await menu.locator('.sheet-menu__row').allInnerTexts()).map(flat);
      check(!rows.some((r) => /Replace|Recommend|Don't recommend/.test(r)), `${where}: actions for an added row ${rows}`);
      await menu.getByRole('button', { name: 'Instructions', exact: true }).click();
      await menu.locator('ol.ex-steps li').first().waitFor();
      check(await menu.getByRole('img', { name: /demonstration/ }).count() === 0, `${where}: instructions are text only`);
      await menu.getByRole('button', { name: 'Close' }).first().click();
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      check(await page.getByRole('dialog').getByRole('button', { name: 'Swap this exercise' }).count() === 0, `${where}: no Swap for an added row`);
      await page.getByRole('dialog').getByRole('button', { name: 'Back to my workout' }).click();
      for (let i = 0; i < 2; i += 1) await page.locator('.lg-log').click();

      // 3. Stretching: seconds held.
      await page.waitForFunction((name) => document.querySelector('.lg-ex .aw-exercise__name')?.textContent?.includes(name), STRETCH.name);
      check(flat(await page.locator('.lg-fields small').innerText()) === 'Seconds held', `${where}: Seconds held label`);
      check(await page.locator('.lg-focus input[id$=":weight"]').count() === 0, `${where}: stretch has no weight field`);
      const secs = page.locator('.lg-focus input[id$=":reps"]');
      await secs.fill('45');
      await secs.blur();
      check(flat(await page.locator('.lg-help').innerText()) === 'Record how long you held it. History shows 45 sec.', `${where}: stretch helper "${flat(await page.locator('.lg-help').innerText())}"`);
      check(await page.locator('.lg-libnote input').getAttribute('placeholder') === '30 sec hold, left leg', `${where}: stretch note placeholder`);
      await shot(page, 'log-timed', where);
      await page.locator('.lg-log').click();
      now = await stored(page);
      entry = now.current.exercises.find((e) => e.exerciseId === STRETCH.id);
      check(entry.performed[0].done && entry.performed[0].reps === 45 && entry.performed[0].weight === 0, `${where}: stretch stored as seconds-in-reps`);
      check(flat(await page.locator('.lg-li').first().innerText()).includes('45 sec'), `${where}: stretch list row`);

      // 4. A reload keeps the open workout exactly.
      const kept = JSON.stringify(now.current);
      await page.reload();
      await page.waitForTimeout(500);
      check(JSON.stringify((await stored(page)).current) === kept, `${where}: reload keeps the added rows`);
      await context.close();
    }

    // 5. Offline before the first load: the Add sheet says so; Try again recovers.
    {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await onboard(page);
      await startWorkout(page);
      await page.route('**/library/**', (route) => route.abort('internetdisconnected'));
      await openAdd(page);
      const offline = page.getByRole('dialog').locator('.ex-state');
      await offline.waitFor();
      check(flat(await offline.innerText()).startsWith('The exercise list needs a connection once.'), `${where}: offline copy (${flat(await offline.innerText())})`);
      await shot(page, 'add-offline', where);
      await page.unroute('**/library/**');
      await page.getByRole('dialog').getByRole('button', { name: 'Try again' }).click();
      await page.getByRole('dialog').locator('.ex-row--add').first().waitFor();
      await context.close();
    }

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    console.log(`${where}: add sheet, append, bands reps, stretch seconds, actions, reload, offline`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`add-from-library-432: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('add-from-library-432: pass at 390x844 and 360x780');
