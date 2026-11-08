import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { dayKey } from '../src/lib/plan.ts';
import { keepKey, todayFresher } from '../src/lib/recovery.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

const profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const plan = [
  { name: 'Upper A', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { name: 'Lower A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  { name: 'Upper B', focus: ['Back', 'Chest', 'Shoulders', 'Triceps', 'Biceps'] },
  { name: 'Lower B', focus: ['Hamstrings', 'Quads', 'Glutes', 'Calves', 'Core'] },
];
const gym = { minutes: 45, equipment: 'gym' } as const;
const NOW = new Date(2026, 10, 10, 9, 0);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const upperYesterday = {
  id: 'u1', date: hoursAgo(21), endedAt: hoursAgo(20), name: 'Upper A', dayIndex: 0, status: 'completed', completedEarly: false,
  exercises: ['barbell-bench-press', 'barbell-row', 'overhead-press'].map((exerciseId) => ({
    exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 50 }],
    performed: [{ weight: 50, reps: 8, done: true, completedAt: hoursAgo(20) }],
  })),
} as unknown as WorkoutRecord;
// Upper A done yesterday, Lower A skipped: Upper B is up next.
const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 2 }, history: [upperYesterday] } as unknown as AppState;

test('#134 gate: Today offers the fresher day on a planned day with no session open', () => {
  const offer = todayFresher(profile, state, gym, null, NOW);
  assert.equal(offer?.option.name, 'Lower B');
  assert.equal(offer?.nextName, 'Upper B');
});

test('#134 gate: no offer while a session is open, on a described day, without a plan, or after Keep', () => {
  const open = { ...upperYesterday, id: 'open', status: 'active', endedAt: null };
  assert.equal(todayFresher(profile, { ...state, current: open } as AppState, gym, null, NOW), null, 'session open');
  const described = { date: dayKey(NOW), minutes: 45, equipment: [], support: [], appliedAt: NOW.toISOString(), focus: ['Quads'] };
  assert.equal(todayFresher(profile, { ...state, todayOverride: described } as AppState, gym, null, NOW), null, 'described day');
  assert.equal(todayFresher(profile, { ...state, plan: [] } as AppState, gym, null, NOW), null, 'no slot');
  assert.equal(todayFresher(null, state, gym, null, NOW), null, 'no profile');
  const upperB = 'slot-2-upper-b';
  assert.equal(todayFresher(profile, state, gym, keepKey(upperB, NOW), NOW), null, 'kept today');
  const tomorrow = new Date(NOW.getTime() + 86_400_000);
  assert.ok(todayFresher(profile, state, gym, keepKey(upperB, NOW), tomorrow), 'Keep lasts for today only');
});

test('#134 card: Today shows the offer with Switch and Keep, and hides it when null or mid-session', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TodayScreen } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const fresher = todayFresher(profile, state, gym, null, NOW);
    assert.ok(fresher);
    const noop = () => {};
    const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TodayScreen, {
      profile, program: FULL_BODY_A, adapted: adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined),
      equipment: 'home', adjusted: false, history: [], current: null, now: NOW,
      onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop,
      fresher, onPickFresher: noop, onKeepNext: noop, ...props,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const shown = render({});
    assert.match(shown, /Chest, Back and Shoulders trained yesterday\. Lower B is fresher\./);
    assert.match(shown, /Switching skips Upper B\./);
    assert.match(shown, /Switch to Lower B Keep Upper B/);
    const none = render({ fresher: null });
    assert.doesNotMatch(none, /is fresher|Switch to|Keep Upper B/);
    const running = render({ current: { ...upperYesterday, id: 'open', status: 'active', endedAt: null } });
    assert.doesNotMatch(running, /is fresher|Switch to|Keep Upper B/);
  } finally {
    await server.close();
  }
});
