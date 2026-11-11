import assert from 'node:assert/strict';
import test from 'node:test';
import { heldMessage, lastWorkingKg, overLastTime } from '../src/lib/carry.ts';
import { carryWeight, createSession, editSet, logSet, revertBurst, undoCarry, type CarryResult, type Followers } from '../src/lib/session.ts';
import { toKg } from '../src/lib/units.ts';
import type { PerformedSet, SetupChoice, WorkoutRecord } from '../src/types.ts';

// #327: a typed working weight more than 10% over last time applies to its own set only.
const NOW = '2026-11-11T10:00:00.000Z';
const BENCH = 'barbell-bench-press';

type Row = Partial<PerformedSet> & { weight: number };
function workout(id: string, date: string, entries: { exerciseId: string; sets: Row[]; setup?: SetupChoice }[], status: WorkoutRecord['status'] = 'completed'): WorkoutRecord {
  const record = createSession({ id, name: 'Day', dayIndex: 0, now: date, exercises: entries.map(({ exerciseId, sets, setup }) => ({
    exerciseId, name: exerciseId, ...(setup ? { setup } : {}),
    planned: sets.map(({ weight }) => ({ weight, reps: 5 })),
    performed: sets.map((set) => ({ reps: 5, done: true, completedAt: date, ...set })),
  })) });
  return { ...record, status, endedAt: status === 'completed' ? date : null };
}
const last60 = [workout('w1', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: Array(5).fill({ weight: 60 }) }])];
const over = (history: WorkoutRecord[], exerciseId: string, kg: number, unit: 'kg' | 'lb' = 'kg', setup?: SetupChoice) =>
  overLastTime({ history, exerciseId, kg, unit, setup });

test('60 to 66 carries, 60 to 67 does not (kg): exactly 10% is fine', () => {
  assert.equal(over(last60, BENCH, 66), null);
  assert.deepEqual(over(last60, BENCH, 67), { percent: 12, lastKg: 60 });
  assert.deepEqual(over(last60, BENCH, 80), { percent: 33, lastKg: 60 });
  assert.equal(over(last60, BENCH, 66.4), null, 'whole-unit rounding: 66.4 reads as 66');
  assert.ok(over(last60, BENCH, 66.5), '66.5 reads as 67');
});

test('the 10% edge in lb, compared in the display unit', () => {
  const lb = [workout('w1', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: Array(3).fill({ weight: toKg(60, 'lb') }) }])];
  assert.equal(over(lb, BENCH, toKg(66, 'lb'), 'lb'), null);
  assert.equal(over(lb, BENCH, toKg(67, 'lb'), 'lb')?.percent, 12);
  const lb135 = [workout('w1', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: toKg(135, 'lb') }] }])];
  // 135 × 1.1 = 148.5: 148 carries, 149 does not.
  assert.equal(over(lb135, BENCH, toKg(148, 'lb'), 'lb'), null);
  assert.equal(over(lb135, BENCH, toKg(149, 'lb'), 'lb')?.percent, 10);
});

test('no history, a first set ever, or a lighter load: nothing changes', () => {
  assert.equal(over([], BENCH, 200), null);
  assert.equal(over(last60, BENCH, 40), null, 'a deload');
  assert.equal(over(last60, BENCH, 0), null, 'an empty cell');
  // An open (not finished) session is not history.
  assert.equal(over([workout('w0', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: 60 }] }], 'active')], BENCH, 80), null);
});

test('a swapped-in variant has no history of its own: no check', () => {
  assert.equal(over(last60, 'dumbbell-bench-press', 80), null);
  assert.equal(over(last60, 'close-grip-bench', 80), null);
});

test('each with each, total with total: the load mode belongs to the exercise', () => {
  const history = [workout('w1', '2026-11-04T10:00:00.000Z', [
    { exerciseId: 'dumbbell-floor-press', sets: [{ weight: 20 }, { weight: 20 }] },
    { exerciseId: 'goblet-squat', sets: [{ weight: 20 }, { weight: 20 }] },
  ])];
  assert.equal(over(history, 'dumbbell-floor-press', 22), null);
  assert.equal(over(history, 'dumbbell-floor-press', 24)?.percent, 20);
  assert.equal(over(history, 'goblet-squat', 22), null);
  assert.equal(over(history, 'goblet-squat', 24)?.percent, 20);
  assert.equal(heldMessage({ kg: 24, percent: 20, setIndex: 0, unit: 'kg', mode: 'each' }), '24 kg each is 20% over last time. Applied to set 1 only.');
});

test('seconds and bodyweight lifts: no check', () => {
  const history = [workout('w1', '2026-11-04T10:00:00.000Z', [
    { exerciseId: 'plank', sets: [{ weight: 10 }] },
    { exerciseId: 'push-up', sets: [{ weight: 10 }] },
  ])];
  assert.equal(over(history, 'plank', 40), null);
  assert.equal(over(history, 'push-up', 40), null);
});

test('skipped (unlogged) and 0-weight sets are not "last logged"; warm-up rows are never stored as sets', () => {
  const history = [workout('w1', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: [
    { weight: 0 }, { weight: 60 }, { weight: 100, done: false, completedAt: null },
  ] }])];
  assert.equal(lastWorkingKg(history, BENCH), 60);
  assert.ok(over(history, BENCH, 67));
});

test('the heaviest working set of the most recent finished session; a later session with nothing logged is passed over', () => {
  const history = [
    workout('old', '2026-11-01T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: 100 }] }]),
    workout('new', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: 55 }, { weight: 60 }, { weight: 57.5 }] }]),
    workout('skipped', '2026-11-06T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: 90, done: false, completedAt: null }] }]),
  ];
  assert.equal(lastWorkingKg(history, BENCH), 60);
  assert.equal(over(history, BENCH, 67)?.percent, 12);
});

test('a today-only setup reads its own history first, then the saved setup', () => {
  const history = [
    workout('home', '2026-11-01T10:00:00.000Z', [{ exerciseId: BENCH, sets: [{ weight: 60 }] }]),
    workout('hotel', '2026-11-04T10:00:00.000Z', [{ exerciseId: BENCH, setup: 'hotel', sets: [{ weight: 40 }] }]),
  ];
  assert.equal(lastWorkingKg(history, BENCH), 60);
  assert.equal(lastWorkingKg(history, BENCH, 'hotel'), 40);
  assert.equal(lastWorkingKg(history, BENCH, 'bands'), 60);
});

test('the notice names the typed weight in the user unit, a whole percent and the set typed', () => {
  assert.equal(heldMessage({ kg: 80, percent: 33, setIndex: 0, unit: 'kg', mode: 'total' }), '80 kg is 33% over last time. Applied to set 1 only.');
  assert.equal(heldMessage({ kg: toKg(155, 'lb'), percent: 15, setIndex: 2, unit: 'lb', mode: 'total' }), '155 lb is 15% over last time. Applied to set 3 only.');
});

// The keystroke burst as App runs it (lesson 26, 28): followers fixed by the first keystroke; an over-limit
// keystroke reverts what the burst carried and holds the typed set; Apply to all carries; Undo restores.
function bench60(): WorkoutRecord {
  return createSession({ id: 's', name: 'Upper', dayIndex: 0, now: NOW, exercises: [{
    exerciseId: BENCH, name: 'Barbell Bench Press',
    planned: Array.from({ length: 5 }, () => ({ weight: 60, reps: 5 })),
    performed: Array.from({ length: 5 }, () => ({ weight: 60, reps: 5, done: false, completedAt: null })),
  }] });
}
const weights = (s: WorkoutRecord) => s.exercises[0].performed.map((set) => set.weight);

function type(s: WorkoutRecord, set: number, values: number[]) {
  let followers: Followers | undefined;
  let previous: CarryResult['previous'] = [];
  let held = false;
  for (const kg of values) {
    const would = editSet(s, 0, set, { weight: kg }, NOW, followers);
    followers = would.followers;
    if (over(last60, BENCH, kg)) {
      s = revertBurst(s, 0, BENCH, set, { weight: kg }, previous, NOW);
      previous = [...previous, ...would.previous.filter((p) => !previous.some((q) => q.index === p.index))];
      held = true;
    } else {
      previous = [...previous, ...would.previous.filter((p) => !previous.some((q) => q.index === p.index))];
      s = would.session;
      held = false;
    }
  }
  return { session: s, previous, followers: followers!, held };
}

test('8 then 0 from 60: the 8 carries, the 0 reverts the burst and holds 80 on set 1', () => {
  const eight = type(bench60(), 0, [8]);
  assert.deepEqual(weights(eight.session), [8, 8, 8, 8, 8]);
  const eighty = type(bench60(), 0, [8, 80]);
  assert.deepEqual(weights(eighty.session), [80, 60, 60, 60, 60]);
  assert.ok(eighty.held);
  // Backspace to 8 carries again, to the same sets.
  const back = type(bench60(), 0, [8, 80, 8]);
  assert.deepEqual(weights(back.session), [8, 8, 8, 8, 8]);
  assert.ok(!back.held);
  // 6 then 7: 67 is over.
  assert.deepEqual(weights(type(bench60(), 0, [6, 67]).session), [67, 60, 60, 60, 60]);
  assert.deepEqual(weights(type(bench60(), 0, [6, 66]).session), [66, 66, 66, 66, 66]);
});

test('Apply to all carries to the burst\'s sets; Undo restores every one, including those the burst reverted', () => {
  const held = type(bench60(), 0, [8, 80]);
  const applied = carryWeight(held.session, 0, held.followers.weight, 80, NOW);
  assert.deepEqual(weights(applied.session), [80, 80, 80, 80, 80]);
  assert.deepEqual(applied.carried, [1, 2, 3, 4]);
  const undone = undoCarry(applied.session, 0, BENCH, applied.previous, NOW);
  assert.deepEqual(weights(undone), [80, 60, 60, 60, 60]);
});

function empty(): WorkoutRecord {
  const s = bench60();
  s.exercises[0].performed = s.exercises[0].performed.map((set) => ({ ...set, weight: 0 }));
  return s;
}

test('review 1: on a day whose later sets are empty, logging the held set carries no load to them; reps still carry', () => {
  const held = type(empty(), 0, [8, 80]);
  assert.deepEqual(weights(held.session), [80, 0, 0, 0, 0]);
  const reps3 = editSet(held.session, 0, 0, { reps: 3 }, NOW).session;
  const logged = logSet(reps3, 0, 0, NOW, 75, { carryWeight: false });
  assert.deepEqual(weights(logged), [80, 0, 0, 0, 0], '"Applied to set 1 only" stays true');
  assert.deepEqual(logged.exercises[0].performed.map((set) => set.reps), [3, 3, 3, 3, 3]);
  // Without a hold, #182 still carries the load into empty sets.
  assert.deepEqual(weights(logSet(reps3, 0, 0, NOW)), [80, 80, 80, 80, 80]);
  // Apply to all after the log still carries to the burst's sets.
  assert.deepEqual(weights(carryWeight(logged, 0, held.followers.weight, 80, NOW).session), [80, 80, 80, 80, 80]);
});

test('review 1: Undo after Apply to all never reverses the reps a logged set carried (#182, #306)', () => {
  const held = type(bench60(), 0, [8, 80]);
  const reps3 = editSet(held.session, 0, 0, { reps: 3 }, NOW, { weight: [], reps: [] }).session;
  const logged = logSet(reps3, 0, 0, NOW, 75, { carryWeight: false });
  assert.deepEqual(logged.exercises[0].performed.map((set) => set.reps), [3, 3, 3, 3, 3]);
  const applied = carryWeight(logged, 0, held.followers.weight, 80, NOW);
  const undone = undoCarry(applied.session, 0, BENCH, applied.previous, NOW);
  assert.deepEqual(undone.exercises[0].performed.map((set) => [set.weight, set.reps]), [[80, 3], [60, 3], [60, 3], [60, 3], [60, 3]]);
});

test('any set, not only set 1: typing in set 3 holds set 3 only', () => {
  const held = type(bench60(), 2, [8, 80]);
  assert.deepEqual(weights(held.session), [60, 60, 80, 60, 60]);
  assert.deepEqual(held.followers.weight, [3, 4]);
});
