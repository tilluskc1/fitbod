// The voice planner check (#426): "Plan today with me" has a small, subtle mic entry point next
// to the existing button. Tapping it opens a listening sheet, then (R1) hides the mic for the rest
// of the session on a start error, an unsupported browser or a permission denial — never on a
// silent timeout, which instead offers "Try again" / "Use the chips instead". A heard sentence with
// pain goes straight to the existing sore step; anything else shows "Here's what I heard" with four
// tap-to-fix slots (Time/Sore/Train/Gear) and a cardio notice that is display-only, never stored.
// Every reading goes through the same parser typed text uses (`talkParse`/`composeTalk`), so this
// check only needs to confirm voice reaches that engine and the UI reacts to it — not re-prove the
// parser, which `tests/todayTalk.test.ts` already covers.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//
// Set E2E_SHOTS=<dir> to also save a screenshot of every step, in Chromium and WebKit.
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

const { chromium, webkit } = await loadPlaywright();
const server = await preview({ preview: { port: 4185, strictPort: false }, logLevel: 'silent' });
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
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

/** A fake SpeechRecognition the page's own code drives; the test only calls the hooks it leaves on window. */
function installFakeRecognition(ctorName) {
  window.__voice = { lastError: null };
  class FakeRecognition {
    start() { window.__voiceLive = this; }
    stop() { this.onend?.(); }
    abort() {}
  }
  window[ctorName] = FakeRecognition;
  window.__voiceSay = (text) => {
    window.__voiceLive.onresult?.({ results: [{ 0: { transcript: text } }] });
  };
  window.__voiceEnd = () => { window.__voiceLive.onend?.(); };
  window.__voiceError = (error) => { window.__voiceLive.onerror?.({ error }); };
}

async function shot(page, name) {
  if (!shots) return;
  await page.waitForTimeout(300); // let the sheet's 220ms rise / 160ms fade settle first
  await page.screenshot({ path: join(shots, `426-${name}.png`) });
}

/** Opens the sheet and waits for the effect that wires up `window.__voiceLive`, so a fired event always hits the live recognizer. */
async function openListening(page, mic) {
  await mic.click();
  await page.locator('text=Listening…').waitFor();
}

async function voiceFlow(browser, where) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(installFakeRecognition, 'SpeechRecognition');
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await onboard(page);

  const mic = page.locator('.tt-mic');
  check(await mic.isVisible(), `${where}: mic entry not shown when SpeechRecognition exists`);
  const micBox = await mic.boundingBox();
  const openBox = await page.locator('.tt-open').boundingBox();
  check(micBox.width <= 44 && micBox.height <= 44, `${where}: mic is ${micBox.width}x${micBox.height}, want small (<=44px)`);
  check(Math.abs(micBox.y - openBox.y) < openBox.height, `${where}: mic not beside the main entry`);
  check(await page.getByText("Voice uses your browser's speech service.").isVisible(), `${where}: R2 disclosure not shown near the mic`);
  await shot(page, `${where}-today`);

  // Heard: a sentence with sore (not pain) and a cardio word goes to the "heard you" card.
  await openListening(page, mic);
  await shot(page, `${where}-listening`);
  await page.evaluate(() => window.__voiceSay('thirty minutes, lower back is a bit sore, some biking and upper body'));
  await page.evaluate(() => window.__voiceEnd());
  await page.locator("text=Here's what I heard").waitFor();
  check(await page.getByText('“thirty minutes, lower back is a bit sore, some biking and upper body”').isVisible(), `${where}: transcript not shown`);
  check(await page.getByText('Biking noted — not tracked.').isVisible(), `${where}: cardio notice missing`);
  check(await page.locator('.tt-voice-slot__value').getByText('30 min').isVisible(), `${where}: Time slot wrong`);
  check(await page.locator('.tt-voice-slot__value').getByText('Back', { exact: true }).isVisible(), `${where}: Sore slot wrong`);
  await shot(page, `${where}-heard`);

  // Tapping a slot opens that question, seeded, instead of building straight away.
  await page.getByText('Time', { exact: true }).locator('xpath=..').click();
  await page.locator('.tt h2:has-text("How long do you have?")').waitFor();
  await shot(page, `${where}-slot-time`);
  await page.locator('.tt-nav .secondary').click(); // Cancel back to Today
  await page.locator('.tt-open').waitFor();

  // Yes, build it: builds straight to the summary, Back excluded by the sore reading.
  await openListening(page, mic);
  await page.evaluate(() => window.__voiceSay('thirty minutes, lower back is a bit sore, some biking and upper body'));
  await page.evaluate(() => window.__voiceEnd());
  await page.getByRole('button', { name: 'Yes, build it' }).click();
  await page.getByRole('button', { name: 'Start this workout' }).waitFor();
  check(!(await page.getByText('Back', { exact: true }).isVisible().catch(() => false)), `${where}: sore Back still offered to train`);
  await shot(page, `${where}-summary`);
  await page.getByRole('button', { name: 'Change answers' }).click();
  await page.locator('.tt-nav .secondary').click();
  await page.locator('.tt-open').waitFor();

  // Pain skips the heard-you card and goes straight to the existing sore step.
  await openListening(page, mic);
  await page.evaluate(() => window.__voiceSay('my knee hurts'));
  await page.evaluate(() => window.__voiceEnd());
  await page.locator('.tt h2:has-text("Anything sore or hurting?")').waitFor();
  check(!(await page.getByText("Here's what I heard").isVisible().catch(() => false)), `${where}: pain shown a heard-you card instead of the sore step`);
  await shot(page, `${where}-pain`);
  await page.locator('.tt-nav .secondary').click(); // "Back" from sore (index 1) to time (index 0)
  await page.locator('.tt-nav .secondary').click(); // "Cancel" from time (index 0) closes the planner
  await page.locator('.tt-open').waitFor();

  // A silent timeout (no result at all) offers Try again / Use the chips instead; the mic stays.
  await openListening(page, mic);
  await page.evaluate(() => window.__voiceEnd());
  await page.getByRole('heading', { name: "Didn't catch that" }).waitFor();
  await shot(page, `${where}-empty`);
  await page.getByRole('button', { name: 'Use the chips instead' }).click();
  await page.locator('.tt h2:has-text("How long do you have?")').waitFor();
  await page.locator('.tt-nav .secondary').click();
  await page.locator('.tt-open').waitFor();
  check(await mic.isVisible(), `${where}: mic hidden after a silent timeout (should only hide on a real failure)`);

  // A permission denial hides the mic for the rest of the session.
  await openListening(page, mic);
  await page.evaluate(() => window.__voiceError('not-allowed'));
  await page.locator('.tt-open').waitFor();
  await mic.waitFor({ state: 'hidden' }).catch(() => {});
  check(!(await mic.isVisible().catch(() => false)), `${where}: mic still shown after a permission denial`);

  check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
  await page.close();
}

/** A chip tap left over from an earlier, cancelled chip session must still show in the heard-you
 * card — and match what "Yes, build it" actually builds. Regression: the card used to read
 * `NO_TAPS` instead of the real taps/text, so it could show different values than the build. */
async function staleTaps(browser, where) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(installFakeRecognition, 'SpeechRecognition');
  await onboard(page);
  const mic = page.locator('.tt-mic');

  await page.locator('.tt-open').click();
  await page.locator('.tt h2:has-text("How long do you have?")').waitFor();
  await page.locator('[role="group"][aria-label="Time"]').getByText('20 min', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.tt h2:has-text("Anything sore or hurting?")').waitFor();
  await page.locator('[role="group"][aria-label="Sore or hurting"]').getByText('Back', { exact: true }).click();
  await page.locator('.tt-nav .secondary').click(); // Back: sore (index 1) to time (index 0)
  await page.locator('.tt-nav .secondary').click(); // Cancel: time (index 0) closes the planner
  await page.locator('.tt-open').waitFor();

  await openListening(page, mic);
  await page.evaluate(() => window.__voiceSay('legs'));
  await page.evaluate(() => window.__voiceEnd());
  await page.locator("text=Here's what I heard").waitFor();
  check(await page.locator('.tt-voice-slot__value').getByText('20 min').isVisible(), `${where}: heard-you card dropped the earlier 20 min tap`);
  check(await page.locator('.tt-voice-slot__value').getByText('Back', { exact: true }).isVisible(), `${where}: heard-you card dropped the earlier Back tap`);
  check(await page.locator('.tt-voice-slot__value').getByText('Legs', { exact: true }).isVisible(), `${where}: heard-you card missing Legs from "legs"`);
  await page.getByRole('button', { name: 'Yes, build it' }).click();
  await page.getByRole('button', { name: 'Start this workout' }).waitFor();
  // `.tt-line` echoes `talk.minutes` verbatim (unlike `.tt-meta`, which shows the adapted/approx
  // exercise time), so it proves the build used the same 20-minute tap the card showed.
  check(await page.locator('.tt-line').getByText('20 min').isVisible(), `${where}: built plan did not use the 20 min tap the card showed`);
  await shot(page, `${where}-stale-taps-summary`);
  await page.close();
}

/** A real browser's `onend` can fire right after `onerror`; the network message must survive it
 * instead of getting overwritten by the generic "Didn't catch that" (the fake recognizer normally
 * fires only one or the other, so this drives both explicitly to reproduce the real sequencing). */
async function errorThenEnd(browser, where) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(installFakeRecognition, 'SpeechRecognition');
  await onboard(page);
  const mic = page.locator('.tt-mic');

  await openListening(page, mic);
  await page.evaluate(() => window.__voiceError('network'));
  await page.getByRole('heading', { name: "Didn't catch that" }).waitFor();
  await page.evaluate(() => window.__voiceEnd());
  await page.waitForTimeout(100); // lets a regression's setState (onend overwriting the stage) settle before the check below
  check(await page.getByText("Voice needs your browser's speech service online.").isVisible().catch(() => false),
    `${where}: onend after onerror overwrote the network message`);
  await page.close();
}

async function noSupport(browser, where) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Real Chromium ships its own webkitSpeechRecognition; R1 needs the true no-support case, so remove both.
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await onboard(page);
  check(!(await page.locator('.tt-mic').isVisible().catch(() => false)), `${where}: mic shown with no SpeechRecognition constructor`);
  await page.locator('.tt-open').click();
  await page.locator('.tt h2').waitFor();
  check(true, `${where}: chips still reachable with no voice support`);
  await page.close();
}

async function layoutShots(browser, label) {
  for (const [width, height] of [[360, 780], [390, 844], [430, 932], [768, 1024], [1280, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(installFakeRecognition, 'SpeechRecognition');
    await onboard(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `${label} ${width}x${height}: sideways scroll on Today with the mic shown`);
    await shot(page, `${label}-${width}x${height}-today`);
    await page.locator('.tt-mic').click();
    await page.evaluate(() => window.__voiceSay('thirty minutes, upper body'));
    await page.evaluate(() => window.__voiceEnd());
    await page.locator("text=Here's what I heard").waitFor();
    const overflowSheet = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflowSheet, `${label} ${width}x${height}: sideways scroll on the heard-you sheet`);
    await shot(page, `${label}-${width}x${height}-heard`);
    await page.close();
  }
}

// CI sets E2E_SHOTS for every group (screenshot artifacts) and installs WebKit too (checks.yml,
// #435), so this always runs both there; a local shot pass without E2E_SHOTS skips WebKit.
const chromiumBrowser = await chromium.launch();
const webkitBrowser = shots ? await webkit.launch() : null;
try {
  await voiceFlow(chromiumBrowser, 'chromium');
  await staleTaps(chromiumBrowser, 'chromium-stale-taps');
  await errorThenEnd(chromiumBrowser, 'chromium-error-then-end');
  await noSupport(chromiumBrowser, 'chromium-no-support');
  await layoutShots(chromiumBrowser, 'chromium');
  if (webkitBrowser) await layoutShots(webkitBrowser, 'webkit');
} finally {
  await chromiumBrowser.close();
  if (webkitBrowser) await webkitBrowser.close();
  await server.close();
}

if (failures.length) {
  console.error(`voice-plan-426: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('voice-plan-426: pass — mic entry, R2 disclosure, listening, heard-you slots, stale taps match the build, a network error surviving onend, pain bypass, silent timeout vs. real failure, no-support fallback, and layout at 360/390/430/tablet/desktop in Chromium and WebKit');
