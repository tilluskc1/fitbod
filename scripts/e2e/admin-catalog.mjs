// The /admin Exercises and Equipment pages (#360). Google sign-in, Firestore and Storage are mocked with
// context.route, so nothing reaches Google; the mock Firestore answers like the rules (owner's token only).
//   The list shows added rows with their status; built-in exercises are not listed or editable.
//   A built-in name, no pattern or muscle, media without its rights, a photo over 1 MB, a GIF, a video
//   over 15 s, a non-MP4: each blocks Publish with its reason, and Publish stays disabled.
//   The coach check's days equal the planner's own `appearsIn` for the same picks (lesson 12).
//   Publish uploads the photo (multipart, its content type kept), then writes the row once
//   (create-only), with exactly the fields the phone validates. Unpublish rewrites the saved row.
//   Equipment a published exercise uses can't be unpublished.
// 390x844, 360x780 and 1280x800; nothing scrolls sideways.
//
//   npm run e2e        (builds, then runs every scripts/e2e check against the built app)
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';
import { appearsIn } from '../../src/lib/adminCatalog.ts';
import { validRow } from '../../src/lib/additions.ts';
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
const server = await preview({ preview: { port: 4212, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const DB = 'projects/home-strength/databases/(default)/documents';
const cors = { 'Access-Control-Allow-Origin': '*' };

// Files the admin picks: a small JPG, a JPG over 1 MB, a GIF, and (with ffmpeg) MP4s of 3 s and 16 s.
const work = mkdtempSync(join(tmpdir(), 'admin360-'));
const PHOTO = readFileSync(new URL('../../public/exercises/push-up/0.jpg', import.meta.url));
const files = {
  photo: { name: 'cable-y-raise.jpg', mimeType: 'image/jpeg', buffer: PHOTO },
  big: { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([PHOTO, Buffer.alloc(1024 * 1024)]) },
  gif: { name: 'move.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
  mov: { name: 'clip.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(100) },
};
let videos = false;
try {
  for (const [name, seconds] of [['short', 3], ['long', 16]]) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=64x64:d=${seconds}`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', join(work, `${name}.mp4`)]);
    files[name] = { name: `${name}.mp4`, mimeType: 'video/mp4', buffer: readFileSync(join(work, `${name}.mp4`)) };
  }
  videos = true;
} catch {
  console.log('ffmpeg not found: the 15-second video step is skipped (tests/catalog360.test.ts covers the rule).');
}

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

const s = (value) => ({ stringValue: value });
const list = (values) => ({ arrayValue: { values: values.map(s) } });
const ts = { timestampValue: '2026-11-13T10:00:00Z' };
const SEED = [
  { id: s('add-landmine-press'), kind: s('exercise'), status: s('published'), name: s('Landmine Press'), muscles: list(['Chest', 'Shoulders']),
    pattern: s('horizontal_push'), item: s('barbell'), instructions: s('Press the bar end up and forward.'), cues: list([]), updatedAt: ts },
  { id: s('add-belt-squat'), kind: s('equipment'), status: s('published'), name: s('Belt squat'), family: s('Machine'), group: s('Legs machines'), updatedAt: ts },
  { id: s('add-belt-squat-squat'), kind: s('exercise'), status: s('published'), name: s('Belt Squat'), muscles: list(['Quads', 'Glutes']),
    pattern: s('squat'), item: s('add-belt-squat'), instructions: s('Squat with the belt at your hips.'), cues: list([]), updatedAt: ts },
  { id: s('add-t-bar-row'), kind: s('exercise'), status: s('draft'), name: s('T-Bar Row'), muscles: list(['Back', 'Biceps']),
    pattern: s('horizontal_pull'), item: s('barbell'), instructions: s('Row the bar end to your chest.'), cues: list([]), updatedAt: ts },
];

async function open(browser, size) {
  const context = await browser.newContext({ viewport: size });
  const log = { patches: [], uploads: [] };
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: GIS_STUB }));
  await context.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ idToken: 'tok-owner' }) }));
  await context.route('https://firestore.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
    if (request.headers().authorization !== 'Bearer tok-owner') return reply(401, {});
    const url = request.url();
    if (request.method() === 'PATCH' && url.includes('/catalog/')) {
      log.patches.push({ url, fields: request.postDataJSON().fields });
      return reply(200, { name: url.split('/v1/')[1].split('?')[0], fields: request.postDataJSON().fields });
    }
    if (request.method() === 'GET' && url.includes('/catalog?')) {
      return reply(200, { documents: SEED.map((fields) => ({ name: `${DB}/catalog/${fields.id.stringValue}`, fields })) });
    }
    if (url.includes(':runQuery')) return reply(200, [{ readTime: '2026-11-14T10:00:00Z' }]);
    if (url.includes('/feedback?')) return reply(200, {});
    failures.push(`unexpected Firestore call ${request.method()} ${url}`);
    return reply(404, {});
  });
  await context.route('https://firebasestorage.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: cors, body: PHOTO });
    const body = request.postDataBuffer() ?? Buffer.alloc(0);
    log.uploads.push({ url: request.url(), headers: request.headers(), head: body.subarray(0, 400).toString('latin1'), size: body.length });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${base}admin`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('tab', { name: 'Exercises' }).waitFor();
  return { context, page, errors, log };
}

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page, name, where) => {
  if (!shots) return;
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: join(shots, `360-admin-${name}-${where}.png`), fullPage: true });
};
const problems = async (page) => ((await page.locator('.adm-problems').count()) ? (await page.locator('.adm-problems li').allInnerTexts()) : []);
const publish = (page) => page.getByRole('button', { name: 'Publish', exact: true });
/** A form control by the start of its label (a wrapping label's name also carries the control's own text). */
const field = (page, label) => page.getByLabel(new RegExp(`^${label.replace(/[()'.]/g, '\\$&')}`));

const browser = await chromium.launch();
try {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 780 }, { width: 1280, height: 800 }]) {
    const where = `${size.width}x${size.height}`;
    const { context, page, errors, log } = await open(browser, size);

    // The list: only added rows, each with its status.
    await page.getByRole('tab', { name: 'Exercises' }).click();
    await page.getByRole('button', { name: 'Add exercise' }).waitFor();
    const names = await page.locator('.adm-cat__name').allInnerTexts();
    check(names.join() === 'Belt Squat,Landmine Press,T-Bar Row', `${where}: exercise list ${names}`);
    check(!(await page.getByText('Barbell Bench Press').count()), `${where}: a built-in exercise is listed`);
    check((await page.locator('.adm-cat__row').filter({ hasText: 'T-Bar Row' }).locator('.adm-chip').innerText()) === 'Draft', `${where}: draft status`);
    check(await fitsWidth(page), `${where}: exercise list scrolls sideways`);
    await shot(page, 'exercises', where);

    // A new exercise: each gap blocks Publish with its reason.
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await field(page, 'Name').fill('Push-Up');
    check((await problems(page)).includes('Push-Up is already built in. Pick another name.'), `${where}: a built-in name can publish (${await problems(page)})`);
    check(await publish(page).isDisabled(), `${where}: Publish enabled with a built-in name`);
    await field(page, 'Name').fill('Cable Y Raise');
    const opening = await problems(page);
    check(opening.includes('Pick the primary muscle.') && opening.includes('Pick the movement pattern.') && opening.includes('Add instructions.'),
      `${where}: opening problems ${opening}`);
    await field(page, 'Primary muscle').selectOption('Shoulders');
    await page.getByRole('checkbox', { name: 'Back' }).check();
    check((await problems(page)).includes('Pick the movement pattern.'), `${where}: no pattern does not block`);
    check((await page.locator('.adm-coach').innerText()).includes('Pick the primary muscle and the movement pattern'), `${where}: coach check before a pattern`);
    await field(page, 'Movement pattern').selectOption('shoulder_abduction');
    const days = appearsIn(['Shoulders', 'Back'], 'shoulder_abduction');
    const coach = await page.locator('.adm-coach').innerText();
    check(days.length > 0 && coach.includes(`This exercise would appear in: ${days.join(', ')}.`), `${where}: coach check "${coach}" vs planner ${days}`);
    await field(page, 'Equipment').selectOption('cable-stack');
    await field(page, 'Instructions').fill('Face the cable, arms low and crossed. Raise both hands up and out into a Y.');
    await field(page, 'Cues (one per line, up to 5)').fill('Thumbs up\nRibs down');
    check((await problems(page)).length === 0, `${where}: a complete draft without media still blocked (${await problems(page)})`);

    // Files: wrong type, too big, too long; then a good photo without its rights.
    const photoInput = page.locator('input[type="file"][accept^="image"]');
    const videoInput = page.locator('input[type="file"][accept="video/mp4"]');
    await photoInput.setInputFiles(files.gif);
    await page.locator('.adm-error', { hasText: 'Photos must be JPG, PNG or WebP.' }).waitFor();
    check(await publish(page).isDisabled(), `${where}: Publish enabled with a GIF`);
    await photoInput.setInputFiles(files.big);
    await page.locator('.adm-error', { hasText: 'This photo is over 1 MB.' }).waitFor();
    check(await publish(page).isDisabled(), `${where}: Publish enabled with a photo over 1 MB`);
    await videoInput.setInputFiles(files.mov);
    await page.locator('.adm-error', { hasText: 'Videos must be MP4.' }).waitFor();
    // Clearing the picker clears the file and its problem (CI has no ffmpeg to make a good MP4).
    await videoInput.setInputFiles([]);
    await page.waitForFunction(() => !document.body.innerText.includes('Videos must be MP4.'));
    if (videos) {
      await videoInput.setInputFiles(files.long);
      await page.locator('.adm-error', { hasText: 'This video is over 15 seconds.' }).waitFor();
      check(await publish(page).isDisabled(), `${where}: Publish enabled with a 16 s video`);
      await videoInput.setInputFiles(files.short);
      await page.waitForFunction(() => !document.body.innerText.includes('This video is over 15 seconds.'));
    }
    await photoInput.setInputFiles(files.photo);
    await page.waitForFunction(() => !document.body.innerText.includes('This photo is over 1 MB.'));
    check((await problems(page)).join() === 'Add the source, licence and credit for the photo or video. No rights, no publish.',
      `${where}: media without rights: ${await problems(page)}`);
    check(await publish(page).isDisabled(), `${where}: Publish enabled without rights`);
    await shot(page, 'blocked', where);

    await field(page, 'Source (link or where it came from)').fill('Own photo, taken at the gym on 13 Nov 2026');
    await field(page, 'Licence').selectOption('own-work');
    await field(page, 'Credit (shown in the app\'s About)').fill('Home Strength team');
    check((await problems(page)).length === 0, `${where}: still blocked with rights (${await problems(page)})`);
    check(await fitsWidth(page), `${where}: the form scrolls sideways`);
    await shot(page, 'ready', where);

    // Publish: uploads first (multipart, content type kept), then one create-only write.
    await publish(page).click();
    await page.getByText('Published. Phones get it the next time the app opens online.').waitFor();
    const photoUpload = log.uploads.find((upload) => upload.head.includes('"contentType":"image/jpeg"'));
    check(photoUpload && /\/o\?name=catalog%2Fadd-cable-y-raise%2Fphoto-\d+\.jpg$/.test(photoUpload.url)
      && photoUpload.headers['content-type'].startsWith('multipart/related; boundary=') && photoUpload.headers.authorization === 'Firebase tok-owner',
      `${where}: photo upload ${JSON.stringify(photoUpload && { url: photoUpload.url, type: photoUpload.headers['content-type'] })}`);
    check(!videos || log.uploads.some((upload) => upload.head.includes('"contentType":"video/mp4"')), `${where}: no video upload`);
    const created = log.patches.at(-1);
    check(created?.url.endsWith('/catalog/add-cable-y-raise?currentDocument.exists=false'), `${where}: create is not create-only (${created?.url})`);
    const row = created && plain(created.fields);
    check(row?.status === 'published' && created.fields.updatedAt?.timestampValue, `${where}: status ${row?.status}`);
    const valid = row && validRow(row);
    check(valid && valid.muscles.join() === 'Shoulders,Back' && valid.cues.join('|') === 'Thumbs up|Ribs down' && valid.licence === 'own-work'
      && /^catalog\/add-cable-y-raise\/photo-\d+\.jpg$/.test(valid.photo), `${where}: the written row is not what the phone accepts ${JSON.stringify(row)}`);
    check(await page.getByRole('button', { name: 'Unpublish' }).isVisible(), `${where}: no Unpublish after publishing`);
    await shot(page, 'published', where);

    // Unpublish rewrites the saved row with the new status; no precondition (it exists).
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await page.getByText('Unpublished. Phones stop planning it; past workouts keep it.').waitFor();
    const unpublished = log.patches.at(-1);
    check(unpublished.url.endsWith('/catalog/add-cable-y-raise') && plain(unpublished.fields).status === 'unpublished'
      && plain(unpublished.fields).photo === valid?.photo, `${where}: unpublish wrote ${unpublished.url} ${JSON.stringify(plain(unpublished.fields))}`);
    await page.getByRole('button', { name: '‹ Back to the list' }).click();
    check((await page.locator('.adm-cat__row').filter({ hasText: 'Cable Y Raise' }).locator('.adm-chip').innerText()) === 'Unpublished', `${where}: list status after unpublish`);

    // Equipment: a published exercise stands on Belt squat, so it can't be unpublished.
    await page.getByRole('tab', { name: 'Equipment' }).click();
    await page.getByRole('button', { name: 'Edit Belt squat' }).click();
    check(await page.getByRole('button', { name: 'Unpublish' }).isDisabled(), `${where}: equipment in use can be unpublished`);
    check(await page.getByText('Unpublish Belt Squat first: it uses this equipment.').isVisible(), `${where}: in-use reason not shown`);
    check(await fitsWidth(page), `${where}: equipment form scrolls sideways`);
    await shot(page, 'equipment', where);
    check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
    await context.close();
    console.log(`${where}: list, every blocker, coach check "${days.join(', ')}", publish (upload then create-only write), unpublish, equipment in use`);
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('PASS: admin adds exercises and equipment: blockers with reasons, coach check from the planner, rights before publish, upload then create-only write, unpublish');
