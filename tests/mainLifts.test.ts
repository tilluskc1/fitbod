import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { matchesRequirement, requirementsForDay } from '../src/lib/feasibility.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { isCompound } from '../src/lib/progression.ts';
import type { Experience, Goal, Profile } from '../src/types.ts';

// #131: ranked main lifts, compounds kept before isolation, and a Face Pull is not a row.
const FULL_GYM = {
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'],
  support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'],
} as const;
const profileOf = (overrides: Partial<Profile> = {}): Profile => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, exclusions: [], loads: {},
  equipment: [...FULL_GYM.equipment], support: [...FULL_GYM.support], ...overrides,
});
const ids = (profile: Profile, dayIndex: number) =>
  generateWorkout(profile, buildPlan(profile)[dayIndex], dayIndex).exercises.map((item) => item.exerciseId);
const each = (fn: (profile: Profile, dayIndex: number, label: string) => void) => {
  for (const experience of ['Intermediate', 'Advanced'] as Experience[])
  for (const goal of ['Build Muscle', 'Get Stronger'] as Goal[])
  for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of [30, 45, 60, 90]) {
    const profile = profileOf({ experience, goal, daysPerWeek, sessionMinutes });
    buildPlan(profile).forEach((day, index) =>
      fn(profile, index, `${experience} ${goal} ${daysPerWeek}d ${sessionMinutes} min ${day.name}: ${ids(profile, index).join(', ')}`));
  }
};

test('a full-gym Intermediate or Advanced Lower or Legs day has a barbell squat or deadlift, at every length', () => {
  each((profile, index, label) => {
    if (!/^(lower|legs)/i.test(buildPlan(profile)[index].name)) return;
    assert.ok(ids(profile, index).some((id) => ['back-squat', 'front-squat', 'deadlift', 'romanian-deadlift'].includes(id)), label);
  });
});

test('the first Lower or Legs day of the week squats and deadlifts with the bar; a repeat day takes the second choice', () => {
  for (const daysPerWeek of [3, 4, 5, 6]) {
    const profile = profileOf({ daysPerWeek, sessionMinutes: 60 });
    const legDays = buildPlan(profile).map((day, index) => ({ day, index })).filter(({ day }) => /^(lower|legs)/i.test(day.name));
    const first = ids(profile, legDays[0].index);
    assert.ok(first.includes('back-squat') && first.includes('deadlift'), `${daysPerWeek}d ${legDays[0].day.name}: ${first.join(', ')}`);
    for (const { day, index } of legDays.slice(1)) {
      const repeat = ids(profile, index);
      assert.ok(!repeat.includes('deadlift'), `no second heavy deadlift in a week: ${daysPerWeek}d ${day.name}: ${repeat.join(', ')}`);
      assert.ok(repeat.includes('romanian-deadlift'), `${daysPerWeek}d ${day.name}: ${repeat.join(', ')}`);
    }
  }
});

test('Push and Upper days at 60 and 90 min overhead press; the first of the week with the barbell', () => {
  for (const daysPerWeek of [3, 4, 5, 6]) for (const sessionMinutes of [60, 90]) {
    const profile = profileOf({ daysPerWeek, sessionMinutes });
    const plan = buildPlan(profile);
    const pressDays = plan.map((day, index) => ({ day, index })).filter(({ day }) => /^(push|upper)/i.test(day.name));
    for (const { day, index } of pressDays) {
      const day_ = ids(profile, index);
      assert.ok(day_.some((id) => exerciseById(id)!.pattern === 'vertical_push'), `${daysPerWeek}d ${sessionMinutes} ${day.name}: ${day_.join(', ')}`);
    }
    assert.ok(ids(profile, pressDays[0].index).includes('overhead-press'), `${daysPerWeek}d ${sessionMinutes} ${pressDays[0].day.name}`);
  }
});

test('Upper at 30 min keeps a press and a row or pulldown that is not a Face Pull', () => {
  for (const experience of ['Beginner', 'Intermediate', 'Advanced'] as Experience[]) for (const sessionMinutes of [30, 45]) {
    const profile = profileOf({ experience, sessionMinutes });
    for (const index of [0, 2]) {
      const day = ids(profile, index).map((id) => exerciseById(id)!);
      const label = `${experience} ${sessionMinutes} min ${buildPlan(profile)[index].name}: ${day.map((item) => item.id).join(', ')}`;
      assert.ok(day.some((item) => /^(horizontal|vertical)_push$/.test(item.pattern)), label);
      assert.ok(day.some((item) => /^(horizontal|vertical)_pull$/.test(item.pattern) && item.id !== 'face-pull'), label);
    }
  }
});

test('a Face Pull does not cover the pull requirement on its own', () => {
  const pull = requirementsForDay({ name: 'Pull', focus: ['Back', 'Biceps', 'Core'] }).find((item) => item.id === 'pull')!;
  assert.equal(matchesRequirement(exerciseById('face-pull')!, pull), false);
  assert.equal(matchesRequirement(exerciseById('seated-cable-row')!, pull), true);
});

test('trimming for time drops isolation before compounds', () => {
  each((profile, index, label) => {
    const day = buildPlan(profile)[index];
    const kept = ids(profile, index).map((id) => exerciseById(id)!);
    const full = ids({ ...profile, sessionMinutes: 120 }, index).map((id) => exerciseById(id)!);
    const droppedCompound = full.some((item) => isCompound(item) && !kept.includes(item));
    if (!droppedCompound) return;
    // An isolation exercise may stay only as the one cover of a day requirement (calves, arms, core).
    for (const item of kept.filter((entry) => !isCompound(entry))) {
      const sole = requirementsForDay(day).some((requirement) => matchesRequirement(item, requirement)
        && kept.filter((entry) => matchesRequirement(entry, requirement)).length === 1);
      assert.ok(sole, `${label} keeps ${item.id} over a compound`);
    }
  });
});
