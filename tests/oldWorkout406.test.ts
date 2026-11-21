import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession, unfinishedSince } from '../src/lib/session.ts';
import { START_OVER_BLOCKED, startOverBlocked } from '../src/lib/storage.ts';
import type { Profile } from '../src/types.ts';

// #406: the last places that called an old unfinished workout "in progress" or promised its length.
// One stale test (`unfinishedSince`, lesson 36) drives all of them; a same-day session is unchanged.

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const home = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: { Dumbbell: [10, 15, 18] }, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), home, []);
const STARTED = local(2026, 11, 12, 18);
const LATER = local(2026, 11, 17, 9);
const SAME_DAY = local(2026, 11, 12, 23, 59);
const session = createSession({ id: 's', name: 'Push', dayIndex: 0, durationMin: 35, exercises: liveExercises(adapted, home, []), now: STARTED.toISOString() });
const SINCE = 'Thu, Nov 12';

async function withModules(run: (m: Record<string, any>) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    run({
      Today: (await server.ssrLoadModule('/src/screens/TodayScreen.tsx')).default,
      Progress: (await server.ssrLoadModule('/src/screens/ProgressScreen.tsx')).default,
      sheets: await server.ssrLoadModule('/src/screens/Sheets.tsx'),
    });
  } finally {
    await server.close();
  }
}

const today = (m: Record<string, any>, now: Date) => renderToStaticMarkup(createElement(m.Today, { profile: home, program: FULL_BODY_A, adapted,
  equipment: 'home', adjusted: false, history: [], current: session, now, slotLabel: 'Day 1 of 3', onPreview: noop, onAdjust: noop, onResume: noop,
  onEnd: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onOpenLength: noop, onOpenGym: noop, onOpenSwitch: noop }));
const progress = (m: Record<string, any>, extra: Record<string, unknown>) => renderToStaticMarkup(createElement(m.Progress, { history: [], unit: 'kg',
  onBackup: noop, onCorrect: noop, onDelete: noop, onFeedback: noop, onStartToday: noop, running: true, ...extra }));
const buttons = (html: string) => [...html.matchAll(/<button class="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].filter((x) => x[1] !== 'icon-btn').map((x) => [x[1], plain(x[2]).replace(/arrow_forward/, '').trim()]);

test('#406 the fixture is old at LATER and same-day at 23:59', () => {
  assert.equal(unfinishedSince(session, LATER), SINCE);
  assert.equal(unfinishedSince(session, SAME_DAY), null);
});

test('#406 item 1: the replace sheet says "from <day> is still open" for an old workout, "in progress" otherwise', async () => {
  await withModules(({ sheets }) => {
    const sheet = (since?: string | null) => plain(renderToStaticMarkup(createElement(sheets.DiscardSessionSheet, { currentName: 'Push', nextName: 'Pull', since, onDiscard: noop, onKeep: noop })));
    assert.match(sheet(SINCE), /Push from Thu, Nov 12 is still open\. Starting Pull discards it/);
    assert.doesNotMatch(sheet(SINCE), /in progress/);
    assert.match(sheet(null), /Push is still in progress\. Starting Pull discards it/);
    assert.match(sheet(undefined), /Push is still in progress/);
  });
});

test('#406 item 2: the start-over block names the day for an old workout and is unchanged for a same-day one', async () => {
  assert.equal(startOverBlocked(SINCE), 'A workout from Thu, Nov 12 is still open. End or finish it first, then start over.');
  assert.equal(startOverBlocked(null), START_OVER_BLOCKED);
  await withModules(({ sheets }) => {
    const sheet = (since: string | null) => plain(renderToStaticMarkup(createElement(sheets.StartOverSheet, { sessionOpen: true, since, onBackup: async () => ({ ok: false, message: null }), onErase: () => ({ ok: true }), onClose: noop })));
    assert.match(sheet(SINCE), /A workout from Thu, Nov 12 is still open\. End or finish it first/);
    assert.doesNotMatch(sheet(SINCE), /in progress/);
    assert.match(sheet(null), /A workout is in progress\. Finish or discard it first/);
  });
});

test('#406 item 3: Progress leads with End or Finish for an old workout, Resume is the quiet link; same day unchanged', async () => {
  await withModules((m) => {
    const old0 = buttons(progress(m, { unfinished: true, loggedSets: 0, onEnd: noop }));
    assert.deepEqual(old0, [['primary', 'End workout'], ['link-btn', 'Resume']]);
    assert.deepEqual(buttons(progress(m, { unfinished: true, loggedSets: 2, onEnd: noop })), [['primary', 'Finish workout'], ['link-btn', 'Resume']]);
    assert.deepEqual(buttons(progress(m, { unfinished: false, onEnd: noop })), [['primary', 'Resume workout']]);
    assert.deepEqual(buttons(progress(m, { running: false })), [['primary', 'Start today&#x27;s workout']]);
  });
});

test('#406 items 4 and 5: an old workout shows the info icon and "{N} sets" only; a same-day one keeps play and its length', async () => {
  await withModules((m) => {
    const old = today(m, LATER);
    const chip = /<span class="t7-state[^"]*"><span [^>]*>(\w+)<\/span>/.exec(old)?.[1];
    assert.equal(chip, 'info');
    const head = plain(/<div class="list-head">[\s\S]*?<\/div>/.exec(old)?.[0] ?? '');
    assert.match(head, /^ The workout \d+ sets? $/, `old header: "${head}"`);
    assert.doesNotMatch(head, /min/);
    const same = today(m, SAME_DAY);
    assert.equal(/<span class="t7-state[^"]*"><span [^>]*>(\w+)<\/span>/.exec(same)?.[1], 'play_arrow');
    assert.match(plain(/<div class="list-head">[\s\S]*?<\/div>/.exec(same)?.[0] ?? ''), /\d+ min · \d+ sets/);
  });
});
