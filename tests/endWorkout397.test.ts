import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { applyCancel, createSession, unfinishedSince } from '../src/lib/session.ts';
import { currentSlot, cursorFor, skipCurrentSlot } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

// #397: the owner could not end a 5-day-old empty Push. The way out now says "End", Today offers End next
// to Resume, a session from an earlier day reads "Unfinished … from …", and the top chips are never dead.

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('unfinishedSince: null on the day it started, the start day (Thu, Nov 12) on any later day', () => {
  const started = local(2026, 11, 12, 18).toISOString();
  assert.equal(unfinishedSince(null, local(2026, 11, 17, 9)), null);
  assert.equal(unfinishedSince({ date: started }, local(2026, 11, 12, 23, 59)), null, 'same day: still today\'s');
  assert.equal(unfinishedSince({ date: started }, local(2026, 11, 17, 9)), 'Thu, Nov 12', 'five days later');
  assert.equal(unfinishedSince({ date: 'not a date' }, local(2026, 11, 17, 9)), null, 'a bad date never claims a day');
});

test('midnight: a session started 23:50 and seen at 00:10 is from yesterday', () => {
  const started = local(2026, 11, 16, 23, 50).toISOString();
  assert.equal(unfinishedSince({ date: started }, local(2026, 11, 16, 23, 59)), null);
  assert.equal(unfinishedSince({ date: started }, local(2026, 11, 17, 0, 10)), 'Mon, Nov 16');
});

const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];

test('End workout keeps Push next; End and skip to Pull moves the plan, recorded as a skip', () => {
  const session = createSession({ id: 'empty', name: 'Push', dayIndex: 0, now: '2026-11-12T10:00:00.000Z', exercises: [] });
  const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 }, current: session } as unknown as AppState;
  const ended = applyCancel(state, 'empty');
  assert.equal(ended.current, null);
  assert.equal(currentSlot(ended)?.name, 'Push');
  assert.equal(ended.history.length, 0);
  assert.equal(ended.slotSkips?.length ?? 0, 0);
  const skipped = skipCurrentSlot(applyCancel(state, 'empty'), '2026-11-17T10:00:00.000Z', cursorFor(state));
  assert.equal(currentSlot(skipped)?.name, 'Pull');
  assert.equal(skipped.slotSkips?.length, 1);
  assert.deepEqual(Object.keys(ended).sort(), Object.keys(state).sort(), 'no new stored key');
});

test('the empty sheet with no next day shows only End workout and Keep going', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { FinishSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(FinishSheet, { done: 0, total: 12, onSave: noop, onContinue: noop,
      onDiscard: noop, onClose: noop, onSkip: noop }));
    const words = text(html);
    assert.match(words, /End this workout\?/);
    assert.match(words, /End workout/);
    assert.match(words, /Keep going/);
    assert.doesNotMatch(words, /skip to/i);
    assert.match(html, /<button class="primary"[^>]*>End workout/, 'End workout is the primary action');
  } finally {
    await server.close();
  }
});

test('Today with an open session: End beside Resume workout; a stale one reads Unfinished … from … with Resume', async () => {
  const home = { ...profile, loads: { Dumbbell: [10, 15, 18] } } as unknown as Profile;
  const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), home, []);
  const started = local(2026, 11, 12, 18).toISOString();
  const session = createSession({ id: 's', name: 'Push', dayIndex: 0, durationMin: 35, exercises: liveExercises(adapted, home, []), now: started });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const Today = (await server.ssrLoadModule('/src/screens/TodayScreen.tsx')).default;
    const noop = () => {};
    const render = (now: Date) => renderToStaticMarkup(createElement(Today, { profile: home, program: FULL_BODY_A, adapted, equipment: 'home',
      adjusted: false, history: [], current: session, now, onPreview: noop, onAdjust: noop, onResume: noop, onEnd: noop, onWhy: noop,
      onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onOpenLength: noop, onOpenGym: noop, onOpenSwitch: noop }));
    const dock = (html: string) => /<div class="flow-dock"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    const sameDay = render(local(2026, 11, 12, 19));
    assert.match(text(sameDay), /Push in progress/);
    assert.match(dock(sameDay), /<button class="link-btn today-end"[^>]*>End<\/button>/);
    assert.match(dock(sameDay), />Resume workout/);
    assert.doesNotMatch(sameDay, /<button[^>]*t7-pill[^>]*disabled/, 'no chip is disabled while a session is open');
    const stale = render(local(2026, 11, 17, 9));
    assert.match(text(stale), /Unfinished Push from Thu, Nov 12/);
    assert.doesNotMatch(text(stale), /Push in progress/);
    assert.match(dock(stale), />Resume</);
    assert.doesNotMatch(dock(stale), /Resume workout/);
    assert.match(dock(stale), />End<\/button>/);
  } finally {
    await server.close();
  }
});

test('App: no "Finish or discard" heads-up remains, and chips route through openChip', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Finish or discard the open session/);
  assert.match(app, /onOpenLength=\{\(\) => openChip\('length'\)\}/);
  assert.match(app, /onOpenGym=\{\(\) => openChip\('gym'\)\}/);
  assert.match(app, /openChip\('switch'\)/);
  assert.match(app, /onEnd=\{current \? endFromToday : undefined\}/);
});
