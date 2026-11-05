import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { completeSession, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';

// Render the actual screen: model-only checks missed the diverging current rows.
test('Today shows the accepted active targets instead of a recomputed program', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const adapted = adaptWorkout(FULL_BODY_A, { minutes: 20, equipment: 'home' });
    const current = logSet(createSession({
      id: 'accepted', name: adapted.name, dayIndex: 0, durationMin: 20,
      exercises: toWorkoutExercises(adapted), now: '2026-10-31T10:00:00.000Z',
    }), 0, 0, '2026-10-31T10:05:00.000Z');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(TodayScreen, {
      profile: { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
        equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Today review' },
      program: FULL_BODY_A,
      adapted: adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }),
      equipment: 'home', adjusted: false, history: [], current,
      now: new Date('2026-10-31T10:10:00.000Z'),
      onStart: noop, onResume: noop, onAdjust: noop, onWhy: noop, onRestore: noop,
      onOpenSettings: noop, onOpenExercise: noop,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /20 min · 6 sets/);
    assert.match(text, /2 sets · 9 · 9 @ 15 kg each/);
    assert.doesNotMatch(text, /11 sets|3 sets · 9 · 9 · 9/);
  } finally {
    await server.close();
  }
});


test('Today preserves the actual fractional load in last performance', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' });
    const active = createSession({ id: 'actual', name: adapted.name, dayIndex: 0,
      now: '2026-10-31T10:00:00.000Z', exercises: toWorkoutExercises(adapted) });
    const logged = updatePerformedSet(active, 0, 0, { weight: 42.3, reps: 8, done: true }, '2026-10-31T10:05:00.000Z');
    const history = [completeSession(logged, { early: true, now: '2026-10-31T10:06:00.000Z' })];
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(TodayScreen, {
      profile: { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
        equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'Today review' },
      program: FULL_BODY_A, adapted, equipment: 'home', adjusted: false, history, current: null,
      now: new Date('2026-11-01T10:10:00.000Z'), onStart: noop, onResume: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // The coach insight now reads the live reason (#5); it must still name the logged load.
    assert.match(text, /42\.3 kg/);
    assert.doesNotMatch(text, /42\.5 kg/);
  } finally { await server.close(); }
});
