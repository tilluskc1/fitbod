import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession, logSet, skipExercise, updatePerformedSet } from '../src/lib/session.ts';
import { isStaleSession } from '../src/lib/staleSession.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #399: on a session from an earlier day, End was a small link above a big Resume, and the card still said
// "In progress". A stale session now leads with End workout (0 sets) or Finish workout (sets logged), Resume
// is the quiet link, and no stale surface says "In progress". A same-day session is unchanged.

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

test('isStaleSession: an earlier calendar day only; across midnight counts; a legacy or bad date never does', () => {
  const started = local(2026, 11, 12, 18).toISOString();
  assert.equal(isStaleSession(null, local(2026, 11, 17, 9)), false);
  assert.equal(isStaleSession({ date: started }, local(2026, 11, 12, 23, 59)), false, 'same day');
  assert.equal(isStaleSession({ date: started }, local(2026, 11, 17, 9)), true, 'five days later');
  const lateStart = local(2026, 11, 16, 23, 50).toISOString();
  assert.equal(isStaleSession({ date: lateStart }, local(2026, 11, 16, 23, 59)), false, '23:50 seen at 23:59');
  assert.equal(isStaleSession({ date: lateStart }, local(2026, 11, 17, 0, 10)), true, '23:50 seen at 00:10');
  assert.equal(isStaleSession({ date: undefined } as unknown as Pick<WorkoutRecord, 'date'>, local(2026, 11, 17, 9)), false, 'legacy: no date');
  assert.equal(isStaleSession({ date: '' }, local(2026, 11, 17, 9)), false, 'legacy: empty date');
  assert.equal(isStaleSession({ date: 'not a date' }, local(2026, 11, 17, 9)), false, 'bad date');
});

const home = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: { Dumbbell: [10, 15, 18] }, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), home, []);
const sessionAt = (start: Date) => createSession({ id: 's', name: 'Push', dayIndex: 0, durationMin: 35,
  exercises: liveExercises(adapted, home, []), now: start.toISOString() });
/** Logs set `setIndex` of exercise 0 at 15 kg (a 0 kg dumbbell set is refused). */
const logged = (session: WorkoutRecord, setIndex: number, at: string) =>
  logSet(updatePerformedSet(session, 0, setIndex, { weight: 15 }), 0, setIndex, at);
const total = (session: WorkoutRecord) => session.exercises.reduce((sum, exercise) => sum + exercise.performed.length, 0);

async function withServer(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<void>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    await run((path) => server.ssrLoadModule(path));
  } finally {
    await server.close();
  }
}

const parts = (html: string) => ({
  eyebrow: text(/<span class="t7-hero__eyebrow">[\s\S]*?<\/span>/.exec(html)?.[0] ?? ''),
  meta: text(/<span class="t7-hero__meta">[\s\S]*?<\/span>\s*<span class="t7-state/.exec(html)?.[0] ?? ''),
  // The chip's icon is a ligature (its name as text): drop it, keep the label.
  chip: text((/<span class="t7-state[\s\S]*?<\/span>\s*<\/section>/.exec(html)?.[0] ?? '').replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, '')),
  hero: text(/<section class="t7-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''),
  dock: /<div class="flow-dock"[\s\S]*?<\/div>\s*<\/div>\s*$/.exec(html)?.[0] ?? '',
});

async function renderToday(load: (path: string) => Promise<Record<string, unknown>>, current: WorkoutRecord, now: Date) {
  const Today = (await load('/src/screens/TodayScreen.tsx')).default;
  return renderToStaticMarkup(createElement(Today as never, { profile: home, program: FULL_BODY_A, adapted, equipment: 'home',
    adjusted: false, history: [], current, now, slotLabel: 'Day 1 of 3', onPreview: noop, onAdjust: noop, onResume: noop, onEnd: noop,
    onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onOpenLength: noop, onOpenGym: noop, onOpenSwitch: noop }));
}

test('Today, stale with 0 sets: Unfinished eyebrow, "0 of N sets logged", no duration, End workout primary, Resume link', async () => {
  await withServer(async (load) => {
    const session = sessionAt(local(2026, 11, 12, 18));
    const html = await renderToday(load, session, local(2026, 11, 17, 9));
    const { eyebrow, meta, chip, hero, dock } = parts(html);
    assert.equal(eyebrow, 'Unfinished');
    assert.match(hero, /Unfinished Push from Thu, Nov 12/);
    assert.equal(chip, `0 of ${total(session)} sets logged`);
    assert.doesNotMatch(hero, /In progress/);
    assert.doesNotMatch(meta, /min/, 'the stale meta line drops the duration');
    assert.match(meta, /Day 1 of 3/);
    assert.match(dock, /<button class="pill-primary"[^>]*>End workout<\/button>/, 'End workout is the black primary');
    assert.match(dock, /<button class="link-btn today-resume"[^>]*>Resume<\/button>/, 'Resume is the quiet link');
    assert.doesNotMatch(dock, /Resume workout|today-end|Finish workout/);
  });
});

test('Today, stale with sets logged: Finish workout primary, Resume link, "N of M sets logged"', async () => {
  await withServer(async (load) => {
    const start = local(2026, 11, 12, 18);
    const session = logged(logged(sessionAt(start), 0, start.toISOString()), 1, start.toISOString());
    const html = await renderToday(load, session, local(2026, 11, 17, 9));
    const { eyebrow, chip, hero, dock } = parts(html);
    assert.equal(eyebrow, 'Unfinished');
    assert.equal(chip, `2 of ${total(session)} sets logged`);
    assert.doesNotMatch(hero, /In progress/);
    assert.match(dock, /<button class="pill-primary"[^>]*>Finish workout<\/button>/);
    assert.match(dock, /<button class="link-btn today-resume"[^>]*>Resume<\/button>/);
    assert.doesNotMatch(dock, /End workout|today-end/);
  });
});

test('Today across midnight: started 23:50, seen 00:10 is the stale card; seen 23:59 is unchanged', async () => {
  await withServer(async (load) => {
    const session = sessionAt(local(2026, 11, 16, 23, 50));
    const after = parts(await renderToday(load, session, local(2026, 11, 17, 0, 10)));
    assert.equal(after.eyebrow, 'Unfinished');
    assert.match(after.dock, />End workout<\/button>/);
    const before = parts(await renderToday(load, session, local(2026, 11, 16, 23, 59)));
    assert.equal(before.eyebrow, 'In progress');
    assert.match(before.dock, />Resume workout/);
  });
});

test('Today, same-day session is unchanged: In progress, duration, End link above Resume workout', async () => {
  await withServer(async (load) => {
    const session = sessionAt(local(2026, 11, 12, 18));
    const { eyebrow, meta, chip, hero, dock } = parts(await renderToday(load, session, local(2026, 11, 12, 19)));
    assert.equal(eyebrow, 'In progress');
    assert.match(hero, /Push in progress/);
    assert.equal(chip, `In progress · 0 of ${total(session)} sets`);
    assert.match(meta, /\d+ min/);
    assert.match(dock, /<button class="link-btn today-end"[^>]*>End<\/button>\s*<button class="pill-primary"[^>]*>Resume workout/);
    assert.doesNotMatch(dock, /End workout|today-resume/);
  });
});

test('Plan, stale session: "Unfinished · N of M sets"; same day keeps "In progress · N of M sets"', async () => {
  await withServer(async (load) => {
    const Plan = (await load('/src/screens/PlanScreen.tsx')).default;
    const start = local(2026, 11, 12, 18);
    const session = logged(sessionAt(start), 0, start.toISOString());
    const render = (now: Date) => text(renderToStaticMarkup(createElement(Plan as never, { profile: home, program: FULL_BODY_A,
      today: todayGlance(adapted, session, false), history: [], unit: 'kg', current: session, now, onResume: noop,
      onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop })));
    const stale = render(local(2026, 11, 17, 9));
    assert.match(stale, new RegExp(`Today Unfinished · 1 of ${total(session)} sets`));
    assert.doesNotMatch(stale, /In progress/);
    assert.match(stale, /Resume/);
    const midnight = render(local(2026, 11, 13, 0, 10));
    assert.match(midnight, /Today Unfinished · 1 of/, 'started 18:00, seen 00:10 the next day');
    const sameDay = render(local(2026, 11, 12, 19));
    assert.match(sameDay, new RegExp(`Today In progress · 1 of ${total(session)} sets`));
    assert.doesNotMatch(sameDay, /Unfinished/);
  });
});

test('(#399 review 1) Plan with no now reads the live clock: a 23:50 session is In progress at 23:59, Unfinished at 00:10', async () => {
  await withServer(async (load) => {
    const Plan = (await load('/src/screens/PlanScreen.tsx')).default;
    const session = sessionAt(local(2026, 11, 16, 23, 50));
    const render = () => text(renderToStaticMarkup(createElement(Plan as never, { profile: home, program: FULL_BODY_A,
      today: todayGlance(adapted, session, false), history: [], unit: 'kg', current: session, onResume: noop,
      onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop })));
    mock.timers.enable({ apis: ['Date'], now: local(2026, 11, 16, 23, 59) });
    try {
      const before = render();
      mock.timers.setTime(local(2026, 11, 17, 0, 10).getTime());
      const after = render();
      assert.match(before, /Today In progress · 0 of/);
      assert.match(after, /Today Unfinished · 0 of/);
    } finally {
      mock.timers.reset();
    }
  });
});

test('Logger save bar: End workout at 0 sets, Finish workout once a set is logged', async () => {
  await withServer(async (load) => {
    const Train = (await load('/src/screens/TrainScreen.tsx')).default;
    const RACK = [10, 15, 18];
    const render = (session: WorkoutRecord) => renderToStaticMarkup(createElement(Train as never, { session, history: [],
      now: Date.parse('2026-11-04T10:05:00.000Z'), rampLoads: RACK, calibrationLoads: RACK, profileLoads: { Dumbbell: RACK }, unit: 'kg',
      onMinimize: noop, onFinish: noop, onUpdateSet: noop, onConfirmWeight: noop, onLogSet: noop, onToggleRestPause: noop,
      onExtendRest: noop, onOpenActions: noop, onReturn: noop }));
    const bar = (html: string) => text(/<button class="save-bar"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? '');
    const start = sessionAt(local(2026, 11, 4, 10));
    const allSkipped = start.exercises.reduce((session, _entry, index) => skipExercise(session, index), start);
    assert.equal(bar(render(allSkipped)), 'End workout');
    const oneLogged = logged(start, 0, '2026-11-04T10:02:00.000Z');
    const rest = oneLogged.exercises.reduce((session, _entry, index) => skipExercise(session, index), oneLogged);
    assert.equal(bar(render(rest)), 'Finish workout');
    assert.doesNotMatch(render(allSkipped), /Finish or discard/);
  });
});

test('one stale test: Today and Plan both read isStaleSession; the stale primary is Today\'s own End path', () => {
  const today = readFileSync(new URL('../src/screens/TodayScreen.tsx', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../src/screens/PlanScreen.tsx', import.meta.url), 'utf8');
  assert.match(today, /isStaleSession\(current, now\)/);
  // (#399 review 1) Plan reads the live clock at render, never one frozen at mount.
  assert.match(plan, /isStaleSession\(current, now \?\? new Date\(\)\)/);
  assert.doesNotMatch(plan, /useState\(\(\) => new Date\(\)\)/);
  assert.match(today, /<button className="pill-primary" onClick=\{onEnd\}>/, 'End workout and Finish workout both call onEnd');
});
