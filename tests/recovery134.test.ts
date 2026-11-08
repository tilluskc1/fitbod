import assert from 'node:assert/strict';
import test from 'node:test';
import { fresherDay, listAreas, musclesWorked, recentlyTrained } from '../src/lib/recovery.ts';
import { planSlots } from '../src/lib/sequence.ts';
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

function offer(seq: number, history: WorkoutRecord[], plan = upperLower) {
  const state = at(seq, plan);
  return fresherDay(planSlots(state.plan), switchOptions(profile, state, history, gym), history, NOW);
}

test('#134: muscles worked follow the skipped-area rule: hinge counts the back, assisting arms do not', () => {
  assert.deepEqual([...musclesWorked(lowerDay(1))].sort(), ['Back', 'Core', 'Glutes', 'Hamstrings', 'Quads'], 'a plank is core work; the squat closing Core is not');
  assert.deepEqual([...musclesWorked(record(['barbell-bench-press'], 1))], ['Chest'], 'triceps assist a press, not trained by it');
  assert.equal(musclesWorked(record(['barbell-row'], 1, { done: false })).size, 0, 'no done set, nothing worked');
});

test('#134: only finished sessions in the last 48 h count; open, old and future sessions do not', () => {
  assert.ok(recentlyTrained([upperDay(47)], NOW).has('Chest'));
  assert.equal(recentlyTrained([upperDay(49)], NOW).size, 0, 'older than 48 h');
  assert.equal(recentlyTrained([upperDay(-2)], NOW).size, 0, 'a clock in the future');
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
  assert.equal(offer(0, [record(['barbell-bench-press', 'barbell-row', 'back-squat', 'romanian-deadlift'], 20)], fullBody), null,
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
