// (#406) The last places that called an old unfinished workout "in progress" or promised its length.
// A Push started 5 days ago (page clock pinned, lesson 35), viewed at 390x844, 360x780 and 390x650:
// Today's pill shows the info icon (not play) and the card header gives only "{N} sets"; Progress leads
// with End workout and Resume is the quiet link; Start over's block names the day. A same-day session
// is unchanged. Screenshots only when E2E_SHOTS is set.
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
const shot = async (page, name, where, story = 397) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: join(shots, `${story}-${name}-${where}.png`) });
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
const sheetTitle = async (page) => squash(await page.locator('.sheet-title').first().innerText().catch(() => ''));
const dock = (page) => page.locator('.today + .flow-dock');
const endLink = (page) => dock(page).getByRole('button', { name: 'End', exact: true });
/** From the logger (Minimize) or another tab, back to Today. */
const toToday = async (page) => {
  const minimize = page.getByRole('button', { name: 'Minimize workout' });
  if (await minimize.count()) await minimize.click();
  await page.locator('button.tab', { hasText: 'Today' }).click();
  await page.waitForSelector('.t7-hero');
};
/** Start from Today; the logger is open. */
async function start(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
}
async function logSets(page, count) {
  for (let n = 0; n < count; n += 1) {
    await page.locator('button.lg-log:not(.lg-log--back):not([disabled])').first().click();
  }
}
/** Sets logged across history (the page clock is fixed, so records share one end time). */
const totalDone = (history) => history.reduce((sum, workout) => sum + doneSets(workout), 0);
const doneSets = (workout) => (workout?.exercises ?? []).flatMap((exercise) => exercise.performed).filter((set) => set.done).length;
/** The planned day Today offers, from "Your Pull Day Starts Here!". */
const offered = async (page) => (await heroTitle(page)).match(/^Your (.+) Day Starts Here!$/)?.[1] ?? null;
async function finishSheet(page) {
  await page.locator('.sheet-title').first().waitFor();
  await settle(page);
  return sheetTitle(page);
}
/** (#399) An open session from an earlier day, as Today shows it: the words and the dock's two buttons. */
const staleCard = (page) => page.evaluate(() => {
  const words = (selector) => document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  const dock = document.querySelector('.today + .flow-dock');
  return {
    eyebrow: words('.t7-hero__eyebrow'),
    hero: document.querySelector('.t7-hero').innerText.replace(/\s+/g, ' ').trim(),
    meta: words('.t7-hero__meta'),
    // The chip's words without its icon ligature.
    chip: [...document.querySelector('.t7-state').childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim(),
    // The label without the arrow icon's ligature.
    primary: [...dock.querySelectorAll('.pill-primary')].map((button) => [...button.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim()),
    quiet: [...dock.querySelectorAll('.link-btn')].map((button) => button.innerText.replace(/\s+/g, ' ').trim()),
  };
});
/** (#399) The dock's main button and its quiet link: both inside the viewport, 44px targets, the main one the wider, no overlap. */
async function dockFits(page, where) {
  const [main, quiet] = [await dock(page).locator('.pill-primary').boundingBox(), await dock(page).locator('.link-btn').boundingBox()];
  const { width, height } = page.viewportSize();
  const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  check(inside(main) && main.height >= 44, `${where}: the main button is not a visible 44px target (${JSON.stringify(main)} of ${width}x${height})`);
  check(inside(quiet) && quiet.height >= 44 && quiet.width >= 44, `${where}: Resume is not a visible 44x44 target (${JSON.stringify(quiet)})`);
  if (!main || !quiet) return;
  check(main.width > quiet.width && main.width >= width / 2, `${where}: the main button (${Math.round(main.width)}px) does not lead Resume (${Math.round(quiet.width)}px)`);
  const meets = main.x < quiet.x + quiet.width && quiet.x < main.x + main.width && main.y < quiet.y + quiet.height && quiet.y < main.y + main.height;
  check(!meets, `${where}: the main button and Resume overlap`);
  const lines = await dock(page).locator('.pill-primary').evaluate((button) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  check(lines === 1, `${where}: the main button's label wraps to ${lines} lines`);
}
/** (#399) Plan's Today row chip, then back to Today. */
async function planChip(page) {
  await page.locator('nav.tabbar .tab', { hasText: 'Plan' }).click();
  await page.waitForSelector('.plan-row--today');
  return squash(await page.locator('.plan-row--today .plan-chip').innerText().catch(() => ''));
}
/** (#296 r2, lesson 36) The Today toast, fully faded in, shares no pixel with the greeting. */
async function toastClear(page, where) {
  const pill = page.locator('.done-toast .done-toast__pill');
  await pill.waitFor({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const [t, g] = [await pill.boundingBox(), await page.locator('.today__greeting').boundingBox()];
  check(t && g, `${where}: no toast or greeting to compare (${JSON.stringify(t)} / ${JSON.stringify(g)})`);
  if (!t || !g) return;
  check(!(t.x < g.x + g.width && g.x < t.x + t.width && t.y < g.y + g.height && g.y < t.y + t.height), `${where}: End's toast covers the greeting (${JSON.stringify(t)} vs ${JSON.stringify(g)})`);
}
/** Move the open session's start back, as if the app had been left open since. */
const backdate = (page, ms) => page.evaluate(([key, age]) => {
  const saved = JSON.parse(localStorage.getItem(key));
  saved.state.current.date = new Date(Date.now() - age).toISOString();
  localStorage.setItem(key, JSON.stringify(saved));
}, [KEY, ms]);
const setsIn = (session) => session.exercises.flatMap((exercise) => exercise.performed).length;

/** Every top chip is enabled while a session is open (#397: no chip looks live and does nothing). */
async function chipsLive(page, where) {
  const disabled = await page.locator('.t7-controls .t7-pill[disabled]').count();
  check(disabled === 0, `${where}: ${disabled} top chip(s) are disabled while a session is open`);
}
/** The End link sits inside the visible viewport, at least 44px both ways, and never spans the dock (#397 review 1). */
async function endInView(page, where) {
  const box = await endLink(page).boundingBox();
  const height = page.viewportSize().height;
  check(box && box.y >= 0 && box.y + box.height <= height && box.height >= 44 && box.width >= 44, `${where}: End is not a visible 44x44 target (${JSON.stringify(box)} of ${height})`);
  check(box && box.width < page.viewportSize().width / 2, `${where}: End's tap area spans the dock (${box && Math.round(box.width)}px wide)`);
}

const noon = new Date();
noon.setHours(12, 0, 0, 0);
const browser = await chromium.launch();
const iconOf = (page) => page.locator('.t7-state > span').first().textContent().then((t) => t.trim()).catch(() => '');
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.clock.setFixedTime(noon);
    await onboard(page);
    await start(page);
    // Same day first: unchanged.
    await toToday(page);
    let card = await staleCard(page);
    let header = squash(await page.locator('.t7-workout .list-head').innerText());
    check(/\d+ min · \d+ sets/.test(header), `${where} same day: the card header reads "${header}", want its length`);
    check(await iconOf(page) === 'play_arrow', `${where} same day: the pill icon is "${await iconOf(page)}", want play_arrow`);
    await shot(page, 'today-sameday', where, 406);

    await backdate(page, 5 * 86_400_000);
    await page.reload();
    await toToday(page);
    const day = new Date(noon.getTime() - 5 * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const sets = setsIn((await stored(page)).current);
    card = await staleCard(page);
    check(card.chip === `0 of ${sets} sets logged`, `${where} old: the pill reads "${card.chip}"`);
    check(await iconOf(page) === 'info', `${where} old: the pill icon is "${await iconOf(page)}", want info`);
    header = squash(await page.locator('.t7-workout .list-head').innerText());
    check(header === `The workout ${sets} sets`, `${where} old: the card header reads "${header}", want "The workout ${sets} sets"`);
    await page.locator('.t7-workout').scrollIntoViewIfNeeded();
    await shot(page, 'today-old', where, 406);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Progress: End workout leads, Resume is the quiet link.
    await page.locator('nav.tabbar .tab', { hasText: 'Progress' }).click();
    const empty = page.locator('.progress-empty');
    await empty.waitFor();
    const labels = (await empty.locator('button').allInnerTexts()).map(squash);
    check(labels.join('|').replace(/arrow_forward/g, '').trim() === 'End workout|Resume', `${where} old: Progress buttons read "${labels.join('|')}", want "End workout|Resume"`);
    const [main, quiet] = [await empty.locator('button.primary').boundingBox(), await empty.locator('button.link-btn').boundingBox()];
    check(main && quiet && main.y + main.height <= height && quiet.y + quiet.height <= height && main.x >= 0 && main.x + main.width <= width, `${where} old: Progress buttons are not inside the viewport (${JSON.stringify([main, quiet])})`);
    check(quiet && quiet.height >= 44 && quiet.width >= 44, `${where} old: Resume is not a 44x44 target (${JSON.stringify(quiet)})`);
    await shot(page, 'progress-old', where, 406);

    // Start over's block names the day.
    await page.locator('nav.tabbar .tab', { hasText: 'Today' }).click();
    await page.locator('.today__name').click();
    await page.getByRole('button', { name: /Start over on this device/ }).click();
    await page.locator('.sheet-title', { hasText: 'Save your progress first?' }).waitFor();
    const note = squash(await page.locator('.sheet .note-card, .note-card').first().innerText());
    check(note === `A workout from ${day} is still open. End or finish it first, then start over.`, `${where} old: Start over reads "${note}"`);
    await shot(page, 'startover-old', where, 406);
    await page.close();

    // Midnight: started 23:50, at 23:55 Progress still resumes; at 00:10 it leads with End.
    const night = await browser.newPage({ viewport: { width, height } });
    const late = new Date(noon);
    late.setHours(23, 50, 0, 0);
    await night.clock.setFixedTime(late);
    await onboard(night);
    await start(night);
    await night.clock.setFixedTime(new Date(late.getTime() + 5 * 60_000));
    await night.reload();
    await toToday(night);
    await night.locator('nav.tabbar .tab', { hasText: 'Progress' }).click();
    let l = (await night.locator('.progress-empty button').allInnerTexts()).map(squash).join('|').replace(/arrow_forward/g, '').trim();
    check(l === 'Resume workout', `${where} 23:55: Progress reads "${l}", want "Resume workout"`);
    await night.clock.setFixedTime(new Date(late.getTime() + 20 * 60_000));
    await night.reload();
    await night.locator('nav.tabbar .tab', { hasText: 'Progress' }).click();
    await night.locator('.progress-empty').waitFor();
    l = (await night.locator('.progress-empty button').allInnerTexts()).map(squash).join('|').replace(/arrow_forward/g, '').trim();
    check(l === 'End workout|Resume', `${where} 00:10: Progress reads "${l}", want "End workout|Resume"`);
    await night.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`old-workout-406: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('old-workout-406: an old unfinished workout never says in progress, plays, or promises minutes; same day unchanged');
