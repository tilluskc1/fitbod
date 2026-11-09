// The offline check (#251): open the built app once online, lose the network, open it again.
// The app must render (not a blank page), and exercise photos never loaded online must show
// the labelled placeholder. Runs at 390x844 and 360x780.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
//
// Uses an installed Playwright (local, global, or NODE_PATH); it is not a project dependency.
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
const server = await preview({ preview: { port: 4180, strictPort: false }, logLevel: 'silent' });
// Service workers need a secure context: localhost counts, 127.0.0.1 does too, but use the name.
const url = server.resolvedUrls.local[0].replace('127.0.0.1', 'localhost');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    // A fresh context is a first-time visitor: no worker, no cache, no stored data.
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    // 1. One online visit. Wait only until the worker is active, never for a second visit.
    await page.goto(url);
    await page.getByRole('button', { name: 'Get started' }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map((el) =>
        new URL(el.getAttribute('src') ?? el.getAttribute('href'), location.href).pathname,
      ),
    );
    const cached = await page.evaluate(async (paths) => {
      const hits = await Promise.all(paths.map((path) => caches.match(path)));
      return paths.filter((_, i) => hits[i]);
    }, scripts);
    check(scripts.length >= 2, `${where}: expected the page to reference built JS and CSS, got ${scripts}`);
    check(cached.length === scripts.length, `${where}: after one visit, cached ${cached} of ${scripts}`);

    // 2. Offline, open again (a reload is a navigation through the worker).
    await context.setOffline(true);
    await page.reload();
    const opened = await page
      .getByRole('button', { name: 'Get started' })
      .waitFor({ timeout: 8000 })
      .then(() => true, () => false);
    check(opened, `${where}: offline reload did not render the app`);
    const text = (await page.locator('body').innerText()).trim();
    check(text.length > 20, `${where}: offline page is blank`);

    // 3. Still offline, onboard: Today shows exercise photos that were never fetched online.
    if (opened) {
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
      const placeholder = await page
        .locator('.photo-fallback')
        .first()
        .waitFor({ timeout: 8000 })
        .then(() => true, () => false);
      check(placeholder, `${where}: no labelled placeholder for an uncached exercise photo offline`);
      const labelled = await page.locator('.photo[role="img"][aria-label$="demonstration"]').count();
      check(labelled > 0, `${where}: photo slots lost their label`);
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `offline-${where}.png`) });
    }

    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`offline-first-visit: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('offline-first-visit: pass at 390x844 and 360x780');
