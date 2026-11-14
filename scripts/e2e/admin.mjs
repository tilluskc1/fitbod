// The /admin check (#359). Google Identity Services, Firebase Auth and Firestore are all mocked with
// context.route, so nothing reaches Google. The mock Firestore answers like the rules: the owner's token
// reads, any other token gets 403, an expired one 401. The page never checks the email itself.
//   Signed out: a sign-in card, no data. Another account: "Not allowed". Google unreachable: says so.
//   Owner, empty data: each page says it is empty. Owner, data: feedback newest first (an old note with no
//   done field reads open), Mark done patches only `done`; tester counts; this week's usage and the week
//   before. Token expired mid-use: "Your sign-in ran out", with the sign-in button again.
//   The training app at / loads neither the admin chunk nor Google's script.
// 390x844, 360x780 and 1280x800; nothing scrolls sideways.
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
const server = await preview({ preview: { port: 4198, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

// Saturday 14 Nov 2026, 10:00 local: this week runs Mon 9 to Sun 15 Nov.
const NOW = new Date(2026, 10, 14, 10, 0, 0);
const DB = 'projects/home-strength/databases/(default)/documents';
const cors = { 'Access-Control-Allow-Origin': '*' };

const GIS_STUB = `window.google = { accounts: { id: {
  initialize(options) { window.__gis = options; },
  renderButton(el) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Sign in with Google';
    b.style.minHeight = '44px';
    b.onclick = () => window.__gis.callback({ credential: window.__account || 'owner' });
    el.appendChild(b);
  },
  disableAutoSelect() {},
} } };`;

const s = (value) => ({ stringValue: value });
const feedbackDoc = (id, createTime, message, extra = {}) => ({
  name: `${DB}/feedback/${id}`,
  createTime,
  fields: { message: s(message), appVersion: s('dfae102'), screen: s('recap'), device: s('iphone'), workoutCount: { integerValue: '4' }, testerId: s(`tester-${id}-0000`), ...extra },
});
const eventDoc = (i, event, date, dayType = null, tester = 'tester-a-0000') => ({
  document: {
    name: `${DB}/events/e${i}`,
    fields: { testerId: s(tester), event: s(event), dayType: dayType ? s(dayType) : { nullValue: null }, appVersion: s('dfae102'), date: s(date), createdAt: { timestampValue: `${date}T10:00:00Z` } },
  },
});

const FEEDBACK = [
  feedbackDoc('old', '2026-11-02T09:00:00Z', 'Rest timer is too quiet on my phone.'),
  feedbackDoc('new', '2026-11-13T18:30:00Z', 'Loved the warm-up sets. Could Switch remember my last pick?', { name: s('Priya') }),
  feedbackDoc('mid', '2026-11-08T12:00:00Z', 'Done earlier', { done: { booleanValue: true } }),
];
const EVENTS = [
  eventDoc(1, 'workout-started', '2026-11-10', 'push'),
  eventDoc(2, 'workout-finished', '2026-11-10', 'push'),
  eventDoc(3, 'workout-started', '2026-11-12', 'picked', 'tester-b-0000'),
  eventDoc(4, 'workout-cut-short', '2026-11-12', 'picked', 'tester-b-0000'),
  eventDoc(5, 'switch', '2026-11-12', null, 'tester-b-0000'),
  eventDoc(6, 'switch', '2026-11-15', null, 'tester-b-0000'), // Sunday: still this week
  eventDoc(7, 'workout-finished', '2026-11-08', 'legs'), // Sunday before: last week
  eventDoc(8, 'backup', '2026-10-20', null, 'tester-c-0000'),
];

async function setup(context, { data = 'full', gis = 'ok', patches = [], flags = {} } = {}) {
  await context.route('https://accounts.google.com/gsi/client', (route) => gis === 'ok'
    ? route.fulfill({ contentType: 'text/javascript', body: GIS_STUB })
    : route.abort());
  await context.route('https://identitytoolkit.googleapis.com/**', (route) => {
    const body = route.request().postDataJSON();
    const token = /id_token=([^&]+)/.exec(body.postBody)?.[1];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ idToken: `tok-${token}`, email: 'hidden' }) });
  });
  await context.route('https://firestore.googleapis.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const auth = request.headers().authorization;
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
    if (auth === 'Bearer tok-other') return reply(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
    if (auth !== 'Bearer tok-owner' || flags.expired) return reply(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    const url = request.url();
    if (request.method() === 'PATCH') {
      patches.push({ url, body: request.postDataJSON() });
      return reply(200, { name: url.split('/v1/')[1].split('?')[0], fields: request.postDataJSON().fields });
    }
    if (url.includes(':runQuery')) return reply(200, data === 'full' ? EVENTS : [{ readTime: '2026-11-14T10:00:00Z' }]);
    if (url.includes('/feedback?')) return reply(200, data === 'full' ? { documents: FEEDBACK } : {});
    failures.push(`unexpected Firestore call ${request.method()} ${url}`);
    return reply(404, {});
  });
}

async function open(browser, size, options = {}) {
  const context = await browser.newContext({ viewport: size });
  await setup(context, options);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  if (options.account) await page.addInitScript((account) => { window.__account = account; }, options.account);
  await page.goto(`${base}admin`);
  return { context, page, errors };
}

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page, name, where) => { if (shots) await page.screenshot({ path: join(shots, `359-admin-${name}-${where}.png`), fullPage: true }); };

const browser = await chromium.launch();
try {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 780 }, { width: 1280, height: 800 }]) {
    const where = `${size.width}x${size.height}`;

    // Signed out.
    {
      const { context, page, errors } = await open(browser, size);
      await page.getByText('Sign in with Google to see feedback and usage.').waitFor();
      check(await page.getByRole('button', { name: 'Sign in with Google' }).isVisible(), `${where}: no sign-in button when signed out`);
      check(!(await page.getByText(/Rest timer/).count()), `${where}: data shown signed out`);
      check(await fitsWidth(page), `${where}: signed out scrolls sideways`);
      check((await page.title()) === 'Home Strength admin', `${where}: title ${await page.title()}`);
      await shot(page, 'signed-out', where);
      check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // Another Google account: the rules refuse; the page says Not allowed and offers sign-in again.
    {
      const { context, page, errors } = await open(browser, size, { account: 'other' });
      await page.getByRole('button', { name: 'Sign in with Google' }).click();
      await page.getByRole('heading', { name: 'Not allowed' }).waitFor();
      check(await page.getByRole('button', { name: 'Sign in with Google' }).isVisible(), `${where}: no way to switch account after Not allowed`);
      check(!(await page.getByText(/Rest timer|Tester IDs/).count()), `${where}: data shown to another account`);
      await shot(page, 'not-allowed', where);
      check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // Google's script unreachable.
    {
      const { context, page } = await open(browser, size, { gis: 'down' });
      await page.getByText("Couldn't reach Google sign-in. Check the connection and reload.").waitFor();
      await context.close();
    }

    // Owner, nothing yet.
    {
      const { context, page, errors } = await open(browser, size, { data: 'empty' });
      await page.getByRole('button', { name: 'Sign in with Google' }).click();
      await page.getByText('No feedback yet.').waitFor();
      await shot(page, 'empty-feedback', where);
      await page.getByRole('tab', { name: 'Testers' }).click();
      const tiles = await page.locator('.adm-tile__value').allInnerTexts();
      check(tiles.join() === '0,0,0,0', `${where}: empty tester counts ${tiles}`);
      check(await page.getByText(/No testers seen yet/).isVisible(), `${where}: empty testers not said`);
      await page.getByRole('tab', { name: "What's used" }).click();
      check(await page.getByText('No usage yet in the last 8 weeks.').isVisible(), `${where}: empty usage not said`);
      await shot(page, 'empty-usage', where);
      check(await fitsWidth(page), `${where}: empty pages scroll sideways`);
      check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
      await context.close();
    }

    // Owner with data; then the token runs out mid-use.
    {
      const patches = [];
      const flags = {};
      const { context, page, errors } = await open(browser, size, { patches, flags });
      await page.getByRole('button', { name: 'Sign in with Google' }).click();
      await page.getByRole('tab', { name: 'Feedback (2)' }).waitFor();
      const messages = await page.locator('.adm-note__msg').allInnerTexts();
      check(messages[0]?.startsWith('Loved the warm-up') && messages[2]?.startsWith('Rest timer'), `${where}: not newest first: ${messages}`);
      const old = page.locator('.adm-note').filter({ hasText: 'Rest timer' });
      check(await old.getByRole('button', { name: 'Mark done' }).isVisible(), `${where}: an old note without done does not read open`);
      check(await page.locator('.adm-note').filter({ hasText: 'Loved' }).getByText(/from Priya/).isVisible(), `${where}: name not shown`);
      check(await page.locator('.adm-note').filter({ hasText: 'Loved' }).getByText(/Tester tester-n · version dfae102/).isVisible(), `${where}: tester ID or version missing`);
      check(await page.locator('.adm-note').filter({ hasText: 'Loved' }).getByText(/Workout recap/).isVisible(), `${where}: screen missing`);
      await shot(page, 'feedback', where);
      check(await fitsWidth(page), `${where}: feedback scrolls sideways`);

      await old.getByRole('button', { name: 'Mark done' }).click();
      await old.getByRole('button', { name: 'Mark not done' }).waitFor();
      check(await old.getByText('Done', { exact: true }).isVisible(), `${where}: no Done chip after Mark done`);
      check(await page.getByRole('tab', { name: 'Feedback (1)' }).isVisible(), `${where}: open count did not drop`);
      const patch = patches[0];
      check(patch && /\/feedback\/old\?updateMask\.fieldPaths=done&currentDocument\.exists=true$/.test(patch.url), `${where}: patch url ${patch?.url}`);
      check(patch && JSON.stringify(patch.body) === '{"fields":{"done":{"booleanValue":true}}}', `${where}: patch body ${JSON.stringify(patch?.body)}`);

      await page.getByRole('tab', { name: 'Testers' }).click();
      const tiles = await page.locator('.adm-tile__value').allInnerTexts();
      // a, b, c from events + new, mid, old from notes = 6; new this week: b + note "new"; active this week:
      // a, b, new; the last 4 weeks (from Mon 19 Oct) hold all six.
      check(tiles.join() === '6,2,3,6', `${where}: tester counts ${tiles}`);
      await shot(page, 'testers', where);

      await page.getByRole('tab', { name: "What's used" }).click();
      check(await page.getByText('This week, from Mon 9 Nov').isVisible(), `${where}: week label`);
      const rows = async () => Object.fromEntries((await page.locator('.adm-counts__row').allInnerTexts()).map((row) => row.split('\n')).map(([k, v]) => [k.trim(), v?.trim()]));
      let counts = await rows();
      check(counts.Started === '2' && counts.Finished === '1' && counts['Cut short'] === '1', `${where}: workouts ${JSON.stringify(counts)}`);
      check(counts.Push === '1' && counts['Picked day'] === '0' && counts.Legs === '0', `${where}: by day type ${JSON.stringify(counts)}`);
      check(counts.Switch === '2' && counts.Backup === '0', `${where}: taps ${JSON.stringify(counts)}`);
      await shot(page, 'usage', where);
      check(await fitsWidth(page), `${where}: usage scrolls sideways`);
      await page.getByRole('button', { name: 'Earlier week' }).click();
      check(await page.getByText('Week from Mon 2 Nov').isVisible(), `${where}: earlier week label`);
      counts = await rows();
      check(counts.Finished === '1' && counts.Legs === '1' && counts.Switch === '0', `${where}: last week ${JSON.stringify(counts)}`);
      check(await page.getByRole('button', { name: 'Later week' }).isEnabled(), `${where}: cannot step back to this week`);

      // Token runs out mid-use.
      await page.getByRole('tab', { name: 'Feedback (1)' }).click();
      flags.expired = true;
      await page.locator('.adm-note').filter({ hasText: 'Loved' }).getByRole('button', { name: 'Mark done' }).click();
      await page.getByText('Your sign-in ran out. Sign in again.').waitFor();
      check(await page.getByRole('button', { name: 'Sign in with Google' }).isVisible(), `${where}: no sign-in after expiry`);
      check(!(await page.getByText(/Loved the warm-up/).count()), `${where}: data still shown after expiry`);
      await shot(page, 'expired', where);
      check(errors.length === 0, `${where}: page errors ${errors.join(' | ')}`);
      await context.close();
    }
  }

  // The training app never loads the admin chunk or Google's script.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const requests = [];
    context.on('request', (request) => requests.push(request.url()));
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Get started' }).waitFor();
    await page.waitForTimeout(300);
    check(!requests.some((u) => u.includes('accounts.google.com')), 'training app requested Google sign-in');
    const scripts = [...new Set(requests.filter((u) => u.endsWith('.js') && !u.endsWith('/sw.js')))];
    check(scripts.length === 1, `training app loaded ${scripts.length} scripts: ${scripts.join(', ')}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`admin: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('admin: signed out, other account, Google down, empty, data, Mark done, expiry (390x844, 360x780, 1280x800)');
