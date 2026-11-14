// The Send feedback check (#255): Settings and the recap open one sheet; offline and a refused send
// keep the text and say "Not sent"; a sent note clears the box and says thanks. The Firestore endpoint
// is mocked with context.route (every firestore.googleapis.com call), so this never writes to the real
// database; a call to any other URL or method there is a failure.
// Checks the posted body: rule field names, screen, workout count, one tester ID kept per phone.
// #330: reopening clears a leftover Sent / Not sent line (mid-send keeps Sending…); a rejected send
// ends as Not sent with the text kept. 390x844 and 360x780.
// #253: Settings > About, its Send feedback round trip (draft kept, back to About), and the note box
// with the keyboard open at 390x650. #342: Send stays in the visible band with the keyboard open, from
// Settings, About and the recap (also after a send and with a long note), and returns when it closes.
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

const NOT_SENT = "Not sent. You're offline. Your note is kept; tap Send again.";
const NOTE = "Goes to the Home Strength team. Don't include anything private.";
const ENDPOINT = 'https://firestore.googleapis.com/v1/projects/home-strength/databases/(default)/documents/feedback?key=AIzaSyA2efM2HsT1n1GpIiTrk4eFCkwREdFhUvo';
const FIELDS = ['message', 'name', 'appVersion', 'screen', 'device', 'workoutCount', 'testerId'];
const TESTER_KEY = 'fitbod-clone-v1:tester-id';

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4192, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Intermediate/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^4\s*days$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

async function finishToRecap(page) {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('.lg-ex');
  for (let guard = 0; guard < 120; guard += 1) {
    const log = page.locator('button.lg-check:not([disabled])').first();
    if (!(await log.count())) break;
    await log.click();
  }
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).waitFor();
}

/** Lets the sheet's rise animation settle before a screenshot. */
const settle = (page) => page.waitForTimeout(450);

const ABOUT_RECEIVE = 'A feedback note, only when you send one. It sends your message, your name if you add one, the screen you were on, your phone type, the app version, how many workouts you have logged, and a random ID that is the same for every note from this phone.';
const SAFETY = 'Strength training carries risk. Start light. Stop if something hurts, and check with a doctor first if you have an injury or a health condition.';

/** Waits for the open sheet's rise to finish (lesson 29), then one more frame. */
async function settleSheet(page) {
  await page.waitForFunction(() => {
    const sheet = document.querySelector('[role="dialog"]');
    return sheet && sheet.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity);
  });
  await page.waitForTimeout(100);
}

/** (#253) The About sheet, reached from Settings, and the Send feedback round trip. */
async function about(page, settings, sheet, box, send, posts, where, context) {
  const row = settings.getByRole('button', { name: 'About Home Strength' });
  await row.scrollIntoViewIfNeeded();
  const rowBox = await row.boundingBox();
  check(rowBox && rowBox.height >= 44, `${where}: About row is ${rowBox?.height}px tall`);
  if (shots) { await settleSheet(page); await page.screenshot({ path: join(shots, `253-settings-about-row-${where}.png`) }); }
  await row.click();
  const aboutSheet = page.getByRole('dialog', { name: 'About Home Strength' });
  await aboutSheet.waitFor();
  await settleSheet(page);
  const text = (await aboutSheet.innerText()).replace(/\s+/g, ' ');
  for (const line of ['Home Strength is built and run by a small independent team.', ABOUT_RECEIVE, SAFETY, 'Welcome photo and video: made with AI by the Home Strength team.']) {
    check(text.includes(line), `${where}: About is missing "${line.slice(0, 40)}…"`);
  }
  // (#343) A stranger cannot open a repo file, so About does not point at one.
  check(!text.includes('CREDITS.md'), `${where}: About still points at CREDITS.md`);
  const overflow = await aboutSheet.evaluate((el) => [...el.querySelectorAll('*')].some((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'hidden' && node.clientWidth > 0));
  check(!overflow, `${where}: About scrolls sideways`);
  for (const button of await aboutSheet.getByRole('button').all()) {
    const b = await button.boundingBox();
    check(b && b.height >= 44 && b.width >= 44, `${where}: About button "${await button.getAttribute('aria-label') ?? await button.innerText()}" is ${b?.width}x${b?.height}`);
  }
  if (shots) {
    await page.screenshot({ path: join(shots, `253-about-top-${where}.png`) });
    // Whichever box scrolls inside the sheet goes to its end, so Credits and Done show.
    await aboutSheet.evaluate((el) => {
      for (const node of [el, ...el.querySelectorAll('*')]) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight;
      }
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(shots, `253-about-bottom-${where}.png`) });
  }

  // Send feedback from About: the draft written there survives a close and reopen, and offline
  // shows the feedback sheet's own Not sent line. Each close comes back to About, not Settings.
  const before = posts.length;
  await aboutSheet.getByRole('button', { name: 'Send feedback' }).click();
  await sheet.waitFor();
  await box.fill('Written from About');
  await sheet.getByRole('button', { name: /Close/ }).click();
  await aboutSheet.waitFor();
  check(!(await settings.count()), `${where}: closing feedback from About went to Settings`);
  await aboutSheet.getByRole('button', { name: 'Send feedback' }).click();
  await sheet.waitFor();
  check((await box.inputValue()) === 'Written from About', `${where}: draft lost between About and feedback`);
  await context.setOffline(true);
  await send.click();
  await sheet.getByText(NOT_SENT).waitFor();
  check(posts.length === before, `${where}: offline send from About posted`);
  await context.setOffline(false);
  await sheet.getByRole('button', { name: /Close/ }).click();
  await aboutSheet.waitFor();
  check((await aboutSheet.innerText()).includes('What we receive'), `${where}: About not shown after closing feedback`);
  await aboutSheet.getByRole('button', { name: 'Done' }).click();
  await settings.waitFor();
  check(!(await aboutSheet.count()), `${where}: About still open after Done`);
  // Settings opened again later starts on Settings, not About.
  await settings.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Open profile and settings' }).click();
  await settings.waitFor();
  check(!(await aboutSheet.count()), `${where}: Settings reopened on About`);
  await settings.getByRole('button', { name: /Send feedback/ }).click();
  await sheet.waitFor();
  await box.fill('');
  await sheet.getByRole('button', { name: /Close/ }).click();
  await settings.waitFor();
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    // Every Firestore call is answered here; `answer` picks the reply for the next one.
    const posts = [];
    let answer = 200;
    let gate = null; // when set, the reply waits for it (a send in flight)
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const request = route.request();
      if (gate) await gate;
      check(request.url() === ENDPOINT, `${where}: unexpected Firestore URL ${request.url()}`);
      check(request.method() === 'POST', `${where}: Firestore call was ${request.method()}, not POST`);
      posts.push(JSON.parse(request.postData() ?? '{}'));
      await route.fulfill({
        status: answer,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: answer === 200 ? '{"name":"projects/home-strength/databases/(default)/documents/feedback/x"}' : '{"error":{"code":403}}',
      });
    });

    await onboard(page);

    // 1. Settings shows the entry; it opens an empty sheet with Send off.
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Training settings' });
    const entry = settings.getByRole('button', { name: /Send feedback/ });
    await entry.scrollIntoViewIfNeeded();
    check(await entry.isVisible(), `${where}: Settings has no Send feedback entry`);
    if (shots) { await settle(page); await page.screenshot({ path: join(shots, `255-settings-${where}.png`) }); }
    await entry.click();
    const sheet = page.getByRole('dialog', { name: 'Send feedback' });
    await sheet.waitFor();
    const box = sheet.getByLabel('What should we know?');
    const name = sheet.getByLabel('Your name (optional)');
    const send = sheet.getByRole('button', { name: 'Send', exact: true });
    check((await sheet.innerText()).includes(NOTE), `${where}: privacy line missing`);
    check(await send.isDisabled(), `${where}: Send is on with an empty box`);
    await box.fill('   ');
    check(await send.isDisabled(), `${where}: Send is on with only spaces`);
    await box.fill('');
    if (shots) { await settle(page); await page.screenshot({ path: join(shots, `255-sheet-empty-${where}.png`) }); }

    // 2. Offline: nothing is posted, the text stays, the story's line shows.
    await box.fill('The rest timer is too quiet');
    await name.fill('Sam');
    await context.setOffline(true);
    await send.click();
    await sheet.getByText(NOT_SENT).waitFor();
    check(posts.length === 0, `${where}: offline send still posted`);
    check((await box.inputValue()) === 'The rest timer is too quiet', `${where}: offline send lost the text`);
    if (shots) { await page.screenshot({ path: join(shots, `255-sheet-offline-${where}.png`) }); }
    await context.setOffline(false);

    // 3. A refused send (403) is also "Not sent" and keeps the text.
    answer = 403;
    await send.click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] .error-text')?.textContent?.includes('Not sent'));
    check(posts.length === 1, `${where}: refused send posted ${posts.length} times`);
    check((await box.inputValue()) === 'The rest timer is too quiet', `${where}: refused send lost the text`);

    // 4. Closing keeps the draft for this visit; nothing about it is stored.
    await sheet.getByRole('button', { name: /Close/ }).click();
    await settings.waitFor();
    await settings.getByRole('button', { name: /Send feedback/ }).click();
    await sheet.waitFor();
    check((await box.inputValue()) === 'The rest timer is too quiet', `${where}: closing the sheet lost the text`);
    // (#330) Reopening after a failed send shows no leftover "Not sent" line.
    check(!(await sheet.getByRole('alert').count()), `${where}: reopened sheet still shows Not sent`);
    const storedText = await page.evaluate(() => Object.keys(localStorage).some((key) => (localStorage.getItem(key) ?? '').includes('rest timer is too quiet')));
    check(!storedText, `${where}: the draft was written to storage`);

    // 5. Sent: thanks, the box clears, the name stays; the body is the rule's fields.
    answer = 200;
    await send.click();
    await sheet.getByText('Sent. Thanks.').waitFor();
    check((await box.inputValue()) === '', `${where}: box not cleared after send`);
    check(!(await sheet.getByText(NOT_SENT).count()), `${where}: Not sent still shows after a send`);
    if (shots) { await page.screenshot({ path: join(shots, `255-sheet-sent-${where}.png`) }); }
    const sent = posts.at(-1)?.fields ?? {};
    check(Object.keys(sent).every((key) => FIELDS.includes(key)), `${where}: extra field in ${Object.keys(sent)}`);
    check(sent.message?.stringValue === 'The rest timer is too quiet', `${where}: message ${JSON.stringify(sent.message)}`);
    check(sent.name?.stringValue === 'Sam', `${where}: name ${JSON.stringify(sent.name)}`);
    check(sent.screen?.stringValue === 'settings', `${where}: screen ${JSON.stringify(sent.screen)}`);
    check(sent.device?.stringValue === 'other', `${where}: device ${JSON.stringify(sent.device)}`);
    check(sent.workoutCount?.integerValue === '0', `${where}: workoutCount ${JSON.stringify(sent.workoutCount)}`);
    check(/^[0-9a-f]{7}$|^dev$/.test(sent.appVersion?.stringValue ?? ''), `${where}: appVersion ${JSON.stringify(sent.appVersion)}`);
    const stored = await page.evaluate((key) => localStorage.getItem(key), TESTER_KEY);
    check(stored && sent.testerId?.stringValue === stored, `${where}: testerId ${JSON.stringify(sent.testerId)} not the stored ${stored}`);

    // 5a. (#330) Reopening after a sent note shows no status line, twice over.
    for (let round = 1; round <= 2; round += 1) {
      await sheet.getByRole('button', { name: /Close/ }).click();
      await settings.getByRole('button', { name: /Send feedback/ }).click();
      await sheet.waitFor();
      if (shots && round === 1) { await settle(page); await page.screenshot({ path: join(shots, `330-reopen-after-sent-${where}.png`) }); }
      check(!(await sheet.getByText('Sent. Thanks.').count()), `${where}: reopen ${round} after a send still shows Sent. Thanks.`);
      check(((await sheet.getByRole('status').innerText()) ?? '').trim() === '', `${where}: reopen ${round} shows a status line`);
    }

    // 5b. A send in flight (review 1): fields lock, Send stays off across a close and reopen, the
    // note posts once, and its result reaches the reopened sheet without wiping a newer note.
    let release;
    gate = new Promise((resolve) => { release = resolve; });
    const before = posts.length;
    await box.fill('In flight note');
    await send.click();
    await sheet.getByRole('status').getByText('Sending…').waitFor();
    check(await box.evaluate((el) => el.readOnly), `${where}: box editable while sending`);
    check(await name.evaluate((el) => el.readOnly), `${where}: name editable while sending`);
    await box.press('End');
    await page.keyboard.type(' plus more');
    check((await box.inputValue()) === 'In flight note', `${where}: typing changed the box while sending`);
    await sheet.getByRole('button', { name: /Close/ }).click();
    await settings.getByRole('button', { name: /Send feedback/ }).click();
    await sheet.waitFor();
    check((await box.inputValue()) === 'In flight note', `${where}: reopened mid-send without the note`);
    check(await sheet.getByRole('button', { name: 'Sending…' }).isDisabled(), `${where}: Send on again after reopening mid-send`);
    await sheet.getByRole('button', { name: 'Sending…' }).click({ force: true }).catch(() => {});
    gate = null;
    release();
    await sheet.getByText('Sent. Thanks.').waitFor();
    check(posts.length === before + 1, `${where}: in-flight note posted ${posts.length - before} times`);
    check((await box.inputValue()) === '', `${where}: box not cleared after the in-flight send`);
    check((await name.inputValue()) === 'Sam', `${where}: name lost after the in-flight send`);
    await box.fill('A newer note');
    check(!(await sheet.getByText('Sent. Thanks.').count()), `${where}: Sent still shows after typing again`);

    // 5c. (#330) A rejected send ends as "Not sent" with the text kept, and the next send works.
    // A throwing AbortController makes sendFeedback's promise reject before any post.
    await page.evaluate(() => {
      window.__realAbortController = window.AbortController;
      window.AbortController = function Refused() { throw new Error('rejected send (#330 e2e)'); };
    });
    const beforeReject = posts.length;
    await send.click();
    const notSent = await sheet.getByText(NOT_SENT).waitFor({ timeout: 3000 }).then(() => true, () => false);
    check(notSent, `${where}: a rejected send did not end as Not sent`);
    if (!notSent) throw new Error(`feedback: stuck after a rejected send\n- ${failures.join('\n- ')}`);
    check((await box.inputValue()) === 'A newer note', `${where}: a rejected send lost the text`);
    check(!(await box.evaluate((el) => el.readOnly)), `${where}: box stayed read-only after a rejected send`);
    check(posts.length === beforeReject, `${where}: a rejected send posted`);
    await page.evaluate(() => { window.AbortController = window.__realAbortController; });
    await send.click();
    await sheet.getByText('Sent. Thanks.').waitFor({ timeout: 5000 }).catch(() => check(false, `${where}: send after a rejected one did not go`));
    check(posts.at(-1)?.fields?.message?.stringValue === 'A newer note', `${where}: send after a rejected one posted the wrong note`);
    await box.fill('');
    await sheet.getByRole('button', { name: /Close/ }).click();

    // 5d. (#253) Settings > About: one tap from Settings, Send feedback inside it opens the same
    // sheet with the draft kept, and closing it comes back to About; Done goes back to Settings.
    await about(page, settings, sheet, box, send, posts, where, context);

    await settings.getByRole('button', { name: 'Done' }).click();

    // 6. The recap after a workout has the entry; its note says recap and counts the workout.
    await finishToRecap(page);
    const recapEntry = page.getByRole('button', { name: 'Send feedback' });
    await recapEntry.scrollIntoViewIfNeeded();
    check(await recapEntry.isVisible(), `${where}: recap has no Send feedback entry`);
    if (shots) { await page.screenshot({ path: join(shots, `255-recap-${where}.png`) }); }
    await recapEntry.click();
    await sheet.waitFor();
    check((await name.inputValue()) === 'Sam', `${where}: name not kept for the visit`);
    await box.fill('Loved the warm-up sets');
    await send.click();
    await sheet.getByText('Sent. Thanks.').waitFor();
    const fromRecap = posts.at(-1)?.fields ?? {};
    check(fromRecap.screen?.stringValue === 'recap', `${where}: recap note screen ${JSON.stringify(fromRecap.screen)}`);
    check(fromRecap.workoutCount?.integerValue === '1', `${where}: recap workoutCount ${JSON.stringify(fromRecap.workoutCount)}`);
    check(fromRecap.testerId?.stringValue === stored, `${where}: tester ID changed between notes`);
    await sheet.getByRole('button', { name: /Close/ }).click();
    // (#330) Reopening from the recap after a sent note shows no status line.
    await recapEntry.click();
    await sheet.waitFor();
    check(!(await sheet.getByText('Sent. Thanks.').count()), `${where}: recap reopen still shows Sent. Thanks.`);
    await sheet.getByRole('button', { name: /Close/ }).click();
    check(await page.getByRole('button', { name: 'Back to Today' }).isVisible(), `${where}: closing from the recap left the recap`);

    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    check(keys.every((key) => key.startsWith('fitbod-clone-v1')), `${where}: unexpected storage keys ${keys}`);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // (#253, #342) 390x650 with the keyboard open on the note, from Settings, About and the recap.
  // Chromium cannot shrink the visual viewport without the layout, so a controllable visualViewport
  // stands in (lesson 16): the layout keeps its height and the keyboard covers the bottom 330px,
  // unshifted, partly shifted and fully shifted (iPhone). The test never scrolls for the app.
  {
    const where = '390x650-keyboard';
    const KB = 330;
    const context = await browser.newContext({ viewport: { width: 390, height: 650 } });
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '{"name":"projects/home-strength/databases/(default)/documents/feedback/x"}',
    }));
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
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const sheet = page.getByRole('dialog', { name: 'Send feedback' });
    const box = sheet.getByLabel('What should we know?');
    const send = sheet.getByRole('button', { name: 'Send', exact: true });
    const privacy = sheet.getByText(NOTE);
    const owns = (loc) => loc.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    });

    /** (#342) With the note focused and the keyboard up, Send and the box sit in the visible band. */
    async function keyboardChecks(from, typed) {
      await settleSheet(page);
      const closed = await send.boundingBox();
      for (const shift of [0, 120, KB]) {
        const tag = `${where} from ${from} (offsetTop ${shift})`;
        const top = shift;
        const bottom = 650 - KB + shift;
        await box.focus();
        await page.evaluate(([h, o]) => window.__fakeKeyboard(h, o), [650 - KB, shift]);
        await page.waitForTimeout(80);
        if (typed && shift === 0) await page.keyboard.type(typed);
        const s = await send.boundingBox();
        const b = await box.boundingBox();
        check(s && s.y >= top && s.y + s.height <= bottom, `${tag}: Send outside the visible band (y ${s && Math.round(s.y)}-${s && Math.round(s.y + s.height)}, band ${top}-${bottom})`);
        check(b && b.y < bottom && b.y + Math.min(b.height, 44) > top && b.y >= top, `${tag}: note box not in the visible band (y ${b && Math.round(b.y)}, band ${top}-${bottom})`);
        check(b && s && b.y < s.y, `${tag}: note box below Send`);
        // (#349) The privacy line sits above the box, fully in the band and clear of Send, while typing.
        const p = await privacy.boundingBox();
        check(p && p.y >= top && p.y + p.height <= bottom, `${tag}: privacy line outside the visible band (y ${p && Math.round(p.y)}-${p && Math.round(p.y + p.height)}, band ${top}-${bottom})`);
        check(p && b && s && p.y + p.height <= b.y && p.y + p.height <= s.y, `${tag}: privacy line not above the note box and Send`);
        const covered = await privacy.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
          return pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !(hit && (hit === el || el.contains(hit))); }).length;
        });
        check(covered === 0, `${tag}: privacy line partly covered (${covered} of 5 points)`);
        check(await owns(send), `${tag}: Send does not own its tap`);
        check(await owns(box), `${tag}: note box does not own its tap`);
        if (shots && from !== 'recap') { await page.screenshot({ path: join(shots, `342-feedback-keyboard-${from}${shift ? `-shifted${shift}` : ''}-390x650.png`) }); }
        await box.blur();
        await page.evaluate(() => window.__fakeKeyboard(null, 0));
        await page.waitForTimeout(80);
        // Keyboard closed again: Send goes back where it was.
        const back = await send.boundingBox();
        check(closed && back && Math.abs(back.y - closed.y) < 1 && Math.abs(back.x - closed.x) < 1, `${tag}: Send did not return after the keyboard closed (was y ${closed && Math.round(closed.y)}, now ${back && Math.round(back.y)})`);
      }
    }

    await onboard(page);
    // From Settings, with a long note that scrolls the box.
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Training settings' });
    const entry = settings.getByRole('button', { name: /Send feedback/ });
    await entry.scrollIntoViewIfNeeded();
    await entry.click();
    await sheet.waitFor();
    await box.fill(Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long note about the rest timer.`).join('\n'));
    check(await box.evaluate((el) => el.scrollHeight > el.clientHeight), `${where}: long note does not scroll the box`);
    await keyboardChecks('settings');
    await box.fill('');
    await sheet.getByRole('button', { name: /Close/ }).click();
    await settings.waitFor();

    // From About.
    const row = settings.getByRole('button', { name: 'About Home Strength' });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const aboutSheet = page.getByRole('dialog', { name: 'About Home Strength' });
    await aboutSheet.waitFor();
    await settleSheet(page);
    if (shots) { await page.screenshot({ path: join(shots, `253-about-top-390x650.png`) }); }
    await aboutSheet.getByRole('button', { name: 'Send feedback' }).click();
    await sheet.waitFor();
    await keyboardChecks('about', 'Typed with the keyboard open');
    await sheet.getByRole('button', { name: /Close/ }).click();
    await aboutSheet.waitFor();
    check((await aboutSheet.isVisible()), `${where}: closing feedback did not return to About`);
    await aboutSheet.getByRole('button', { name: 'Send feedback' }).click();
    await sheet.waitFor();
    check((await box.inputValue()) === 'Typed with the keyboard open', `${where}: draft typed with the keyboard open was lost`);
    await box.fill('');
    await sheet.getByRole('button', { name: /Close/ }).click();
    await aboutSheet.getByRole('button', { name: 'Done' }).click();
    await settings.getByRole('button', { name: 'Done' }).click();

    // From the recap, then the same sheet reopened after a send.
    await finishToRecap(page);
    const recapEntry = page.getByRole('button', { name: 'Send feedback' });
    await recapEntry.scrollIntoViewIfNeeded();
    await recapEntry.click();
    await sheet.waitFor();
    await keyboardChecks('recap', 'From the recap');
    await send.click();
    await sheet.getByText('Sent. Thanks.').waitFor();
    await sheet.getByRole('button', { name: /Close/ }).click();
    await recapEntry.click();
    await sheet.waitFor();
    await keyboardChecks('recap reopened after a send');
    await sheet.getByRole('button', { name: /Close/ }).click();

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`feedback: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('feedback: Settings, About and recap send, offline and refused keep the text, body matches the rules, About returns after feedback, 390x844, 360x780 and 390x650 keyboard');
