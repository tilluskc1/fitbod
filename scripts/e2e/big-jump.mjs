// (#327) A typed working weight more than 10% over the last logged one applies to the typed set only:
// the sets it would carry to keep (or go back to) their start-of-burst values, and a Heads-up offers
// "Apply to all", which carries as #309 does with an Undo that restores every set. Typed one key at a
// time (lessons 26, 28). kg at 390x844 and 360x780, then 390x650 with the keyboard open (lesson 16).
// The lead lift is seeded with a finished session at 60 kg and today's sets at 60 kg.
// Screenshots only when E2E_SHOTS is set.
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
const KEY = 'fitbod-clone-v1';

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'kg', exact: true }).click();
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
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
}

/**
 * The lead lift was last done at 60 kg (a finished session a week ago), and today's sets all show 60.
 * Written to storage, then reloaded, so every scenario starts from the same sets.
 */
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

/** The weight each set row shows. */
async function shown(page) {
  const out = [];
  for (const row of await page.locator('table.lg-table tbody tr:not(.lg-note):not(.lg-row--warm)').all()) {
    out.push((await row.locator('input.lg-cell').nth(0).inputValue()).trim());
  }
  return out.join(',');
}

/** The lead lift's stored weights, so a value the screen shows is also the value kept (lesson 27). */
async function stored(page) {
  return page.evaluate((key) => {
    const { state } = JSON.parse(localStorage.getItem(key));
    const lead = state.current.exercises.find((exercise) => !exercise.skipped);
    return lead.performed.map((set) => set.weight).join(',');
  }, KEY);
}

const weightCell = (page, n) => page.getByLabel(new RegExp(`^Set ${n} weight`));
const card = (page) => page.locator('.lg-note--held .notice-card--headsUp');
const toast = (page) => page.locator('.done-toast');
const text = async (locator) => (await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, ' ').trim() : '';

/** Tap a control that should be there; a missing one is a failed check, not a crash, so every later step still reports. */
async function tap(locator, message) {
  const there = (await locator.count()) === 1;
  check(there, message);
  if (there) await locator.click();
}

/** Select the cell's value, then type one key at a time, as a phone keyboard does. */
async function typeKeys(page, n, keys) {
  await weightCell(page, n).click();
  await page.keyboard.press('ControlOrMeta+A');
  for (const key of keys) await page.keyboard.press(key);
}

/** Is the element wholly inside the band and the one hit at its centre? */
async function inBand(page, locator, top, bottom) {
  if ((await locator.count()) !== 1) return { ok: false, box: null };
  const box = await locator.boundingBox();
  if (!box) return { ok: false, box };
  const owns = await locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  });
  return { ok: box.y >= top - 0.5 && box.y + box.height <= bottom + 0.5 && owns, box };
}

/** Wait for finite animations to finish before a shot (lesson 29). */
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
    .map((a) => a.finished.catch(() => undefined))));
  await page.waitForTimeout(100);
}

const HELD = (kg, set) => `${kg} kg is ${Math.round(((kg - 60) / 60) * 100)}% over last time. Applied to set ${set} only.`;
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page);
    await seed(page);
    const sets = (await shown(page)).split(',').length;
    const all = (kg) => Array(sets).fill(kg).join(',');
    const first = (kg, rest = 60) => [kg, ...Array(sets - 1).fill(rest)].join(',');
    check(await shown(page) === all(60), `${where}: seeded sets show 60 (${await shown(page)})`);
    if (shots) { await settle(page); await page.screenshot({ path: `${shots}/327-before-${width}.png` }); }

    // A. 8 then 0 from 60: the 8 carries; the 0 makes 80, so the burst's carries go back and set 1 keeps 80.
    await typeKeys(page, 1, ['8']);
    check(await shown(page) === all(8), `${where} A: 8 carries to every set (${await shown(page)})`);
    await page.keyboard.press('0');
    check(await shown(page) === first(80), `${where} A: 80 stays on set 1, the rest go back to 60 (${await shown(page)})`);
    check(await stored(page) === first(80), `${where} A: stored as shown (${await stored(page)})`);
    check((await text(card(page))).startsWith(HELD(80, 1)), `${where} A: the Heads-up reads "${HELD(80, 1)}" (${await text(card(page))})`);
    check(await card(page).getByRole('button', { name: 'Apply to all' }).count() === 1, `${where} A: one action, Apply to all`);
    check(await card(page).getByRole('button', { name: 'Undo' }).count() === 0, `${where} A: no Undo on the Heads-up`);
    if (shots) { await settle(page); await page.screenshot({ path: `${shots}/327-after-held-${width}.png` }); }
    // Backspace to 8: the notice goes and 8 carries again; 0 again holds 80 again.
    await page.keyboard.press('Backspace');
    check(await shown(page) === all(8), `${where} A: backspace to 8 carries again (${await shown(page)})`);
    check(await card(page).count() === 0, `${where} A: backspace clears the Heads-up (${await text(card(page))})`);
    await page.keyboard.press('0');
    check(await shown(page) === first(80), `${where} A: 0 again holds 80 on set 1 (${await shown(page)})`);
    // Apply to all carries as #309; Undo restores every set, including the ones the burst reverted.
    await tap(card(page).getByRole('button', { name: 'Apply to all' }), `${where} A: Apply to all is offered`);
    check(await shown(page) === all(80), `${where} A: Apply to all carries 80 (${await shown(page)})`);
    check(await stored(page) === all(80), `${where} A: Apply to all is stored (${await stored(page)})`);
    check((await text(toast(page))).includes(`80 kg applied to sets 2 to ${sets}`), `${where} A: the carry toast (${await text(toast(page))})`);
    check(await card(page).count() === 0, `${where} A: the Heads-up is gone after Apply to all`);
    if (shots) { await settle(page); await page.screenshot({ path: `${shots}/327-after-apply-${width}.png` }); }
    await tap(toast(page).getByRole('button', { name: 'Undo' }), `${where} A: the carry toast offers Undo`);
    check(await shown(page) === first(80), `${where} A: Undo puts sets 2+ back to 60 (${await shown(page)})`);
    check(await stored(page) === first(80), `${where} A: Undo is stored (${await stored(page)})`);

    // B. 6 then 7: 67 is over (12%); backspace and 6 makes 66, exactly 10%, which carries.
    await seed(page);
    await typeKeys(page, 1, ['6']);
    check(await shown(page) === all(6), `${where} B: 6 carries (${await shown(page)})`);
    await page.keyboard.press('7');
    check(await shown(page) === first(67), `${where} B: 67 stays on set 1 (${await shown(page)})`);
    check((await text(card(page))).startsWith(HELD(67, 1)), `${where} B: "${HELD(67, 1)}" (${await text(card(page))})`);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('6');
    check(await shown(page) === all(66), `${where} B: 66 carries to every set (${await shown(page)})`);
    check(await card(page).count() === 0, `${where} B: no Heads-up at exactly 10%`);

    // C. 1, 0, 0: 1 and 10 carry, 100 is held; a refused paste then reverts the whole burst.
    await seed(page);
    await typeKeys(page, 1, ['1', '0']);
    check(await shown(page) === all(10), `${where} C: 10 carries (${await shown(page)})`);
    await page.keyboard.press('0');
    check(await shown(page) === first(100), `${where} C: 100 stays on set 1 (${await shown(page)})`);
    await page.evaluate((value) => navigator.clipboard.writeText(value), '99999');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+V');
    check(await shown(page) === all(60), `${where} C: the refused paste puts every set back to 60 (${await shown(page)})`);
    check(await stored(page) === all(60), `${where} C: nothing stored holds the burst's loads (${await stored(page)})`);
    check(await card(page).count() === 0, `${where} C: the Heads-up goes with the refused burst (${await text(card(page))})`);

    // D. Any set: 8, 0 in set 3 holds set 3 only, and says so. Logging a set leaves it up (it never
    // blocks logging); Apply to all still carries; an edit in another cell clears it.
    await seed(page);
    await typeKeys(page, 3, ['8', '0']);
    const third = [60, 60, 80, ...Array(sets - 3).fill(60)].join(',');
    check(await shown(page) === third, `${where} D: 80 stays on set 3 (${await shown(page)})`);
    check((await text(card(page))).startsWith(HELD(80, 3)), `${where} D: "${HELD(80, 3)}" (${await text(card(page))})`);
    await weightCell(page, 3).blur();
    await page.getByRole('button', { name: 'Log set 1', exact: true }).click();
    check(await card(page).count() === 1, `${where} D: logging set 1 leaves the Heads-up up`);
    await tap(card(page).getByRole('button', { name: 'Apply to all' }), `${where} D: Apply to all is still offered after logging set 1`);
    check(await shown(page) === [60, 60, 80, ...Array(sets - 3).fill(80)].join(','), `${where} D: Apply to all carries to sets 4+ only (${await shown(page)})`);
    await seed(page);
    await typeKeys(page, 1, ['8', '0']);
    await page.getByLabel(/^Set 2 reps/).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('6');
    check(await card(page).count() === 0, `${where} D: an edit in another cell clears the Heads-up`);
    check(await shown(page) === first(80), `${where} D: and carries nothing (${await shown(page)})`);

    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${sets} sets; A-D done`);
    await context.close();
  }

  // E. 390x650 with the keyboard open (fake visualViewport, lesson 16): the notice and Apply to all sit
  // inside the visible band while set 1 is being typed.
  {
    const width = 390;
    const height = 650;
    const where = `${width}x${height} keyboard`;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(() => {
      const real = window.visualViewport;
      const fake = new EventTarget();
      let covered = null;
      let shifted = 0;
      Object.defineProperty(fake, 'height', { get: () => covered ?? window.innerHeight });
      Object.defineProperty(fake, 'offsetTop', { get: () => shifted });
      Object.defineProperty(fake, 'width', { get: () => real?.width ?? window.innerWidth });
      Object.defineProperty(window, 'visualViewport', { get: () => fake });
      window.__fakeKeyboard = (visible, offsetTop = 0) => { covered = visible; shifted = offsetTop; fake.dispatchEvent(new Event('resize')); };
    });
    await onboard(page);
    await seed(page);
    const KB = 300;
    for (const n of [1, 3]) {
      for (const shift of [0, 120]) {
        await seed(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await weightCell(page, n).click();
        await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [height - KB, shift]);
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('8');
        await page.keyboard.press('0');
        await page.waitForTimeout(100);
        const top = shift;
        const bottom = height - KB + shift;
        const tag = `${where} set ${n} (offsetTop ${shift})`;
        check(await card(page).count() === 1, `${tag}: the Heads-up shows`);
        for (const [label, loc] of [['notice', card(page)], ['Apply to all', card(page).getByRole('button', { name: 'Apply to all' })], ['weight cell', weightCell(page, n)]]) {
          const seen = await inBand(page, loc, top, bottom);
          check(seen.ok, `${tag}: ${label} outside the visible band ${top}-${bottom} (${JSON.stringify(seen.box)})`);
        }
        if (shots && shift === 0 && n === 1) {
          await settle(page);
          await page.screenshot({ path: `${shots}/327-after-keyboard-held-${width}x${height}.png` });
          await tap(card(page).getByRole('button', { name: 'Apply to all' }), `${tag}: Apply to all is offered`);
          await settle(page);
          await page.screenshot({ path: `${shots}/327-after-keyboard-apply-${width}x${height}.png` });
        }
        await page.evaluate(() => window.__fakeKeyboard(null, 0));
      }
    }
    if (shots) {
      await seed(page);
      await settle(page);
      await page.screenshot({ path: `${shots}/327-before-${width}x${height}.png` });
    }
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
console.log('PASS: a jump over 10% stays on its set, Apply to all carries with Undo, the notice sits in view with the keyboard open');
