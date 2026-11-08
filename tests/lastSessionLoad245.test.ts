import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A, lastSummary } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import type { Profile } from '../src/types.ts';

// #245: Today's "Last session" line showed reps without the load, so a load step up (132.5 -> 138 lb,
// reps back to the bottom of the range) read as a rep drop.

const each = { exerciseId: 'dumbbell-floor-press', load: 'each' as const };
const total = { exerciseId: 'barbell-bench-press', load: 'total' as const };

test('the last session reads like the target line: reps @ load', () => {
  const sets = [6, 6, 6, 6, 6].map((reps) => ({ weight: 60, reps }));
  assert.equal(lastSummary(total, sets, 'kg'), '6 · 6 · 6 · 6 · 6 @ 60 kg total');
  assert.equal(lastSummary(each, [{ weight: 15, reps: 9 }, { weight: 15, reps: 8 }], 'kg'), '9 · 8 @ 15 kg each');
  assert.equal(lastSummary(total, sets, 'lb', () => '132.5'), '6 · 6 · 6 · 6 · 6 @ 132.5 lb total');
});

test('sets at different loads read per set, as the logger does', () => {
  assert.equal(lastSummary(total, [{ weight: 60, reps: 6 }, { weight: 62.5, reps: 5 }], 'kg'), '60 × 6 · 62.5 × 5 kg total');
});

test('bodyweight and holds keep reps or seconds only', () => {
  assert.equal(lastSummary({ exerciseId: 'push-up', load: 'none' }, [{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }], 'kg'), '12 · 10 reps');
  assert.equal(lastSummary({ exerciseId: 'plank', load: 'none' }, [{ weight: 0, reps: 45 }], 'kg'), '45s');
});

test('Today shows the load on the Last session line', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined);
    const profile: Profile = { goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
      equipment: ['Dumbbell'], support: [], exclusions: [], loads: {}, name: 'K' };
    let session = createSession({ id: 'w1', name: adapted.name, dayIndex: 0, now: '2026-10-31T10:00:00.000Z', exercises: liveExercises(adapted, profile, []) });
    for (const index of [0, 1, 2]) session = updatePerformedSet(session, 0, index, { weight: 15, reps: 10, done: true }, '2026-10-31T10:05:00.000Z');
    const history = [completeSession(session, { early: true, now: '2026-10-31T10:30:00.000Z' })];
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(TodayScreen, {
      profile, program: FULL_BODY_A, adapted: liveAdapted(adapted, profile, history), equipment: 'home',
      adjusted: false, history, current: null, now: new Date('2026-11-07T10:00:00.000Z'), onPreview: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /Last session 10 · 10 · 10 @ 15 kg each/);
    // No rack saved: the step up is "your next dumbbell", so the target carries no number (unchanged).
    assert.match(text, /Today’s target 8 · 8 · 8 /);
  } finally { await server.close(); }
});
