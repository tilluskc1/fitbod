// (#378) The installed iPhone app (Home Screen, standalone). Emulates display-mode: standalone and the
// iPhone safe areas (top 59, bottom 34) by rewriting env(safe-area-inset-*) in the served CSS, then checks:
// A. Top: the status-bar band stays the page colour, even with Today or the logger scrolled under it.
// B. Bottom: the tab bar sits on the home-indicator line (gap at most the inset), the shell fills the screen.
// C. Sheets (Switch, Replace, Plan today) keep their actions above the home indicator.
// D. Every input, textarea and select computes >= 16px (iOS auto-zooms below that): onboarding, logger,
//    Plan today, Settings. The app root has touch-action: manipulation; the viewport keeps pinch-zoom.
// E. Nothing scrolls sideways: onboarding, Today, Plan, logger, Progress, Coach and /admin.
// F. A Safari tab (no insets, not standalone) keeps the old fit: no band, 14px under the tab bar.
// Sizes 390x844, 360x780, 390x650. Shots only with E2E_SHOTS.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
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
const server = await preview({ preview: { port: 4186, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const INSET = { top: 59, bottom: 34 };
const PAGE = [0xe6, 0xf2, 0xf1]; // --surface, the page colour

// Lesson 29: wait for finite animations before a shot or a pixel read.
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime) && !a.effect?.target?.closest?.('.done-toast'))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: `${shots}/378-${name}.png` });
};

/** RGB pixels of a Playwright PNG (8-bit RGB or RGBA, not interlaced). */
function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Pixels in the status-bar band that are not the page colour. */
async function bandOffColour(page, width) {
  await settle(page);
  const png = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width, height: INSET.top } }));
  let off = 0;
  for (let i = 0; i < png.width * png.height; i += 1) {
    const at = i * png.channels;
    if (PAGE.some((c, k) => Math.abs(png.data[at + k] - c) > 3)) off += 1;
  }
  return off;
}

/** Scroll the screen's own scroller so content passes under the top band. */
const scrollScreen = (page, by) => page.evaluate((y) => {
  const screen = document.querySelector('.screen');
  if (screen) screen.scrollTop = y;
  return screen ? screen.scrollTop : 0;
}, by);

const sideways = (page) => page.evaluate(() => {
  const doc = document.scrollingElement;
  const screen = document.querySelector('.screen');
  return {
    doc: doc.scrollWidth - window.innerWidth,
    screen: screen ? screen.scrollWidth - screen.clientWidth : 0,
  };
});
const checkSideways = async (page, where, what) => {
  const s = await sideways(page);
  check(s.doc <= 0, `${where}: ${what} scrolls sideways (document ${s.doc}px wider)`);
  check(s.screen <= 0, `${where}: ${what} screen scrolls sideways (${s.screen}px)`);
};

/** Inputs under 16px computed (iOS zooms the page when one is focused). */
const smallInputs = (page) => page.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
  .filter((el) => el.type !== 'hidden' && el.type !== 'range' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file')
  .map((el) => ({ el: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}[${el.getAttribute('aria-label') ?? el.name ?? ''}]`, size: parseFloat(getComputedStyle(el).fontSize) }))
  .filter((input) => input.size < 16));
const checkInputs = async (page, where, what) => {
  const small = await smallInputs(page);
  check(small.length === 0, `${where}: ${what} has inputs under 16px: ${small.map((s) => `${s.el} ${s.size}px`).join(', ')}`);
};

/** The lowest action in an open sheet must sit above the home indicator. */
const checkSheet = async (page, where, what, height, inset) => {
  await settle(page);
  // Scrolled to its end, the sheet's last visible action sits above the home indicator.
  const bottom = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return null;
    for (const el of [sheet, ...sheet.querySelectorAll('*')]) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    }
    const actions = [...sheet.querySelectorAll('button, a, input, textarea')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top < window.innerHeight;
    });
    return Math.max(...actions.map((el) => el.getBoundingClientRect().bottom));
  });
  check(bottom !== null, `${where}: ${what} sheet did not open`);
  if (bottom !== null) check(bottom <= height - inset + 0.5, `${where}: ${what} sheet action at ${bottom}px runs into the home indicator (limit ${height - inset})`);
};

const tabGap = (page) => page.evaluate(() => {
  const bar = document.querySelector('.tabbar');
  const app = document.querySelector('.native-app').getBoundingClientRect();
  return { gap: bar ? window.innerHeight - bar.getBoundingClientRect().bottom : null, appBottom: app.bottom, appTop: app.top, h: window.innerHeight };
});

async function newPage(browser, width, height, standalone) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  await context.route(/accounts\.google\.com|googleapis\.com|gstatic\.com/, (route) => route.abort());
  if (standalone) {
    // The test hook: the served CSS reports the iPhone's safe areas, as iOS does in the installed app.
    await context.route(/\/assets\/.*\.css$/, async (route) => {
      const response = await route.fetch();
      const css = (await response.text()).replace(/env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g,
        (_, side) => `${INSET[side] ?? 0}px`);
      await route.fulfill({ response, body: css });
    });
  }
  if (standalone) {
    // Chromium cannot emulate display-mode, so the page sees what iOS reports in the installed app.
    await context.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query)
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : real(query));
      Object.defineProperty(navigator, 'standalone', { get: () => true });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors };
}

async function onboard(page, where) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('Your first name').waitFor();
  await checkInputs(page, where, 'onboarding');
  await checkSideways(page, where, 'onboarding');
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'lb', exact: true }).click();
  await page.getByRole('button', { name: /Build muscle/i }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Beginner/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^3\s*days$/ }).click();
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'At a gym' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.waitForSelector('.t7-hero');
}

const closeSheet = async (page) => {
  await page.keyboard.press('Escape');
  await page.locator('.sheet').waitFor({ state: 'detached' }).catch(() => {});
};

const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `standalone ${width}x${height}`;
    const { context, page, errors } = await newPage(browser, width, height, true);
    await onboard(page, where);
    check(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches), `${where}: standalone emulation is off`);

    // D. Zoom guards.
    const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
    check(!/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(meta), `${where}: viewport blocks pinch-zoom (${meta})`);
    check(await page.evaluate(() => getComputedStyle(document.getElementById('root')).touchAction) === 'manipulation', `${where}: app root lacks touch-action: manipulation`);

    // A + B on Today.
    const fit = await tabGap(page);
    check(Math.abs(fit.appTop) <= 0.5 && Math.abs(fit.appBottom - fit.h) <= 0.5, `${where}: the app shell does not fill the screen (${fit.appTop}..${fit.appBottom} of ${fit.h})`);
    check(fit.gap !== null && fit.gap <= INSET.bottom && fit.gap >= 14, `${where}: tab bar sits ${fit.gap}px above the screen edge (want 14..${INSET.bottom})`);
    await shot(page, `today-${width}x${height}`);
    await scrollScreen(page, 140);
    const todayOff = await bandOffColour(page, width);
    check(todayOff === 0, `${where}: Today scrolled shows ${todayOff} non-page pixels in the status-bar band`);
    await shot(page, `today-scrolled-${width}x${height}`);
    await scrollScreen(page, 0);
    await checkSideways(page, where, 'Today');

    // C. Switch sheet.
    await page.getByRole('button', { name: 'Switch' }).first().click();
    await page.locator('.sheet').waitFor();
    await checkSheet(page, where, 'Switch', height, INSET.bottom);
    await closeSheet(page);

    // Plan today with me: inputs, its sheet's actions, sideways.
    await page.locator('.tt-open').click();
    await page.getByText('How long do you have?').waitFor();
    await checkInputs(page, where, 'Plan today');
    await checkSideways(page, where, 'Plan today');
    const nav = await page.locator('.tt-nav').boundingBox();
    check(nav && nav.y + nav.height <= height - INSET.bottom + 0.5, `${where}: Plan today's buttons run into the home indicator (${nav && nav.y + nav.height})`);
    await page.locator('.tt-nav .pill-primary').click();
    await page.getByText('Anything sore or hurting?').waitFor();
    await checkInputs(page, where, 'Plan today (sore)');
    await page.locator('.tt-nav .pill-primary').click();
    await page.getByText('What do you want to train?').waitFor();
    await checkInputs(page, where, 'Plan today (train)');
    await checkSideways(page, where, 'Plan today (train)');
    for (let i = 0; i < 3 && (await page.locator('.tt-nav').count()); i += 1) await page.locator('.tt-nav .secondary').click();
    await page.locator('.tt-open').waitFor();

    // Settings.
    await page.getByRole('button', { name: 'Open profile and settings' }).click();
    await page.getByRole('dialog', { name: 'Training settings' }).waitFor();
    await checkInputs(page, where, 'Settings');
    await checkSideways(page, where, 'Settings');
    await closeSheet(page);

    // Other tabs.
    for (const tab of ['Plan', 'Progress', 'Coach']) {
      await page.locator('.tabbar .tab', { hasText: new RegExp(`${tab}$`) }).click();
      await page.waitForTimeout(150);
      await checkSideways(page, where, tab);
      await checkInputs(page, where, tab);
      const gap = await tabGap(page);
      check(gap.gap !== null && gap.gap <= INSET.bottom, `${where}: ${tab} tab bar gap ${gap.gap}px`);
    }
    await page.locator('.tabbar .tab', { hasText: /Today$/ }).click();
    await page.waitForSelector('.t7-hero');

    // The logger.
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    await checkInputs(page, where, 'logger');
    await checkSideways(page, where, 'logger');
    await shot(page, `logger-${width}x${height}`);
    await scrollScreen(page, 220);
    const loggerOff = await bandOffColour(page, width);
    check(loggerOff === 0, `${where}: logger scrolled shows ${loggerOff} non-page pixels in the status-bar band`);
    await shot(page, `logger-scrolled-${width}x${height}`);
    await scrollScreen(page, 0);
    // Focusing a load cell keeps the page unzoomed (the font-size check is iOS's rule; this guards the layout).
    await page.locator('.lg-input').first().focus();
    check(await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1), `${where}: focusing a load cell zoomed the page`);
    await checkSideways(page, where, 'logger (cell focused)');
    await page.locator('.lg-acts').getByRole('button', { name: 'Replace', exact: true }).click();
    await page.locator('.sheet').waitFor();
    await checkSheet(page, where, 'Replace', height, INSET.bottom);
    await checkInputs(page, where, 'Replace');
    await closeSheet(page);

    // /admin (signed-out shell; Google is blocked here).
    await page.goto(`${url}admin`);
    await page.waitForTimeout(400);
    await checkSideways(page, where, '/admin');
    await checkInputs(page, where, '/admin');

    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();
  }

  // F. A Safari tab: no insets, not standalone. The band takes no room; the tab bar keeps 14px under it.
  for (const [width, height] of [[390, 844], [360, 780], [390, 650]]) {
    const where = `browser ${width}x${height}`;
    const { context, page, errors } = await newPage(browser, width, height, false);
    await onboard(page, where);
    const fit = await tabGap(page);
    check(Math.abs(fit.gap - 14) <= 0.5, `${where}: tab bar gap ${fit.gap}px, was 14px`);
    const greeting = await page.locator('.today').evaluate((el) => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop));
    check(Math.abs(greeting - 28) <= 0.5, `${where}: Today content starts at ${greeting}px, was 28px`);
    await shot(page, `browser-today-${width}x${height}`);
    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`standalone-fit: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('standalone-fit: ok');
