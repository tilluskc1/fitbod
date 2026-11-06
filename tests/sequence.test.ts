import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan } from '../src/lib/generator.ts';
import { mergeImport } from '../src/lib/storage.ts';
import { applyCorrection, applyFinish, createSession, logSet, applyCancel, updatePerformedSet } from '../src/lib/session.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import {
  advanceAfterFinish,
  currentSlot,
  nextSlotIndex,
  planSlots,
  revisePlan,
  skipCurrentSlot,
  slotProgram,
  updateProfile,
} from '../src/lib/sequence.ts';
import type { AppState, Profile } from '../src/types.ts';

const profile: Profile = {
  goal: 'Build Muscle',
  experience: 'Beginner',
  daysPerWeek: 3,
  equipment: ['Dumbbell'],
  support: [],
  exclusions: [],
  loads: { Dumbbell: [10, 15, 18] },
  name: 'Sequence',
  unit: 'kg',
  sessionMinutes: 35,
};

function fresh(overrides: Partial<AppState> = {}): AppState {
  const plan = buildPlan(profile);
  return {
    profile,
    plan,
    history: [],
    current: null,
    todayOverride: null,
    planRevision: 1,
    programCursor: { revision: 1, seq: 0 },
    slotSkips: [],
    ...overrides,
  };
}

/** Start and finish the slot the cursor points at, the way the app does. */
function runSlot(state: AppState, options: { sets?: number } = {}): AppState {
  const slot = currentSlot(state);
  assert.ok(slot, 'a slot must be on offer');
  const program = slotProgram(profile, slot, state.history);
  const adapted = adaptWorkout(program, { minutes: 35, equipment: 'home' }, []);
  const session = createSession({
    id: `s-${slot.index}-${state.history.length}`,
    name: adapted.name,
    dayIndex: slot.index,
    slotId: slot.id,
    slotSeq: state.programCursor?.seq ?? 0,
    planRevision: state.planRevision,
    exercises: toWorkoutExercises(adapted),
    now: '2026-11-01T10:00:00.000Z',
    durationMin: adapted.minutes,
  });
  let open = { ...state, current: session };
  const sets = options.sets ?? 1;
  const at = '2026-11-01T10:05:00.000Z';
  // A loaded set needs a load to log (#103).
  for (let i = 0; i < sets; i += 1) open = { ...open, current: logSet(updatePerformedSet(open.current!, 0, i, { weight: 10 }, at), 0, i, at) };
  return applyFinish(open, open.current!.id, { early: sets < adapted.totalSets, now: '2026-11-01T10:30:00.000Z' });
}

test('a three-slot plan runs its own slots in order and wraps A → B → C → A', () => {
  const state = fresh();
  const slots = planSlots(state.plan);
  assert.equal(slots.length, 3);
  assert.equal(currentSlot(state)?.name, slots[0].name);

  // The slots are real configured days, not three copies of one fixture.
  const first = slotProgram(profile, slots[0], []);
  const second = slotProgram(profile, slots[1], []);
  assert.equal(first.name, slots[0].name);
  assert.notDeepEqual(
    first.exercises.map((exercise) => exercise.exerciseId),
    second.exercises.map((exercise) => exercise.exerciseId),
  );

  const afterFirst = runSlot(state);
  assert.equal(currentSlot(afterFirst)?.name, slots[1].name);
  const afterSecond = runSlot(afterFirst);
  assert.equal(currentSlot(afterSecond)?.name, slots[2].name);
  const wrapped = runSlot(afterSecond);
  assert.equal(currentSlot(wrapped)?.name, slots[0].name);
  assert.equal(wrapped.history.length, 3);
});

test('missed days move nothing: elapsed dates neither advance nor add work', () => {
  const state = fresh();
  const old = runSlot(state);
  // Compare the same slot on both sides: the one the cursor now points at.
  const program = slotProgram(profile, currentSlot(old)!, old.history);
  // A week later, with the last session dated long ago, the same slot is next.
  const next = { ...old, history: [{ ...old.history[0], date: '2026-10-20T10:00:00.000Z' }] };
  assert.equal(currentSlot(next)?.id, currentSlot(old)?.id);
  const still = slotProgram(profile, currentSlot(next)!, next.history);
  assert.equal(
    still.exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
    program.exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
  );
});

test('a repeated Finish, a correction or a duplicate record cannot advance twice', () => {
  const state = fresh();
  const once = runSlot(state);
  assert.equal(nextSlotIndex(once), 1);

  // The same finished session is no longer the active one: replay is a no-op.
  const finishAgain = applyFinish(once, 's-0-0', { early: false, now: '2026-11-01T11:00:00.000Z' });
  assert.equal(finishAgain, once);

  // A restored duplicate of the finished workout (through the real restore merge) does not move the cursor.
  const restored = mergeImport(once, once).state;
  assert.equal(restored.history.length, 1);
  assert.equal(nextSlotIndex(restored), 1);
  assert.equal(restored.programCursor?.seq, once.programCursor?.seq);

  // Correcting logged work (through the real correction path) changes evidence, not the completion.
  const corrected = applyCorrection(once, once.history[0].id, 0, 0, { weight: once.history[0].exercises[0].performed[0].weight + 2 }, '2026-11-02T10:00:00.000Z');
  assert.notDeepEqual(corrected.history[0].exercises, once.history[0].exercises);
  assert.equal(nextSlotIndex(corrected), 1);
  assert.deepEqual(corrected.programCursor, once.programCursor);
});

test('an unfinished session stays resumable and a zero-work discard keeps the cursor', () => {
  const state = fresh();
  const slot = currentSlot(state)!;
  const program = slotProgram(profile, slot, []);
  const adapted = adaptWorkout(program, { minutes: 35, equipment: 'home' }, []);
  const open = { ...state, current: createSession({
    id: 'open', name: adapted.name, dayIndex: slot.index, slotId: slot.id, slotSeq: 0,
    planRevision: state.planRevision, exercises: toWorkoutExercises(adapted),
    now: '2026-11-01T10:00:00.000Z',
  }) };
  const logged = { ...open, current: logSet(updatePerformedSet(open.current!, 0, 0, { weight: 10 }, '2026-11-01T10:02:00.000Z'), 0, 0, '2026-11-01T10:02:00.000Z') };
  assert.equal(logged.current?.exercises[0].performed[0].done, true);

  const discarded = applyCancel({ ...state, current: open.current }, 'open');
  assert.equal(discarded.current, null);
  assert.equal(discarded.history.length, 0);
  assert.equal(nextSlotIndex(discarded), 0);
});

test('an adapted or shortened finish advances once and keeps the original requirement', () => {
  const state = fresh();
  const after = runSlot(state, { sets: 1 });
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].completedEarly, true);
  assert.ok((after.history[0].exercises[0].originalPlannedSets ?? 0) >= 1);
  assert.equal(nextSlotIndex(after), 1);
});

test('Skip advances exactly one slot and records a skip, never a workout', () => {
  const state = fresh();
  const slots = planSlots(state.plan);
  const skipped = skipCurrentSlot(state, '2026-11-02T09:00:00.000Z');
  assert.equal(currentSlot(skipped)?.name, slots[1].name);
  assert.equal(skipped.history.length, 0);
  assert.equal(skipped.slotSkips?.length, 1);
  assert.equal(skipped.slotSkips?.[0].slotId, slots[0].id);
  assert.equal(skipped.slotSkips?.[0].revision, 1);

  // Same click twice at the same cursor cannot log two skips.
  const again = skipCurrentSlot({ ...skipped, programCursor: { revision: 1, seq: 0 }, current: null }, '2026-11-02T09:01:00.000Z');
  assert.equal(again.slotSkips?.length, 1);
  assert.equal(nextSlotIndex(again), 1);
});

test('a new plan revision resets the sequence but leaves an open session frozen', () => {
  const slots = planSlots(fresh().plan);
  const running = runSlot(fresh());
  const open = { ...running, current: running.history[0] };

  const revised = revisePlan(open, { ...profile, daysPerWeek: 5 });
  assert.equal(revised.plan.length, 5);
  assert.equal(revised.planRevision, 2);
  assert.equal(nextSlotIndex(revised), 0);
  assert.equal(revised.slotSkips?.length, 0);
  // The active session is untouched by the new plan.
  assert.deepEqual(revised.current?.exercises, open.current?.exercises);
  assert.notEqual(slots.length, revised.plan.length);
});

test('a session finished under an older plan revision does not move the new sequence', () => {
  const state = fresh({ planRevision: 2, programCursor: { revision: 2, seq: 0 } });
  const stale = advanceAfterFinish(state, {
    ...runSlot(fresh()).history[0],
    planRevision: 1,
    slotSeq: 2,
  });
  assert.equal(nextSlotIndex(stale), 0);
  assert.equal(stale.programCursor?.seq, 0);
});

test('a configured barbell plan keeps its actual Push and Pull lifts in Today', () => {
  const equipped: Profile = {
    ...profile,
    equipment: ['Barbell'],
    support: ['Rack', 'Bench'],
    loads: { Barbell: [20, 30, 40] },
  };
  const state = fresh({ profile: equipped, plan: buildPlan(equipped) });
  for (const index of [0, 1]) {
    const program = slotProgram(equipped, planSlots(state.plan)[index], []);
    const adapted = adaptWorkout(program, defaultConstraints(equipped), equipped.exclusions);
    assert.deepEqual(adapted.exercises.map((exercise) => exercise.exerciseId), program.exercises.map((exercise) => exercise.exerciseId));
  }
});

test('bodyweight override cannot start a configured Pull slot with only core accessories', () => {
  const equipped: Profile = { ...profile, equipment: ['Barbell'], support: ['Rack', 'Bench'], loads: { Barbell: [20, 30, 40] } };
  const program = slotProgram(equipped, planSlots(buildPlan(equipped))[1], []);
  const adapted = adaptWorkout(program, { minutes: 35, equipment: 'bodyweight' }, []);
  assert.equal(adapted.exercises.length, 0);
  assert.match(adapted.note, /main movement/i);
});

test('a replayed Skip for the offered slot advances only once', () => {
  const state = fresh();
  const offered = { revision: 1, seq: 0 };
  const once = skipCurrentSlot(state, '2026-11-02T09:00:00.000Z', offered);
  const replay = skipCurrentSlot(once, '2026-11-02T09:01:00.000Z', offered);
  assert.equal(replay.programCursor?.seq, 1);
  assert.deepEqual(replay.slotSkips, once.slotSkips);
});

test('plan revision retains skip evidence from earlier revisions', () => {
  const skipped = skipCurrentSlot(fresh(), '2026-11-02T09:00:00.000Z');
  const revised = revisePlan(skipped, { ...profile, daysPerWeek: 5 });
  assert.deepEqual(revised.slotSkips, skipped.slotSkips);
  assert.equal(revised.planRevision, 2);
});

test('plan-affecting settings make a new revision without changing active work', () => {
  const state = fresh();
  const active = { ...state, current: runSlot(state).history[0] };
  const revised = updateProfile(active, { daysPerWeek: 5 });
  assert.equal(revised.planRevision, 2);
  assert.equal(revised.programCursor?.seq, 0);
  assert.deepEqual(revised.current?.exercises, active.current?.exercises);
  assert.equal(updateProfile(revised, { name: 'New name' }).planRevision, 2);
});

test('settings that leave the slot list unchanged keep the revision, cursor and skips', () => {
  const mid = skipCurrentSlot(runSlot(fresh()), '2026-11-02T09:00:00.000Z');
  assert.equal(nextSlotIndex(mid), 2);
  const changed = updateProfile(mid, { sessionMinutes: 60, goal: 'Lose Fat', experience: 'Intermediate', exclusions: ['Squat'] });
  assert.equal(changed.planRevision, mid.planRevision);
  assert.deepEqual(changed.programCursor, mid.programCursor);
  assert.deepEqual(changed.slotSkips, mid.slotSkips);
  assert.equal(changed.profile?.sessionMinutes, 60);
  // A different slot list still starts a new revision.
  assert.equal(updateProfile(mid, { daysPerWeek: 5 }).planRevision, 2);
});

test('a finish with no completed working set does not advance the cursor', () => {
  const state = fresh();
  const slot = currentSlot(state)!;
  const adapted = adaptWorkout(slotProgram(profile, slot, []), { minutes: 35, equipment: 'home' }, []);
  const session = createSession({
    id: 'empty', name: adapted.name, dayIndex: slot.index, slotId: slot.id, slotSeq: 0,
    planRevision: state.planRevision, exercises: toWorkoutExercises(adapted), now: '2026-11-01T10:00:00.000Z',
  });
  const after = applyFinish({ ...state, current: session }, 'empty', { early: true, now: '2026-11-01T10:30:00.000Z' });
  assert.equal(nextSlotIndex(after), 0);
  assert.equal(after.programCursor?.seq, 0);
});
