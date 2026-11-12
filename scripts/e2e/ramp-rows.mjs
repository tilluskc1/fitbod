// #326: the warm-up ramp (W) rows hold still while set 1's weight is typed. They read the load set 1
// showed when focus began, through every keystroke (lesson 26), and follow the new load on blur.
// A first-time lead ramps from its muted suggested start, and gets none under 30 lb / 15 kg (#345).
//
//   npm run e2e        (builds, then runs this at 390x844, 360x780 and 390x650 with the keyboard open)
//   E2E_SHOTS=<dir>    also writes set 1 mid-typing and the first-time lead there
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
const SHOTS = process.env.E2E_SHOTS;
const MONDAY = new Date('2026-11-09T08:00:00');
const KEY = 'fitbod-clone-v1';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const number = (value) => Number(value.replace(/[^\d.]/g, ''));

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

/** Last week's session of today's lead at `kg`, so set 1 opens on it; or, with `firstTime`, a lead never done. */
async function seedLead(page, { kg, firstTime }) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  await page.evaluate(([key, kg, firstTime]) => {
    const stored = JSON.parse(localStorage.getItem(key));
    const current = stored.state.current;
    if (firstTime) {
      // Today's lead becomes a Dumbbell Bench Press never logged: set 1 shows the suggested start.
      const lead = current.exercises[0];
      const planned = lead.planned.map((set) => ({ ...set, weight: 0, reps: 8 }));
      current.exercises[0] = { ...lead, exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', planned,
        performed: planned.map((set) => ({ ...set, done: false, completedAt: null })) };
      current.exercises = current.exercises.filter((entry, i) => i === 0 || entry.exerciseId !== 'dumbbell-bench-press');
      stored.state.history = stored.state.history.filter((w) => !w.exercises.some((e) => e.exerciseId === 'dumbbell-bench-press'));
      localStorage.setItem(key, JSON.stringify(stored));
      return;
    }
    const lead = current.exercises[0];
    const done = lead.planned.map((set) => ({ weight: kg, reps: set.reps, done: true, completedAt: '2026-11-02T08:30:00.000Z' }));
    stored.state.history = [...stored.state.history, {
      ...current, id: 'seed-326', date: '2026-11-02T08:00:00.000Z', status: 'completed', completedEarly: true,
      endedAt: '2026-11-02T09:00:00.000Z', restStartedAt: null,
      exercises: [{ ...lead, planned: lead.planned.map((set) => ({ ...set, weight: kg })), performed: done }],
    }];
    stored.state.current = null;
    localStorage.setItem(key, JSON.stringify(stored));
  }, [KEY, kg, Boolean(firstTime)]);
  await page.reload();
  if (firstTime) {
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
  } else {
    await page.waitForSelector('.t7-hero');
    await page.getByRole('button', { name: 'Start workout' }).click();
  }
  await page.waitForSelector('.lg-ex');
}

/** The W rows and set 1's row: count, loads and where each sits on screen. */
async function layout(page) {
  const warm = page.locator('tr.lg-row--warm');
  const loads = (await warm.locator('td:nth-child(3)').allInnerTexts()).map(number);
  const tops = [];
  for (const row of await warm.all()) tops.push(Math.round((await row.boundingBox()).y));
  const setOne = Math.round((await page.getByRole('textbox', { name: /^Set 1 weight/ }).boundingBox()).y);
  return { count: loads.length, loads: loads.join('/'), tops: tops.join('/'), setOne, gaps: tops.map((y) => setOne - y).join('/') };
}

/** On screen: nothing moved. `relative`: the W rows kept their place above set 1 (the page itself may scroll). */
const same = (a, b, relative = false) => a.count === b.count && a.loads === b.loads
  && (relative ? a.gaps === b.gaps : a.tops === b.tops && a.setOne === b.setOne);
const show = (l) => `${l.count} rows ${l.loads} at ${l.tops}, set 1 at ${l.setOne}`;

const browser = await chromium.launch();
try {
  for (const [width, height, keyboard] of [[390, 844, false], [360, 780, false], [390, 650, true]]) {
    const where = `${width}x${height}${keyboard ? ' keyboard' : ''}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    // Chromium cannot shrink the visual viewport without shrinking the layout (lesson 16): stand in a
    // controllable visualViewport, as scripts/e2e/planner-reach.mjs does.
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
    await page.clock.setFixedTime(MONDAY);
    await onboard(page, 'lb');
    await seedLead(page, { kg: 135 * 0.45359237 });

    // Last time 135 lb: today's target opens set 1 a step up from it.
    const setOne = page.getByRole('textbox', { name: /^Set 1 weight/ });
    const target = number(await setOne.inputValue());
    check(target >= 135 && target < 148, `${where}: set 1 opens near last time's 135 lb (${target})`);
    const opened = await layout(page);
    check(opened.count === 2, `${where}: two W rows from ${target} (${show(opened)})`);

    // Focus selects the text, so the first key replaces it: 1, 14, 140, one key at a time.
    await setOne.click();
    if (keyboard) {
      await page.evaluate((h) => window.__fakeKeyboard(h, 0), height - 344);
      await page.waitForTimeout(100);
    }
    const start = await layout(page);
    check(same(start, opened) || keyboard, `${where}: focus moves nothing (${show(opened)} -> ${show(start)})`);
    const step = async (label, act, relative = false) => {
      await act();
      const now = await layout(page);
      check(same(now, start, relative), `${where}: ${label}: W rows changed mid-burst (${show(start)} -> ${show(now)})`);
      return now;
    };
    for (const key of ['1', '4', '0']) await step(`typed ${key}`, () => page.keyboard.press(key));
    check(number(await setOne.inputValue()) === 140, `${where}: set 1 reads 140 (${await setOne.inputValue()})`);
    if (SHOTS && !keyboard) await page.screenshot({ path: join(SHOTS, `326-mid-typing-${width}x${height}.png`) });
    // Backspace to empty, then retype.
    for (let i = 0; i < 3; i += 1) await step(`backspace ${i + 1}`, () => page.keyboard.press('Backspace'));
    for (const key of ['1', '4', '5']) await step(`retyped ${key}`, () => page.keyboard.press(key));
    // A typed key past the cap, and a refused paste (lesson 28): the burst reverts, the rows never flicker.
    // The refusal's message row below set 1 may scroll the page, so these compare places above set 1.
    for (const key of ['9', '9']) await step(`capped ${key}`, () => page.keyboard.press(key), true);
    await step('refused paste', async () => {
      await page.evaluate((value) => navigator.clipboard.writeText(value), '99999');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('ControlOrMeta+V');
    }, true);
    const reverted = number(await setOne.inputValue());
    check(reverted === target, `${where}: the refused paste puts set 1 back to ${target} (${reverted})`);
    // The burst ends on blur (Enter moves to reps).
    await page.keyboard.press('Enter');
    const ended = await layout(page);
    check(ended.loads === start.loads, `${where}: set 1 back at ${target}, the same ramps (${ended.loads})`);

    // A second burst to 160, ended by blur: the rows now follow 160 (lesson 12: the value set 1 holds).
    // 160 is over 10% above last time, so #327's held card opens under set 1 and may scroll the page.
    await setOne.click();
    const second = await layout(page);
    for (const key of ['1', '6', '0']) {
      await page.keyboard.press(key);
      const now = await layout(page);
      check(same(now, second, true), `${where}: second burst, typed ${key}: W rows changed (${show(second)} -> ${show(now)})`);
    }
    check(/over last time/.test(await page.locator('.lg-note--held').innerText().catch(() => '')), `${where}: #327 holds 160 on set 1`);
    await page.keyboard.press('Enter');
    if (keyboard) await page.evaluate(() => window.__fakeKeyboard(null, 0));
    const after = await layout(page);
    const loads = after.loads.split('/').map(Number);
    check(after.count === 2 && after.loads !== start.loads && loads[1] < 160 && loads[1] > loads[0],
      `${where}: after blur, two ramps follow 160 (${after.loads}; before ${start.loads})`);
    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: ${show(start)} held through 1/14/140, backspaces, 145, a cap and a refused paste; 160 then blur gives ${after.loads}`);
    await context.close();
  }

  // #345: a first-time Dumbbell Bench lead opens on its suggested start (25 lb each, Intermediate), which is
  // under the 30 lb floor: no W rows. Typed up to 35 then 40 lb, two rows; back down to 25, none. Rows only
  // change on blur, never mid-burst (#326). A kg lifter's 10 kg start is under 15 kg: no rows either.
  const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime)).map((a) => a.finished.catch(() => {}))));
  const shot = async (page, name) => {
    if (!SHOTS) return;
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    await page.screenshot({ path: join(SHOTS, name) });
  };
  const warmLoads = async (page) => (await page.locator('tr.lg-row--warm td:nth-child(3)').allInnerTexts()).map(number);
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height} first-time`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(MONDAY);
    await onboard(page, 'lb');
    await seedLead(page, { firstTime: true });
    const hint = (await page.locator('.lg-coach').innerText()).match(/Suggested start (\d+)/)?.[1];
    const setOne = page.getByRole('textbox', { name: /^Set 1 weight/ });
    check(hint === '25' && (await setOne.inputValue()) === hint, `${where}: set 1 shows the suggested 25 (${hint}, ${await setOne.inputValue()})`);
    const opened = await warmLoads(page);
    check(opened.length === 0, `${where}: no W rows under the 30 lb floor at ${hint} lb (${opened})`);
    await shot(page, `345-first-time-25lb-${width}x${height}.png`);

    /** Types `keys` one at a time into set 1; the W rows must stay at `held` through the burst. */
    const burst = async (keys, held) => {
      await setOne.click();
      for (const key of keys) {
        await page.keyboard.press(key);
        const now = (await warmLoads(page)).join('/');
        check(now === held, `${where}: typed ${key} of ${keys.join('')}: W rows changed mid-burst (${held} -> ${now})`);
      }
      await page.keyboard.press('Enter');
      return warmLoads(page);
    };
    // 25 -> 35: none through the burst, two rows on blur.
    const at35 = await burst(['3', '5'], '');
    check(at35.length === 2 && at35.every((load) => load < 35) && at35[0] < at35[1], `${where}: 35 lb ramps two rows (${at35})`);
    // 35 -> 40: 35's rows hold mid-burst, then follow 40.
    const at40 = await burst(['4', '0'], at35.join('/'));
    check(at40.length === 2 && at40.every((load) => load < 40) && at40[0] < at40[1], `${where}: 40 lb ramps two rows (${at40})`);
    await shot(page, `345-lead-40lb-${width}x${height}.png`);
    // 40 -> 2 -> 25: rows hold through the burst, then go on blur.
    const at25 = await burst(['2', '5'], at40.join('/'));
    check(at25.length === 0, `${where}: back to 25 lb, no W rows (${at25})`);
    check(errors.length === 0, `${where}: no page errors (${errors.join('; ')})`);
    console.log(`${where}: suggested ${hint} lb none; 35 lb ${at35.join(' / ')}; 40 lb ${at40.join(' / ')}; 25 lb none`);
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.setFixedTime(MONDAY);
    await onboard(page, 'kg');
    await seedLead(page, { firstTime: true });
    const hint = (await page.locator('.lg-coach').innerText()).match(/Suggested start (\d+)/)?.[1];
    const loads = await warmLoads(page);
    check(hint === '10' && loads.length === 0, `390x844 kg first-time: no W rows under 15 kg at ${hint} kg (${loads})`);
    console.log(`390x844 kg first-time: suggested ${hint} kg, ${loads.length} W rows`);
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
console.log('PASS: W rows hold still while set 1 is typed, ramp from a first-time suggested start, and stop under 30 lb / 15 kg');
