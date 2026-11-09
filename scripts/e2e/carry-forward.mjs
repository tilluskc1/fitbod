// (#306) Changing set 1 carries to the sets still to come: the value set 1 shows is the value sets 2+
// show, a hand-edited set keeps its own, Undo puts the carried sets back, a reload keeps the carried
// values, and the ⋮ menu's "Set all remaining sets to…" writes every unlogged set. lb at 390x844 and
// 360x780, plus a kg pass. Screenshots only when E2E_SHOTS is set.
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
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function onboard(page, unit) {
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

/** Each set row as { weight, reps }, read from the cells the lifter sees (inputs since #309). */
async function rows(page) {
  const out = [];
  for (const row of await page.locator('table.lg-table tbody tr:not(.lg-note)').all()) {
    const cells = row.locator('input.lg-cell');
    out.push({ weight: (await cells.nth(0).inputValue()).trim(), reps: (await cells.nth(1).inputValue()).trim() });
  }
  return out;
}

/** Tap a set's weight cell, type one key at a time as a phone keyboard does, then leave the cell. */
async function typeWeight(page, set, value) {
  const input = page.getByLabel(new RegExp(`^Set ${set} weight`));
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(value));
  await input.blur();
}

const browser = await chromium.launch();
try {
  for (const [width, height, unit, heavy, hand, heavier] of [
    [390, 844, 'lb', '135', '115', '155'],
    [360, 780, 'lb', '135', '115', '155'],
    [390, 844, 'kg', '60', '50', '70'],
  ]) {
    const where = `${width}x${height} ${unit}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page, unit);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const name = (await page.locator('.aw-exercise__name').innerText()).trim();
    const target = (await page.locator('.lg-ex__meta').innerText()).match(/Target (\d+) × (\d+)/);
    check(Boolean(target), `${where}: the header names a sets × reps target`);

    // The prefilled reps equal the target's reps (the "4 × 8 vs 5" check), and every set starts alike.
    let r = await rows(page);
    const start = r[0].weight;
    if (target) {
      check(r.length === Number(target[1]), `${where}: ${target[1]} rows for the target (${r.length})`);
      check(r.every((row) => row.reps === target[2]), `${where}: every row prefills ${target[2]} reps (${JSON.stringify(r)})`);
    }
    check(r.every((row) => row.weight === start), `${where}: one starting load on every set`);
    if (shots && unit === 'lb') await page.screenshot({ path: `${shots}/306-before-carry-${width}.png` });

    // Set 1 to the heavy load: sets 2+ show what set 1 shows, at once, with an Undo toast.
    await typeWeight(page, 1, heavy);
    r = await rows(page);
    check(r[0].weight === heavy, `${where}: set 1 shows ${heavy} (${r[0].weight})`);
    check(r.slice(1).every((row) => row.weight === r[0].weight), `${where}: sets 2+ show set 1's ${r[0].weight} (${JSON.stringify(r)})`);
    const toast = page.locator('.app-alerts .banner');
    const toastText = (await toast.innerText()).replace(/\s+/g, ' ');
    check(toastText.includes(`${heavy} ${unit} applied to sets 2 to ${r.length}`), `${where}: toast names the carry (${toastText})`);
    if (unit === 'lb') check(/Big jump from the starting load/.test(toastText), `${where}: a first-time jump says heads-up (${toastText})`);
    check(await toast.getByRole('button', { name: 'Undo' }).count() === 1, `${where}: the toast offers Undo`);
    if (shots && unit === 'lb') await page.screenshot({ path: `${shots}/306-after-carry-${width}.png` });

    // A hand-edited last set keeps its value when set 1 changes again.
    await typeWeight(page, r.length, hand);
    await typeWeight(page, 1, heavier);
    r = await rows(page);
    check(r.slice(1, -1).every((row) => row.weight === r[0].weight) && r[0].weight === heavier,
      `${where}: middle sets follow set 1's ${heavier} (${JSON.stringify(r)})`);
    check(r.at(-1).weight === hand, `${where}: the hand-edited last set keeps ${hand} (${r.at(-1).weight})`);

    // Undo puts the carried sets back to what they held; set 1 and the hand-edited set keep theirs.
    await toast.getByRole('button', { name: 'Undo' }).click();
    r = await rows(page);
    check(r[0].weight === heavier && r.slice(1, -1).every((row) => row.weight === heavy) && r.at(-1).weight === hand,
      `${where}: Undo returns sets 2+ to ${heavy} (${JSON.stringify(r)})`);

    // Log set 1, reload: the carried values are still there, and the logged set is untouched.
    await page.getByRole('button', { name: 'Log set 1' }).click();
    await page.reload();
    const resume = page.getByRole('button', { name: 'Resume workout', exact: true });
    await Promise.race([page.waitForSelector('.lg-ex'), resume.waitFor()]);
    if (!(await page.locator('.lg-ex').count())) await resume.click();
    await page.waitForSelector('.lg-ex');
    const after = await rows(page);
    check(JSON.stringify(after) === JSON.stringify(r), `${where}: a reload keeps the carried values (${JSON.stringify(after)} vs ${JSON.stringify(r)})`);

    // ⋮ → Set all remaining sets to… heavy × 6: every unlogged set reads it; the logged set 1 stays.
    await page.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('button', { name: /Set all remaining sets to/ }).click();
    await page.getByLabel(/^Weight \(/).fill(heavy);
    const reps = page.locator('[aria-label="Set all remaining sets"] output');
    for (let guard = 0; guard < 30 && Number(await reps.innerText()) > 6; guard += 1) await page.getByRole('button', { name: 'Decrease reps' }).click();
    for (let guard = 0; guard < 30 && Number(await reps.innerText()) < 6; guard += 1) await page.getByRole('button', { name: 'Increase reps' }).click();
    if (shots && unit === 'lb') await page.screenshot({ path: `${shots}/306-set-all-${width}.png` });
    await page.getByRole('button', { name: /^Apply to \d+ sets?$/ }).click();
    r = await rows(page);
    check(r[0].weight === heavier, `${where}: logged set 1 keeps ${heavier} (${r[0].weight})`);
    check(r.slice(1).every((row) => row.weight === heavy && row.reps === '6'), `${where}: every unlogged set reads ${heavy} × 6 (${JSON.stringify(r)})`);
    // (review 2) Sets 3 and 4 typed by hand, then set 2 edited with backspaces, 135 → 13 → 1 → 10 → 100,
    // passing through set 4's value: the first keystroke follows nobody, so nobody follows for the burst.
    if (unit === 'lb') {
      await typeWeight(page, 3, '95');
      await typeWeight(page, 4, '10');
      const input = page.getByLabel(/^Set 2 weight/);
      await input.focus();
      await input.press('End');
      await input.press('Backspace');
      await input.press('Backspace');
      await input.pressSequentially('00');
      await input.blur();
      r = await rows(page);
      check(r[1].weight === '100' && r[2].weight === '95' && r[3].weight === '10',
        `${where}: backspacing set 2 to 100 leaves hand-typed 95 and 10 (${JSON.stringify(r)})`);
    }
    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${name}, target ${target?.[1]} × ${target?.[2]}, start ${start}; after set-all ${JSON.stringify(r)}`);
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
console.log('PASS: set 1 carries forward, hand edits stay, Undo and reload hold, set all writes every unlogged set');
