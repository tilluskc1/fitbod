import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ABOUT_CREDITS, ABOUT_HOSTING, ABOUT_RECEIVE, ABOUT_WHO, ABOUT_WORKOUTS, FEEDBACK_SENT } from '../src/lib/about.ts';
import { feedbackBody } from '../src/lib/sendFeedback.ts';

// #253 Settings > About. The copy is the product default; "what we receive" must name every field a
// feedback note carries, so a new field in feedbackBody fails here until the About text says what it is.

const fullNote = feedbackBody({
  message: 'Hi',
  name: 'Sam',
  appVersion: 'abc1234',
  screen: 'settings',
  device: 'iphone',
  workoutCount: 3,
  testerId: 'abcdef12-3456',
})!;

test('#253 "what we receive" lists exactly the fields a feedback note sends', () => {
  const sent = Object.keys(fullNote.fields).sort();
  const listed = FEEDBACK_SENT.map((item) => item.field).sort();
  assert.deepEqual(listed, sent);
  assert.equal(new Set(listed).size, listed.length, 'each field named once');
  for (const { says } of FEEDBACK_SENT) assert.ok(ABOUT_RECEIVE.includes(says), `About text names "${says}"`);
});

test('#253 the About copy is the product default, word for word', () => {
  assert.equal(ABOUT_WHO, 'Home Strength is built and run by a small independent team.');
  assert.equal(
    ABOUT_WORKOUTS,
    "Your workouts, sets and settings stay on this phone, in this browser. We don't keep a copy. Back up regularly: clearing browser data deletes them.",
  );
  assert.equal(
    ABOUT_RECEIVE,
    'Only what you choose to send. A feedback note sends your message, your name if you add one, the screen you were on, your phone type, the app version, how many workouts you have logged, and a random ID that is the same for every note from this phone. Your workout details are never sent.',
  );
  assert.equal(ABOUT_HOSTING, 'Like any website, the host keeps basic server logs.');
  assert.deepEqual(ABOUT_CREDITS, [
    'Exercise photos: free-exercise-db (public domain).',
    'Welcome photo and video: made with AI by the Home Strength team.',
  ]);
});

test('#253 no name, no email address, no "we never collect" claim in the About copy', () => {
  const text = [ABOUT_WHO, ABOUT_WORKOUTS, ABOUT_RECEIVE, ABOUT_HOSTING, ...ABOUT_CREDITS].join(' ');
  assert.doesNotMatch(text, /@|mailto:/);
  assert.doesNotMatch(text, /never collect|no data|don't store data/i);
});

test('#253 the About sheet renders every group, the safety line and Send feedback', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createServer } = await import('vite');
  const { SAFETY_NOTICE } = await import('../src/lib/safety.ts');
  const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: AboutSheet } = await server.ssrLoadModule('/src/screens/AboutSheet.tsx');
    const html = plain(renderToStaticMarkup(createElement(AboutSheet, { onFeedback: () => {}, onClose: () => {} })));
    for (const line of ['About Home Strength', 'Who', 'Your workouts', 'What we receive', 'Hosting', 'Safety', 'Credits',
      ABOUT_WHO, ABOUT_WORKOUTS, ABOUT_RECEIVE, ABOUT_HOSTING, SAFETY_NOTICE, ...ABOUT_CREDITS, 'Send feedback', 'Done']) {
      assert.ok(html.includes(line), `About shows "${line}"`);
    }
    const without = plain(renderToStaticMarkup(createElement(AboutSheet, { onClose: () => {} })));
    assert.ok(!without.includes('Send feedback'), 'no Send feedback button without a feedback sheet');
  } finally {
    await server.close();
  }
});

test('#253 Settings keeps the safety line first in About and adds the About row', () => {
  const sheets = readFileSync(new URL('../src/screens/Sheets.tsx', import.meta.url), 'utf8');
  assert.match(
    sheets,
    /\{SAFETY_NOTICE\}<\/p>\s*<button className="settings-row settings-row--action" onClick=\{\(\) => setAboutOpen\(true\)\}>\s*About Home Strength\s*<\/button>/,
  );
});
