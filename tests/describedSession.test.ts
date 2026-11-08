import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { dayKey } from '../src/lib/plan.ts';
import { isDescribedSession, planSlots, todayProgram } from '../src/lib/sequence.ts';
import { createSession, swapPendingExercise } from '../src/lib/session.ts';
import { describedDayStatus, describedSessionStatus, talkConstraints } from '../src/lib/todayTalk.ts';
import type { TalkState } from '../src/lib/todayTalk.ts';
import type { Profile, TodayOverride } from '../src/types.ts';

/**
 * #220: a running described session ("Tell me about today", no slot link) names itself on Today's
 * hero ("Today only", never a plan slot), and its status comes from the session itself, judged
 * against what was asked while that ask (today's override) lasts; after midnight it shows none.
 */
const gym: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60,
};
const slots = planSlots(buildPlan(gym));
const START = '2026-11-07T15:00:00.000Z';
const TODAY = dayKey(new Date(START));
const TOMORROW = dayKey(new Date(Date.parse(START) + 24 * 3600 * 1000));
// A Legs day with the back sore: home gym, 45 min. Nordic Curl is its only hamstring move.
const talk: TalkState = { equipment: 'home', minutes: 45, train: ['Legs'], skip: ['Back'], sore: ['Back'], pain: false, notices: [] };
const constraints = talkConstraints(talk, undefined, slots[0].focus);
const program = todayProgram(gym, slots[0], [], constraints);
const live = liveAdapted(adaptWorkout(program, constraints, [], gym.goal), gym, []);
const session = createSession({ id: 's', name: live.name, dayIndex: slots[0].index, planRevision: 1,
  exercises: liveExercises(live, gym, []), now: START, durationMin: live.minutes });
const planned = createSession({ id: 'p', name: slots[0].name, dayIndex: slots[0].index, slotId: slots[0].id, slotSeq: 0, planRevision: 1,
  exercises: liveExercises(live, gym, []), now: START, durationMin: live.minutes });
const legacy = createSession({ id: 'l', name: slots[0].name, dayIndex: slots[0].index,
  exercises: liveExercises(live, gym, []), now: START, durationMin: live.minutes });
const override = (date: string): TodayOverride => ({ date, minutes: 45, equipment: ['Dumbbell'], support: [], appliedAt: START,
  choice: 'home', focus: constraints.focus, skip: constraints.skip });
const nordic = session.exercises.findIndex((exercise) => exercise.exerciseId === 'nordic-curl');
const swapped = swapPendingExercise(session, nordic, { exerciseId: 'walking-lunge', name: 'Walking Lunge', weight: 20, reps: 10 });

test('#220: a described session is the one with no slot link, never judged by name', () => {
  assert.equal(isDescribedSession(session), true);
  assert.equal(isDescribedSession(planned), false);
  assert.equal(isDescribedSession({ ...planned, name: 'Legs' }), false);
  // A record from before slot links (no slotSeq, no planRevision) is a planned session, not a described one.
  assert.equal(isDescribedSession(legacy), false);
});

test('#220: a running described session\'s status is its own exercises judged against what was asked', () => {
  assert.equal(live.name, 'Legs');
  assert.ok(nordic >= 0);
  assert.equal(session.exercises.filter((exercise) => exercise.exerciseId === 'nordic-curl').length, 1);
  const before = describedSessionStatus(session, override(TODAY), gym);
  assert.deepEqual(before, describedDayStatus(constraints, program, live, gym), 'unchanged session reads as its preview did');
  assert.equal(before?.status, 'ready');
  // The swap leaves no hamstring move: the session, not the proposed day, decides.
  const after = describedSessionStatus(swapped, override(TODAY), gym);
  assert.equal(after?.status, 'limited');
  assert.deepEqual(after?.gaps.map((gap) => gap.muscle), ['Hamstrings']);
  assert.ok(after?.reasons.some((line) => /\bhamstring\b/.test(line.text)), JSON.stringify(after?.reasons));
});

test('#220: once the ask has expired (rollover) a described session has no status; a planned one never does', () => {
  assert.equal(describedSessionStatus(session, override(TOMORROW), gym), null);
  assert.equal(describedSessionStatus(session, null, gym), null);
  const { focus: _focus, skip: _skip, ...plain } = override(TODAY);
  assert.equal(describedSessionStatus(session, plain, gym), null);
  assert.equal(describedSessionStatus(planned, override(TODAY), gym), null);
  assert.equal(describedSessionStatus(legacy, override(TODAY), gym), null);
});

async function withServer<T>(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<T>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try { return await run((path) => server.ssrLoadModule(path)); } finally { await server.close(); }
}
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
const heroOf = (html: string) => /<section class="t7-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
const chipOf = (html: string) => /<span class="t7-state t7-state--(\w+)"><span [^>]*>\w+<\/span>([^<]+)<\/span>/.exec(html);
/** A planned day the generator rates "Limited · x of y": what Today falls back to after midnight. */
const shortDay = todayProgram(gym, slots[0], [], { equipment: 'bodyweight', minutes: 30 });

test('#220: Today names a running described session, "Today only", and its status follows the session until midnight', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const now = new Date(START);
    const render = (current: typeof session, described: ReturnType<typeof describedSessionStatus>, day = program) =>
      renderToStaticMarkup(createElement(Today as never, { profile: gym, program: day, adapted: live, equipment: 'home', adjusted: true,
        history: [], current, now, described, slotLabel: 'Day 1 of 4 this week', onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop,
        onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));

    const running = render(session, describedSessionStatus(session, override(TODAY), gym));
    const hero = heroOf(running);
    assert.match(plain(hero), /Legs in progress/);
    assert.match(plain(hero), /Today only/);
    assert.doesNotMatch(hero, /Slot/);
    assert.match(hero, /aria-label="Legs, /);
    assert.equal(chipOf(running)?.[2].trim(), 'Ready');

    const afterSwap = render(swapped, describedSessionStatus(swapped, override(TODAY), gym));
    assert.equal(chipOf(afterSwap)?.[1], 'limited');
    assert.match(plain(afterSwap), /\bhamstring\b/);

    // Midnight: the ask is gone. No chip, no note, never the generator's "x of y" for the planned day.
    assert.equal(shortDay.feasibility?.status, 'limited');
    assert.ok((shortDay.feasibility?.selectedCount ?? 0) < (shortDay.feasibility?.targetCount ?? 0));
    const rolled = render(session, describedSessionStatus(session, override(TOMORROW), gym), shortDay);
    assert.equal(chipOf(rolled), null);
    assert.doesNotMatch(rolled, /t7-state/);
    assert.doesNotMatch(rolled, /role="note"/);
    assert.doesNotMatch(plain(heroOf(rolled)), / of \d|Slot/);
    assert.match(plain(heroOf(rolled)), /Legs in progress.*Today only/);
  });
});

test('#220: a planned running session keeps its slot and the generator\'s chip', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const html = renderToStaticMarkup(createElement(Today as never, { profile: gym, program: shortDay, adapted: live, equipment: 'home',
      adjusted: false, history: [], current: planned, now: new Date(START), described: null, slotLabel: 'Day 1 of 4 this week', onPreview: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
    const hero = plain(heroOf(html));
    assert.match(hero, /Day 1 of 4 this week/);
    assert.doesNotMatch(hero, /Today only/);
    assert.match(chipOf(html)?.[2] ?? '', /^Limited · \d+ of \d+$/);
  });
});

test('#220: a legacy running session (no slot link, no plan revision) still reads as planned', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    assert.equal(legacy.slotSeq, undefined);
    assert.equal(legacy.planRevision, undefined);
    const html = renderToStaticMarkup(createElement(Today as never, { profile: gym, program: shortDay, adapted: live, equipment: 'home',
      adjusted: false, history: [], current: legacy, now: new Date(START), described: null, slotLabel: 'Day 1 of 4 this week', onPreview: noop,
      onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
    const hero = plain(heroOf(html));
    assert.match(hero, /Day 1 of 4 this week/);
    assert.doesNotMatch(hero, /Today only/);
    assert.match(chipOf(html)?.[2] ?? '', /^Limited · \d+ of \d+$/);
  });
});
