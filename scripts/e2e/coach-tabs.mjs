// The Coach check (#257): no demo chat. Coach opens to Your review, both tabs show content, and
// no "demo", "scripted" or "server-side" copy is in the built app or on screen. 390x844 and 360x780.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

// The built bundle, so nothing reachable in production says it.
for (const file of readdirSync('dist/assets').filter((name) => name.endsWith('.js'))) {
  const js = readFileSync(join('dist/assets', file), 'utf8');
  for (const phrase of ['Scripted demo', 'COACH DEMO', 'Send to demo', 'server-side', 'Talk to coach', 'demo coach']) {
    check(!js.includes(phrase), `dist/assets/${file} still contains "${phrase}"`);
  }
}

const { chromium } = await loadPlaywright();
const server = await preview({ preview: { port: 4188, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
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
    await page.getByRole('button', { name: 'Coach' }).click();

    const tabs = await page.getByRole('tab').allInnerTexts();
    check(JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['Your review', 'What I know']), `${where}: tabs are ${JSON.stringify(tabs)}`);
    check((await page.getByRole('tab', { name: 'Your review' }).getAttribute('aria-selected')) === 'true', `${where}: Coach does not open to Your review`);
    const review = (await page.locator('.screen').innerText()).trim();
    check(review.length > 120, `${where}: Your review is empty`);
    check(!/demo|scripted|server-side/i.test(review), `${where}: Your review mentions a demo`);
    if (shots) await page.screenshot({ path: join(shots, `257-review-${where}.png`), fullPage: false });

    await page.getByRole('tab', { name: 'What I know' }).click();
    const memory = (await page.locator('.screen').innerText()).trim();
    check(memory.length > 120, `${where}: What I know is empty`);
    check(!/demo|scripted|server-side/i.test(memory), `${where}: What I know mentions a demo`);
    if (shots) await page.screenshot({ path: join(shots, `257-memory-${where}.png`) });

    // #261: the equipment label follows the saved setup and the length reads "N min sessions".
    for (const [kind, equipment, support, title, value] of [
      ['gym', ['Barbell', 'Dumbbell', 'Machine', 'Cable'], ['Bench', 'Rack'], 'Gym equipment', /Barbell/],
      ['home', ['Dumbbell'], ['Bench'], 'Home equipment', /Dumbbell/],
      ['none', [], [], 'Bodyweight', /Bodyweight only/],
    ]) {
      await page.evaluate(({ key, equipment, support }) => {
        const data = JSON.parse(localStorage.getItem(key));
        Object.assign(data.state.profile, { equipment, support, sessionMinutes: 30 });
        localStorage.setItem(key, JSON.stringify(data));
      }, { key: 'fitbod-clone-v1', equipment, support });
      await page.reload();
      await page.waitForSelector('.t7-hero');
      await page.getByRole('button', { name: 'Coach' }).click();
      await page.getByRole('tab', { name: 'What I know' }).click();
      const rows = await page.locator('.memory-row').allInnerTexts();
      const gear = rows[0] ?? '';
      check(gear.startsWith(title) && value.test(gear), `${where} ${kind}: equipment row reads ${JSON.stringify(gear)}`);
      check(/30 min sessions/.test(rows[1] ?? '') && !/Under/.test(rows[1] ?? ''), `${where} ${kind}: length row reads ${JSON.stringify(rows[1])}`);
      if (shots) await page.screenshot({ path: join(shots, `261-memory-${kind}-${where}.png`) });
    }
    check(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`coach-tabs: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('coach-tabs: pass at 390x844 and 360x780 (gym, home and no-gear What I know labels)');
