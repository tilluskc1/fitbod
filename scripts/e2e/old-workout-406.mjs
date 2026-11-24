// (#406, rewritten for #430) An old workout never lingers. #430 replaced the "Unfinished" card, its info pill
// and Progress's End workout/Resume pair: a workout idle 6 h, or idle past midnight, expires on the next
// visit. Page clock pinned (lesson 35), at 390x844, 360x780 and 390x650:
// - a Push started 5 days ago with nothing logged closes: no row, no record, Push still next;
// - one with 2 sets logged 5 days ago is saved to history with those exact sets, the plan unmoved;
// - nothing on Today or Progress says Unfinished, End workout or Resume workout;
// - Start over with a workout open today is blocked with the plain "in progress" line.
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
const server = await preview({ preview: { port: 4226, strictPort: false }, logLevel: 'silent' });
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
  await settle(page);
  await page.screenshot({ path: join(shots, `430-${name}-${where}.png`) });
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
const heroTitle = async (page) => squash(await page.locator('.t7-hero__title').innerText());
const offered = async (page) => (await heroTitle(page)).match(/^Your (.+) Day Starts Here!$/)?.[1] ?? null;
/** From the logger (Minimize) or another tab, back to Today. */
const toToday = async (page) => {
  const minimize = page.getByRole('button', { name: 'Minimize workout' });
  if (await minimize.count()) await minimize.click();
  await page.locator('button.tab', { hasText: 'Today' }).click();
  await page.waitForSelector('.t7-hero');
};
/** Preview workout, then Start (#430: the only way to start). The logger is open. */
async function start(page) {
  await page.getByRole('button', { name: 'Preview workout' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
}
async function logSets(page, count) {
  for (let n = 0; n < count; n += 1) {
    await page.locator('button.lg-log:not(.lg-log--back):not([disabled])').first().click();
  }
}
const doneSets = (workout) => (workout?.exercises ?? []).flatMap((exercise) => exercise.performed).filter((set) => set.done).length;
/** Move every time on the open workout back by `age`, as if it had been left open since. */
const backdate = (page, age) => page.evaluate(([key, ms]) => {
  const saved = JSON.parse(localStorage.getItem(key));
  const back = (iso) => (iso ? new Date(Date.parse(iso) - ms).toISOString() : iso);
  const current = saved.state.current;
  current.date = back(current.date);
  current.lastActiveAt = back(current.lastActiveAt);
  current.restStartedAt = back(current.restStartedAt);
  for (const exercise of current.exercises) for (const set of exercise.performed) set.completedAt = back(set.completedAt);
  localStorage.setItem(key, JSON.stringify(saved));
  return current;
}, [KEY, age]);
/** Nothing on screen calls the workout unfinished or offers the retired buttons. */
async function noRetiredWords(page, where) {
  const words = squash(await page.locator('.native-app').innerText());
  check(!/Unfinished/.test(words), `${where}: something still says Unfinished`);
  check(await page.getByRole('button', { name: /^(End workout|Resume workout|Finish workout)$/ }).count() === 0, `${where}: a retired End/Resume/Finish workout button is on screen`);
}

const DAYS = 5 * 86_400_000;
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;

    // Empty and 5 days old: it closes, nothing is saved, Push is still next.
    let page = await browser.newPage({ viewport: { width, height } });
    await page.clock.setFixedTime(noon);
    await onboard(page);
    await start(page);
    await toToday(page);
    await backdate(page, DAYS);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    let state = await stored(page);
    check(state.current === null && state.history.length === 0, `${where} empty: the old workout stayed open or wrote ${state.history.length} record(s)`);
    check(await page.locator('.rrow').count() === 0, `${where} empty: the resume row is still on Today`);
    check(await offered(page) === 'Push', `${where} empty: Today offers "${await heroTitle(page)}", not Push`);
    await noRetiredWords(page, `${where} empty`);
    await page.close();

    // 2 sets, 5 days old: saved with those exact sets; the plan does not move.
    page = await browser.newPage({ viewport: { width, height } });
    await page.clock.setFixedTime(noon);
    await onboard(page);
    await start(page);
    await logSets(page, 2);
    await toToday(page);
    const old = await backdate(page, DAYS);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    const saved = state.history.find((workout) => workout.id === old.id);
    check(state.current === null && saved && doneSets(saved) === 2, `${where} sets: the old workout was not saved with its 2 sets`);
    check(saved && JSON.stringify(saved.exercises) === JSON.stringify(old.exercises), `${where} sets: the saved sets differ from the logged ones`);
    check(saved && saved.endedAt === old.lastActiveAt, `${where} sets: ended at ${saved?.endedAt}, not its last activity ${old.lastActiveAt}`);
    check(await offered(page) === 'Push', `${where} sets: expiry moved the plan ("${await heroTitle(page)}")`);
    await shot(page, 'old-expired', where);
    await noRetiredWords(page, `${where} sets`);
    await page.locator('nav.tabbar .tab', { hasText: 'Progress' }).click();
    await page.waitForTimeout(200);
    await noRetiredWords(page, `${where} sets, Progress`);

    // Start over with a workout open today: the plain block.
    await toToday(page);
    await start(page);
    await toToday(page);
    await page.locator('.today__name').click();
    await page.getByRole('button', { name: /Start over on this device/ }).click();
    await page.locator('.sheet-title', { hasText: 'Save your progress first?' }).waitFor();
    const note = squash(await page.locator('.sheet .note-card, .note-card').first().innerText());
    check(note === 'A workout is in progress. Finish or discard it first, then start over.', `${where}: Start over reads "${note}"`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`old-workout-406: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('old-workout-406: an old workout expires on the next visit; its sets are saved, an empty one just closes');
