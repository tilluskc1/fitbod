// The name-tap Start over check (#292): tapping the name (or avatar) on Today opens Settings with
// the name and a red "Start over on this device" row in view without scrolling. The row opens a
// sheet that leads with saving: a cancelled or failed backup erases nothing, a backup that left
// the app is recorded in localStorage, and erasing takes two taps. Runs at 390x844, 360x780 and 390x650.
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
const server = await preview({ preview: { port: 4189, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const KEY = 'fitbod-clone-v1';
const failures = [];
/** A screenshot once every sheet animation has settled, so shots never catch a slide-in. */
async function shot(page, name) {
  if (!shots) return;
  // Finite animations only: a looping one (a pulse, a photo loop) never finishes.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  await page.screenshot({ path: join(shots, name) });
}
const check = (ok, message) => { if (!ok) failures.push(message); };

async function onboard(page, name) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  if (name) await page.getByPlaceholder('Your first name').fill(name);
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

/** Every key this origin holds, as stored. */
const dump = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
const stored = async (page) => JSON.parse((await dump(page))[KEY] ?? 'null')?.state ?? null;

/** The row is fully inside the visible band, with no scroll of the sheet or page. */
async function inView(page, locator, height) {
  const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
  const scrolled = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    return window.scrollY + (sheet ? sheet.scrollTop : 0);
  });
  return Boolean(box) && box.y >= 0 && box.y + box.height <= height && scrolled === 0;
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    // The Share sheet, controlled per step: 'abort' (closed), 'fail' (refused), 'ok' (shared).
    await context.addInitScript(() => {
      window.__share = 'ok';
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          if (window.__share === 'abort') throw new DOMException('closed', 'AbortError');
          if (window.__share === 'fail') throw new Error('NotAllowedError');
        },
      });
    });
    const page = await context.newPage();
    await onboard(page, 'Sam');

    // 1. Tapping the name (not only the avatar) opens Settings with the block in view.
    await page.locator('.today__name').click();
    const row = page.getByRole('button', { name: /Start over on this device/ });
    await row.waitFor({ timeout: 3000 }).catch(() => {});
    check(await row.count() === 1, `${where}: Settings has ${await row.count()} Start over rows, want 1`);
    check(await inView(page, row.first(), height), `${where}: Start over is not in view without scrolling after the name tap`);
    const block = page.locator('.settings-profile');
    check((await block.innerText().catch(() => '')).includes('Sam'), `${where}: profile block does not show the name`);
    const rowText = await row.first().innerText().catch(() => '');
    check(/erases this phone's workouts/.test(rowText), `${where}: row subtitle does not say what gets erased ("${rowText}")`);
    check(!/(^|\. )(log|sign) ?out\b/i.test(rowText.replace("No account to log out of", '')), `${where}: row offers to log out`);
    await shot(page, `292-settings-${where}.png`);

    // 2. The row opens the sheet that leads with saving.
    const before = await dump(page);
    await row.first().click();
    const sheet = page.locator('.sheet');
    check(await page.getByRole('heading', { name: 'Save your progress first?' }).isVisible().catch(() => false), `${where}: sheet does not lead with "Save your progress first?"`);
    check((await sheet.innerText()).includes('Last backup: never'), `${where}: sheet does not say "Last backup: never"`);
    const backup = sheet.getByRole('button', { name: 'Back up now' });
    check(/\bprimary\b/.test(await backup.getAttribute('class')), `${where}: Back up now is not the primary button`);
    check(await sheet.getByRole('button', { name: 'Erase without saving' }).isVisible(), `${where}: no "Erase without saving" before a backup`);
    await shot(page, `292-sheet-${where}.png`);

    // 3. A cancelled backup says so and changes nothing stored.
    await page.evaluate(() => { window.__share = 'abort'; });
    await backup.click();
    await page.waitForTimeout(150);
    check((await sheet.innerText()).includes('Backup cancelled. Nothing was erased.'), `${where}: a cancelled backup is not reported`);
    check(JSON.stringify(await dump(page)) === JSON.stringify(before), `${where}: a cancelled backup changed localStorage`);
    check(await sheet.getByRole('button', { name: 'Erase without saving' }).isVisible(), `${where}: a cancelled backup counts as saved`);

    // 4. A failed backup says so and changes nothing stored.
    await page.evaluate(() => { window.__share = 'fail'; });
    await backup.click();
    await page.waitForTimeout(150);
    const failed = await sheet.innerText();
    check(/Backup not shared/.test(failed) && failed.includes('Nothing was erased.'), `${where}: a failed backup is not reported`);
    check(JSON.stringify(await dump(page)) === JSON.stringify(before), `${where}: a failed backup changed localStorage`);
    await shot(page, `292-sheet-failed-${where}.png`);

    // 5. A backup that left the app is recorded; the erase button then says what it erases.
    await page.evaluate(() => { window.__share = 'ok'; });
    await backup.click();
    const erase = sheet.getByRole('button', { name: "Erase this phone's data" });
    await erase.waitFor({ timeout: 3000 }).catch(() => {});
    const saved = await stored(page);
    check(typeof saved?.lastBackupAt === 'string', `${where}: a shared backup was not recorded in localStorage`);
    const shared = await sheet.innerText();
    check(/Last backup: (?!never)\S/.test(shared) && shared.includes('Backup shared.'), `${where}: sheet still reads "Last backup: never" or hides "Backup shared." after a backup`);
    check(await erase.isVisible(), `${where}: no "Erase this phone's data" after a backup`);

    // 6. Two taps: the first only asks; data is still stored.
    await erase.click();
    check(await page.getByRole('heading', { name: 'Erase everything?' }).isVisible(), `${where}: the red confirm did not follow`);
    check((await stored(page))?.profile?.name === 'Sam', `${where}: one tap erased data`);
    await shot(page, `292-confirm-${where}.png`);
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await page.getByRole('button', { name: 'Get started' }).waitFor({ timeout: 5000 }).catch(() => {});
    check(await page.getByRole('button', { name: 'Get started' }).isVisible(), `${where}: erasing did not open onboarding`);
    const after = await dump(page);
    check(!Object.keys(after).some((key) => key.startsWith(KEY)), `${where}: app keys left after erasing: ${Object.keys(after).join(', ')}`);
    await context.close();

    // 7. A profile with no name: the block says "You".
    const blank = await browser.newContext({ viewport: { width, height } });
    const nameless = await blank.newPage();
    await onboard(nameless, '');
    await nameless.evaluate((key) => {
      const record = JSON.parse(localStorage.getItem(key));
      delete record.state.profile.name;
      localStorage.setItem(key, JSON.stringify(record));
    }, KEY);
    await nameless.reload();
    await nameless.getByRole('button', { name: 'Open profile and settings' }).click();
    const youBlock = nameless.locator('.settings-profile');
    await youBlock.waitFor({ timeout: 3000 }).catch(() => {});
    check((await youBlock.innerText().catch(() => '')).split('\n')[0].trim() === 'You', `${where}: nameless block does not show "You"`);
    await blank.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`name-start-over: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('name-start-over: pass at 390x844, 360x780 and 390x650');
