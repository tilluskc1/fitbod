// (#379) Tap the exercise photo: a full-screen how-to player whose clip actually plays (currentTime
// advances). Hold the photo 0.5 s: a menu (How-to, History, Replace, Later) where each item does what its
// chip does, and the hold never also fires the tap. The iPhone "doesn't play" case (Low Power Mode refuses
// play()) falls back to the photo loop with a "Play video" tap, never a frozen poster; an exercise with no
// clip says "No video yet"; offline with the clip never cached says "Video needs a connection".
// The catalog ships no clip yet, so this script builds the app once more with a clip on every exercise
// (one left without) and serves a VP8 clip it records in Chromium. 390x844 and 360x780; shots with E2E_SHOTS.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';

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

// The exercise left without a clip: Today's second row for the onboarding below.
const NO_VIDEO = 'overhead-press';
const clipPlugin = {
  name: 'e2e-clips',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/data/media.json')) return null;
    const media = JSON.parse(code);
    for (const [key, entry] of Object.entries(media)) if (key !== NO_VIDEO) entry.video = `/e2e-clip/${key}.webm`;
    return { code: JSON.stringify(media), map: null };
  },
};

const outDir = mkdtempSync(join(tmpdir(), 'howto-379-'));
await build({ logLevel: 'silent', plugins: [clipPlugin], build: { outDir, emptyOutDir: true } });
const { chromium } = await loadPlaywright();
const server = await preview({ build: { outDir }, preview: { port: 4186, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
// Lesson 29: wait for finite animations (the photo loop is endless, so it is skipped).
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: `${shots}/379-${name}.png` });
};

const browser = await chromium.launch();

/** A 2 s VP8 clip of a moving square, recorded from a canvas: real frames, so currentTime advances. */
async function recordClip() {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 320 });
    const ctx = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    const start = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = performance.now() - start;
        ctx.fillStyle = '#e6f2f1';
        ctx.fillRect(0, 0, 320, 320);
        ctx.fillStyle = '#5b6b00';
        ctx.fillRect((t / 8) % 260, 130, 60, 60);
        if (t < 2000) requestAnimationFrame(draw); else resolve();
      };
      draw();
    });
    recorder.stop();
    await stopped;
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  await page.close();
  return Buffer.from(bytes);
}
const clip = await recordClip();
const serveClips = (context) => context.route('**/e2e-clip/**', (route) =>
  route.fulfill({ status: 200, contentType: 'video/webm', body: clip }));

async function onboard(page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Get started' }).click();
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

const current = async (page) => (await page.locator('.aw-exercise__name').innerText()).trim();
const thumb = (page) => page.locator('.lg-thumb');
const dialog = (page) => page.getByRole('dialog');
/** currentTime of the open player's clip, twice, 0.6 s apart. */
async function advancing(page) {
  const clipEl = dialog(page).locator('video');
  await clipEl.evaluate((video) => new Promise((resolve) => {
    if (video.currentTime > 0.1) return resolve();
    video.addEventListener('timeupdate', () => resolve(), { once: true });
    setTimeout(resolve, 4000);
  }));
  const a = await clipEl.evaluate((video) => video.currentTime);
  await page.waitForTimeout(600);
  const b = await clipEl.evaluate((video) => video.currentTime);
  return { a, b, ok: b > a && !(await clipEl.evaluate((video) => video.paused)) };
}
async function hold(page) {
  const box = await thumb(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}
const menuItem = (page, name) => dialog(page).getByRole('button', { name, exact: true });

try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const where = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await serveClips(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await onboard(page);

    // E. Today's row photo opens the player, not the row's sheet; the clip-less exercise says so.
    const rows = page.locator('.workout-row:not(.workout-row--skipped)');
    const secondName = (await rows.nth(1).locator('.workout-row__name').innerText()).trim();
    await rows.nth(1).locator('.workout-row__photo').click();
    check((await dialog(page).locator('.howto-media').count()) === 1, `${where}: Today's photo did not open the player`);
    check((await dialog(page).getByText('No video yet').count()) === 1, `${where}: ${secondName} (no clip) does not say "No video yet"`);
    check((await dialog(page).locator('.howto-media .demo-frame-alt').count()) === 1, `${where}: no-clip player shows no photo loop`);
    await shot(page, `${width}-no-video`);
    await page.keyboard.press('Escape');
    await rows.nth(0).locator('.workout-row__photo').click();
    const todayPlay = await advancing(page);
    check(todayPlay.ok, `${where}: Today's player clip did not advance (${todayPlay.a} → ${todayPlay.b})`);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('.lg-ex');
    const first = await current(page);

    // A. Tap the photo: full-screen player, clip plays, name and cues below.
    await thumb(page).click();
    check((await dialog(page).count()) === 1, `${where}: photo tap opened no dialog`);
    const play = await advancing(page);
    check(play.ok, `${where}: player clip did not advance (${play.a} → ${play.b})`);
    const box = await dialog(page).locator('video').boundingBox();
    const sheet = await dialog(page).boundingBox();
    check(box && box.width >= width - 50, `${where}: clip is ${box?.width}px wide, not the screen width`);
    check(sheet && sheet.height >= height - 1, `${where}: player is ${sheet?.height}px tall, not full screen`);
    check((await dialog(page).locator('.howto-name').innerText()).trim() === first, `${where}: player name is not ${first}`);
    const cueCount = await dialog(page).locator('.howto-cues li').count();
    check(cueCount >= 1 && cueCount <= 3, `${where}: player shows ${cueCount} cues`);
    const close = dialog(page).getByRole('button', { name: 'Close' });
    const closeBox = await close.boundingBox();
    check(closeBox && closeBox.width >= 56, `${where}: close is ${closeBox?.width}px, not big`);
    await page.waitForTimeout(300);
    await shot(page, `${width}-player`);

    // B. Escape closes and returns focus to the photo.
    await page.keyboard.press('Escape');
    check((await dialog(page).count()) === 0, `${where}: Escape left the player open`);
    check(await thumb(page).evaluate((el) => el === document.activeElement), `${where}: focus did not return to the photo`);

    // The How-to chip opens the same player.
    await page.locator('.lg-acts').getByRole('button', { name: /How-to$/ }).click();
    check((await dialog(page).locator('.howto-media video').count()) === 1, `${where}: How-to chip did not open the player`);
    await close.click();

    // C. Hold: the menu, not the player; each item does what its chip does.
    await hold(page);
    check((await dialog(page).count()) === 1, `${where}: hold opened ${await dialog(page).count()} dialogs`);
    check((await dialog(page).locator('.howto-media').count()) === 0, `${where}: hold also fired the tap (player open)`);
    const items = await dialog(page).locator('.sheet-menu__row').allInnerTexts();
    check(JSON.stringify(items) === JSON.stringify(['How-to', 'History', 'Replace', 'Later']), `${where}: hold menu reads ${JSON.stringify(items)}`);
    await shot(page, `${width}-hold-menu`);
    await menuItem(page, 'How-to').click();
    check((await dialog(page).locator('.howto-media video').count()) === 1, `${where}: menu How-to did not open the player`);
    await page.keyboard.press('Escape');
    await hold(page);
    await menuItem(page, 'History').click();
    check((await dialog(page).getByText(`Only sets you actually recorded for ${first}`).count()) === 1, `${where}: menu History did not open ${first}'s history`);
    await page.keyboard.press('Escape');
    await hold(page);
    await menuItem(page, 'Replace').click();
    check((await dialog(page).getByRole('heading', { name: 'Swap exercise' }).count()) === 1, `${where}: menu Replace did not open Swap exercise`);
    await page.keyboard.press('Escape');
    await hold(page);
    await menuItem(page, 'Later').click();
    await page.waitForFunction((name) => document.querySelector('.aw-exercise__name')?.textContent?.trim() !== name, first, { timeout: 3000 }).catch(() => {});
    check((await current(page)) !== first, `${where}: menu Later left ${first} current`);
    check((await page.locator('.done-toast__text').innerText().catch(() => '')).trim() === `${first} moved to later.`, `${where}: menu Later's toast differs from the chip's`);
    check((await dialog(page).count()) === 0, `${where}: a dialog stayed open after Later`);

    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();

    // R. Repro of "doesn't play on iPhone": Low Power Mode refuses play() (NotAllowedError). Fails on d3ddc30
    // (the How-to showed a frozen poster); now the photos loop at once with a "Play video" tap.
    const refused = await browser.newContext({ viewport: { width, height } });
    await serveClips(refused);
    await refused.addInitScript(() => {
      const real = HTMLMediaElement.prototype.play;
      window.__refuse = true;
      HTMLMediaElement.prototype.play = function play() {
        return window.__refuse ? Promise.reject(new DOMException('Low Power Mode', 'NotAllowedError')) : real.call(this);
      };
    });
    const rp = await refused.newPage();
    await onboard(rp);
    await rp.getByRole('button', { name: 'Start workout' }).click();
    await rp.waitForSelector('.lg-ex');
    await thumb(rp).click();
    await rp.waitForTimeout(1000);
    const loop = await dialog(rp).locator('.demo-frame-alt').evaluateAll((els) => els.some((el) => getComputedStyle(el).animationName === 'demo-crossfade' && getComputedStyle(el).animationPlayState === 'running'));
    check(loop, `${where}: refused play() left no moving photos in the how-to (frozen poster)`);
    const again = dialog(rp).getByRole('button', { name: 'Play video' });
    check((await again.count()) === 1, `${where}: refused play() offers no "Play video" tap`);
    await shot(rp, `${width}-refused`);
    if ((await again.count()) === 1) {
      await rp.evaluate(() => { window.__refuse = false; });
      await again.click();
      const retry = await advancing(rp);
      check(retry.ok, `${where}: "Play video" did not start the clip (${retry.a} → ${retry.b})`);
    }
    await refused.close();
  }

  // F. Offline, clip never cached: "Video needs a connection" over the cached photo loop.
  const off = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await off.route('**/e2e-clip/**', (route) => route.abort());
  const op = await off.newPage();
  // Online: Today's photos load (and are kept); the clips are blocked, so none is ever cached.
  await onboard(op);
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.reload();
  await op.waitForSelector('.t7-hero');
  await op.waitForFunction(() => [...document.querySelectorAll('.workout-row__photo img')].every((img) => img.complete));
  await off.setOffline(true);
  await op.reload();
  await op.waitForSelector('.t7-hero');
  await op.getByRole('button', { name: 'Start workout' }).click();
  await op.waitForSelector('.lg-ex');
  await thumb(op).click();
  await dialog(op).getByText('Video needs a connection').waitFor({ timeout: 6000 }).catch(() => {});
  check((await dialog(op).getByText('Video needs a connection').count()) === 1, 'offline: never-cached clip does not say "Video needs a connection"');
  // The clip's poster (start frame) was cached online; the end frame may never have loaded.
  const photo = await dialog(op).locator('.howto-media .demo-frame-base').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check(photo, 'offline: never-cached clip shows no cached photo (blank)');
  if (shots) await op.setViewportSize({ width: 390, height: 844 });
  await shot(op, '390-offline');
  if (shots) {
    await op.setViewportSize({ width: 360, height: 780 });
    await shot(op, '360-offline');
  }
  await off.close();
} finally {
  await browser.close();
  await server.httpServer.close();
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`howto-379: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('howto-379: photo tap plays the clip full screen, hold opens the chip menu, refused/missing/offline clips fall back to the photo loop');
