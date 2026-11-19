// (#399) An old unfinished workout leads with End. After #397 the stale Today card still read "In progress",
// End was a small link above a big black Resume, Plan said "In progress" and the logger's save bar read
// "Finish or discard". Checks, at 390x844, 360x780 and 390x650, with the page clock pinned (lesson 35):
// A. stale, 0 sets: eyebrow "Unfinished", pill "0 of N sets logged", no duration; End workout is the
//    primary (wide, in view) and Resume the quiet link; End workout ends at once, Push stays next, and the
//    toast clears the greeting and the hero (lesson 36).
// B. same-day open session: unchanged (In progress, End link, Resume workout); Plan says "In progress".
// C. the logger's save bar at 0 sets (shown once nothing is pending) says "End workout" and ends it.
// D. midnight: started 23:50, seen 00:10 is the stale card, on Plan left open across midnight too (review 1);
//    End workout keeps the same day next.
// E. stale, 2 sets: Finish workout is the primary; Plan says "Unfinished · 2 of N sets"; Finish opens
//    "Finish your session?" and Save keeps both sets.
// Screenshots only when E2E_SHOTS is set, named <E2E_SHOT_TAG or 399>-<state>-<width>x<height>.png.
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
const server = await preview({ preview: { port: 4213, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const tag = process.env.E2E_SHOT_TAG || '399';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const KEY = 'fitbod-clone-v1';

const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime) && !a.effect?.target?.closest?.('.done-toast'))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name, where) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: join(shots, `${tag}-${name}-${where}.png`) });
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
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state ?? null, KEY);
/** Rewrites the stored session (null clears it) and reloads onto Today. */
async function seed(page, current) {
  await page.evaluate(([key, value]) => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.state.current = value;
    localStorage.setItem(key, JSON.stringify(saved));
  }, [KEY, current]);
  await page.reload();
  await toToday(page);
}
const toToday = async (page) => {
  const minimize = page.getByRole('button', { name: 'Minimize workout' });
  if (await minimize.count()) await minimize.click();
  await page.locator('button.tab', { hasText: 'Today' }).click();
  await page.waitForSelector('.t7-hero');
  await settle(page);
};
const heroTitle = async (page) => squash(await page.locator('.t7-hero__title').innerText());
const eyebrow = async (page) => squash(await page.locator('.t7-hero__eyebrow').innerText());
/** The hero pill's label, without its icon ligature. */
const pill = async (page) => squash(await page.locator('.t7-hero .t7-state').evaluate((node) =>
  [...node.childNodes].filter((child) => !(child.nodeType === 1 && child.getAttribute('aria-hidden') === 'true')).map((child) => child.textContent).join('')));
const meta = async (page) => squash(await page.locator('.t7-hero__meta').innerText());
/** The open sheet's title, or '' at once when none is open (never a locator wait). */
const sheetTitle = async (page) => (await page.locator('.sheet-title').count() ? squash(await page.locator('.sheet-title').first().innerText()) : '');
const dock = (page) => page.locator('.today + .flow-dock');
const primary = (page) => dock(page).locator('.pill-primary');
const offered = async (page) => (await heroTitle(page)).match(/^Your (.+) Day Starts Here!$/)?.[1] ?? null;
const sets = (session) => session.exercises.reduce((sum, exercise) => sum + exercise.performed.length, 0);
const doneSets = (workout) => (workout?.exercises ?? []).flatMap((exercise) => exercise.performed).filter((set) => set.done).length;
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const fmt = (box) => box && `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;

/** Clicks a button only when it is there; a missing one is a failure, never a 30 s timeout. */
async function tap(locator, where, what) {
  if (await locator.count() !== 1) {
    check(false, `${where}: no single "${what}" button (${await locator.count()})`);
    return false;
  }
  await locator.click();
  return true;
}

/** The stale dock: the primary is wide and in view, Resume is a 44x44 link beside it, and they never meet. */
async function staleDock(page, where, label) {
  const view = page.viewportSize();
  const main = primary(page);
  check(await main.count() === 1 && squash(await main.innerText()) === label, `${where}: the dock's primary reads "${await main.count() ? squash(await main.innerText()) : ''}", not "${label}"`);
  const resume = dock(page).getByRole('button', { name: 'Resume', exact: true });
  check(await resume.count() === 1, `${where}: no "Resume" link in the dock`);
  check(await dock(page).getByRole('button', { name: 'End', exact: true }).count() === 0, `${where}: the small End link is still there`);
  check(await page.getByRole('button', { name: 'Resume workout', exact: true }).count() === 0, `${where}: "Resume workout" is still offered`);
  if (await main.count() !== 1 || await resume.count() !== 1) return;
  const [m, r] = [await main.boundingBox(), await resume.boundingBox()];
  const inView = (box) => box.y >= 0 && box.y + box.height <= view.height && box.x >= 0 && box.x + box.width <= view.width;
  check(inView(m) && m.height >= 44 && m.width >= view.width / 2, `${where}: ${label} is not a wide visible primary (${fmt(m)} in ${view.width}x${view.height})`);
  check(inView(r) && r.height >= 44 && r.width >= 44 && r.width < view.width / 2, `${where}: Resume is not a visible 44x44 link (${fmt(r)})`);
  check(!meets(m, r), `${where}: ${label} and Resume overlap (${fmt(m)} / ${fmt(r)})`);
}

/** No stale surface says "In progress": eyebrow, pill and title. */
async function staleCard(page, where, done, total) {
  check(await eyebrow(page) === 'Unfinished', `${where}: eyebrow reads "${await eyebrow(page)}", not "Unfinished"`);
  check(await pill(page) === `${done} of ${total} sets logged`, `${where}: pill reads "${await pill(page)}", not "${done} of ${total} sets logged"`);
  check(!/In progress/i.test(squash(await page.locator('.t7-hero').innerText())), `${where}: the stale hero still says "In progress"`);
  const line = await meta(page);
  check(!/\bmin\b/.test(line) && /Day \d of \d/.test(line), `${where}: the stale meta line reads "${line}" (no duration, keeps the day)`);
}

/** (lesson 36) The Today toast, fully faded in, meets neither the greeting row nor the hero. */
async function toastClear(page, where) {
  const toast = page.locator('.done-toast .done-toast__pill');
  await toast.waitFor({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  check(await toast.count() === 1, `${where}: no toast after End workout`);
  if (await toast.count() !== 1) return;
  const [t, g, h] = [await toast.boundingBox(), await page.locator('.today__greeting').boundingBox(), await page.locator('.t7-hero').boundingBox()];
  check(t && g, `${where}: no toast or greeting to compare (${fmt(t)} / ${fmt(g)})`);
  if (!t || !g) return;
  check(!meets(t, g), `${where}: the toast covers the greeting (${fmt(t)} vs ${fmt(g)})`);
  check(!h || !meets(t, h), `${where}: the toast covers the workout card (${fmt(t)} vs ${fmt(h)})`);
}

const planRow = async (page) => {
  await page.locator('button.tab', { hasText: 'Plan' }).click();
  await page.locator('.plan-row--today').waitFor();
  await settle(page);
  return squash(await page.locator('.plan-row--today').innerText());
};

// Fixed local times (lesson 35): a calendar day never depends on when or where this runs.
const day = new Date();
day.setHours(12, 0, 0, 0);
const at = (base, days, h, m) => { const d = new Date(base); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.clock.setFixedTime(at(day, 0, 12, 0));
    await onboard(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const template = (await stored(page)).current;
    const total = sets(template);
    const fiveDaysAgo = at(day, -5, 18, 0).toISOString();

    // A. Stale, 0 sets: End workout leads and ends it at once; Push stays next.
    await seed(page, { ...template, date: fiveDaysAgo });
    await staleCard(page, `${where} A`, 0, total);
    await staleDock(page, `${where} A`, 'End workout');
    await shot(page, 'stale-0', where);
    const resume = dock(page).getByRole('button', { name: 'Resume', exact: true });
    if (await resume.count() === 1) {
      await resume.click();
      await page.locator('.lg-ex').first().waitFor({ timeout: 5000 }).catch(() => {});
      check(await page.locator('.lg-ex').first().isVisible().catch(() => false), `${where} A: Resume did not open the stale session`);
      await toToday(page);
    }
    if (await tap(primary(page).filter({ hasText: /^End workout$/ }), `${where} A`, 'End workout')) {
      await page.waitForTimeout(100);
      check(await page.locator('.sheet-title').count() === 0, `${where} A: End workout with 0 sets asked "${await sheetTitle(page)}"`);
      const state = await stored(page);
      check(state.current === null && state.history.length === 0, `${where} A: End workout left a session or a record`);
      check(await offered(page) === 'Push', `${where} A: after End workout Today offers "${await heroTitle(page)}", not Push`);
      await toastClear(page, `${where} A`);
    }

    // B. Same day: unchanged.
    await seed(page, { ...template, date: at(day, 0, 11, 30).toISOString() });
    check(await eyebrow(page) === 'In progress', `${where} B: same-day eyebrow reads "${await eyebrow(page)}"`);
    check(await pill(page) === `In progress · 0 of ${total} sets`, `${where} B: same-day pill reads "${await pill(page)}"`);
    check(/\d+ min/.test(await meta(page)), `${where} B: same-day meta lost its duration ("${await meta(page)}")`);
    check(await dock(page).getByRole('button', { name: 'End', exact: true }).count() === 1, `${where} B: same-day End link is gone`);
    check(await primary(page).count() === 1 && /^Resume workout/.test(squash(await primary(page).innerText())), `${where} B: same-day primary is not Resume workout`);
    await shot(page, 'open-session', where);
    const sameDayPlan = await planRow(page);
    check(sameDayPlan.includes(`In progress · 0 of ${total} sets`) && !/Unfinished/.test(sameDayPlan), `${where} B: same-day Plan row reads "${sameDayPlan}"`);
    await toToday(page);

    // C. The logger's save bar at 0 sets (every exercise skipped) says End workout and ends it at once.
    await seed(page, { ...template, date: at(day, 0, 11, 30).toISOString(), exercises: template.exercises.map((exercise) => ({ ...exercise, skipped: true })) });
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    const bar = page.locator('.save-bar');
    await bar.waitFor({ timeout: 5000 }).catch(() => {});
    check(await bar.count() === 1 && squash(await bar.innerText()) === 'End workout', `${where} C: save bar reads "${await bar.count() ? squash(await bar.innerText()) : ''}" at 0 sets`);
    await shot(page, 'logger-0', where);
    if (await bar.count() === 1) {
      // Every exercise skipped, nothing pending: the bar ends the workout at once, nothing saved (as Finish did).
      await bar.click();
      await page.waitForSelector('.t7-hero');
      const state = await stored(page);
      check(state.current === null && state.history.length === 0, `${where} C: End workout left a session or a record`);
      await toastClear(page, `${where} C`);
    }

    // D. Midnight: started 23:50 is today's at 23:59 and stale at 00:10; End keeps the same day next.
    await page.clock.setFixedTime(at(day, 0, 23, 59));
    await seed(page, null);
    const next = await offered(page);
    await seed(page, { ...template, date: at(day, 0, 23, 50).toISOString() });
    check(await eyebrow(page) === 'In progress', `${where} D: at 23:59 a 23:50 session reads "${await eyebrow(page)}"`);
    // (#399 review 1) Plan open across midnight, never remounted: it follows the same live clock as Today.
    const beforeMidnight = await planRow(page);
    check(beforeMidnight.includes(`In progress · 0 of ${total} sets`), `${where} D: at 23:59 Plan reads "${beforeMidnight}"`);
    await page.clock.setFixedTime(at(day, 1, 0, 10));
    await page.waitForTimeout(1500); // App's session clock ticks once a second
    const afterMidnight = squash(await page.locator('.plan-row--today').innerText());
    check(afterMidnight.includes(`Unfinished · 0 of ${total} sets`) && !/In progress/.test(afterMidnight), `${where} D: Plan left open past midnight reads "${afterMidnight}"`);
    await page.locator('button.tab', { hasText: 'Today' }).click();
    await page.waitForSelector('.t7-hero');
    check(await eyebrow(page) === 'Unfinished', `${where} D: Today after midnight (no reload) reads "${await eyebrow(page)}"`);
    await page.reload();
    await toToday(page);
    await staleCard(page, `${where} D`, 0, total);
    await staleDock(page, `${where} D`, 'End workout');
    if (await tap(primary(page).filter({ hasText: /^End workout$/ }), `${where} D`, 'End workout')) {
      await page.waitForTimeout(100);
      check((await stored(page)).current === null, `${where} D: End workout left the session open`);
      check(await offered(page) === next, `${where} D: after End Today offers "${await offered(page)}", not "${next}"`);
    } else {
      await seed(page, null);
    }

    // E. Stale with 2 sets: Finish workout leads; Plan says Unfinished; Save keeps both sets.
    await page.clock.setFixedTime(at(day, 1, 12, 0));
    await seed(page, { ...template, date: at(day, 1, 11, 30).toISOString() });
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await page.waitForSelector('.lg-ex');
    for (let n = 0; n < 2; n += 1) await page.locator('button.lg-log:not(.lg-log--back):not([disabled])').first().click();
    const logged = (await stored(page)).current;
    check(doneSets(logged) === 2, `${where} E: ${doneSets(logged)} set(s) logged, not 2`);
    await seed(page, { ...logged, date: at(day, -4, 18, 0).toISOString() });
    await staleCard(page, `${where} E`, 2, total);
    await staleDock(page, `${where} E`, 'Finish workout');
    await shot(page, 'stale-sets', where);
    const stalePlan = await planRow(page);
    check(stalePlan.includes(`Unfinished · 2 of ${total} sets`) && !/In progress/.test(stalePlan), `${where} E: stale Plan row reads "${stalePlan}"`);
    await shot(page, 'plan-stale', where);
    await toToday(page);
    if (await tap(primary(page).filter({ hasText: /^Finish workout$/ }), `${where} E`, 'Finish workout')) {
      await page.locator('.sheet-title').first().waitFor();
      check(await sheetTitle(page) === 'Finish your session?', `${where} E: Finish workout opened "${await sheetTitle(page)}"`);
      check((await stored(page)).current !== null, `${where} E: Finish workout discarded before the sheet`);
      await page.getByRole('button', { name: 'Save completed work', exact: true }).click();
      await page.getByRole('button', { name: 'Back to Today' }).click();
      await page.waitForSelector('.t7-hero');
      const state = await stored(page);
      check(state.current === null && state.history.length === 1 && doneSets(state.history[0]) === 2, `${where} E: after Save, ${state.history.length} record(s), ${doneSets(state.history[0])} set(s)`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`stale-end-399: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('stale-end-399: a stale session leads with End or Finish workout, says Unfinished on Today and Plan, and the save bar says End at 0 sets');
