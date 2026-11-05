import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveAdapted, liveExercises, targetReason } from '../src/lib/liveProgression.ts';
import { currentSlot, planSlots, slotProgram } from '../src/lib/sequence.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { tabBarAction } from '../src/lib/tabBarAction.ts';
import type { AppState, Profile } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3, equipment: ['Dumbbell'], support: [],
  exclusions: [], loads: { Dumbbell: RACK }, name: 'Slots', unit: 'kg', sessionMinutes: 60,
};

/** The app's Start path: current slot → adapted → live numbers stored on the session. */
function today(state: AppState) {
  const slot = currentSlot(state);
  assert.ok(slot);
  const adapted = adaptWorkout(slotProgram(profile, slot, state.history), { minutes: 60, equipment: 'home', loads: RACK }, []);
  return { slot, adapted, shown: liveAdapted(adapted, profile, state.history), stored: liveExercises(adapted, profile, state.history) };
}

/** Start the current slot, log `sets` of one exercise at `weight × reps`, finish. */
function finish(state: AppState, exerciseId: string, weight: number, reps: number, sets: number, at: string): AppState {
  const { slot, adapted, stored } = today(state);
  assert.equal(tabBarAction(null, adapted).disabled, false, 'tab bar Start offers this same slot');
  let session = createSession({ id: `s-${state.history.length}`, name: adapted.name, dayIndex: slot.index, slotId: slot.id,
    slotSeq: state.programCursor?.seq ?? 0, planRevision: state.planRevision, exercises: stored, now: `${at}T10:00:00.000Z`,
    durationMin: adapted.minutes });
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId);
  assert.ok(index >= 0, `${exerciseId} is in ${slot.name}`);
  for (let set = 0; set < sets; set += 1) {
    session = logSet(updatePerformedSet(session, index, set, { weight, reps }), index, set, `${at}T10:0${set + 1}:00.000Z`);
  }
  return applyFinish({ ...state, current: session }, session.id, { early: true, now: `${at}T10:40:00.000Z` });
}

test('the cursor walks the configured slots while each slot prescribes from live history', async () => {
  const plan = buildPlan(profile);
  let state: AppState = { profile, plan, history: [], current: null, todayOverride: null, planRevision: 1,
    programCursor: { revision: 1, seq: 0 }, slotSkips: [] };
  const slots = planSlots(plan);
  assert.equal(slots.length, 3);

  // Slot A: every number is a first session, no fixture load.
  const a = today(state);
  assert.equal(a.slot.id, slots[0].id);
  assert.ok(a.stored.every((exercise) => exercise.planned.every((set) => set.weight === 0)), 'uncalibrated: no fixture load');
  const lift = a.stored.find((exercise) => exerciseById(exercise.exerciseId)?.equipment === 'Dumbbell');
  assert.ok(lift);
  const range = a.adapted.exercises.find((exercise) => exercise.exerciseId === lift.exerciseId)!.repRange;
  state = finish(state, lift.exerciseId, 15, range[1], lift.planned.length, '2026-11-02');

  // Slot B: different configured exercises, still first-session numbers.
  const b = today(state);
  assert.equal(b.slot.id, slots[1].id, 'finishing A with work advanced once');
  assert.notDeepEqual(b.stored.map((exercise) => exercise.exerciseId), a.stored.map((exercise) => exercise.exerciseId));
  const other = (stored: typeof b.stored) => stored.find((exercise) => exercise.exerciseId !== lift.exerciseId)!;
  for (const exercise of b.stored.filter((entry) => entry.exerciseId !== lift.exerciseId)) {
    assert.equal(exercise.planned[0].weight, 0, `${exercise.exerciseId} has no history, so no load`);
  }
  state = finish(state, other(b.stored).exerciseId, 10, 8, 1, '2026-11-04');
  const c = today(state);
  assert.equal(c.slot.id, slots[2].id);
  state = finish(state, other(c.stored).exerciseId, 10, 8, 1, '2026-11-06');

  // Wrapped to A (or wherever the lift next appears): the earned rack step.
  const next = today(state);
  assert.equal(next.slot.id, slots[0].id, 'C wraps to A');
  const again = next.stored.find((exercise) => exercise.exerciseId === lift.exerciseId);
  assert.ok(again, 'the lift reappears in its slot');
  assert.deepEqual(again.planned.map((set) => set.weight), again.planned.map(() => 18), 'stored at start: 15 → 18');
  assert.equal(next.shown.exercises.find((exercise) => exercise.exerciseId === lift.exerciseId)?.weight, 18, 'shown on Today');
  assert.match(targetReason(lift.exerciseId, profile, state.history, 'kg') ?? '', /One step up/);

  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(Today, { profile, program: slotProgram(profile, next.slot, state.history),
      adapted: next.shown, equipment: 'home', adjusted: false, history: state.history, current: null,
      now: new Date('2026-11-08T10:00:00.000Z'), onPreview: noop, onAdjust: noop, onWhy: noop,
      onRestore: noop, onOpenSettings: noop, onOpenExercise: noop }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, new RegExp(slots[0].name));
    assert.match(text, /18 kg/);
  } finally { await server.close(); }
});
