// (#397, rewritten for #430) Ending and leaving a workout, ask-first. The black dock Resume/End buttons, the
// "Unfinished" card and the old Finish-sheet chips are gone (#430); an open workout is one quiet row on Today.
// The page clock is pinned (lesson 35), so idle times are exact. Checks at 390x844 and 360x780:
// A. Idle 15 min: the row reads "Push paused · 1 of N sets"; the dock still says Preview workout, the centre
//    button says Ask, nothing says Resume workout or End. Opening and closing the workout without acting
//    writes nothing (still paused); after Resume, the first logged set books the time away into pausedMs.
// B. Expiry with sets: idle 7 h, a reload saves the workout to history with its sets byte-identical, the end
//    time at the last set, the plan not moved (Push still next), and a one-time note.
// C. Expiry with no sets: the workout just closes; no note, no history.
// D. The row's `...`: Save N sets and finish saves and moves the plan once; Discard asks with the count,
//    Cancel first, and only then deletes; Hide tucks the row away (still hidden after a reload) and Plan's
//    Resume brings it back.
// D2. The logger's Finish sheet: "Discard this session" reaches the same named confirm (Cancel first).
// E. Ask with a workout open, from Today's centre button and from the logger's header: the sheet offers
//    Back to my workout and never writes.
// F. Switch to another day with sets logged: the start-conflict sheet. Back changes nothing; Save N sets
//    and switch keeps every set and moves the plan to the picked day.
// G. Midnight: a set at 23:50 is still in progress at 23:58; idle past midnight (00:20) saves it. (The
//    23:58 -> 00:03 case is in tests/askFirst430.test.ts: logging a set starts a rest, and idle time counts
//    from the rest's end.)
// H. (ruling 4a) A described day open with a set: Preview -> Start of the same day resumes it, no conflict.
// I. Restoring a backup whose open workout differs: this phone's stays open, the backup's sets are saved to
//    Progress, and the restore notice says so.
// Screenshots only when E2E_SHOTS is set.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const MIN = 60_000;

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
const sheetTitle = async (page) => squash(await page.locator('.sheet-title').first().innerText().catch(() => ''));
/** The planned day Today offers, from "Your Pull Day Starts Here!". */
const offered = async (page) => (await heroTitle(page)).match(/^Your (.+) Day Starts Here!$/)?.[1] ?? null;
const row = (page) => page.locator('.rrow');
/** The row's words as read aloud; under 400px "sets"/"logged" are hidden on screen (the mock's one line at 360). */
const rowText = async (page) => squash(await row(page).locator('.rrow__text').textContent().catch(() => '') ?? '');
/** From the logger (Minimize) or another tab, back to Today. */
const toToday = async (page) => {
  const minimize = page.getByRole('button', { name: 'Minimize workout' });
  if (await minimize.count()) await minimize.click();
  await page.locator('button.tab', { hasText: 'Today' }).click();
  await page.waitForSelector('.t7-hero');
};
/** Preview workout, then Start: the only way to start (#430). The logger is open. */
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
const doneSets = (workout) => (workout?.exercises ?? []).flatMap((exercise) => exercise.performed).filter((set) => set.done);
const setsIn = (workout) => workout.exercises.flatMap((exercise) => exercise.performed).length;
/** A fresh page, pinned to `at`, onboarded on a 3-day plan (Push, Pull, Legs). */
async function fresh(browser, width, height, at) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.clock.setFixedTime(at);
  await onboard(page);
  return page;
}
/** Move the pinned clock and reload, as if the phone had been put away until then. */
async function later(page, at) {
  await page.clock.setFixedTime(at);
  await page.reload();
  await page.waitForSelector('.t7-hero');
}
/** Today's dock and centre button never offer Start, Resume or End while a workout is open (#430). */
async function askFirst(page, where) {
  const dock = squash(await page.locator('.today + .flow-dock').innerText().catch(() => ''));
  check(/Preview workout/.test(dock), `${where}: the dock reads "${dock}", not Preview workout`);
  check(await page.getByRole('button', { name: /^(Resume workout|End workout|End|Finish workout)$/ }).count() === 0,
    `${where}: a Resume workout / End button is still on Today`);
  check(await page.locator('nav.tabbar .tab-action').getAttribute('aria-label') === 'Ask', `${where}: the centre button is not Ask`);
}

const noon = new Date();
noon.setHours(12, 0, 0, 0);
const at = (ms) => new Date(noon.getTime() + ms);
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;

    // A. Suspended after 15 minutes: the paused row, and Resume leaves the time away out.
    let page = await fresh(browser, width, height, noon);
    check(await offered(page) === 'Push', `${where}: a 3-day plan does not offer Push first ("${await heroTitle(page)}")`);
    await start(page);
    await logSets(page, 1);
    let state = await stored(page);
    const total = setsIn(state.current);
    await toToday(page);
    check(/in progress/.test(await rowText(page)), `${where} A: right after a set the row reads "${await rowText(page)}"`);
    await later(page, at(15 * MIN));
    check(await rowText(page) === `Push paused · 1 of ${total} sets`, `${where} A: the row reads "${await rowText(page)}"`);
    check(await offered(page) === 'Push', `${where} A: Today shows "${await heroTitle(page)}", not the plan's Push`);
    await askFirst(page, `${where} A`);
    const rowBox = await row(page).boundingBox();
    check(rowBox && rowBox.height <= 64 && rowBox.x >= 0 && rowBox.x + rowBox.width <= width, `${where} A: the row is not one line inside the screen (${JSON.stringify(rowBox)})`);
    for (const target of [row(page).locator('.rrow__go'), row(page).locator('.rrow__more')]) {
      const box = await target.boundingBox();
      check(box && box.height >= 44 && box.width >= 44, `${where} A: a row button is under 44px (${JSON.stringify(box)})`);
    }
    await shot(page, 'row-paused', where);
    // Opening and closing it without acting writes nothing and leaves it paused (spec 9).
    const untouched = JSON.stringify(await stored(page));
    await row(page).locator('.rrow__go').click();
    await page.waitForSelector('.lg-ex');
    check(JSON.stringify(await stored(page)) === untouched, `${where} A: opening the workout wrote to storage`);
    await page.getByRole('button', { name: 'Minimize workout' }).click();
    await page.waitForSelector('.t7-hero');
    check(await rowText(page) === `Push paused · 1 of ${total} sets`, `${where} A: after open and close the row reads "${await rowText(page)}"`);
    check(JSON.stringify(await stored(page)) === untouched, `${where} A: open and close wrote to storage`);
    // The first action after Resume books the time away into pausedMs.
    await row(page).locator('.rrow__go').click();
    await page.waitForSelector('.lg-ex');
    await logSets(page, 1);
    state = await stored(page);
    check(state.current.pausedMs > 0 && state.current.pausedMs <= 15 * MIN, `${where} A: Resume put ${state.current.pausedMs} ms into pausedMs, not the time away`);
    check(doneSets(state.current).length === 2, `${where} A: Resume changed the logged sets`);
    await page.close();

    // B. Expiry with sets: saved byte-identical, ended at the last set, the plan unmoved, one note.
    page = await fresh(browser, width, height, noon);
    await start(page);
    await logSets(page, 2);
    const before = (await stored(page)).current;
    await toToday(page);
    await later(page, at(7 * 60 * MIN));
    state = await stored(page);
    check(state.current === null, `${where} B: the workout is still open after 7 h`);
    const saved = state.history.find((workout) => workout.id === before.id);
    check(saved && JSON.stringify(saved.exercises) === JSON.stringify(before.exercises), `${where} B: the saved sets differ from the logged ones`);
    check(saved && saved.endedAt === noon.toISOString(), `${where} B: ended at ${saved?.endedAt}, not the last set (${noon.toISOString()})`);
    check(await offered(page) === 'Push',
      `${where} B: expiry moved the plan ("${await heroTitle(page)}")`);
    const note = squash(await page.locator('.note-line p').textContent().catch(() => '') ?? '');
    check(note === 'Saved your paused workout: 2 sets.Find it in Progress.',
      `${where} B: the expiry note reads "${note}"`);
    check(await row(page).count() === 0, `${where} B: the row is still shown after expiry`);
    await shot(page, 'expiry-note', where);
    await page.locator('.note-line').getByRole('button', { name: 'Dismiss' }).click();
    check(await page.locator('.note-line').count() === 0, `${where} B: Dismiss left the note`);
    await page.close();

    // C. Expiry with nothing logged: it just closes.
    page = await fresh(browser, width, height, noon);
    await start(page);
    await toToday(page);
    check(/open · no sets logged/.test(await rowText(page)), `${where} C: the empty row reads "${await rowText(page)}"`);
    await later(page, at(7 * 60 * MIN));
    state = await stored(page);
    check(state.current === null && state.history.length === 0, `${where} C: an empty expired workout left ${state.history.length} record(s) or stayed open`);
    check(await page.locator('.note-line').count() === 0, `${where} C: an empty workout with no notes showed a note`);
    await page.close();

    // D. The row's `...`: Discard (asks with the count), Hide, then Save (the plan moves once).
    page = await fresh(browser, width, height, noon);
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    await row(page).locator('.rrow__more').click();
    check(/^Push · 1 of \d+ sets$/.test(await sheetTitle(page)), `${where} D: the menu is titled "${await sheetTitle(page)}"`);
    await shot(page, 'menu', where);
    await page.getByRole('button', { name: 'Discard workout' }).click();
    check(await sheetTitle(page) === 'Discard Push?', `${where} D: Discard opened "${await sheetTitle(page)}"`);
    check(await page.evaluate(() => document.activeElement?.textContent?.trim()) === 'Cancel', `${where} D: Cancel does not take first focus`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    check((await stored(page)).current !== null, `${where} D: Cancel discarded the workout`);
    await row(page).locator('.rrow__more').click();
    await page.getByRole('button', { name: /Hide for now/ }).click();
    check(await row(page).count() === 0, `${where} D: Hide left the row`);
    check((await stored(page)).current !== null, `${where} D: Hide closed the workout`);
    await page.reload();
    await page.waitForSelector('.t7-hero');
    check(await row(page).count() === 0, `${where} D: the hidden row came back after a reload`);
    await page.locator('nav.tabbar .tab', { hasText: 'Plan' }).click();
    await page.locator('.plan-row__view', { hasText: 'Resume' }).click();
    await page.waitForSelector('.lg-ex');
    await toToday(page);
    check(await row(page).count() === 1, `${where} D: Resume from Plan did not bring the row back`);
    await row(page).locator('.rrow__more').click();
    await page.getByRole('button', { name: 'Save 1 set and finish' }).click();
    await page.getByRole('button', { name: 'Back to Today' }).click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.current === null && state.history.length === 1 && doneSets(state.history[0]).length === 1, `${where} D: Save left ${state.history.length} record(s)`);
    check(await offered(page) === 'Pull', `${where} D: after Save, Today offers "${await heroTitle(page)}", not Pull`);
    // Discard with a set logged, through the confirm.
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    await row(page).locator('.rrow__more').click();
    await page.getByRole('button', { name: 'Discard workout' }).click();
    await shot(page, 'discard-confirm', where);
    await page.getByRole('button', { name: 'Discard 1 set' }).click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.current === null && state.history.length === 1, `${where} D: Discard left the workout open or touched history (${state.history.length})`);
    check(await offered(page) === 'Pull', `${where} D: Discard moved the plan ("${await heroTitle(page)}")`);

    // D2. The logger's Finish sheet: "Discard this session" reaches the same named confirm; Cancel keeps it all.
    await start(page);
    await logSets(page, 1);
    const beforeFinish = JSON.stringify(await stored(page));
    await page.locator('.lg-header .finish-btn').click();
    await page.getByRole('button', { name: 'Discard this session' }).click();
    check(await sheetTitle(page) === 'Discard Pull?', `${where} D2: Finish's Discard opened "${await sheetTitle(page)}", not the named confirm`);
    check(await page.evaluate(() => document.activeElement?.textContent?.trim()) === 'Cancel', `${where} D2: Cancel does not take first focus`);
    check(JSON.stringify(await stored(page)) === beforeFinish, `${where} D2: opening the confirm changed stored data`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    state = await stored(page);
    check(state.current !== null && doneSets(state.current).length === 1, `${where} D2: Cancel lost the workout or its set`);
    await page.locator('.lg-header .finish-btn').click();
    await page.getByRole('button', { name: 'Discard this session' }).click();
    await page.getByRole('button', { name: 'Discard 1 set' }).click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.current === null && state.history.length === 1, `${where} D2: the confirmed Discard left ${state.current ? 'the workout open' : 'history changed'}`);

    // E. Ask with a workout open: Back to my workout, nothing written.
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    const kept = JSON.stringify(await stored(page));
    await page.locator('nav.tabbar .tab-action').click();
    await page.getByRole('button', { name: /Back to my workout/ }).waitFor();
    check(await sheetTitle(page) === 'What do you want to do today?', `${where} E: Ask opened "${await sheetTitle(page)}"`);
    check(await page.getByRole('button', { name: /Start workout/ }).count() === 0, `${where} E: Ask offers a Start`);
    await shot(page, 'ask-open', where);
    await page.getByRole('button', { name: /Back to my workout/ }).click();
    await page.waitForSelector('.lg-ex');
    check(JSON.stringify(await stored(page)) === kept, `${where} E: Ask changed stored data`);
    // In the logger (no tab bar): the header's Ask opens the same mid-workout sheet; Back writes nothing.
    const headerAsk = page.locator('.lg-header').getByRole('button', { name: 'Ask', exact: true });
    for (const [label, target] of [['Ask', headerAsk], ['Finish', page.locator('.lg-header .finish-btn')], ['Minimize', page.getByRole('button', { name: 'Minimize workout' })]]) {
      const box = await target.boundingBox();
      check(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `${where} E: the logger's ${label} is not a whole 44px target (${JSON.stringify(box)})`);
    }
    await headerAsk.click();
    await page.getByRole('button', { name: /Back to my workout/ }).waitFor();
    check(await page.getByRole('button', { name: /Log a set/ }).count() === 1, `${where} E: the logger's Ask has no Log a set`);
    await shot(page, 'ask-logger', where);
    await page.getByRole('button', { name: /Back to my workout/ }).click();
    await page.waitForSelector('.lg-ex');
    check(JSON.stringify(await stored(page)) === kept, `${where} E: the logger's Ask changed stored data`);

    // F. Switch to Push with a Pull set logged: the conflict sheet; Back keeps everything; Save keeps the set.
    await toToday(page);
    const pullOpen = JSON.stringify(await stored(page));
    await page.getByRole('button', { name: 'Switch workout' }).click();
    await page.locator('.sheet--switch').waitFor();
    await page.locator('.sheet--switch button.len-opt:not([aria-current])', { hasText: 'Push' }).first().click();
    await page.getByRole('button', { name: 'Back to Pull' }).waitFor();
    check(/^Pull is still open 1 set logged$/.test(await sheetTitle(page)), `${where} F: the conflict sheet is titled "${await sheetTitle(page)}"`);
    check(await page.getByRole('button', { name: 'Save 1 set and start Push' }).count() === 1, `${where} F: no "Save 1 set and start Push"`);
    await shot(page, 'conflict', where);
    await page.getByRole('button', { name: 'Back to Pull' }).click();
    check(JSON.stringify(await stored(page)) === pullOpen, `${where} F: Back changed stored data`);
    await page.getByRole('button', { name: 'Switch workout' }).click();
    await page.locator('.sheet--switch').waitFor();
    await page.locator('.sheet--switch button.len-opt:not([aria-current])', { hasText: 'Push' }).first().click();
    await page.getByRole('button', { name: 'Save 1 set and start Push' }).click();
    await page.waitForSelector('.t7-hero');
    state = await stored(page);
    check(state.current === null && state.history.length === 2 && state.history.every((workout) => doneSets(workout).length === 1),
      `${where} F: after Save, ${state.history.length} record(s), current ${state.current ? 'open' : 'closed'}`);
    check(await offered(page) === 'Push', `${where} F: after Save and switch, Today offers "${await heroTitle(page)}"`);
    await page.close();

    // H. (ruling 4a) A described day open with a set: Preview -> Start of the same day resumes it, no conflict.
    page = await fresh(browser, width, height, noon);
    await page.getByRole('button', { name: 'Switch workout' }).click();
    await page.locator('.sheet--switch').waitFor();
    await page.locator('.sw-chip', { hasText: /^Chest/ }).first().click();
    await page.locator('.sw-build').click();
    await page.waitForSelector('.t7-hero');
    const described = await heroTitle(page);
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    const describedOpen = await stored(page);
    check(describedOpen.current?.slotSeq === undefined && doneSets(describedOpen.current).length === 1,
      `${where} H: the described day did not open unlinked with one set`);
    await page.getByRole('button', { name: 'Preview workout' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    check(await page.getByRole('button', { name: /^Back to / }).count() === 0, `${where} H: starting the open described day showed the conflict sheet`);
    state = await stored(page);
    check(state.current?.id === describedOpen.current.id && doneSets(state.current).length === 1 && state.history.length === 0,
      `${where} H: "${described}" started again did not resume the open workout`);
    await page.close();

    // I. A backup with a different open workout: its sets go to Progress and the notice says so.
    page = await fresh(browser, width, height, noon);
    await start(page);
    await logSets(page, 2);
    await toToday(page);
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up now' }).click()]);
    const backup = join(tmpdir(), `end-workout-430-${where}.json`);
    await download.saveAs(backup);
    check(JSON.parse(readFileSync(backup, 'utf8'))?.state?.current !== null, `${where} I: the backup carries no open workout`);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await row(page).locator('.rrow__more').click();
    await page.getByRole('button', { name: 'Discard workout' }).click();
    await page.getByRole('button', { name: 'Discard 2 sets' }).click();
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    const localId = (await stored(page)).current.id;
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    await page.locator('.settings-row input[type=file]').setInputFiles(backup);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    const restored = page.getByText(/^Restored \d+ workouts?/).first();
    await restored.waitFor({ timeout: 5000 }).catch(() => {});
    const restoreNote = squash(await restored.textContent().catch(() => ''));
    check(/Saved 2 sets from the backup's open workout to Progress; your open workout stays open\./.test(restoreNote),
      `${where} I: the restore notice reads "${restoreNote}"`);
    state = await stored(page);
    check(state.current?.id === localId && doneSets(state.current).length === 1, `${where} I: this phone's open workout did not stay`);
    check(state.history.length === 1 && doneSets(state.history[0]).length === 2, `${where} I: the backup's 2 sets are not in history (${state.history.length})`);
    await page.close();

    // G. Midnight: a set at 23:50, still in progress at 23:58; idle past midnight, saved at 00:20.
    const late = new Date(noon);
    late.setHours(23, 50, 0, 0);
    page = await fresh(browser, width, height, late);
    await start(page);
    await logSets(page, 1);
    await toToday(page);
    await later(page, new Date(late.getTime() + 8 * MIN));
    check(/^Push in progress · 1 of \d+ sets$/.test(await rowText(page)), `${where} G 23:58: the row reads "${await rowText(page)}"`);
    await later(page, new Date(late.getTime() + 30 * MIN));
    state = await stored(page);
    check(state.current === null && state.history.length === 1 && doneSets(state.history[0]).length === 1,
      `${where} G 00:20: idle past midnight left ${state.history.length} record(s), current ${state.current ? 'open' : 'closed'}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`end-workout: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('end-workout: paused row, expiry, Save/Hide/Discard, Ask and the conflict sheet keep every logged set');
