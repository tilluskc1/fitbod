// The Send feedback check (#255): Settings and the recap open one sheet; offline and a refused send
// keep the text and say "Not sent"; a sent note clears the box and says thanks. The Firestore endpoint
// is mocked with context.route (every firestore.googleapis.com call), so this never writes to the real
// database; a call to any other URL or method there is a failure.
// Checks the posted body: rule field names, screen, workout count, one tester ID kept per phone.
// #330: reopening clears a leftover Sent / Not sent line (mid-send keeps Sending…); a rejected send
// ends as Not sent with the text kept. 390x844 and 360x780.
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
    check((await sheet.innerText()).includes(NOTE), `${where}: privacy line missing under the box`);
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
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`feedback: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('feedback: Settings and recap send, offline and refused keep the text, body matches the rules, 390x844 and 360x780');
