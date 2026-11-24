import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { completeSession, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { liveAdapted, liveExercises, targetReason } from '../src/lib/liveProgression.ts';
import type { Profile } from '../src/types.ts';

// Render the actual screen. (#430, ruling 4a) Today shows the plan, never the open workout: an open session
// with other targets changes nothing on it.
test('Today shows the plan, the same with or without an open workout', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' }, [], undefined);
    const current = logSet(createSession({
      id: 'accepted', name: adapted.name, dayIndex: 0, durationMin: 20,
      exercises: toWorkoutExercises(adapted), now: '2026-10-31T10:00:00.000Z',
    }), 0, 0, '2026-10-31T10:05:00.000Z');
    const noop = () => {};
    const render = (open: boolean) => renderToStaticMarkup(createElement(TodayScreen, {
      profile: { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
        equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Today review' },
      program: FULL_BODY_A,
      adapted: adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined),
      equipment: 'home', adjusted: false, history: [], ...(open ? { current, workoutOpen: true, logged: 1 } : {}),
      now: new Date('2026-10-31T10:10:00.000Z'),
      onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop,
      onOpenSettings: noop, onOpenExercise: noop,
    }));
    const text = render(true).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // The plan's own 35-minute day, not the open 20-minute session's 8 sets.
    assert.match(text, /The workout 31 min · 11 sets/);
    // Uniform reps read compactly ("3 × 9"), so the row fits at 360 px (#97).
    assert.match(text, /3 × 9 @ 15 kg each/);
    assert.doesNotMatch(text, /8 sets|2 × 9/);
    assert.match(text, /1 \/11 sets logged/, 'only the logged count reads from the open workout');
    const plainOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const counts = / [01] \/11 sets logged| [01]\/11 sets today/g;
    assert.equal(plainOf(render(false)).replace(counts, ''), text.replace(counts, ''),
      'nothing else on Today reads the open workout');
  } finally {
    await server.close();
  }
});


test('Today preserves the actual fractional load in last performance', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined);
    const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
      equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Today review' };
    // A first live session plans no load, so the one typed set is the baseline an early finish repeats (#104).
    const active = createSession({ id: 'actual', name: adapted.name, dayIndex: 0,
      now: '2026-10-31T10:00:00.000Z', exercises: liveExercises(adapted, profile, []) });
    const logged = updatePerformedSet(active, 0, 0, { weight: 42.3, reps: 8, done: true }, '2026-10-31T10:05:00.000Z');
    const history = [completeSession(logged, { early: true, now: '2026-10-31T10:06:00.000Z' })];
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(TodayScreen, {
      profile, program: FULL_BODY_A, adapted: liveAdapted(adapted, profile, history), equipment: 'home',
      adjusted: false, history, current: null, now: new Date('2026-11-01T10:10:00.000Z'), onPreview: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // (#50) Today's coach line reads today's load exactly as the target does...
    assert.match(text, /Finish every set: 42\.3 kg for 8\./);
    // 42.3 kg was logged: no coach sentence may call a different load "same" or "last time".
    const coach = (html.match(/coach-card__text">([^<]*)</) ?? [])[1] ?? '';
    assert.ok(coach, 'coach line rendered');
    for (const sentence of coach.split(/(?<=\.)\s+/)) {
      if (/same|last/i.test(sentence)) assert.doesNotMatch(sentence, /\d+(\.\d+)? kg/, sentence);
    }
    assert.match(text, /Today’s target 8 · 8 · 8 @ 42\.3 kg each/);
    // ...and the logged fractional load stays exact one tap away, under "Why this target".
    assert.match(targetReason('dumbbell-floor-press', profile, history, 'kg') ?? '', /42\.3 kg/);
  } finally { await server.close(); }
});
