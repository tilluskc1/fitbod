// Ad-hoc layout check for #428 (the tab bar's centre button no longer starts a workout; it opens
// "Plan today with me"). Not part of the standing e2e suite: a one-off check for this story's
// screenshots, at the owner's requested sizes, light and dark, Chromium and WebKit.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { preview } from 'vite';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  }
}

const { chromium, webkit } = await loadPlaywright();
const server = await preview({ preview: { port: 4228, strictPort: false }, logLevel: 'silent' });
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

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const nothingClipped = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
}, selector);

const SIZES = [[360, 780], [390, 844], [430, 932], [768, 1024], [1280, 900]];

for (const engineName of ['chromium', 'webkit']) {
  const engine = engineName === 'chromium' ? chromium : webkit;
  const browser = await engine.launch();
  try {
    for (const [width, height] of SIZES) {
      for (const scheme of ['light', 'dark']) {
        const where = `${engineName} ${width}x${height} ${scheme}`;
        const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await onboard(page);

        check(await noSidewaysScroll(page), `${where}: sideways scroll on Today`);
        check(await nothingClipped(page, '.tabbar'), `${where}: tab bar clipped`);
        check(await nothingClipped(page, '.tab-action'), `${where}: centre action button clipped`);
        const label = await page.getByRole('button', { name: 'Plan today with me', exact: true }).getAttribute('aria-label');
        check(label === 'Plan today with me', `${where}: centre button aria-label is "${label}"`);
        const micIcon = await page.locator('.tab-action .tab-action__play').innerText().catch(() => '');
        check(micIcon.trim() === 'mic', `${where}: centre button icon is "${micIcon.trim()}", not mic`);
        if (width === 390 && scheme === 'light' && engineName === 'chromium') {
          await page.screenshot({ path: join(shots ?? '/tmp/e2e-shots-428', `428-today-${width}x${height}-${scheme}.png`) });
        }
        if ((width === 390 || width === 360) && engineName === 'chromium') {
          await page.screenshot({ path: join(shots ?? '/tmp/e2e-shots-428', `428-today-${width}x${height}-${scheme}.png`) });
        }

        await page.getByRole('button', { name: 'Plan today with me', exact: true }).click();
        await page.waitForSelector('.sheet-backdrop, .t7-card.tt h2', { timeout: 5000 }).catch(() => {});
        // The sheet's 220ms "rise" animation starts translateY(18px): let it settle before measuring.
        await page.waitForTimeout(300);
        const voiceSheetUp = (await page.locator('.sheet-backdrop').count()) > 0;
        check(await nothingClipped(page, voiceSheetUp ? '.sheet' : '.t7-card.tt'),
          `${where}: the opened helper (${voiceSheetUp ? 'voice sheet' : 'tap fallback'}) is clipped`);
        check(await noSidewaysScroll(page), `${where}: sideways scroll after opening the helper`);
        if ((width === 390 || width === 360) && engineName === 'chromium') {
          await page.screenshot({ path: join(shots ?? '/tmp/e2e-shots-428', `428-helper-${width}x${height}-${scheme}.png`) });
        }
        check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

await server.close();

if (failures.length) {
  console.error(`layout-check-428: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('layout-check-428: ok at 360x780, 390x844, 430x932, 768x1024 and 1280x900, light and dark, Chromium and WebKit');
