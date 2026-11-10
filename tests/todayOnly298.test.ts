import assert from 'node:assert/strict';
import test from 'node:test';
import { dayKey } from '../src/lib/plan.ts';
import { baseTalk, talkFromText } from '../src/lib/todayTalk.ts';
import { todayOnly, undoToast, usualGear } from '../src/lib/todayOnly.ts';
import type { AppState, Profile, TodayOverride, WorkoutRecord } from '../src/types.ts';

const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 30,
};
const home: Profile = { ...gym, equipment: ['Dumbbell'], support: ['Bench'], sessionMinutes: 45 };
const noGear: Profile = { ...gym, equipment: [], support: [], sessionMinutes: 30 };

const NOW = new Date(2026, 10, 10, 9, 0);
const override = (patch: Partial<TodayOverride>): TodayOverride => ({
  date: dayKey(NOW), minutes: 30, equipment: [], support: [], appliedAt: NOW.toISOString(), ...patch,
});
const state = (profile: Profile, todayOverride: TodayOverride | null, current: WorkoutRecord | null = null): AppState => ({
  profile, plan: [], history: [], current, todayOverride,
});

test('#298 a gym profile on Travel today: the bar names only the gear, the pill keeps "Gym"', () => {
  const bar = todayOnly(state(gym, override({ choice: 'hotel', equipment: ['Dumbbell'] })), NOW);
  assert.deepEqual(bar, { label: 'Today only: Travel gym', gearDiffers: true });
  assert.equal(usualGear(gym), 'Gym');
});

test('#298 the bar names only what differs: length alone, or gear and length', () => {
  assert.deepEqual(todayOnly(state(gym, override({ choice: 'home', minutes: 45 })), NOW), { label: 'Today only: 45 min', gearDiffers: false });
  assert.deepEqual(
    todayOnly(state(gym, override({ choice: 'hotel', minutes: 45 })), NOW),
    { label: 'Today only: Travel gym · 45 min', gearDiffers: true },
  );
});

test('#298 a described day reads "(you chose)"', () => {
  const bar = todayOnly(state(gym, override({ choice: 'home', focus: ['Chest', 'Back'] })), NOW);
  assert.equal(bar?.label, 'Today only: Chest + Back (you chose)');
});

test('#298 no bar: no override, a running session, or an override from yesterday (midnight passed)', () => {
  assert.equal(todayOnly(state(gym, null), NOW), null);
  const running = { id: 'w', name: 'Upper', date: NOW.toISOString(), status: 'in-progress', exercises: [] } as unknown as WorkoutRecord;
  assert.equal(todayOnly(state(gym, override({ choice: 'hotel' }), running), NOW), null);
  const nextMorning = new Date(2026, 10, 11, 7, 0);
  assert.equal(todayOnly(state(gym, override({ choice: 'hotel' })), nextMorning), null);
});

test('#298 a no-gear profile never shows Bodyweight as a change', () => {
  assert.equal(todayOnly(state(noGear, override({ choice: 'bodyweight' })), NOW), null);
  assert.equal(todayOnly(state(noGear, override({ choice: 'home' })), NOW), null);
  assert.equal(todayOnly(state(noGear, override({ choice: 'bodyweight', minutes: 20 })), NOW)?.label, 'Today only: 20 min');
  assert.equal(usualGear(noGear), 'Bodyweight');
});

test('#298 legacy override without a choice reads its gear the way Today does', () => {
  // Dumbbells stored without a choice read as the saved setup; nothing else differs, so no bar.
  assert.equal(todayOnly(state(gym, override({ equipment: ['Dumbbell'] })), NOW), null);
});

test('#298 Undo toast names the usual gear and length', () => {
  assert.equal(undoToast(gym), 'Back to your usual: Gym · 30 min.');
  assert.equal(undoToast(home), 'Back to your usual: Home · 45 min.');
  assert.equal(undoToast(noGear), 'Back to your usual: Bodyweight · 30 min.');
});

test('#298 "dumbbells only" is the dumbbell-and-bench kit for a gym profile', () => {
  const gymBase = baseTalk({ minutes: 30, equipment: 'home' }, ['Chest'], true);
  for (const phrase of ['dumbbells only', 'just dumbbells', 'only dumbbells today', 'Just dumbbell work']) {
    assert.equal(talkFromText(phrase, gymBase).equipment, 'hotel', phrase);
  }
});

test('#298 gym phrases keep the gym', () => {
  const gymBase = baseTalk({ minutes: 30, equipment: 'home' }, ['Chest'], true);
  for (const phrase of ['I go to gym', 'at the gym', 'full gym', 'gym']) {
    assert.equal(talkFromText(phrase, gymBase).equipment, 'home', phrase);
  }
});

test('#298 "dumbbells only" keeps the saved setup for home and no-gear profiles', () => {
  const homeBase = baseTalk({ minutes: 45, equipment: 'home' }, ['Chest']);
  assert.equal(talkFromText('dumbbells only', homeBase).equipment, 'home');
  assert.equal(talkFromText('just dumbbells', homeBase).equipment, 'home');
  const bodyBase = baseTalk({ minutes: 30, equipment: 'bodyweight' }, ['Chest']);
  // Unchanged reading for a no-gear profile: the parser's own "home" (its kit has no dumbbells).
  assert.equal(talkFromText('dumbbells only', bodyBase).equipment, 'home');
});
