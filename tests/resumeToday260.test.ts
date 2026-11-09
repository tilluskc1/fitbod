import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { describedSessionStatus, talkConstraints } from '../src/lib/todayTalk.ts';
import type { TalkState } from '../src/lib/todayTalk.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

/**
 * #260: a running session reads as running on Today, after a reload too (Today renders only from
 * the stored session): an "In progress · N of M sets" chip, a primary "Resume workout" in the dock,
 * and no "Short on time or gear?". A day with nothing open is unchanged.
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

test('#260: a running session shows "In progress · N of M sets", not "Ready"', async () => {
  await withToday((Today) => {
    const chip = chipOf(render(Today, twoDone));
    assert.equal(chip?.[3].trim(), 'In progress · 2 of 11 sets');
    assert.equal(chip?.[1], 'ready', 'lime: live');
    assert.equal(chip?.[2], 'play_arrow');
    assert.equal(chipOf(render(Today, fresh))?.[3].trim(), 'In progress · 0 of 11 sets');
  });
});

test('#260: the dock offers Resume workout and no adjust action while a session is open', async () => {
  await withToday((Today) => {
    const dock = dockOf(render(Today, twoDone));
    assert.match(dock, /<button class="pill-primary"[^>]*>Resume workout/);
    assert.doesNotMatch(dock, /Short on time or gear\?/);
    assert.doesNotMatch(dock, /Preview workout/);
    assert.doesNotMatch(render(Today, twoDone), /Short on time or gear\?/);
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

test('#260 with #220: a described session shows its progress, keeps its own status colour, and after midnight reads as live', async () => {
  const gym: Profile = {
    name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
    exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60,
  };
  const slot = planSlots(buildPlan(gym))[0];
  const talk: TalkState = { equipment: 'home', minutes: 45, train: ['Legs'], skip: ['Back'], sore: ['Back'], pain: false, notices: [] };
  const constraints = talkConstraints(talk, undefined, slot.focus);
  const live = liveAdapted(adaptWorkout(todayProgram(gym, slot, [], constraints), constraints, [], gym.goal), gym, []);
  // planRevision without a slot link: a described session (#220), one set logged.
  const opened = createSession({ id: 'd', name: live.name, dayIndex: slot.index, planRevision: 1, exercises: liveExercises(live, gym, []),
    now: START, durationMin: live.minutes });
  const session = logSet(updatePerformedSet(opened, 0, 0, { weight: 95 }), 0, 0, '2026-11-04T10:02:00.000Z');
  const sets = session.exercises.flatMap((exercise) => exercise.performed).length;
  assert.ok(sets > 1);
  const ask = { date: '2026-11-04', minutes: 45, equipment: ['Dumbbell'], support: [], appliedAt: START, choice: 'home' as const,
    focus: constraints.focus, skip: constraints.skip };
  // A planned day the generator rates Limited: what Today falls back to after midnight.
  const shortDay = todayProgram(gym, slot, [], { equipment: 'bodyweight', minutes: 30 });
  assert.equal(shortDay.feasibility?.status, 'limited');
  await withToday((Today) => {
    const today = render(Today, session, { profile: gym, adapted: live, program: shortDay,
      described: describedSessionStatus(session, ask, gym) });
    assert.match(plain(today), /Legs in progress.*Today only/);
    assert.deepEqual(chipOf(today)?.slice(1).map((part) => part.trim()), ['ready', 'play_arrow', `In progress · 1 of ${sets} sets`]);
    assert.match(dockOf(today), /Resume workout/);
    assert.doesNotMatch(today, /Short on time or gear\?/);

    const rolled = render(Today, session, { profile: gym, adapted: live, program: shortDay, described: null });
    assert.deepEqual(chipOf(rolled)?.slice(1).map((part) => part.trim()), ['ready', 'play_arrow', `In progress · 1 of ${sets} sets`]);
    assert.doesNotMatch(rolled, /Limited|role="note"/);
  });
});

test('#260 (lesson 9): Today\'s Resume and the tab bar\'s centre button are one handler', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const openWorkout = current \? \(\) => setView\('train'\) : startWorkout;/);
  assert.match(app, /onResume=\{openWorkout\}/);
  assert.match(app, /onActivate: openWorkout,/);
});
