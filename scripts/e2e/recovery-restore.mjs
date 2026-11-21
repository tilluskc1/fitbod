// After a Recovery restore the app opens on Today with the restored plan, not the splash (#285);
// Start fresh still opens on the splash. 390x844 and 360x780.
// (#390) Restore and Start fresh both keep the unreadable original in corrupt-backup first, and a record
// stored with an overnight rest pause (restPausedMs over 24 h) opens normally instead of on Recovery.
// (#395) When that copy cannot be written (storage full), Restore and Start fresh stop: the original stays
// byte-identical and one line says nothing was changed. (#412) Download original does not unlock Restore; only a kept copy does.
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
const server = await preview({ preview: { port: 4191, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };


const shot = (page, name, where) => shots && page.screenshot({ path: join(shots, `285-${name}-${where}.png`) });
const KEY = 'fitbod-clone-v1';
const BACKUP_KEY = 'fitbod-clone-v1:corrupt-backup';
const backupText = (page) => page.evaluate((key) => localStorage.getItem(key), BACKUP_KEY);
const storedText = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const COPY_FAILED = "Couldn't save a safety copy of your old data, so nothing was changed.";

/** (#395) A nearly full phone: writing the safety copy throws, every other key still saves. Lasts until a reload. */
const fillStorage = (page) => page.evaluate((key) => {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    if (name === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return setItem.call(this, name, value);
  };
}, BACKUP_KEY);

const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
  .map((a) => a.finished.catch(() => {}))));

const shot395 = async (page, where) => {
  if (!shots) return;
  await settle(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(shots, `395-copy-failed-${where}.png`) });
};

async function onboard(page) {
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

/** Corrupt the stored data and reload, so the app opens on Recovery. */
async function corrupt(page, text = '{not json') {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, text]);
  await page.reload();
  await page.waitForSelector('.recovery');
}

const onSplash = async (page) => (await page.getByRole('button', { name: 'Get started' }).count()) > 0;

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await onboard(page);
    const backup = await page.evaluate((key) => localStorage.getItem(key), KEY);

    // (#395) Storage full, an older safety copy already kept. Restore stops: nothing is overwritten.
    const FULL = '{not json: storage full';
    const chooseBackup = () => page.locator('.recovery-restore input[type=file]').setInputFiles({ name: 'strength-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    const line = page.getByRole('alert').filter({ hasText: COPY_FAILED });
    const stoppedOnRecovery = async (action) => {
      check(await page.locator('.recovery').isVisible().catch(() => false), `${where}: ${action} left Recovery although no copy was kept (#395)`);
      check(await storedText(page) === FULL, `${where}: ${action} overwrote the original although no copy was kept (#395)`);
      check(await backupText(page) === '{older copy', `${where}: ${action} changed the older safety copy (#395)`);
      check(await line.isVisible().catch(() => false), `${where}: ${action} does not show "${COPY_FAILED}" (#395)`);
      check(await page.getByRole('button', { name: 'Download original' }).isVisible().catch(() => false), `${where}: Download original is gone after ${action} stopped (#395)`);
    };
    await page.evaluate((key) => localStorage.setItem(key, '{older copy'), BACKUP_KEY);
    await corrupt(page, FULL);
    await fillStorage(page);
    await chooseBackup();
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await page.waitForTimeout(300);
    await shot395(page, where);
    await stoppedOnRecovery('Restore');

    // Start fresh stops the same way, and its sheet closes so the line shows.
    await corrupt(page, FULL);
    await fillStorage(page);
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start fresh' }).click();
    await page.waitForTimeout(300);
    check(await page.getByRole('dialog').count() === 0, `${where}: the Start fresh sheet stays over the line (#395)`);
    await stoppedOnRecovery('Start fresh');

    // (#412) Download original no longer counts as the copy: Restore still stops while storage is full.
    await corrupt(page, FULL);
    await fillStorage(page);
    await chooseBackup();
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await page.waitForTimeout(300);
    await stoppedOnRecovery('Restore');
    // The warning stays until a copy saves: tapping Download original does not hide it.
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByRole('button', { name: 'Download original' }).click()]);
    check(await line.isVisible().catch(() => false), `${where}: Download original hid the copy-failed line (#414)`);
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await page.waitForTimeout(300);
    await stoppedOnRecovery('Restore after Download original');

    // A restore from Recovery opens on Today with the restored plan, never the splash (#285).
    await page.evaluate((key) => localStorage.removeItem(key), BACKUP_KEY);
    await corrupt(page, '{not json: restore');
    await shot(page, 'recovery', where);
    await page.locator('.recovery-restore input[type=file]').setInputFiles({ name: 'strength-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await page.waitForSelector('.t7-hero, .splash, .onboarding-top', { timeout: 5000 }).catch(() => {});
    check(!(await onSplash(page)), `${where}: the splash shows after a Recovery restore`);
    check(await page.locator('.t7-hero').isVisible().catch(() => false), `${where}: Today is not showing after a Recovery restore`);
    check(await page.getByText('Sam.').first().isVisible().catch(() => false), `${where}: the restored profile is not on Today`);
    check(await page.getByText(/^Restored \d+ workouts?\.$/).first().isVisible().catch(() => false), `${where}: the restore message is not showing`);
    await shot(page, 'restored-today', where);
    check(await backupText(page) === '{not json: restore', `${where}: Restore did not keep the original in corrupt-backup (#390)`);

    // The restore was saved: a reload stays on Today.
    await page.reload();
    await page.waitForSelector('.t7-hero, .recovery, .splash', { timeout: 5000 }).catch(() => {});
    check(!(await onSplash(page)) && (await page.locator('.t7-hero').isVisible().catch(() => false)), `${where}: a reload after the restore does not open on Today`);

    // Start fresh still begins at the splash: the data is empty, so onboarding comes next.
    // (#390) An overnight rest pause stored before the cap (current and history) opens normally.
    const overnight = await page.evaluate((key) => {
      const envelope = JSON.parse(localStorage.getItem(key));
      const workout = (id, status) => ({
        id, date: '2026-11-12T18:00:00.000Z', name: 'Full Body', dayIndex: 0, status, completedEarly: true,
        endedAt: status === 'completed' ? '2026-11-13T19:30:00.000Z' : null, restStartedAt: '2026-11-12T18:00:00.000Z',
        restSeconds: 75, restPausedAt: null, restPausedMs: 89_910_000,
        exercises: [{ exerciseId: 'goblet-squat', name: 'Goblet Squat', planned: [{ weight: 20, reps: 10 }], performed: [{ weight: 20, reps: 10, done: true, completedAt: '2026-11-12T18:00:00.000Z' }] }],
      });
      envelope.state.history = [workout('h-390', 'completed')];
      envelope.state.current = workout('c-390', 'active');
      localStorage.setItem(key, JSON.stringify(envelope));
      return envelope.state.history.length;
    }, KEY);
    await page.reload();
    await page.waitForSelector('.t7-hero, .recovery, .splash, .logger, main', { timeout: 5000 }).catch(() => {});
    check(overnight === 1 && (await page.locator('.recovery').count()) === 0, `${where}: a stored overnight rest pause opens on Recovery (#390)`);

    await corrupt(page, '{not json: fresh');
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start fresh' }).click();
    await page.waitForTimeout(300);
    check(await onSplash(page), `${where}: Start fresh does not open on the splash`);
    check(await backupText(page) === '{not json: fresh', `${where}: Start fresh did not keep the original in corrupt-backup`);
    await shot(page, 'start-fresh', where);

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`recovery-restore: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('recovery-restore: pass at 390x844 and 360x780');
