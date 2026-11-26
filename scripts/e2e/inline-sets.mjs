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

// (#430) The centre button is Ask only: a workout starts from Preview workout -> Start workout. A Start
// already on screen (the preview sheet, a switched or adapted day) is used as is.
async function startWorkout(p) {
  const start = p.getByRole('button', { name: 'Start workout' });
  const preview = p.getByRole('button', { name: 'Preview workout' });
  await start.or(preview).first().waitFor();
  if (!(await start.first().isVisible())) {
    await preview.first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Start workout' }).waitFor();
  }
  await p.getByRole('button', { name: 'Start workout' }).first().click();
}
const server = await preview({ preview: { port: 4184, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/309-${name}.png` }); };

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

/**
 * (#380) Each working set's values as the lifter reads them: its list row ("Set 2, 135 lb × 8, edit"; "…, now" on the card's set, "…, logged, edit" once logged),
 * which follows the card's inputs keystroke by keystroke, and its "Set N logged" tick.
 */
async function rows(page) {
  const out = [];
  for (const row of await page.locator('.lg-list button.lg-li').all()) {
    const line = (await row.getAttribute('aria-label')).match(/^Set \d+, (.*) × (\d+)s?, (?:logged, edit|now|edit)$/);
    const weight = line?.[1] === '—' ? '' : (line?.[1] ?? '').replace(/ (lb|kg)$/, '');
    out.push({ weight, reps: line?.[2] ?? '', logged: (await row.locator('[aria-label$=" logged"]').count()) === 1 });
  }
  return out;
}

/** (#380) Put set `n` on the focus card (tap its row) unless it is already there. */
async function onCard(page, n) {
  const label = (await page.locator('section.lg-focus').getAttribute('aria-label')) ?? '';
  if (new RegExp(`(^|, )set ${n} of`, 'i').test(label)) return;
  await page.getByRole('button', { name: new RegExp(`^Set ${n}, .*, edit$`) }).click();
}

const weightCell = (page, n) => page.getByLabel(new RegExp(`^Set ${n} weight, pounds`));
const logButton = (page, n) => page.getByRole('button', { name: `Log set ${n}`, exact: true });
/** (#380) The same controls, with set `n` brought onto the card first. */
const cardCell = async (page, n) => { await onCard(page, n); return weightCell(page, n); };
const cardLog = async (page, n) => { await onCard(page, n); return logButton(page, n); };
const cardReps = async (page, n) => { await onCard(page, n); return page.getByLabel(`Set ${n} reps`); };

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
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const name = (await page.locator('.aw-exercise__name').innerText()).trim();
    const target = (await page.locator('.lg-ex__meta').innerText()).match(/Target (\d+) × (\d+)/);
    const reps = target?.[2];

    // No weight field, Skip or Confirm above the table; one hint names the suggested start in set 1.
    // (#380) The only inputs are the focus card's: the set to log's weight and reps.
    const outside = await page.locator('.lg-body input:not(.lg-focus input)').count();
    check(outside === 0, `${where}: ${outside} input(s) outside the focus card`);
    const hint = (await page.locator('.lg-coach').innerText()).match(/^Suggested start (\d+(?:\.\d+)?) lb\. Do 5 easy reps with it, then adjust set 1\.$/);
    check(Boolean(hint), `${where}: hint line names the suggested start (${await page.locator('.lg-coach').innerText()})`);
    let r = await rows(page);
    check(hint && r[0].weight === hint[1], `${where}: set 1 shows the suggested ${hint?.[1]} (${r[0].weight})`);
    check(r.every((row) => row.reps === reps), `${where}: every set prefills ${reps} reps (${JSON.stringify(r)})`);
    const markup = await page.locator('.lg-body').innerHTML();
    for (const word of ['Save set', 'Cancel', 'Confirm', 'Skip']) check(!markup.includes(`>${word}<`), `${where}: "${word}" still in the logger`);
    check(!/>Done</.test(markup), `${where}: "Done" still in the logger`);
    check(!/class="stepper"|Increase reps|Decrease reps/.test(markup), `${where}: a reps stepper is still in the logger`);
    for (const n of [1]) {
      const box = await (await cardCell(page, n)).boundingBox();
      check(box && box.height >= 44, `${where}: set ${n} weight cell is ${box?.height}px tall`);
      const lines = await (await cardCell(page, n)).evaluate((el) => el.scrollWidth <= el.clientWidth);
      check(lines, `${where}: set ${n} weight cell overflows`);
    }
    const head = (await page.locator('.lg-focus .lg-field--w small').innerText()).replace(/\s+/g, ' ');
    check(/^lb( · bar| each)?$/.test(head), `${where}: the card names the unit under the number (${head})`);
    await shot(page, `after-logger-${width}`);

    // Tap set 1's weight, type 135, tap ✓: logged at 135 × reps; sets 2+ show 135.
    let taps = 0;
    await (await cardCell(page, 1)).click(); taps += 1;
    await page.keyboard.type('135');
    await (await cardLog(page, 1)).click(); taps += 1;
    r = await rows(page);
    check(r[0].logged && r[0].weight === '135' && r[0].reps === reps, `${where}: set 1 logged at 135 × ${reps} (${JSON.stringify(r[0])})`);
    check(r.slice(1).every((row) => row.weight === '135' && !row.logged), `${where}: sets 2+ show 135 (${JSON.stringify(r)})`);
    check(taps === 2, `${where}: ${taps} taps plus typing`);

    // Set 2 at its prefill: one tap.
    await (await cardLog(page, 2)).click();
    r = await rows(page);
    check(r[1].logged && r[1].weight === '135', `${where}: set 2 logs in one tap (${JSON.stringify(r[1])})`);

    // An empty load cannot be logged.
    await (await cardCell(page, 3)).click();
    await page.keyboard.press('Backspace');
    check(await (await cardLog(page, 3)).isDisabled(), `${where}: an empty load can be logged`);
    await page.keyboard.type('135');
    await (await cardCell(page, 3)).blur();
    check(!(await (await cardLog(page, 3)).isDisabled()), `${where}: a typed load re-enables the ✓`);

    // A logged set edits in place: a toast says so, with Undo; an emptied logged load is not stored.
    await (await cardCell(page, 1)).click();
    await page.keyboard.type('140');
    await (await cardCell(page, 1)).blur();
    const toast = page.locator('.done-toast, .app-alerts .notice-card').first();
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
    await (await cardCell(page, 1)).click();
    await page.keyboard.press('Backspace');
    await (await cardCell(page, 1)).blur();
    r = await rows(page);
    check(r[0].weight === '135', `${where}: an emptied logged load is not stored (${r[0].weight})`);

    // Next on the keyboard moves weight → reps; a reload keeps the typed value.
    await (await cardCell(page, 3)).click();
    await page.keyboard.press('Enter');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check(focused === 'Set 3 reps', `${where}: Next moves to set 3 reps (${focused})`);
    await page.keyboard.type('6');
    await page.reload();
    const resume = page.locator('.rrow__go');
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
      await (await cardCell(page, last)).focus();
      await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [height - 344, shift]);
      await page.waitForTimeout(50);
      const top = Math.max(shift, headerBottom);
      const bottom = height - 344 + shift;
      const tag = `${where} keyboard (offsetTop ${shift})`;
      for (const [label, loc] of [['weight cell', (await cardCell(page, last))], ['✓', (await cardLog(page, last))]]) {
        const seen = await inBand(page, loc, top, bottom);
        check(seen.ok, `${tag}: set ${last} ${label} outside the visible band ${top}-${bottom} (${JSON.stringify(seen.box)})`);
      }
      if (shift === 0 && width === 390) {
        // What the lifter sees: the visible band only.
        if (shots) await page.screenshot({ path: `${shots}/309-after-keyboard-${width}.png`, clip: { x: 0, y: 0, width, height: height - 344 } });
      }
      await (await cardCell(page, last)).blur();
      await page.evaluate(() => window.__fakeKeyboard(null, 0));
    }

    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${name}, suggested ${hint?.[1]} lb, set 1 logged at 135 in ${taps} taps plus typing`);
    await page.close();
  }

  // Review 1 (705c827): refusals, an emptied reps cell, logging out of order, one cleared cell.
  {
    const where = 'review-1';
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await onboard(page);
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const hint = (await page.locator('.lg-coach').innerText()).match(/Suggested start (\d+)/)?.[1];

    // D4: clearing set 1 empties set 1 only; the others keep the suggestion and their ✓.
    await (await cardCell(page, 1)).click();
    await page.keyboard.press('Backspace');
    await (await cardCell(page, 1)).blur();
    let r = await rows(page);
    check(r[0].weight === '' && r.slice(1).every((row) => row.weight === hint), `${where} D4: one cleared cell blanks only itself (${JSON.stringify(r)})`);
    check(!(await (await cardLog(page, 2)).isDisabled()), `${where} D4: set 2 still logs at the suggestion`);

    // D3: logging set 2 first leaves the empty sets at the suggestion, still one tap. After the reload
    // the cleared set 1 shows the muted suggestion again: nothing stores a cleared cell (owner, #315 item 12).
    await page.reload();
    await page.waitForSelector('.lg-ex').catch(() => {});
    const resume = page.locator('.rrow__go');
    if (!(await page.locator('.lg-ex').count())) await resume.click();
    await page.waitForSelector('.lg-ex');
    r = await rows(page);
    check(r[0].weight === hint && !(await (await cardLog(page, 1)).isDisabled()), `${where} R3: a reload shows the suggestion in a cleared cell again (${JSON.stringify(r)})`);
    check(await (await cardCell(page, 1)).evaluate((el) => el.classList.contains('lg-cell--empty')), `${where} R3: in the muted style`);
    await (await cardLog(page, 2)).click();
    r = await rows(page);
    check(r[1].logged && r[2].weight === hint && !(await (await cardLog(page, 3)).isDisabled()),
      `${where} D3: set 3 keeps ${hint} and its ✓ after set 2 logs first (${JSON.stringify(r)})`);

    // D1: an over-limit key is capped at the cell (review 2): it is never typed, and nothing changes.
    await (await cardCell(page, 1)).click();
    await page.keyboard.type('135');
    await (await cardCell(page, 1)).blur();
    await (await cardCell(page, 1)).click();
    // #416: plain "End" doesn't move the caret in a macOS Chromium text field (Mac key bindings
    // reserve End for scrolling; Cmd+Right is the native end-of-line equivalent) — without collapsing
    // the cell's onFocus select-all, the next keystroke would replace the selection instead of appending.
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('99'); // 1359, then 13599 lb: over the limit, so the second 9 is not typed
    check(await (await cardCell(page, 1)).inputValue() === '1359', `${where} D1: the cell keeps 1359 when 13599 is capped`);
    const alert = await page.getByRole('alert').innerText().catch(() => '');
    check(/not saved/.test(alert), `${where} D1: the refusal says so (${alert})`);
    await (await cardCell(page, 1)).blur();
    r = await rows(page);
    check(r[0].weight === '1359', `${where} D1: the capped key leaves 1359 stored (${r[0].weight})`);
    await (await cardReps(page, 1)).click();
    // #416: see the weight cell above — ControlOrMeta+ArrowRight is the cross-platform end-of-line.
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('999'); // 89, 899, then 8999: over the limit, so the last 9 is not typed
    await (await cardReps(page, 1)).blur();
    r = await rows(page);
    check(r[0].reps === '899', `${where} D1: capped reps leave 899 stored (${r[0].reps})`);

    // D2: an emptied reps cell cannot be logged.
    await (await cardReps(page, 3)).click();
    await page.keyboard.press('Backspace');
    check(await (await cardLog(page, 3)).isDisabled(), `${where} D2: a set with no reps can be logged`);
    await page.keyboard.type('8');
    await (await cardReps(page, 3)).blur();
    check(!(await (await cardLog(page, 3)).isDisabled()), `${where} D2: typed reps re-enable the ✓`);
    await page.close();
  }

  // Review 2 (a469d89): a refusal or an emptied cell undoes the whole burst, and five follow-ups.
  {
    const where = 'review-2';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const page = await context.newPage();
    await onboard(page);
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const hint = (await page.locator('.lg-coach').innerText()).match(/Suggested start (\d+)/)?.[1];
    const toast = page.locator('.done-toast, .app-alerts .notice-card').first();
    const toastText = async () => (await toast.count()) ? (await toast.innerText()).replace(/\s+/g, ' ') : '';
    const paste = async (text) => {
      await page.evaluate((value) => navigator.clipboard.writeText(value), text);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('ControlOrMeta+V');
    };

    // R0, the blocker: set 1 empty (showing the suggestion); 1, 3, 5, 9 carry 1359 to every set.
    await (await cardCell(page, 1)).click();
    await page.keyboard.type('1359');
    let r = await rows(page);
    check(r.every((row) => row.weight === '1359'), `${where} R0: the burst carries 1359 (${JSON.stringify(r)})`);
    // A typed 9 is capped; a pasted 13599 is refused and puts back every set the burst carried.
    await page.keyboard.type('9');
    r = await rows(page);
    check(r.every((row) => row.weight === '1359'), `${where} R0: a capped key changes nothing (${JSON.stringify(r)})`);
    await paste('13599');
    const alert = await page.getByRole('alert').innerText().catch(() => '');
    check(/not saved/.test(alert), `${where} R0: the refused paste says so (${alert})`);
    r = await rows(page);
    check(r.every((row) => row.weight === hint), `${where} R0: no set holds the refused burst's load (${JSON.stringify(r)})`);
    check(!/applied/.test(await toastText()), `${where} R0: no carry toast is left up (${await toastText()})`);
    // Follow-up 2: the restored value is selected, so the next key replaces it rather than appending.
    await page.keyboard.type('2');
    check(await (await cardCell(page, 1)).inputValue() === '2', `${where} R2: the next key starts a new value (${await (await cardCell(page, 1)).inputValue()})`);
    // An emptied set 1 puts back every set the burst carried.
    await page.keyboard.press('Backspace');
    r = await rows(page);
    check(r[0].weight === '' && r.slice(1).every((row) => row.weight === hint), `${where} R0: an emptied cell puts the carried sets back (${JSON.stringify(r)})`);
    await (await cardCell(page, 1)).blur();

    // Follow-up 1: a refused first keystroke on a logged set says nothing was updated.
    await (await cardLog(page, 2)).click();
    await (await cardReps(page, 2)).click();
    await paste('99999');
    check(!/updated|applied/.test(await toastText()), `${where} R1: a refused keystroke on a logged set shows no update toast (${await toastText()})`);
    // Follow-up 2 with a value in the cell: the 8 it shows again is selected, so 6 replaces it (not 86).
    await page.keyboard.type('6');
    check(await (await cardReps(page, 2)).inputValue() === '6', `${where} R2: the next key replaces the restored 8 (${await (await cardReps(page, 2)).inputValue()})`);
    await (await cardReps(page, 2)).blur();
    // Follow-up 5: a logged set's reps cannot be emptied to 0.
    await (await cardReps(page, 2)).click();
    await page.keyboard.press('Backspace');
    await (await cardReps(page, 2)).blur();
    r = await rows(page);
    check(r[1].logged && r[1].reps === '8', `${where} R5: a logged set keeps its reps when emptied (${JSON.stringify(r[1])})`);
    check(!/updated/.test(await toastText()), `${where} R5: and says nothing was updated (${await toastText()})`);

    await context.close();
  }

  // Review 2, follow-up 4: logging keeps the "Big jump" heads-up on screen; only its Undo goes. The jump
  // is measured from the suggested start the empty cell showed, not from a half-typed keystroke.
  {
    const where = 'review-2 R4';
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await onboard(page);
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const toast = page.locator('.done-toast, .app-alerts .notice-card').first();
    const toastText = async () => (await toast.count()) ? (await toast.innerText()).replace(/\s+/g, ' ') : '';
    await (await cardCell(page, 1)).click();
    await page.keyboard.type('13');
    check(!/Big jump/.test(await toastText()), `${where}: 13 lb from a 45 lb suggestion is no jump (${await toastText()})`);
    await page.keyboard.type('5');
    check(/Big jump/.test(await toastText()), `${where}: 135 lb from a 45 lb suggestion says heads-up (${await toastText()})`);
    await (await cardLog(page, 1)).click();
    check(/Big jump/.test(await toastText()), `${where}: the heads-up stays after logging (${await toastText()})`);
    check(await toast.getByRole('button', { name: 'Undo' }).count() === 0, `${where}: its Undo is gone`);
    await page.close();
  }

  // A 390x500 window (a phone that resizes for its keyboard): the edited row and ✓ clear the dock.
  {
    const where = '390x500';
    const page = await browser.newPage({ viewport: { width: 390, height: 500 } });
    await onboard(page);
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const last = (await rows(page)).length;
    await (await cardCell(page, last)).click();
    await page.waitForTimeout(50);
    // (#380) The dock shows only while rest runs; without it the band ends at the window's bottom.
    const dock = (await page.locator('.lg-dock').count()) ? await page.locator('.lg-dock').boundingBox() : { y: 500 };
    const header = await page.locator('.flow-header').boundingBox();
    for (const [label, loc] of [['weight cell', (await cardCell(page, last))], ['✓', (await cardLog(page, last))]]) {
      const seen = await inBand(page, loc, header.y + header.height, dock.y);
      check(seen.ok, `${where}: set ${last} ${label} not visible above the dock (${JSON.stringify(seen.box)}, dock ${dock.y})`);
    }
    await shot(page, 'after-keyboard-390x500');
    await page.close();
  }

  // (#380 review 1) While rest runs: log set 1, then tap set 2's weight. The field and "Log set 2" sit fully
  // above the rest dock (R1; it covered Log at 390x500); the dock spans the screen (D1); scrolled to the
  // bottom, Up next clears the dock (D2); the sticky top is opaque (D3).
  for (const [width, height] of [[390, 500], [390, 650], [360, 780], [390, 844]]) {
    const where = `${width}x${height} rest (#380 review 1)`;
    const page = await browser.newPage({ viewport: { width, height } });
    await onboard(page);
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    await logButton(page, 1).click();
    const dock = page.locator('.lg-dock');
    await dock.waitFor({ timeout: 3000 }).catch(() => {});
    check(await dock.count() === 1, `${where}: no rest dock after logging set 1`);
    if (await dock.count() === 1) {
      const rest = await page.locator('.lg-rest').boundingBox();
      check(rest.width >= width - 26, `${where}: the rest pill is ${Math.round(rest.width)}px of ${width} (D1)`);
      // The case review 1 found: set 2's field in view, its Log half under the dock. A tap on a field the
      // screen already shows scrolls nothing by itself, so focus it without Playwright's scroll-into-view.
      {
        const dockY = (await dock.boundingBox()).y;
        const log = await logButton(page, 2).boundingBox();
        await page.evaluate((dy) => { const screen = document.querySelector('.flow-screen'); if (screen) screen.scrollTop += dy; }, log.y - (dockY - 28));
        await page.waitForTimeout(50);
      }
      await weightCell(page, 2).focus();
      await page.waitForTimeout(150);
      const dockTop = (await dock.boundingBox()).y;
      const headerBottom = (await page.locator('.flow-header').boundingBox()).height;
      for (const [label, loc] of [['set 2 weight field', weightCell(page, 2)], ['Log set 2', logButton(page, 2)]]) {
        const seen = await inBand(page, loc, headerBottom, dockTop);
        check(seen.ok, `${where}: ${label} not fully above the dock at ${dockTop} (${JSON.stringify(seen.box)}) (R1)`);
      }
      await weightCell(page, 2).blur();
      await page.evaluate(() => { document.querySelector('.flow-screen').scrollTop = 1e6; window.scrollTo(0, 1e6); });
      await page.waitForTimeout(100);
      const next = await page.locator('.lg-next').boundingBox();
      const dockAfter = (await dock.boundingBox()).y;
      check(next && next.y + next.height <= dockAfter + 0.5, `${where}: scrolled to the end, Up next (${next && next.y + next.height}) still under the dock (${dockAfter}) (D2)`);
      const bg = await page.locator('.flow-header').evaluate((el) => getComputedStyle(el).backgroundColor);
      check(!/rgba\(.*,\s*0?\.\d+\)$/.test(bg), `${where}: the sticky top is see-through (${bg}) (D3)`);
    }
    await page.close();
  }

  // (#380 review 1, R3) A long load fits the card's weight field at 32px or more: 102.5 kg and 1000 lb.
  for (const [width, height] of [[360, 780], [390, 844]]) {
    for (const [unit, value] of [['kg', '102.5'], ['lb', '1000']]) {
      const where = `${width}x${height} ${value} ${unit} (R3)`;
      const page = await browser.newPage({ viewport: { width, height } });
      await onboard(page, unit);
      await startWorkout(page);
      await page.waitForSelector('.lg-ex');
      const cell = page.getByLabel(/^Set 1 weight/);
      await cell.click();
      await page.keyboard.press('ControlOrMeta+a');
      for (const key of value) await page.keyboard.press(key);
      for (const state of ['typing', 'shown']) {
        if (state === 'shown') await cell.blur();
        const fit = await cell.evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth, size: parseFloat(getComputedStyle(el).fontSize), value: el.value }));
        check(fit.value === value, `${where} ${state}: the field reads ${fit.value}`);
        check(fit.fits, `${where} ${state}: ${fit.value} overflows the weight field`);
        check(fit.size >= 32, `${where} ${state}: the number is ${fit.size}px, under 32`);
      }
      await page.close();
    }
  }

  // (#380) 390x650 with the keyboard open (lesson 16: the layout keeps its height, the keyboard covers it):
  // the card's focused weight field and its Log button sit in the visible band, for the next set and for a
  // later set put on the card by tapping its row.
  {
    const width = 390;
    const height = 650;
    const KB = 300;
    const where = `${width}x${height} keyboard (#380)`;
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
    await startWorkout(page);
    await page.waitForSelector('.lg-ex');
    const header = await page.locator('.flow-header').boundingBox();
    for (const n of [1, 3]) {
      for (const shift of [0, 120]) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await onCard(page, n);
        const heading = (await page.locator('.lg-focus__set').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        check(heading.startsWith(`Set ${n} of`), `${where}: the card does not show set ${n} (${heading})`);
        await weightCell(page, n).click();
        await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [height - KB, shift]);
        await page.waitForTimeout(100);
        const top = Math.max(shift, header.height);
        const bottom = height - KB + shift;
        const tag = `${where} set ${n} (offsetTop ${shift})`;
        for (const [label, loc] of [['weight field', weightCell(page, n)], ['Log button', page.locator('section.lg-focus button.lg-log')]]) {
          const seen = await inBand(page, loc, top, bottom);
          check(seen.ok, `${tag}: ${label} outside the visible band ${top}-${bottom} (${JSON.stringify(seen.box)})`);
        }
        if (shots && n === 1 && shift === 0) await page.screenshot({ path: `${shots}/380-keyboard-${width}x${height}.png`, clip: { x: 0, y: 0, width, height: height - KB } });
        await weightCell(page, n).blur();
        await page.evaluate(() => window.__fakeKeyboard(null, 0));
      }
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
console.log('PASS: cells are the inputs, suggested start in the cells, 1-tap prefilled log, no editor left, keyboard keeps the row in view');
