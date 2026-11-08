import assert from 'node:assert/strict';
import test from 'node:test';
import { fresherDay, listAreas, musclesWorked, nextRepeats, recentlyTrained, todayFresher } from '../src/lib/recovery.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { advanceAfterFinish, planSlots, todayProgram } from '../src/lib/sequence.ts';
import { skipForward } from '../src/lib/switchDay.ts';
import { switchOptions } from '../src/lib/switchDay.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

const profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'lb', sessionMinutes: 45,
} as unknown as Profile;
const upperLower = [
  { name: 'Upper A', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { name: 'Lower A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  { name: 'Upper B', focus: ['Back', 'Chest', 'Shoulders', 'Triceps', 'Biceps'] },
  { name: 'Lower B', focus: ['Hamstrings', 'Quads', 'Glutes', 'Calves', 'Core'] },
];
const at = (seq: number, plan = upperLower) =>
  ({ ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq } } as unknown as AppState);
const gym = { minutes: 45, equipment: 'gym' } as const;

const NOW = new Date(2026, 10, 10, 9, 0); // Tue 9:00 local
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
function record(ids: string[], endedHoursAgo: number, { done = true, status = 'completed' } = {}): WorkoutRecord {
  return {
    id: `r${ids.join()}${endedHoursAgo}`, date: hoursAgo(endedHoursAgo + 1), endedAt: status === 'completed' ? hoursAgo(endedHoursAgo) : null,
    name: 'Day', dayIndex: 0, status, completedEarly: false,
    exercises: ids.map((exerciseId) => ({
      exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 50 }],
      performed: [{ weight: 50, reps: 8, done, completedAt: done ? hoursAgo(endedHoursAgo) : null }],
    })),
  } as unknown as WorkoutRecord;
}
const upperDay = (h: number) => record(['barbell-bench-press', 'barbell-row', 'overhead-press', 'lat-pulldown'], h);
const lowerDay = (h: number) => record(['back-squat', 'romanian-deadlift', 'plank'], h);

const skipAt = (seq: number, h = 10, revision = 1, plan = upperLower) => ({
  id: `skip:${revision}:${seq}`, revision, seq, at: hoursAgo(h),
  slotId: planSlots(plan as AppState['plan'])[((seq % plan.length) + plan.length) % plan.length].id,
});
/** Today's offer through the one public path; by default the slot before the cursor was skipped 10 h ago. */
function offer(seq: number, history: WorkoutRecord[], plan = upperLower, slotSkips = [skipAt(seq - 1, 10, 1, plan)]) {
  return todayFresher(profile, { ...at(seq, plan), history, slotSkips }, gym, null, NOW);
}

test('#134: muscles worked follow the skipped-area rule: hinge counts the back, assisting arms do not', () => {
  assert.deepEqual([...musclesWorked(lowerDay(1))].sort(), ['Back', 'Core', 'Glutes', 'Hamstrings', 'Quads'], 'a plank is core work; the squat closing Core is not');
  assert.deepEqual([...musclesWorked(record(['barbell-bench-press'], 1))], ['Chest'], 'triceps assist a press, not trained by it');
  assert.equal(musclesWorked(record(['barbell-row'], 1, { done: false })).size, 0, 'no done set, nothing worked');
});

test('#134: only finished sessions in the last 48 h count; open, old and future sessions do not', () => {
  assert.ok(recentlyTrained([upperDay(47)], NOW).has('Chest'));
  assert.equal(recentlyTrained([upperDay(49)], NOW).size, 0, 'older than 48 h');
  assert.equal(recentlyTrained([record(['barbell-row'], 1, { status: 'active' })], NOW).size, 0, 'an open session');
  const legacy = { ...upperDay(5), endedAt: undefined } as unknown as WorkoutRecord;
  assert.ok(recentlyTrained([legacy], NOW).has('Back'), 'a legacy record without endedAt uses its start');
});

test('#134: Upper A yesterday, Lower A skipped, Upper B up next: offers Lower B, skipping Upper B', () => {
  const result = offer(2, [upperDay(20)]);
  assert.ok(result);
  assert.equal(result.nextName, 'Upper B');
  assert.equal(result.option.name, 'Lower B');
  assert.equal(result.option.offset, 1);
  assert.deepEqual(result.option.skips, ['Upper B']);
  assert.deepEqual(result.areas, ['Chest', 'Back', 'Shoulders']);
  assert.equal(listAreas(result.areas), 'Chest, Back and Shoulders');
  assert.equal(result.when, 'yesterday');
});

test('#134: the offer is the Switch sheet option itself, so picking it runs the same forward skip', () => {
  const state = at(2);
  const options = switchOptions(profile, state, [upperDay(20)], gym);
  const result = fresherDay(planSlots(state.plan), options, [upperDay(20)], NOW);
  assert.ok(result && options.includes(result.option));
});

test('#134: no offer when the next day is fresh, nothing recent, or every day repeats about as much', () => {
  assert.equal(offer(1, [upperDay(20)]), null, 'Lower after Upper repeats nothing');
  assert.equal(offer(2, [upperDay(60)]), null, 'trained 60 h ago: recovered');
  assert.equal(offer(2, []), null, 'no history');
  const fullBody = [
    { name: 'Full Body A', focus: ['Chest', 'Back', 'Quads', 'Hamstrings', 'Shoulders', 'Core'] },
    { name: 'Full Body B', focus: ['Back', 'Chest', 'Glutes', 'Hamstrings', 'Biceps', 'Triceps', 'Calves'] },
  ];
  assert.equal(offer(0, [record(['barbell-bench-press', 'barbell-row', 'back-squat', 'romanian-deadlift'], 20)], fullBody, [skipAt(0, 10, 1, fullBody)]), null,
    'Full Body days overlap alike: no nagging');
});

test('#134: a hinge yesterday makes Upper repeat the back, but Upper is still fresher than the other Lower', () => {
  const result = offer(3, [lowerDay(20)]);
  assert.ok(result);
  assert.equal(result.nextName, 'Lower B');
  assert.equal(result.option.name, 'Upper A');
  assert.deepEqual(result.areas, ['Legs'], 'what Lower B repeats');
});

test('#134: "today" when the repeat was trained earlier the same day', () => {
  assert.equal(offer(2, [upperDay(2)])?.when, 'today');
  assert.equal(offer(2, [upperDay(40)])?.when, '2 days ago');
});

test('#134: a day with nothing to train today is never offered', () => {
  const state = at(2);
  const options = switchOptions(profile, state, [upperDay(20)], gym).map((option) =>
    option.name.startsWith('Lower') ? { ...option, status: 'none' as const } : option);
  assert.equal(fresherDay(planSlots(state.plan), options, [upperDay(20)], NOW), null);
});

/* ---------- fix round 1: the gate, the reach, the clock ---------- */

const ppl = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];
const fiveDay = [...ppl,
  { name: 'Upper', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { name: 'Lower', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];
const sixDay = [
  { name: 'Push A', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull A', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
  { name: 'Push B', focus: ['Shoulders', 'Chest', 'Triceps'] },
  { name: 'Pull B', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs B', focus: ['Hamstrings', 'Glutes', 'Quads', 'Calves', 'Core'] },
];
const legsDay = (h: number) => record(['back-squat', 'romanian-deadlift'], h);
const pullDay = (h: number) => record(['barbell-row', 'lat-pulldown'], h);

test('#134 fix: 3-day, Pull done, Legs skipped, Push next: no offer', () => {
  assert.equal(offer(3, [pullDay(20)], ppl), null);
});

test('#134 fix: 4-day, Lower done, Upper skipped: offers Upper A', () => {
  assert.equal(offer(3, [lowerDay(20)])?.option.name, 'Upper A');
});

test('#134 fix: 5-day, Legs done (squat + RDL), Upper next: no offer, though the hinge marked the back', () => {
  assert.equal(offer(3, [legsDay(20)], fiveDay), null);
});

test('#134 fix: 5-day, Lower done, Push skipped: no offer further than 2 skips', () => {
  assert.equal(offer(6, [legsDay(20)], fiveDay), null, 'Push is fresh, but 4 skips away');
});

test('#134 fix: 6-day, one repeated muscle that does not lead the day: no offer', () => {
  assert.equal(offer(3, [record(['barbell-bench-press'], 20)], sixDay), null, 'Push B repeats Chest only');
});

test('#134 fix: between equally fresh days, the fewest skips wins', () => {
  const result = offer(4, [pullDay(20)], sixDay);
  assert.equal(result?.option.name, 'Legs B');
  assert.equal(result?.option.offset, 1);
});

test('#134 fix: a bad endedAt falls back to the start; a future end counts as now', () => {
  const bad = { ...upperDay(5), endedAt: 'not a date' } as unknown as WorkoutRecord;
  assert.ok(recentlyTrained([bad], NOW).has('Chest'), 'NaN endedAt uses date');
  const neither = { ...bad, date: 'nope' } as unknown as WorkoutRecord;
  assert.equal(recentlyTrained([neither], NOW).size, 0, 'both bad: skipped');
  assert.equal(recentlyTrained([upperDay(-2)], NOW).get('Chest')?.getTime(), NOW.getTime(), 'a clock in the future');
  assert.equal(offer(2, [upperDay(-2)])?.when, 'today');
});

test('#134 fix: a described-day record (no slot link) counts', () => {
  const described = { ...record(['barbell-bench-press', 'overhead-press'], 10), name: 'Chest + Shoulders' } as WorkoutRecord;
  assert.equal(described.slotId, undefined);
  assert.deepEqual([...recentlyTrained([described], NOW).keys()].sort(), ['Chest', 'Shoulders']);
});

test('#134 fix: the precheck needs no priced days: nextRepeats is empty when no offer can follow', () => {
  const slots = (plan: typeof upperLower) => planSlots(plan as AppState['plan']);
  assert.deepEqual(nextRepeats(slots(fiveDay)[3], [legsDay(20)], NOW), [], '5-day Upper after Legs');
  assert.deepEqual(nextRepeats(slots(sixDay)[3], [record(['barbell-bench-press'], 20)], NOW), [], '6-day Push B');
  assert.deepEqual(nextRepeats(slots(upperLower)[2], [upperDay(20)], NOW), ['Back', 'Chest', 'Shoulders'], 'Upper B after Upper A');
});

/* ---------- fix round 2: only when the order was broken ---------- */

test('#134 order: no offer on the planned order, however much repeats (5-day: Pull 44 h, Legs 20 h, Upper next)', () => {
  assert.equal(offer(3, [pullDay(44), legsDay(20)], fiveDay, []), null);
  assert.equal(offer(2, [upperDay(20)], upperLower, []), null, 'no skip, no described day');
  assert.equal(offer(2, [upperDay(20)], upperLower, [skipAt(1, 50)]), null, 'the skip is older than 48 h');
  assert.equal(offer(2, [upperDay(20)], upperLower, [skipAt(1, 10, 0)]), null, 'the skip belongs to an older plan');
  assert.equal(offer(2, [upperDay(20)])?.option.name, 'Lower B', 'a skip 10 h ago breaks the order');
});

test('#134 order: a finished described day breaks the order too', () => {
  const described = { ...upperDay(20), name: 'Chest + Back + Shoulders', planRevision: 1 } as WorkoutRecord;
  assert.equal(offer(2, [described], upperLower, [])?.option.name, 'Lower B');
});

test('#134 order: sweep, every split 2-6, 1 to 3 days done in the planned order from every start: no offer', () => {
  for (let days = 2; days <= 6; days += 1) {
    const plan = buildPlan({ ...profile, daysPerWeek: days });
    const slots = planSlots(plan);
    for (let start = 0; start < days; start += 1) {
      for (let done = 1; done <= 3; done += 1) {
        const history: WorkoutRecord[] = [];
        for (let k = 0; k < done; k += 1) {
          const slot = slots[(start + k) % days];
          const ids = todayProgram(profile, slot, history, gym).exercises.map((exercise) => exercise.exerciseId);
          history.push({ ...record(ids, (done - k) * 20), slotId: slot.id, slotSeq: start + k, planRevision: 1 } as WorkoutRecord);
        }
        assert.equal(offer(start + done, history, plan as typeof upperLower, []), null, `${days}-day from ${slots[start].name}, ${done} done`);
      }
    }
  }
});

test('#134 lead: on 6-day Push B the lead repeats only when a done lift listed Shoulders first', () => {
  assert.equal(offer(3, [record(['face-pull'], 20)], sixDay), null, 'a face pull is back work that touches the shoulders');
  assert.equal(offer(3, [record(['overhead-press'], 20)], sixDay)?.option.name, 'Pull B');
});

/* ---------- fix round 3: never the day just skipped, never a loop ---------- */

test('#134 skipped: 3-day, Push and Pull done, Legs skipped: Legs is never the offer', () => {
  const push = record(['barbell-bench-press', 'overhead-press', 'triceps-pushdown'], 40);
  const result = offer(3, [push, pullDay(20)], ppl, [skipAt(2, 10, 1, ppl)]);
  assert.notEqual(result?.option.name, 'Legs');
});

test('#134 after: a skip before the last planned session no longer breaks the order', () => {
  const planned = { ...upperDay(5), slotId: 'slot-0-upper-a', slotSeq: 4, planRevision: 1 } as WorkoutRecord;
  assert.equal(offer(2, [planned], upperLower, [skipAt(1, 10)]), null, 'skip 10 h ago, planned session 5 h ago');
  assert.ok(offer(2, [{ ...planned, endedAt: hoursAgo(20), date: hoursAgo(21) } as WorkoutRecord], upperLower, [skipAt(1, 10)]),
    'the skip came after it');
});

test('#134 future: a skip stamped more than 10 minutes ahead is ignored', () => {
  assert.equal(offer(2, [upperDay(20)], upperLower, [skipAt(1, -1)]), null, 'an hour ahead');
  assert.ok(offer(2, [upperDay(20)], upperLower, [skipAt(1, -0.1)]), '6 minutes ahead is clock skew');
});

test('#134 loop: 14 days of daily 3-day training after one skip, taking every offer: at most one offer', () => {
  const plan = buildPlan({ ...profile, daysPerWeek: 3 });
  const day0 = new Date(2026, 10, 1);
  const at = (day: number, hour: number) => new Date(day0.getTime() + day * 86_400_000 + hour * 3_600_000);
  for (let skipDay = 0; skipDay <= 5; skipDay += 1) {
    let state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 }, history: [], slotSkips: [] } as unknown as AppState;
    const train = (day: number) => {
      const slot = planSlots(state.plan)[state.programCursor!.seq % 3];
      const ids = todayProgram(profile, slot, state.history, gym).exercises.map((exercise) => exercise.exerciseId);
      const end = at(day, 10).toISOString();
      const workout = {
        id: `d${day}`, date: at(day, 9.5).toISOString(), endedAt: end, name: slot.name, dayIndex: slot.index, status: 'completed',
        completedEarly: false, slotId: slot.id, slotSeq: state.programCursor!.seq, planRevision: 1,
        exercises: ids.map((exerciseId) => ({ exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 50 }],
          performed: [{ weight: 50, reps: 8, done: true, completedAt: end }] })),
      } as unknown as WorkoutRecord;
      state = advanceAfterFinish({ ...state, history: [...state.history, workout] }, workout);
    };
    for (let day = 0; day < skipDay; day += 1) train(day);
    state = skipForward(state, 1, at(skipDay, 8).toISOString());
    let offers = 0;
    for (let day = skipDay; day < skipDay + 14; day += 1) {
      const now = at(day, 9);
      const fresher = todayFresher(profile, state, gym, null, now);
      if (fresher) {
        offers += 1;
        state = skipForward(state, fresher.option.offset, now.toISOString());
      }
      train(day);
    }
    assert.ok(offers <= 1, `skip on day ${skipDay}: ${offers} offers in 14 days`);
  }
});

/* ---------- fix round 4: a fresher day must itself be fresh ---------- */

test('#134 fresh: 3-day, Legs Mon, Push Tue, Pull skipped Wed 08:00: Push (trained 23 h ago) is not offered', () => {
  const slots = planSlots(ppl as AppState['plan']);
  const session = (index: number, h: number, seq: number) => ({
    ...record(todayProgram(profile, slots[index], [], gym).exercises.map((exercise) => exercise.exerciseId), h),
    slotId: slots[index].id, slotSeq: seq, planRevision: 1,
  } as WorkoutRecord);
  const result = offer(5, [session(2, 47, 2), session(0, 23, 3)], ppl, [skipAt(4, 1, 1, ppl)]);
  assert.notEqual(result?.option.name, 'Push', `${result?.areas} trained ${result?.when}. ${result?.option.name} is fresher.`);
});
