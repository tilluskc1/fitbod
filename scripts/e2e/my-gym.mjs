// "My gym" (#357): type what the gym has, check the ticks, save, and the plan uses only listed machines.
// Onboarding offers it once after "At a gym"; Settings > Equipment has the row for gym kits only (home
// profiles never see it). Nothing is stored until Save my gym; text matching nothing says so; a tap
// wins over the text. The plan check reads the stored running session and Plan's Equipment list, so it
// compares what the sheet saved with what the planner hands out (lesson 12).
// 390x844 and 360x780; 390x650 with the keyboard open on the text box (visual viewport only, lesson 16).
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
const server = await preview({ preview: { port: 4203, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const KEY = 'fitbod-clone-v1';
const TYPED = 'leg extension, leg curl, dumbbells, cable stack';
/** The gym default kit's free weights and stations: the sheet opens with them ticked (review 1). */
const KEPT = ['Dumbbells', 'Barbell', 'Kettlebells', 'Squat rack', 'Bench', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'];
const KEPT_IDS = ['dumbbells', 'barbell', 'kettlebells', 'squat-rack', 'bench', 'pull-up-bar', 'dip-bars', 'box', 'ab-wheel'];
const LISTED = ['leg-extension', 'leg-curl', 'cable-stack', ...KEPT_IDS];
const LISTED_LABELS = ['Leg extension', 'Leg curl', 'Cable stack (single)', ...KEPT];
const SAVE = `Save my gym (${LISTED.length})`;
const SUMMARY = `${LISTED.length} items: Leg extension, Leg curl, Cable stack (single) and ${LISTED.length - 3} more.`;
const ALL_FAMILIES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'];
/** Catalog machines and cables the list cannot host. */
const NEVER = ['leg-press', 'standing-calf-raise', 'seated-calf-raise', 'machine-chest-press', 'lat-pulldown', 'cable-fly'];
const NEVER_NAMES = ['Leg Press', 'Machine Chest Press', 'Lat Pulldown', 'Cable Fly', 'Standing Calf Raise', 'Seated Calf Raise'];

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state ?? null, KEY);

/** Waits for every finite animation to finish (lesson 29), then a frame. */
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
    .map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
}
async function shot(page, name) {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function toGearStep(page, place = 'gym') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (place === 'home') await page.getByRole('button', { name: 'At home' }).click();
}
async function build(page) {
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}
async function openSettings(page) {
  await page.getByRole('button', { name: 'Open profile and settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Training settings' });
  await settings.waitFor();
  return settings;
}

/** The sheet's pressed chips, in screen order. */
const pressed = (sheet) => sheet.locator('.my-gym__group .chip[aria-pressed="true"]').allInnerTexts();

/** Layout checks: no sideways scroll, every chip and button at least 44px tall. */
async function fits(sheet, where) {
  const wide = await sheet.evaluate((el) => [...el.querySelectorAll('*')].filter((node) => node.clientWidth > 0
    && node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'hidden').map((node) => node.className));
  check(wide.length === 0, `${where}: the sheet scrolls sideways (${wide.join(', ')})`);
  const small = await sheet.locator('button').evaluateAll((buttons) => buttons.map((b) => [b.innerText || b.getAttribute('aria-label'), b.getBoundingClientRect().height])
    .filter(([, h]) => h > 0 && h < 44));
  check(small.length === 0, `${where}: buttons under 44px: ${JSON.stringify(small)}`);
}

/** Starts today's workout and returns the stored session's exercise ids. */
async function startedIds(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  const ids = (await stored(page)).current.exercises.map((exercise) => exercise.exerciseId);
  return { ids };
}

/** Plan's Equipment tab: the saved gear and the first exercises it can host. */
async function planEquipment(page) {
  await page.locator('nav.tabbar .tab', { hasText: 'Plan' }).click();
  await page.waitForSelector('.plan-row--today');
  await page.getByRole('tab', { name: /Equipment/ }).click();
  return (await page.locator('.plan-screen').innerText()).replace(/\s+/g, ' ');
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;

    // A. Onboarding: "At a gym" offers My gym once; it opens empty; type, check, save, build.
    {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await toGearStep(page);
      const offer = page.getByRole('button', { name: 'List my gym' });
      await offer.waitFor();
      await shot(page, `357-onboarding-offer-${where}`);
      await offer.click();
      const sheet = page.getByRole('dialog', { name: 'My gym' });
      await sheet.waitFor();
      check(JSON.stringify(await pressed(sheet)) === JSON.stringify(KEPT), `${where} onboarding: the sheet opens with ${JSON.stringify(await pressed(sheet))}`);
      await shot(page, `357-my-gym-empty-onboarding-${where}`);
      await fits(sheet, `${where} onboarding sheet`);
      await sheet.getByLabel('What does your gym have?').fill(TYPED);
      check(JSON.stringify(await pressed(sheet)) === JSON.stringify(LISTED_LABELS), `${where} onboarding: typed list ticked ${JSON.stringify(await pressed(sheet))}`);
      await shot(page, `357-my-gym-typed-onboarding-${where}`);
      await sheet.getByRole('button', { name: SAVE }).click();
      await sheet.waitFor({ state: 'detached' });
      const summary = (await page.locator('.onboarding-gym').innerText()).replace(/\s+/g, ' ');
      check(summary.includes(SUMMARY), `${where} onboarding: summary reads "${summary}"`);
      const primary = await page.locator('.onboarding-step .chip-wrap').nth(1).locator('.chip[aria-pressed="true"]').allInnerTexts();
      check(JSON.stringify(primary) === JSON.stringify(ALL_FAMILIES), `${where} onboarding: Equipment chips after save ${JSON.stringify(primary)}`);
      await shot(page, `357-onboarding-saved-${where}`);
      await build(page);
      const profile = (await stored(page)).profile;
      check(JSON.stringify(profile.gymItems) === JSON.stringify(LISTED), `${where} onboarding: stored gymItems ${JSON.stringify(profile.gymItems)}`);
      check(profile.support.length === 6, `${where} onboarding: stored support ${JSON.stringify(profile.support)}`);
      // The plan the planner hands out uses only listed kit: the started session and the whole kit list.
      const listText = await planEquipment(page);
      for (const name of NEVER_NAMES) check(!listText.includes(name), `${where} onboarding: Plan's Equipment list offers ${name}`);
      await page.locator('nav.tabbar .tab', { hasText: 'Today' }).click();
      const { ids } = await startedIds(page);
      check(ids.length > 0, `${where} onboarding: the started day is empty`);
      for (const id of ids) check(!NEVER.includes(id), `${where} onboarding: the started day holds ${id}`);
      check(errors.length === 0, `${where} onboarding: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // B. Settings: the row on a gym kit; nothing saves before Save; no-match line; a tap wins; save; clear.
    {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await toGearStep(page);
      await build(page);
      let settings = await openSettings(page);
      const row = settings.getByRole('button', { name: 'Set up my gym' });
      await row.scrollIntoViewIfNeeded();
      check((await settings.locator('#my-gym-note').innerText()).startsWith('Not set: every machine counts.'), `${where} settings: the empty row's line`);
      await shot(page, `357-settings-equipment-after-empty-${where}`);
      await row.click();
      let sheet = page.getByRole('dialog', { name: 'My gym' });
      await sheet.waitFor();
      check(!(await settings.count()), `${where} settings: Settings stays open under My gym`);
      const box = sheet.getByLabel('What does your gym have?');
      await box.fill('a treadmill and a sauna');
      check((await sheet.locator('#my-gym-read').innerText()) === "Didn't catch that. Tick what your gym has.", `${where} settings: no-match line reads "${await sheet.locator('#my-gym-read').innerText()}"`);
      check((await sheet.locator('.my-gym__group .chip').count()) === 24, `${where} settings: the full list is not shown`);
      await shot(page, `357-my-gym-no-match-${where}`);
      await box.fill(TYPED);
      // A tap wins over the text: Leg curl off stays off while the text still names it; Barbell off.
      await sheet.getByRole('button', { name: 'Leg curl', exact: true }).click();
      await sheet.getByRole('button', { name: 'Barbell', exact: true }).click();
      await box.fill(`${TYPED}, smith`);
      const ticks = await pressed(sheet);
      check(JSON.stringify(ticks) === JSON.stringify(['Leg extension', 'Smith machine', 'Cable stack (single)', ...KEPT.filter((label) => label !== 'Barbell')]), `${where} settings: ticks after taps ${JSON.stringify(ticks)}`);
      // Close without saving: nothing stored.
      await sheet.getByRole('button', { name: 'Close' }).click();
      settings = page.getByRole('dialog', { name: 'Training settings' });
      await settings.waitFor();
      check((await stored(page)).profile.gymItems === undefined, `${where} settings: closing without Save stored a list`);
      await settings.getByRole('button', { name: 'Set up my gym' }).click();
      sheet = page.getByRole('dialog', { name: 'My gym' });
      await sheet.waitFor();
      check(JSON.stringify(await pressed(sheet)) === JSON.stringify(KEPT), `${where} settings: reopened sheet kept unsaved ticks`);
      await sheet.getByLabel('What does your gym have?').fill(TYPED);
      await shot(page, `357-my-gym-typed-${where}`);
      await sheet.getByRole('button', { name: SAVE }).click();
      settings = page.getByRole('dialog', { name: 'Training settings' });
      await settings.waitFor();
      const profile = (await stored(page)).profile;
      check(JSON.stringify(profile.gymItems) === JSON.stringify(LISTED), `${where} settings: stored gymItems ${JSON.stringify(profile.gymItems)}`);
      check(JSON.stringify(profile.equipment) === JSON.stringify(ALL_FAMILIES), `${where} settings: stored equipment ${JSON.stringify(profile.equipment)}`);
      // Review 1: a saved list keeps the gym a gym (never "Home").
      check(!(await settings.innerText()).includes('Home equipment'), `${where} settings: reads Home after saving a list`);
      const edit = settings.getByRole('button', { name: 'Edit my gym' });
      await edit.scrollIntoViewIfNeeded();
      check((await settings.locator('#my-gym-note').innerText()) === SUMMARY, `${where} settings: saved line`);
      await shot(page, `357-settings-equipment-after-saved-${where}`);
      // The saved sheet opens with the list.
      await edit.click();
      sheet = page.getByRole('dialog', { name: 'My gym' });
      await sheet.waitFor();
      check(JSON.stringify(await pressed(sheet)) === JSON.stringify(LISTED_LABELS), `${where} settings: saved sheet opens with ${JSON.stringify(await pressed(sheet))}`);
      await shot(page, `357-my-gym-saved-${where}`);
      await fits(sheet, `${where} settings sheet`);
      await sheet.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('dialog', { name: 'Training settings' }).getByRole('button', { name: 'Done' }).click();
      const listText = await planEquipment(page);
      for (const name of NEVER_NAMES) check(!listText.includes(name), `${where} settings: Plan's Equipment list offers ${name}`);
      await page.locator('nav.tabbar .tab', { hasText: 'Today' }).click();
      const { ids } = await startedIds(page);
      for (const id of ids) check(!NEVER.includes(id), `${where} settings: the started day holds ${id}`);
      check(errors.length === 0, `${where} settings: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // C. Clear: back to "every machine counts"; the field is gone from storage.
    {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await toGearStep(page);
      await page.getByRole('button', { name: 'List my gym' }).click();
      await page.getByRole('dialog', { name: 'My gym' }).getByLabel('What does your gym have?').fill(TYPED);
      await page.getByRole('button', { name: SAVE }).click();
      await build(page);
      const settings = await openSettings(page);
      await settings.getByRole('button', { name: 'Edit my gym' }).click();
      await page.getByRole('dialog', { name: 'My gym' }).getByRole('button', { name: /^Clear my gym list/ }).click();
      await page.getByRole('dialog', { name: 'Training settings' }).waitFor();
      const profile = (await stored(page)).profile;
      check(!('gymItems' in profile), `${where} clear: gymItems still stored`);
      check((await page.locator('#my-gym-note').innerText()).startsWith('Not set'), `${where} clear: row line not back to Not set`);
      await context.close();
    }

    // D. Home profile: no My gym in onboarding or Settings.
    {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await toGearStep(page, 'home');
      check(!(await page.getByRole('button', { name: 'List my gym' }).count()), `${where} home: onboarding offers My gym`);
      await build(page);
      const settings = await openSettings(page);
      check(!(await settings.getByText('My gym').count()), `${where} home: Settings shows My gym`);
      await context.close();
    }
  }

  // E. 390x650, keyboard open on the text box (lesson 16: the layout keeps its height; a controllable
  // visualViewport covers the bottom 330px, unshifted and shifted). Save and the box stay in the band.
  {
    const where = '390x650-keyboard';
    const KB = 330;
    const context = await browser.newContext({ viewport: { width: 390, height: 650 } });
    await context.addInitScript(() => {
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
    const page = await context.newPage();
    await toGearStep(page);
    await build(page);
    const settings = await openSettings(page);
    const row = settings.getByRole('button', { name: 'Set up my gym' });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const sheet = page.getByRole('dialog', { name: 'My gym' });
    await sheet.waitFor();
    await settle(page);
    const box = sheet.getByLabel('What does your gym have?');
    const save = sheet.getByRole('button', { name: /^Save my gym/ });
    const owns = (loc) => loc.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    });
    const closed = await save.boundingBox();
    for (const shift of [0, 120, KB]) {
      const tag = `${where} (offsetTop ${shift})`;
      const top = shift;
      const bottom = 650 - KB + shift;
      await box.focus();
      await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [650 - KB, shift]);
      await page.waitForTimeout(80);
      if (shift === 0) await page.keyboard.type(TYPED);
      const s = await save.boundingBox();
      const b = await box.boundingBox();
      check(s && s.y >= top && s.y + s.height <= bottom, `${tag}: Save outside the visible band (y ${s && Math.round(s.y)}-${s && Math.round(s.y + s.height)}, band ${top}-${bottom})`);
      check(b && b.y >= top && b.y < bottom, `${tag}: text box not in the visible band (y ${b && Math.round(b.y)}, band ${top}-${bottom})`);
      check(await owns(save), `${tag}: Save does not own its tap`);
      if (shift === 0) {
        // What the text read is the typing feedback: fully in the band, above Save.
        const r = await sheet.locator('#my-gym-read').boundingBox();
        check(r && r.y >= top && r.y + r.height <= bottom && s && r.y + r.height <= s.y, `${tag}: the read line is hidden (y ${r && Math.round(r.y)}-${r && Math.round(r.y + r.height)}, Save at ${s && Math.round(s.y)})`);
      }
      check(await owns(box), `${tag}: text box does not own its tap`);
      if (shift === 0) {
        check(JSON.stringify(await pressed(sheet)) === JSON.stringify(LISTED_LABELS), `${tag}: typed with the keyboard open ticked ${JSON.stringify(await pressed(sheet))}`);
        await shot(page, `357-my-gym-keyboard-390x650`);
      }
      await box.blur();
      await page.evaluate(() => window.__fakeKeyboard(null, 0));
      await page.waitForTimeout(80);
      const back = await save.boundingBox();
      check(closed && back && Math.abs(back.y - closed.y) < 1, `${tag}: Save did not return after the keyboard closed (was ${closed && Math.round(closed.y)}, now ${back && Math.round(back.y)})`);
    }
    await save.click();
    await page.getByRole('dialog', { name: 'Training settings' }).waitFor();
    check(JSON.stringify((await stored(page)).profile.gymItems) === JSON.stringify(LISTED), `${where}: saved list with the keyboard open`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`my-gym: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('my-gym: onboarding offer, Settings row, no-match line, taps win, nothing saved before Save, clear, home hides it, plan and Equipment list use only listed kit, 390x844, 360x780 and 390x650 keyboard');
