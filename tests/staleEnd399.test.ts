import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession, logSet, skipExercise, swapPendingExercise, unfinishedSince, updatePerformedSet } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #399: a workout left open from an earlier day leads with its way out. With nothing logged the main
// button is End workout; with sets logged it is Finish workout (the sheet that saves them). Resume is
// the quiet choice. No stale surface says "In progress": Today's eyebrow and pill, and Plan's Today row,
// all read the one stale test (`unfinishedSince`). A same-day session is unchanged.

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const home = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: { Dumbbell: [10, 15, 18] }, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), home, []);
const STARTED = local(2026, 11, 12, 18);
const LATER = local(2026, 11, 17, 9);
const empty = createSession({ id: 's', name: 'Push', dayIndex: 0, durationMin: 35, exercises: liveExercises(adapted, home, []), now: STARTED.toISOString() });
// Two sets logged: the first set of each of the first two exercises (a first-time lift needs its load typed).
const logFirst = (session: WorkoutRecord, exerciseIndex: number) =>
  logSet(updatePerformedSet(session, exerciseIndex, 0, { weight: 15 }), exerciseIndex, 0, STARTED.toISOString());
const twoDone = logFirst(logFirst(empty, 0), 1);
const setsOf = (session: WorkoutRecord) => session.exercises.flatMap((exercise) => exercise.performed).length;

const heroOf = (html: string) => /<section class="t7-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
const eyebrowOf = (html: string) => /<span class="t7-hero__eyebrow">([^<]*)<\/span>/.exec(html)?.[1];
const metaOf = (html: string) => plain(/<span class="t7-hero__meta">[\s\S]*?<\/span>\s*<span class="t7-state/.exec(html)?.[0].replace(/<span class="t7-state$/, '') ?? '').trim();
const chipOf = (html: string) => /<span class="t7-state t7-state--\w+"><span [^>]*>\w+<\/span>([^<]+)<\/span>/.exec(html)?.[1].trim();
const dockOf = (html: string) => /<div class="flow-dock"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
/** The dock's buttons in order: [class, words]. */
const buttonsOf = (html: string) => [...dockOf(html).matchAll(/<button class="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((match) => [match[1], plain(match[2]).replace(/arrow_forward/, '').trim()]);
const planChipOf = (html: string) => /<span class="plan-chip plan-chip--(\w+)">([^<]+)<\/span>/.exec(html)?.slice(1);

async function withScreens(run: (screens: { today: (current: WorkoutRecord, now: Date) => string; plan: (current: WorkoutRecord, now?: Date) => string;
  train: (session: WorkoutRecord) => string }) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const Today = (await server.ssrLoadModule('/src/screens/TodayScreen.tsx')).default;
    const Plan = (await server.ssrLoadModule('/src/screens/PlanScreen.tsx')).default;
    const Train = (await server.ssrLoadModule('/src/screens/TrainScreen.tsx')).default;
    run({
      today: (current, now) => renderToStaticMarkup(createElement(Today, { profile: home, program: FULL_BODY_A, adapted, equipment: 'home',
        adjusted: false, history: [], current, now, slotLabel: 'Day 1 of 3', onPreview: noop, onAdjust: noop, onResume: noop, onEnd: noop,
        onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onOpenLength: noop, onOpenGym: noop, onOpenSwitch: noop })),
      plan: (current, now) => renderToStaticMarkup(createElement(Plan, { profile: home, program: FULL_BODY_A, today: todayGlance(adapted, current),
        history: [], unit: 'kg', current, now, onResume: noop, onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop })),
      train: (session) => renderToStaticMarkup(createElement(Train, { session, history: [], now: STARTED.getTime(), rampLoads: [10, 15, 18],
        calibrationLoads: [10, 15, 18], profileLoads: { Dumbbell: [10, 15, 18] }, unit: 'kg', onMinimize: noop, onFinish: noop, onUpdateSet: noop,
        onConfirmWeight: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop })),
    });
  } finally {
    await server.close();
  }
}

test('#399 stale, 0 sets: End workout is the primary, Resume the quiet link; nothing says "In progress" or a length', async () => {
  await withScreens(({ today }) => {
    const html = today(empty, LATER);
    assert.match(plain(html), /Unfinished Push from Thu, Nov 12/);
    assert.equal(eyebrowOf(html), 'Unfinished');
    assert.equal(chipOf(html), `0 of ${setsOf(empty)} sets logged`);
    assert.doesNotMatch(plain(heroOf(html)), /In progress|in progress/, 'no stale surface says In progress');
    assert.doesNotMatch(metaOf(html), /min|≈/, `the meta line promises no length: "${metaOf(html)}"`);
    assert.match(metaOf(html), /Day 1 of 3/, 'the slot stays');
    assert.doesNotMatch(heroOf(html), /aria-label="[^"]*minutes/, 'nor does the hero\'s spoken name');
    assert.deepEqual(buttonsOf(html), [['link-btn today-end', 'Resume'], ['pill-primary', 'End workout']]);
  });
});

test('#399 stale, sets logged: Finish workout is the primary (the sheet saves them), Resume stays', async () => {
  assert.equal(twoDone.exercises.flatMap((exercise) => exercise.performed).filter((set) => set.done).length, 2, 'the fixture has 2 sets logged');
  await withScreens(({ today }) => {
    const html = today(twoDone, LATER);
    assert.equal(eyebrowOf(html), 'Unfinished');
    assert.equal(chipOf(html), `2 of ${setsOf(twoDone)} sets logged`);
    assert.deepEqual(buttonsOf(html), [['link-btn today-end', 'Resume'], ['pill-primary', 'Finish workout']]);
    assert.doesNotMatch(dockOf(html), /End workout/, 'End workout would read as losing the logged sets');
  });
});

test('#399 same day: unchanged. In progress, its length, Resume workout primary and the End link', async () => {
  await withScreens(({ today }) => {
    for (const session of [empty, twoDone]) {
      const html = today(session, local(2026, 11, 12, 23, 59));
      const done = session === empty ? 0 : 2;
      assert.equal(eyebrowOf(html), 'In progress');
      assert.equal(chipOf(html), `In progress · ${done} of ${setsOf(session)} sets`);
      assert.match(metaOf(html), /\d+ min/);
      assert.deepEqual(buttonsOf(html), [['link-btn today-end', 'End'], ['pill-primary', 'Resume workout']]);
    }
  });
});

test('#399 midnight: started 23:50, seen at 00:10, Today and Plan both say Unfinished from the one stale test', async () => {
  const started = local(2026, 11, 16, 23, 50);
  const session = { ...empty, date: started.toISOString() };
  await withScreens(({ today, plan }) => {
    for (const [now, stale] of [[local(2026, 11, 16, 23, 59), false], [local(2026, 11, 17, 0, 10), true]] as const) {
      assert.equal(unfinishedSince(session, now) !== null, stale);
      assert.equal(eyebrowOf(today(session, now)), stale ? 'Unfinished' : 'In progress');
      assert.deepEqual(planChipOf(plan(session, now)), ['progress', `${stale ? 'Unfinished' : 'In progress'} · 0 of ${setsOf(session)} sets`]);
    }
  });
});

test('#399 Plan: a stale session reads "Unfinished · N of M sets", counting the same sets as Today', async () => {
  await withScreens(({ today, plan }) => {
    assert.deepEqual(planChipOf(plan(twoDone, LATER)), ['progress', `Unfinished · 2 of ${setsOf(twoDone)} sets`]);
    assert.doesNotMatch(plain(plan(twoDone, LATER)), /In progress/);
    assert.equal(chipOf(today(twoDone, LATER)), `2 of ${setsOf(twoDone)} sets logged`, 'Today and Plan count alike');
    assert.deepEqual(planChipOf(plan(twoDone, STARTED)), ['progress', `In progress · 2 of ${setsOf(twoDone)} sets`]);
    // No clock given (an older caller): the row keeps its old words rather than guessing.
    assert.deepEqual(planChipOf(plan(twoDone)), ['progress', `In progress · 2 of ${setsOf(twoDone)} sets`]);
  });
});

test('#399 legacy: a session with no date, or an unreadable one, is never called stale', async () => {
  await withScreens(({ today, plan }) => {
    for (const date of [undefined, 'not a date']) {
      const legacy = { ...empty, date } as unknown as WorkoutRecord;
      const html = today(legacy, LATER);
      assert.equal(eyebrowOf(html), 'In progress');
      assert.deepEqual(buttonsOf(html), [['link-btn today-end', 'End'], ['pill-primary', 'Resume workout']]);
      assert.equal(planChipOf(plan(legacy, LATER))?.[1], `In progress · 0 of ${setsOf(legacy)} sets`);
    }
  });
});

test('#399 a swap made before the session went stale: the card counts the session as swapped', async () => {
  const swapped = swapPendingExercise(empty, 0, { exerciseId: 'push-up', name: 'Push-Up', weight: 0, reps: 10 });
  assert.notEqual(swapped, empty);
  assert.equal(swapped.exercises[0].exerciseId, 'push-up');
  await withScreens(({ today, plan }) => {
    const html = today(swapped, LATER);
    assert.equal(chipOf(html), `0 of ${setsOf(swapped)} sets logged`);
    assert.deepEqual(buttonsOf(html), [['link-btn today-end', 'Resume'], ['pill-primary', 'End workout']]);
    assert.equal(planChipOf(plan(swapped, LATER))?.[1], `Unfinished · 0 of ${setsOf(swapped)} sets`);
  });
});

test('#399 logger save bar (nothing left to log): "End workout" with no set logged, "Finish workout" once one is', async () => {
  // The bar shows on the logger's review state, so skip whatever is still open.
  const skipRest = (session: WorkoutRecord) => session.exercises.reduce((next, _, index) => skipExercise(next, index), session);
  await withScreens(({ train }) => {
    const bar = (html: string) => /<button class="save-bar"[^>]*>([^<]*)<\/button>/.exec(html)?.[1].trim();
    assert.equal(bar(train(skipRest(empty))), 'End workout');
    assert.equal(bar(train(skipRest(twoDone))), 'Finish workout');
    assert.doesNotMatch(plain(train(skipRest(empty))), /Finish or discard/);
  });
});
