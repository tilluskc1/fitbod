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
  assert.equal(live.name, 'Lower', '#296: Legs alone is the Lower preset, named so on every screen');
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

// (#430, ruling 4a) Today shows the plan, never the open workout: a running described, planned or legacy
// session leaves the hero on the planned day with the generator's own status. The described session's own
// status (above) stays in the lib for its callers; Today no longer reads it.
test('#220 (#430): a running session of any kind leaves Today on the planned day and its own status', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    for (const current of [session, planned, legacy]) {
      const html = renderToStaticMarkup(createElement(Today as never, { profile: gym, program: shortDay, adapted: live, equipment: 'home',
        adjusted: false, history: [], current, workoutOpen: true, now: new Date(START), described: null, slotLabel: 'Day 1 of 4',
        onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
      const hero = plain(heroOf(html));
      assert.match(hero, /Day 1 of 4/);
      assert.doesNotMatch(hero, /in progress|Today only/i);
      assert.equal(chipOf(html)?.[1], 'limited', 'the generator\'s tone for the planned day');
      assert.match(chipOf(html)?.[2] ?? '', /^Limited · \d+ of \d+$/);
    }
  });
});
