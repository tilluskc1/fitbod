// The safety notice check (#252): on onboarding's last step the notice is fully on screen, above
// Build my plan, on first render, for At a gym and At home, at 390x844, 360x780 and 390x650.
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
const server = await preview({ preview: { port: 4185, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    for (const place of ['At a gym', 'At home']) {
      const where = `${width}x${height} ${place}`;
      const page = await browser.newPage({ viewport: { width, height } });
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
      await page.getByRole('button', { name: place }).click();
      const notice = await page.locator('.onboarding-safety').boundingBox();
      const build = await page.getByRole('button', { name: 'Build my plan' }).boundingBox();
      check(Boolean(notice && build), `${where}: notice or Build my plan missing`);
      if (notice && build) {
        check(notice.y >= 0 && notice.y + notice.height <= build.y, `${where}: notice (y ${Math.round(notice.y)}-${Math.round(notice.y + notice.height)}) not fully above Build my plan (y ${Math.round(build.y)})`);
        check(build.y + build.height <= height, `${where}: Build my plan off screen`);
      }
      const text = await page.locator('.onboarding-safety').innerText();
      check(text.startsWith('Strength training carries risk.'), `${where}: notice text "${text}"`);
      if (shots) await page.screenshot({ path: join(shots, `252-onboarding-${width}x${height}-${place === 'At home' ? 'home' : 'gym'}.png`) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`safety-notice: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('safety-notice: pass at 390x844, 360x780 and 390x650, gym and home');
