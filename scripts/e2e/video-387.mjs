// (#387) The owner attaches a video to a built-in exercise from /admin; phones play it; unpublishing takes it back.
// Google sign-in, Firestore and Storage are mocked with context.route (one shared store, so the admin's write is
// what the phone reads), so nothing reaches Google.
//   A. Phone, nothing published: the player says "No video yet" (today's behaviour).
//   B. Admin: All exercises > the exercise > Video. Publish is blocked without a clip and without its rights; a
//      clip over 15 s or over 10 MB is refused; then a clip and its rights publish: one Storage upload into
//      `catalog/media-<id>/video-<n>.mp4` (content type video/mp4) and one `media-<id>` Firestore row (kind media,
//      published, rights, the clip's path), nothing else written, no built-in data touched.
//   C. Phone: the open right after the publish still says "No video yet" (the plan never changes under the lifter);
//      the next open plays the clip (currentTime advances), and the worker kept the clip in `catalog-v1`.
//   D. Offline: the clip still plays, from the cache.
//   E. Admin unpublishes: after two phone opens the exercise says "No video yet" again.
// 390x844 and 360x780; nothing scrolls sideways. E2E_SHOTS=<dir> saves 387-<view>-<size>.png.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { preview } from 'vite';
import { EXERCISES } from '../../src/data/exercises.ts';
import { validMedia } from '../../src/lib/additions.ts';
import { plain } from '../../src/lib/catalogSync.ts';

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
const server = await preview({ preview: { port: 4217, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const DB = 'projects/home-strength/databases/(default)/documents';
const cors = { 'Access-Control-Allow-Origin': '*' };
const STORAGE_HOST = 'firebasestorage.googleapis.com';
const GIS_STUB = `window.google = { accounts: { id: {
  initialize(options) { window.__gis = options; },
  renderButton(el) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Sign in with Google';
    b.onclick = () => window.__gis.callback({ credential: 'owner' });
    el.appendChild(b);
  },
} } };`;
// Lesson 29: wait for finite animations (the photo loop is endless, so it is skipped).
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
  .map((a) => a.finished.catch(() => {}))));
const shot = async (page, name, fullPage = false) => {
  if (!shots) return;
  await settle(page);
  await page.screenshot({ path: `${shots}/387-${name}.png`, fullPage });
};
const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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

/** The mock backend, shared by the admin and the phone. */
const store = { docs: new Map(), online: true, writes: [], uploads: [], queries: 0, clipGets: 0 };
const typed = (doc) => ({ name: `${DB}/catalog/${doc.id}`, fields: doc.fields });

async function routes(context, { admin }) {
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: GIS_STUB }));
  await context.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ idToken: 'tok-owner' }) }));
  await context.route('https://firestore.googleapis.com/**', (route) => {
    if (!store.online) return route.abort('internetdisconnected');
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
    const url = request.url();
    if (url.includes(':runQuery')) {
      const where = request.postDataJSON()?.structuredQuery?.where?.fieldFilter;
      if (admin) return reply(200, [{ readTime: 'x' }]);
      check(where?.field?.fieldPath === 'status' && where?.value?.stringValue === 'published', 'the phone asks for published rows only');
      store.queries += 1;
      const published = [...store.docs.values()].filter((doc) => doc.fields.status.stringValue === 'published');
      return reply(200, published.length ? published.map((doc) => ({ document: typed(doc) })) : [{ readTime: 'x' }]);
    }
    if (request.headers().authorization !== 'Bearer tok-owner') return reply(401, {});
    if (request.method() === 'GET' && url.includes('/catalog?')) return reply(200, { documents: [...store.docs.values()].map(typed) });
    if (request.method() === 'GET' && url.includes('/feedback?')) return reply(200, {});
    if (request.method() === 'PATCH') {
      const id = new URL(url).pathname.split('/').pop();
      store.writes.push({ id, exists: new URL(url).searchParams.get('currentDocument.exists'), fields: request.postDataJSON().fields });
      store.docs.set(id, { id, fields: request.postDataJSON().fields });
      return reply(200, {});
    }
    failures.push(`unexpected Firestore call ${request.method()} ${url}`);
    return reply(404, {});
  });
  await context.route(`https://${STORAGE_HOST}/**`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (!store.online) return route.abort('internetdisconnected');
    if (request.method() === 'POST') {
      store.uploads.push({ url: request.url(), type: request.headers()['content-type'], size: request.postDataBuffer()?.length ?? 0, head: request.postData()?.slice(0, 400) ?? '' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
    }
    if (request.url().includes('video-')) store.clipGets += 1;
    return route.fulfill({ status: 200, contentType: 'video/webm', headers: cors, body: clip });
  });
}

async function onboard(page, url) {
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

const dialog = (page) => page.getByRole('dialog');
const firstPhoto = (page) => page.locator('.workout-row:not(.workout-row--skipped)').nth(0).locator('.workout-row__photo');
async function advancing(page) {
  const clipEl = dialog(page).locator('video');
  await clipEl.evaluate((video) => new Promise((resolve) => {
    if (video.currentTime > 0.1) return resolve();
    video.addEventListener('timeupdate', () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  }));
  const a = await clipEl.evaluate((video) => video.currentTime);
  await page.waitForTimeout(600);
  const b = await clipEl.evaluate((video) => video.currentTime);
  return { a, b, ok: b > a && !(await clipEl.evaluate((video) => video.paused)) };
}
/** Opens Today's first photo and reports whether the clip played, or "No video yet" showed. */
async function player(page) {
  await firstPhoto(page).click();
  await dialog(page).locator('.howto-media').waitFor();
  const play = await Promise.race([
    dialog(page).getByText('No video yet').waitFor().then(() => 'none'),
    advancing(page).then((result) => (result.ok ? 'plays' : 'stuck')),
  ]).catch(() => 'unknown');
  return play;
}
async function openAgain(page, url) {
  await page.goto(url);
  await page.waitForSelector('.t7-hero');
  // The download after the first render has landed in the cache (or failed): give it a moment.
  await page.waitForTimeout(600);
}
const kept = (page, path) => page.evaluate(async (needle) => {
  for (let i = 0; i < 50; i += 1) {
    const cache = await caches.open('catalog-v1');
    for (const request of await cache.keys()) if (request.url.includes(needle)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}, path);

try {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const where = `${size.width}x${size.height}`;
    Object.assign(store, { docs: new Map(), online: true, writes: [], uploads: [], queries: 0, clipGets: 0 });

    const phoneContext = await browser.newContext({ viewport: size });
    await routes(phoneContext, { admin: false });
    await phoneContext.addInitScript(() => { window.__catalogTest = true; });
    const phone = await phoneContext.newPage();
    const errors = [];
    phone.on('pageerror', (error) => errors.push(String(error)));
    await onboard(phone, base);

    // A. Nothing published: today's behaviour.
    const name = (await phone.locator('.workout-row:not(.workout-row--skipped)').nth(0).locator('.workout-row__name').innerText()).trim();
    const exercise = EXERCISES.find((entry) => entry.name === name);
    check(Boolean(exercise), `${where}: no built-in named ${name}`);
    const id = exercise.id;
    check((await player(phone)) === 'none', `${where}: ${name} had no overlay yet but did not say "No video yet"`);
    await shot(phone, `phone-no-video-${where}`);
    await phone.keyboard.press('Escape');

    // B. The admin attaches and publishes a clip.
    const adminContext = await browser.newContext({ viewport: size });
    await routes(adminContext, { admin: true });
    // MediaRecorder's WebM has no duration, which the admin page needs to enforce 15 s; the test sets it.
    await adminContext.addInitScript(() => {
      window.__seconds = 8;
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { get() { return window.__seconds; } });
    });
    const admin = await adminContext.newPage();
    const adminErrors = [];
    admin.on('pageerror', (error) => adminErrors.push(String(error)));
    await admin.goto(`${base}admin`);
    await admin.getByRole('button', { name: 'Sign in with Google' }).click();
    await admin.getByRole('tab', { name: 'Exercises' }).click();
    await admin.getByRole('button', { name: 'All exercises' }).click();
    await admin.getByRole('searchbox', { name: 'Search' }).fill(name);
    await admin.locator('.adm-all__row').filter({ has: admin.locator('.adm-all__name', { hasText: new RegExp(`^${name}$`) }) }).click();
    const form = admin.getByRole('group', { name: `Video for ${name}` });
    await form.waitFor();
    check((await form.getByText('No video yet.').count()) === 1, `${where}: the form does not say there is no video yet`);
    const publish = form.getByRole('button', { name: 'Publish video' });
    check(await publish.isDisabled(), `${where}: Publish video is enabled with no clip and no rights`);
    check((await form.getByText(/Choose a video/).count()) === 1, `${where}: no "Choose a video" reason`);
    await shot(admin, `admin-form-${where}`, true);

    const input = form.locator('input[type=file]');
    await input.setInputFiles({ name: 'long.mp4', mimeType: 'video/mp4', buffer: clip });
    await admin.evaluate(() => { window.__seconds = 16; });
    await input.setInputFiles({ name: 'long2.mp4', mimeType: 'video/mp4', buffer: clip });
    await form.getByRole('alert').filter({ hasText: 'This video is over 15 seconds.' }).waitFor({ timeout: 5000 }).catch(() => {});
    check((await form.getByRole('alert').filter({ hasText: 'This video is over 15 seconds.' }).count()) === 1, `${where}: a 16 s clip was not refused: ${(await form.getByRole('alert').allInnerTexts()).join('|')}`);
    await input.setInputFiles({ name: 'big.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(11 * 1024 * 1024) });
    await form.getByRole('alert').filter({ hasText: 'This video is over 10 MB.' }).waitFor({ timeout: 5000 }).catch(() => {});
    check((await form.getByRole('alert').filter({ hasText: 'This video is over 10 MB.' }).count()) === 1, `${where}: an 11 MB clip was not refused`);
    check(await publish.isDisabled(), `${where}: Publish video enabled after a refused clip`);
    await admin.evaluate(() => { window.__seconds = 8; });
    await input.setInputFiles({ name: 'bench.mp4', mimeType: 'video/mp4', buffer: clip });
    await form.getByRole('alert').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    check((await form.getByRole('alert').count()) === 0, `${where}: a good clip still shows a problem`);
    check(await publish.isDisabled(), `${where}: Publish video enabled without the rights`);
    check((await form.getByText(/source, licence and credit/).count()) === 1, `${where}: no rights reason`);
    await form.getByLabel('Source (link or where it came from)').fill('Own footage, Home Strength team');
    await form.getByLabel('Licence').selectOption('own-work');
    await form.getByLabel(/^Credit/).fill('Home Strength team');
    check(await publish.isEnabled(), `${where}: Publish video still disabled with a clip and rights`);
    check(await fitsWidth(admin), `${where}: admin form scrolls sideways`);
    await shot(admin, `admin-ready-${where}`, true);
    await publish.click();
    await form.getByText(/^Video published\./).waitFor({ timeout: 8000 }).catch(async () => {
      console.error(`publish stuck. form: ${await form.innerText()} | uploads=${store.uploads.length} writes=${store.writes.length} | ${adminErrors}`);
      process.exit(1);
    });
    check(store.uploads.length === 1 && store.writes.length === 1, `${where}: ${store.uploads.length} uploads, ${store.writes.length} writes (expected 1 and 1)`);
    const upload = store.uploads[0];
    check(new RegExp(`/o\\?name=catalog%2Fmedia-${id}%2Fvideo-\\d+\\.mp4$`).test(upload?.url ?? ''), `${where}: upload went to ${upload?.url}`);
    check(upload?.head.includes('"contentType":"video/mp4"'), `${where}: upload metadata lacks content type video/mp4`);
    const write = store.writes[0];
    const row = write ? plain(write.fields) : {};
    check(write?.id === `media-${id}`, `${where}: wrote ${write?.id}`);
    check(validMedia(row) !== null, `${where}: the written row is not a valid overlay: ${JSON.stringify(row)}`);
    check(row.status === 'published' && row.kind === 'media' && row.exercise === id && row.licence === 'own-work' && row.credit === 'Home Strength team', `${where}: row ${JSON.stringify(row)}`);
    check(decodeURIComponent(upload?.url.match(/name=([^&]+)/)?.[1] ?? '') === row.video, `${where}: the row's video is not the uploaded path`);
    check(!store.docs.has(id) && [...store.docs.keys()].join() === `media-${id}`, `${where}: wrote something other than the overlay: ${[...store.docs.keys()]}`);
    check(write?.exists === null, `${where}: an overlay write must replace, not demand a new doc`);
    check((await form.getByRole('button', { name: 'Unpublish video' }).count()) === 1, `${where}: no Unpublish video after publish`);
    await shot(admin, `admin-published-${where}`, true);

    // C. The next phone open still has no video; the one after plays it, and the worker kept the clip.
    await openAgain(phone, base);
    check((await player(phone)) === 'none', `${where}: the open right after publish already changed (the plan must not move under the lifter)`);
    await phone.keyboard.press('Escape');
    await openAgain(phone, base);
    const played = await player(phone);
    check(played === 'plays', `${where}: second open after publish: the clip ${played}`);
    await phone.waitForTimeout(300);
    await shot(phone, `phone-player-${where}`);
    check(await kept(phone, 'video-'), `${where}: the worker did not keep the clip in catalog-v1`);
    await phone.keyboard.press('Escape');

    // D. Offline: from the cache.
    store.online = false;
    await phoneContext.setOffline(true);
    await phone.reload();
    await phone.waitForSelector('.t7-hero');
    const gets = store.clipGets;
    const offlinePlay = await player(phone);
    check(offlinePlay === 'plays', `${where}: offline, the clip ${offlinePlay}`);
    check(store.clipGets === gets, `${where}: offline play still asked the network`);
    await phone.keyboard.press('Escape');
    check(await fitsWidth(phone), `${where}: phone scrolls sideways`);
    store.online = true;
    await phoneContext.setOffline(false);

    // E. Unpublish: back to "No video yet" after two opens.
    await admin.getByRole('button', { name: 'Unpublish video' }).click();
    await form.getByText(/^Unpublished\./).first().waitFor();
    const off = store.writes.at(-1);
    check(off?.id === `media-${id}` && plain(off.fields).status === 'unpublished' && plain(off.fields).video === row.video, `${where}: unpublish wrote ${JSON.stringify(off && plain(off.fields))}`);
    check(store.uploads.length === 1, `${where}: unpublish uploaded again`);
    await openAgain(phone, base);
    await phone.keyboard.press('Escape').catch(() => {});
    await openAgain(phone, base);
    const after = await player(phone);
    check(after === 'none', `${where}: after unpublish the exercise ${after}, not "No video yet"`);
    check(!(await phone.evaluate(async () => (await (await caches.open('catalog-v1')).keys()).some((request) => request.url.includes('video-')))), `${where}: the unpublished clip is still saved on the phone`);
    await shot(phone, `phone-unpublished-${where}`);

    check(errors.length === 0 && adminErrors.length === 0, `${where}: page errors ${errors.concat(adminErrors).join(' | ')}`);
    console.log(`${where}: ${name}: no video, published from /admin (${store.uploads.length} upload, ${store.writes.length - 1} publish), plays on the second open, offline from cache, unpublished back to "No video yet"`);
    await phoneContext.close();
    await adminContext.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(failures.map((message) => `FAIL ${message}`).join('\n'));
  process.exit(1);
}
