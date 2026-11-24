import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

/**
 * #260: a running session read as running on Today. #430 (ruling 4a) changed the surface: Today always
 * shows the plan (its own status chip, Preview and the adjust action), and the open workout reads in the
 * quiet resume row above it (`openRow`) and in the filled set count. Resume lives on that row and in Plan.
 */
const profile: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: [10, 15, 18] }, unit: 'kg',
};
const adapted = liveAdapted(adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: [10, 15, 18] }, [], undefined), profile, []);
const START = '2026-11-04T10:00:00.000Z';
const fresh = createSession({ id: 's', name: adapted.name, dayIndex: 0, durationMin: 35,
  exercises: liveExercises(adapted, profile, []), now: START });
// Two sets logged: the first exercise's first set and the second exercise's first set.
const logAt = (session: WorkoutRecord, exerciseIndex: number, at: string) =>
  logSet(updatePerformedSet(session, exerciseIndex, 0, { weight: 15 }), exerciseIndex, 0, at);
const twoDone = logAt(logAt(fresh, 0, '2026-11-04T10:02:00.000Z'), 1, '2026-11-04T10:05:00.000Z');

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const chipOf = (html: string) => /<span class="t7-state t7-state--(\w+)"><span [^>]*>(\w+)<\/span>([^<]+)<\/span>/.exec(html);
const dockOf = (html: string) => /<div class="flow-dock"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';

async function withToday<T>(run: (Today: unknown) => T | Promise<T>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try { return await run((await server.ssrLoadModule('/src/screens/TodayScreen.tsx')).default); } finally { await server.close(); }
}
const render = (Today: unknown, current: WorkoutRecord | null, extra: object = {}) =>
  renderToStaticMarkup(createElement(Today as never, { profile, program: FULL_BODY_A, adapted, equipment: 'home', adjusted: false,
    history: [], current, now: new Date(START), onPreview: noop, onAdjust: noop, onResume: noop, onWhy: noop, onRestore: noop,
    onOpenSettings: noop, onOpenExercise: noop, ...extra }));

test('#260: the fixture has 2 of 11 sets logged', () => {
  assert.deepEqual(twoDone.exercises.map((exercise) => exercise.performed.length), [3, 3, 3, 2]);
  assert.equal(twoDone.exercises.flatMap((exercise) => exercise.performed).filter((set) => set.done).length, 2);
});

test('#260 (#430): an open workout leaves Today on the plan: Ready, Preview and the adjust action stay', async () => {
  await withToday((Today) => {
    for (const current of [fresh, twoDone]) {
      const html = render(Today, current, { workoutOpen: true, logged: 2 });
      assert.equal(chipOf(html)?.[3].trim(), 'Ready', 'the plan keeps its own status');
      const dock = dockOf(html);
      assert.match(dock, /Short on time or gear\?/);
      assert.match(dock, /<button class="pill-primary">Preview workout/);
      assert.doesNotMatch(html, /Resume workout|In progress/, 'no Resume or In progress outside the row');
    }
  });
});

test('#260 (#430): the open workout reads in the resume row and the set count', async () => {
  await withToday((Today) => {
    const row = createElement('div', { className: 'rrow-probe' }, 'ROW');
    const html = render(Today, twoDone, { workoutOpen: true, logged: 2, openRow: row });
    assert.match(html, /<div class="rrow-probe">ROW<\/div>/);
    assert.match(plain(html), /2 \/\d+ sets logged/);
    assert.doesNotMatch(render(Today, null), /rrow-probe/);
  });
});

test('#260: a day with nothing open is unchanged: Ready, Preview and the adjust action, no Resume', async () => {
  await withToday((Today) => {
    const html = render(Today, null);
    assert.equal(chipOf(html)?.[3].trim(), 'Ready');
    assert.equal(chipOf(html)?.[2], 'check');
    const dock = dockOf(html);
    assert.match(dock, /Short on time or gear\?/);
    assert.match(dock, /<button class="pill-primary">Preview workout/);
    assert.doesNotMatch(html, /Resume workout|In progress/);
  });
});

test('#260 (lesson 9): the resume row and Plan resume through the one handler', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<ResumeRow [^>]*onResume=\{\(\) => resumeWorkout\(\)\}/);
  assert.equal(app.match(/onResume=\{\(\) => resumeWorkout\(\)\}/g)?.length, 2, 'row and Plan');
  assert.doesNotMatch(app, /const openWorkout = /, 'no second open path');
});
