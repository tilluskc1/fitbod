// (#397) Ending a workout. The owner could not end a 5-day-old empty Push: the way out read
// "Keep Push for next time", Today offered only "Resume workout", and the top chips were dead while a
// session was open. Checks, at 390x844, 360x780 and 390x650:
// A. a Push started 5 days ago, 0 sets: Today reads "Unfinished Push from <day>"; (#399) the main button is
//    End workout and Resume is the quiet link, nothing says "In progress" or a length, and the Plan tab says
//    Unfinished with the same set count. Resume opens it; End workout ends it with no question, its toast
//    clear of the greeting, and a fresh Push is offered.
// B. the empty Finish sheet: End workout keeps Push next; End and skip to Pull moves the plan to Pull.
// C. 2 sets, End from Today: the Finish sheet, never a silent discard; Save keeps the 2 sets and Today
//    offers the next day.
// D. 0 sets, Gym chip: the session ends quietly, the gear sheet opens and the pick applies.
// E. 2 sets, Switch chip: the Finish sheet; Continue changes nothing; Save keeps the sets, then Switch opens.
// F. a described day (#193), 1 set, Time chip: Finish sheet, Save keeps the set, the length sheet opens.
// G. (#399) a workout from 5 days ago with 2 sets: the main button is Finish workout; it opens the Finish
//    sheet, Continue changes nothing, Save keeps the 2 sets.
// H. (#399) midnight: started 23:50, still "In progress" with Resume workout at 23:55; at 00:10 it is
//    Unfinished on Today and Plan. With every exercise skipped the logger's bar reads End workout and ends it.
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
const server = await preview({ preview: { port: 4211, strictPort: false }, logLevel: 'silent' });
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
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    // A fixed local noon: "5 days ago" is a calendar day, never one that depends on when this runs (lesson 35).
    await page.clock.setFixedTime(noon);
    await onboard(page);
    check(await offered(page) === 'Push', `${where}: a 3-day plan does not offer Push first ("${await heroTitle(page)}")`);
    await shot(page, 'today-fresh', where);

    // A. The owner's case: a Push started 5 days ago, nothing logged.
    await start(page);
    await backdate(page, 5 * 86_400_000);
    await page.reload();
    await toToday(page);
    const day = new Date(noon.getTime() - 5 * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    check(await heroTitle(page) === `Unfinished Push from ${day}`, `${where} A: hero reads "${await heroTitle(page)}", not "Unfinished Push from ${day}"`);
    // (#399) The way out leads: End workout is the main button, Resume the quiet link; no "In progress", no length.
    let state = await stored(page);
    const sets = setsIn(state.current);
    let card = await staleCard(page);
    check(card.eyebrow === 'Unfinished', `${where} A: the eyebrow reads "${card.eyebrow}", not "Unfinished"`);
    check(card.chip === `0 of ${sets} sets logged`, `${where} A: the pill reads "${card.chip}", not "0 of ${sets} sets logged"`);
    check(!/in progress/i.test(card.hero), `${where} A: the stale card still says In progress ("${card.hero}")`);
    check(!/\bmin\b|≈/.test(card.meta) && /Day 1 of 3/.test(card.meta), `${where} A: the meta line reads "${card.meta}" (want no length, and Day 1 of 3)`);
    check(card.primary.join() === 'End workout', `${where} A: the main button reads "${card.primary}", not "End workout"`);
    check(card.quiet.join() === 'Resume', `${where} A: the quiet link reads "${card.quiet}", not "Resume"`);
    await dockFits(page, `${where} A`);
    await chipsLive(page, `${where} A`);
    await shot(page, 'stale', where);
    await shot(page, 'stale-empty', where, 399);
    // Plan counts the same sets and says Unfinished too (one stale test, lesson 36).
    const planA = await planChip(page);
    check(planA === `Unfinished · 0 of ${sets} sets`, `${where} A: Plan's Today chip reads "${planA}", not "Unfinished · 0 of ${sets} sets"`);
    await shot(page, 'plan-stale', where, 399);
    await toToday(page);
    await dock(page).getByRole('button', { name: 'Resume', exact: true }).click();
    check(await page.locator('.lg-ex').first().isVisible().catch(() => false), `${where} A: Resume did not open the stale session`);
    await toToday(page);
    await dock(page).getByRole('button', { name: 'End workout', exact: true }).click();
    // The toast lives 4 s, so it is measured before anything else waits.
    await toastClear(page, `${where} A`);
    await settle(page);
    check(await page.locator('.sheet-title').count() === 0, `${where} A: End workout with 0 sets asked a question ("${await sheetTitle(page)}")`);
    state = await stored(page);
    check(state.current === null, `${where} A: End left the session open`);
    check(state.history.length === 0, `${where} A: End added ${state.history.length} history record(s)`);
    check(await offered(page) === 'Push', `${where} A: after End, Today offers "${await heroTitle(page)}", not a fresh Push`);

    // B. The empty Finish sheet says what each exit does.
    await start(page);
    await toToday(page);
    await shot(page, 'open-session', where);
    await endInView(page, `${where} B`);
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await page.getByRole('button', { name: /^Finish( or discard)?$/ }).first().click();
    check(await finishSheet(page) === 'End this workout?', `${where} B: empty sheet titled "${await sheetTitle(page)}"`);
    const sheetText = squash(await page.locator('.sheet').first().innerText());
    check(sheetText.includes('No sets logged, so nothing is saved.'), `${where} B: empty sheet body reads "${sheetText}"`);
    check(!/for next time/.test(sheetText), `${where} B: "for next time" is still on the sheet`);
    check(await page.getByRole('button', { name: 'End and skip to Pull', exact: true }).count() === 1, `${where} B: no "End and skip to Pull"`);
    check(await page.getByRole('button', { name: 'Keep going', exact: true }).count() === 1, `${where} B: no "Keep going"`);
    await shot(page, 'empty-sheet', where);
    await page.getByRole('button', { name: 'End workout', exact: true }).click();
    await page.waitForSelector('.t7-hero');
    check(await offered(page) === 'Push', `${where} B: End workout moved the plan ("${await heroTitle(page)}")`);
    check((await stored(page)).current === null, `${where} B: End workout left the session open`);
    await start(page);
    await page.getByRole('button', { name: /^Finish( or discard)?$/ }).first().click();
    await finishSheet(page);
    await page.getByRole('button', { name: 'End and skip to Pull', exact: true }).click();
    await page.waitForSelector('.t7-hero');
    check(await offered(page) === 'Pull', `${where} B: End and skip to Pull offers "${await heroTitle(page)}"`);
    state = await stored(page);
    check(state.current === null && state.history.length === 0, `${where} B: the skip left a session or a history record`);

    // C. 2 sets logged, End from Today: the Finish sheet, then Save keeps them; Today offers the next day.
    await start(page);
    await logSets(page, 2);
    await toToday(page);
    await endLink(page).click();
    check(await finishSheet(page) === 'Finish your session?', `${where} C: End with sets opened "${await sheetTitle(page)}"`);
    check((await stored(page)).current !== null, `${where} C: End discarded before the sheet`);
    await page.getByRole('button', { name: 'Save completed work', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Today' }).click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.history.length === 1 && doneSets(state.history[0]) === 2, `${where} C: history holds ${state.history.length} record(s), ${doneSets(state.history[0])} set(s)`);
    check(await offered(page) === 'Legs', `${where} C: after saving Pull, Today offers "${await heroTitle(page)}"`);

    // D. 0 sets, Gym chip: the empty session ends quietly and the gear pick applies.
    await start(page);
    await toToday(page);
    await chipsLive(page, `${where} D`);
    await page.locator('.t7-pill--gym').click();
    await page.locator('.len-opt').first().waitFor();
    check((await stored(page)).current === null, `${where} D: the Gym chip did not end the empty session`);
    const other = page.locator('.len-opt:not([aria-current="true"])', { hasText: 'Travel gym' }).first();
    await other.click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.todayOverride?.choice === 'hotel', `${where} D: the gear pick did not apply (${JSON.stringify(state.todayOverride)})`);
    check(/Travel/.test(await page.locator('.t7-hero__meta').innerText()), `${where} D: the hero reads "${squash(await page.locator('.t7-hero__meta').innerText())}"`);
    check(state.history.length === 1, `${where} D: history changed (${state.history.length})`);

    // E. 2 sets, Switch: the Finish sheet; Continue changes nothing; Save keeps them, then Switch opens.
    await start(page);
    await logSets(page, 2);
    await toToday(page);
    const before = JSON.stringify(await stored(page));
    await page.getByRole('button', { name: 'Switch workout' }).click();
    check(await finishSheet(page) === 'Finish your session?', `${where} E: Switch with sets opened "${await sheetTitle(page)}"`);
    await shot(page, 'chip-finish', where);
    await page.getByRole('button', { name: 'Continue workout', exact: true }).click();
    await page.locator('.sheet-title').waitFor({ state: 'detached' });
    check(JSON.stringify(await stored(page)) === before, `${where} E: Continue changed stored data`);
    check(await page.locator('.sheet--switch').count() === 0, `${where} E: Continue opened Switch`);
    await page.getByRole('button', { name: 'Switch workout' }).click();
    await finishSheet(page);
    await page.getByRole('button', { name: 'Save completed work', exact: true }).click();
    await page.locator('.sheet--switch').waitFor();
    state = await stored(page);
    check(state.current === null && state.history.length === 2 && totalDone(state.history) === 4, `${where} E: after Save, ${state.history.length} record(s), ${totalDone(state.history)} set(s)`);
    await shot(page, 'switch-after-save', where);

    // F. A described day (#193) with a set logged, Time chip: Save keeps the set, then the length sheet opens.
    await page.locator('.sw-chip', { hasText: /^Pull/ }).first().click();
    await page.locator('.sw-build').click();
    await page.locator('.sheet--switch').waitFor({ state: 'detached' });
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    await page.getByRole('button', { name: /^Workout length/ }).click();
    check(await finishSheet(page) === 'Finish your session?', `${where} F: Time with a set opened "${await sheetTitle(page)}"`);
    await page.getByRole('button', { name: 'Save completed work', exact: true }).click();
    await page.waitForSelector('.t7-hero');
    await settle(page);
    check(/duration/i.test(await sheetTitle(page)), `${where} F: after Save the length sheet is not open ("${await sheetTitle(page)}")`);
    state = await stored(page);
    check(state.history.length === 3 && totalDone(state.history) === 5, `${where} F: the described day's set was not kept (${state.history.length} records, ${totalDone(state.history)} set(s))`);
    check(Object.keys(state).sort().join() === Object.keys(JSON.parse(before)).sort().join(), `${where}: stored keys changed`);
    await page.close();

    // G. (#399) An old workout with 2 sets logged: Finish workout leads, and it saves them through the sheet.
    const old = await browser.newPage({ viewport: { width, height } });
    await old.clock.setFixedTime(noon);
    await onboard(old);
    await start(old);
    await logSets(old, 2);
    await backdate(old, 5 * 86_400_000);
    await old.reload();
    await toToday(old);
    state = await stored(old);
    const total = setsIn(state.current);
    card = await staleCard(old);
    check(card.eyebrow === 'Unfinished' && card.chip === `2 of ${total} sets logged`, `${where} G: the card reads "${card.eyebrow}" / "${card.chip}"`);
    check(!/in progress/i.test(card.hero), `${where} G: the stale card still says In progress ("${card.hero}")`);
    check(card.primary.join() === 'Finish workout' && card.quiet.join() === 'Resume', `${where} G: the dock reads "${card.primary}" and "${card.quiet}"`);
    await dockFits(old, `${where} G`);
    await shot(old, 'stale-sets', where, 399);
    const planG = await planChip(old);
    check(planG === `Unfinished · 2 of ${total} sets`, `${where} G: Plan's Today chip reads "${planG}"`);
    await toToday(old);
    const kept = JSON.stringify(await stored(old));
    await dock(old).getByRole('button', { name: 'Finish workout', exact: true }).click();
    check(await finishSheet(old) === 'Finish your session?', `${where} G: Finish workout opened "${await sheetTitle(old)}"`);
    await old.getByRole('button', { name: 'Continue workout', exact: true }).click();
    await old.locator('.sheet-title').waitFor({ state: 'detached' });
    check(JSON.stringify(await stored(old)) === kept, `${where} G: Continue changed stored data`);
    await toToday(old);
    await dock(old).getByRole('button', { name: 'Finish workout', exact: true }).click();
    await finishSheet(old);
    await old.getByRole('button', { name: 'Save completed work', exact: true }).click();
    await old.getByRole('button', { name: 'Back to Today' }).click();
    await old.waitForSelector('.t7-hero');
    state = await stored(old);
    check(state.current === null && state.history.length === 1 && doneSets(state.history[0]) === 2, `${where} G: after Save, ${state.history.length} record(s), ${doneSets(state.history[0])} set(s)`);
    check(await offered(old) === 'Pull', `${where} G: after saving the old Push, Today offers "${await heroTitle(old)}"`);
    await old.close();

    // H. (#399) Midnight (lesson 35: the clock is pinned). Started 23:50: at 23:55 it is today's and unchanged;
    // at 00:10 it is unfinished, on Today and on Plan.
    const night = await browser.newPage({ viewport: { width, height } });
    const late = new Date(noon);
    late.setHours(23, 50, 0, 0);
    await night.clock.setFixedTime(late);
    await onboard(night);
    await start(night);
    await night.clock.setFixedTime(new Date(late.getTime() + 5 * 60_000));
    await night.reload();
    await toToday(night);
    card = await staleCard(night);
    const count = setsIn((await stored(night)).current);
    check(card.eyebrow === 'In progress' && card.chip === `In progress · 0 of ${count} sets`, `${where} H 23:55: the card reads "${card.eyebrow}" / "${card.chip}"`);
    check(/\bmin\b/.test(card.meta), `${where} H 23:55: the same-day meta lost its length ("${card.meta}")`);
    check(card.primary.join() === 'Resume workout' && card.quiet.join() === 'End', `${where} H 23:55: the dock reads "${card.primary}" and "${card.quiet}"`);
    const planBefore = await planChip(night);
    check(planBefore === `In progress · 0 of ${count} sets`, `${where} H 23:55: Plan's chip reads "${planBefore}"`);
    await night.clock.setFixedTime(new Date(late.getTime() + 20 * 60_000));
    await night.reload();
    await toToday(night);
    card = await staleCard(night);
    check(card.eyebrow === 'Unfinished' && card.chip === `0 of ${count} sets logged`, `${where} H 00:10: the card reads "${card.eyebrow}" / "${card.chip}"`);
    check(card.primary.join() === 'End workout' && card.quiet.join() === 'Resume', `${where} H 00:10: the dock reads "${card.primary}" and "${card.quiet}"`);
    const planAfter = await planChip(night);
    check(planAfter === `Unfinished · 0 of ${count} sets`, `${where} H 00:10: Plan's chip reads "${planAfter}"`);
    // The logger's own bar (shown once nothing is left to log) names the same action at 0 sets.
    await night.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      for (const exercise of saved.state.current.exercises) exercise.skipped = true;
      localStorage.setItem(key, JSON.stringify(saved));
    }, KEY);
    await night.reload();
    await toToday(night);
    await dock(night).getByRole('button', { name: 'Resume', exact: true }).click();
    await night.locator('.save-bar').waitFor();
    const barText = squash(await night.locator('.save-bar').innerText());
    check(barText === 'End workout', `${where} H: the logger's bar reads "${barText}", not "End workout"`);
    await shot(night, 'logger-bar', where, 399);
    // Nothing is pending and nothing is logged, so the bar does what it says: the workout ends, Push stays next.
    await night.locator('.save-bar').click();
    await night.waitForSelector('.t7-hero');
    state = await stored(night);
    check(state.current === null && state.history.length === 0, `${where} H: the bar left a session or wrote ${state.history.length} record(s)`);
    check(await offered(night) === 'Push', `${where} H: after the bar, Today offers "${await heroTitle(night)}"`);
    await night.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`end-workout: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('end-workout: stale and empty sessions end from Today, the empty sheet says End, chips finish or end first');
