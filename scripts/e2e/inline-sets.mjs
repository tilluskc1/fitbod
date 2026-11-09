// (#309) The set cells are the inputs. A first-time lift shows its suggested start in the cells and
// one hint line (no weight block above the table); tap set 1's weight, type, tap ✓ logs it and the
// later sets show the new load (#306); a prefilled set logs in one tap; no Save set, Done, Cancel or
// reps stepper is left; an empty load cannot be logged; a logged set edits in place with an Undo toast;
// a reload keeps a typed value; with the keyboard open the edited row and its ✓ are in the visible band.
// lb at 390x844 and 360x780, plus a 390x500 window. Screenshots only when E2E_SHOTS is set.
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
const server = await preview({ preview: { port: 4184, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/309-${name}.png` }); };

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'lb', exact: true }).click();
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

async function rows(page) {
  const out = [];
  for (const row of await page.locator('table.lg-table tbody tr:not(.lg-note)').all()) {
    const cells = row.locator('input.lg-cell');
    out.push({ weight: (await cells.nth(0).inputValue()).trim(), reps: (await cells.nth(1).inputValue()).trim(),
      logged: (await row.locator('[aria-label$=" logged"]').count()) === 1 });
  }
  return out;
}

const weightCell = (page, n) => page.getByLabel(new RegExp(`^Set ${n} weight, pounds`));
const logButton = (page, n) => page.getByRole('button', { name: `Log set ${n}`, exact: true });

/** Is the element wholly inside the band and the one hit at its centre? */
async function inBand(page, locator, top, bottom) {
  const box = await locator.boundingBox();
  if (!box) return { ok: false, box };
  const owns = await locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  });
  return { ok: box.y >= top - 0.5 && box.y + box.height <= bottom + 0.5 && owns, box };
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    // Chromium cannot shrink the visual viewport without shrinking the layout (lesson 16): a phone
    // keyboard covers the page, so stand in a controllable visualViewport the app reads.
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
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const name = (await page.locator('.aw-exercise__name').innerText()).trim();
    const target = (await page.locator('.lg-ex__meta').innerText()).match(/Target (\d+) × (\d+)/);
    const reps = target?.[2];

    // No weight field, Skip or Confirm above the table; one hint names the suggested start in set 1.
    const outside = await page.locator('.lg-body input:not(table.lg-table input)').count();
    check(outside === 0, `${where}: ${outside} input(s) outside the set table`);
    const hint = (await page.locator('.lg-coach').innerText()).match(/^Suggested start (\d+(?:\.\d+)?) lb\. Do 5 easy reps with it, then adjust set 1\.$/);
    check(Boolean(hint), `${where}: hint line names the suggested start (${await page.locator('.lg-coach').innerText()})`);
    let r = await rows(page);
    check(hint && r[0].weight === hint[1], `${where}: set 1 shows the suggested ${hint?.[1]} (${r[0].weight})`);
    check(r.every((row) => row.reps === reps), `${where}: every set prefills ${reps} reps (${JSON.stringify(r)})`);
    const markup = await page.locator('.lg-body').innerHTML();
    for (const word of ['Save set', 'Cancel', 'Confirm', 'Skip']) check(!markup.includes(`>${word}<`), `${where}: "${word}" still in the logger`);
    check(!/>Done</.test(markup), `${where}: "Done" still in the logger`);
    check(!/class="stepper"|Increase reps|Decrease reps/.test(markup), `${where}: a reps stepper is still in the logger`);
    for (const n of [1, 2]) {
      const box = await weightCell(page, n).boundingBox();
      check(box && box.height >= 44, `${where}: set ${n} weight cell is ${box?.height}px tall`);
      const lines = await weightCell(page, n).evaluate((el) => el.scrollWidth <= el.clientWidth);
      check(lines, `${where}: set ${n} weight cell overflows`);
    }
    const head = (await page.locator('.lg-table thead').innerText()).replace(/\s+/g, ' ');
    check(/LB TOTAL|LB EACH/.test(head), `${where}: the column header names the unit (${head})`);
    await shot(page, `after-logger-${width}`);

    // Tap set 1's weight, type 135, tap ✓: logged at 135 × reps; sets 2+ show 135.
    let taps = 0;
    await weightCell(page, 1).click(); taps += 1;
    await page.keyboard.type('135');
    await logButton(page, 1).click(); taps += 1;
    r = await rows(page);
    check(r[0].logged && r[0].weight === '135' && r[0].reps === reps, `${where}: set 1 logged at 135 × ${reps} (${JSON.stringify(r[0])})`);
    check(r.slice(1).every((row) => row.weight === '135' && !row.logged), `${where}: sets 2+ show 135 (${JSON.stringify(r)})`);
    check(taps === 2, `${where}: ${taps} taps plus typing`);

    // Set 2 at its prefill: one tap.
    await logButton(page, 2).click();
    r = await rows(page);
    check(r[1].logged && r[1].weight === '135', `${where}: set 2 logs in one tap (${JSON.stringify(r[1])})`);

    // An empty load cannot be logged.
    await weightCell(page, 3).click();
    await page.keyboard.press('Backspace');
    check(await logButton(page, 3).isDisabled(), `${where}: an empty load can be logged`);
    await page.keyboard.type('135');
    await weightCell(page, 3).blur();
    check(!(await logButton(page, 3).isDisabled()), `${where}: a typed load re-enables the ✓`);

    // A logged set edits in place: a toast says so, with Undo; an emptied logged load is not stored.
    await weightCell(page, 1).click();
    await page.keyboard.type('140');
    await weightCell(page, 1).blur();
    const toast = page.locator('.app-alerts .banner');
    const toastText = (await toast.innerText()).replace(/\s+/g, ' ');
    check(/^Set 1 updated/.test(toastText), `${where}: logged-set toast (${toastText})`);
    r = await rows(page);
    check(r[0].weight === '140' && r[0].logged, `${where}: set 1 reads 140, still logged (${JSON.stringify(r[0])})`);
    // Sets still to log at set 1's old load follow it (#306); the toast names them.
    check(r.slice(2).every((row) => row.weight === '140'), `${where}: sets 3+ follow the logged edit (${JSON.stringify(r)})`);
    check(toastText.includes(`140 lb applied to sets 3 to ${r.length}`), `${where}: the toast names the carry (${toastText})`);
    await toast.getByRole('button', { name: 'Undo' }).click();
    r = await rows(page);
    check(r[0].weight === '135' && r[0].logged, `${where}: Undo puts set 1 back to 135 (${JSON.stringify(r[0])})`);
    check(r.slice(2).every((row) => row.weight === '135'), `${where}: Undo puts sets 3+ back to 135 (${JSON.stringify(r)})`);
    await weightCell(page, 1).click();
    await page.keyboard.press('Backspace');
    await weightCell(page, 1).blur();
    r = await rows(page);
    check(r[0].weight === '135', `${where}: an emptied logged load is not stored (${r[0].weight})`);

    // Next on the keyboard moves weight → reps; a reload keeps the typed value.
    await weightCell(page, 3).click();
    await page.keyboard.press('Enter');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check(focused === 'Set 3 reps', `${where}: Next moves to set 3 reps (${focused})`);
    await page.keyboard.type('6');
    await page.reload();
    const resume = page.getByRole('button', { name: 'Resume workout', exact: true });
    await Promise.race([page.waitForSelector('.lg-ex'), resume.waitFor()]);
    if (!(await page.locator('.lg-ex').count())) await resume.click();
    await page.waitForSelector('.lg-ex');
    r = await rows(page);
    check(r[2].reps === '6', `${where}: a reload keeps the typed 6 reps (${JSON.stringify(r[2])})`);

    // Keyboard open: the last set's weight is edited; its row and ✓ sit in the visible band.
    const last = r.length;
    const headerBottom = (await page.locator('.flow-header').boundingBox()).height;
    for (const shift of [0, 344 - 60, 344]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await weightCell(page, last).focus();
      await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [height - 344, shift]);
      await page.waitForTimeout(50);
      const top = Math.max(shift, headerBottom);
      const bottom = height - 344 + shift;
      const tag = `${where} keyboard (offsetTop ${shift})`;
      for (const [label, loc] of [['weight cell', weightCell(page, last)], ['✓', logButton(page, last)]]) {
        const seen = await inBand(page, loc, top, bottom);
        check(seen.ok, `${tag}: set ${last} ${label} outside the visible band ${top}-${bottom} (${JSON.stringify(seen.box)})`);
      }
      if (shift === 0 && width === 390) {
        // What the lifter sees: the visible band only.
        if (shots) await page.screenshot({ path: `${shots}/309-after-keyboard-${width}.png`, clip: { x: 0, y: 0, width, height: height - 344 } });
      }
      await weightCell(page, last).blur();
      await page.evaluate(() => window.__fakeKeyboard(null, 0));
    }

    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${name}, suggested ${hint?.[1]} lb, set 1 logged at 135 in ${taps} taps plus typing`);
    await page.close();
  }

  // A 390x500 window (a phone that resizes for its keyboard): the edited row and ✓ clear the dock.
  {
    const where = '390x500';
    const page = await browser.newPage({ viewport: { width: 390, height: 500 } });
    await onboard(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const last = (await rows(page)).length;
    await weightCell(page, last).click();
    await page.waitForTimeout(50);
    const dock = await page.locator('.lg-dock').boundingBox();
    const header = await page.locator('.flow-header').boundingBox();
    for (const [label, loc] of [['weight cell', weightCell(page, last)], ['✓', logButton(page, last)]]) {
      const seen = await inBand(page, loc, header.y + header.height, dock.y);
      check(seen.ok, `${where}: set ${last} ${label} not visible above the dock (${JSON.stringify(seen.box)}, dock ${dock.y})`);
    }
    await shot(page, 'after-keyboard-390x500');
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
console.log('PASS: cells are the inputs, suggested start in the cells, 1-tap prefilled log, no editor left, keyboard keeps the row in view');
