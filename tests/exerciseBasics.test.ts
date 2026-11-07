import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { existsSync, readFileSync } from 'node:fs';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { leadCompoundId, roleTarget } from '../src/lib/progression.ts';
import type { Profile } from '../src/types.ts';

// #174: the week covers the basics wherever the kit allows it, and days run in a coach's order.

const at = (equipment: string[], support: string[], daysPerWeek: number, sessionMinutes = 60) => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek, equipment, support, exclusions: [], loads: {}, sessionMinutes,
}) as unknown as Profile;

const BASICS: Record<string, (pattern: string) => boolean> = {
  squat: (p) => p === 'squat', hinge: (p) => p === 'hinge', 'single-leg': (p) => p === 'lunge',
  'horizontal push': (p) => p === 'horizontal_push', 'vertical push': (p) => p === 'vertical_push',
  'horizontal pull': (p) => p === 'horizontal_pull', 'vertical pull': (p) => p === 'vertical_pull',
  calves: (p) => p === 'calf_raise', biceps: (p) => p === 'elbow_flexion', triceps: (p) => p === 'elbow_extension',
  core: (p) => p === 'core_flexion' || p === 'core_stability',
};

function week(profile: Profile) {
  return buildPlan(profile).map((day, index) => ({ day, ids: generateWorkout(profile, day, index).exercises.map((e) => e.exerciseId) }));
}
function missing(profile: Profile) {
  const patterns = week(profile).flatMap(({ ids }) => ids.map((id) => exerciseById(id)!.pattern));
  return Object.entries(BASICS).filter(([, has]) => !patterns.some(has)).map(([name]) => name);
}

test('a 60-minute week covers every basic with a gym or with dumbbells and a bench', () => {
  for (const [label, equipment, support] of [
    ['gym', ['Barbell', 'Dumbbell', 'Machine', 'Cable'], ['Bench', 'Rack', 'Pull-up bar', 'Dip bars']],
    ['dumbbells + bench', ['Dumbbell'], ['Bench']],
  ] as const) {
    for (const days of [3, 4]) assert.deepEqual(missing(at([...equipment], [...support], days)), [], `${label} ${days}d`);
  }
});

test('dumbbells alone get a hinge and calf work on leg days', () => {
  for (const days of [3, 4]) {
    const lower = week(at(['Dumbbell'], [], days)).filter(({ day }) => /Legs|Lower/.test(day.name));
    assert.ok(lower.length > 0);
    for (const { day, ids } of lower) {
      assert.ok(ids.some((id) => exerciseById(id)!.pattern === 'hinge'), `${day.name}: ${ids.join(', ')}`);
      assert.ok(ids.some((id) => exerciseById(id)!.pattern === 'calf_raise'), `${day.name}: ${ids.join(', ')}`);
    }
  }
});

test('kettlebell and bodyweight weeks now squat, lunge and (with a kettlebell) hinge, press and row', () => {
  assert.deepEqual(missing(at(['Kettlebell'], [], 3)).filter((m) => ['squat', 'hinge', 'single-leg', 'vertical push', 'horizontal pull'].includes(m)), []);
  assert.deepEqual(missing(at([], [], 3)).filter((m) => ['squat', 'single-leg'].includes(m)), []);
});

test('heavy barbell squats and hinges come before other compounds, single-leg work last', () => {
  for (const { day, ids } of week(at(['Barbell', 'Dumbbell', 'Machine', 'Cable'], ['Bench', 'Rack', 'Pull-up bar'], 3))) {
    const lunge = ids.findIndex((id) => exerciseById(id)!.pattern === 'lunge');
    const deadlift = ids.indexOf('deadlift');
    const hipThrust = ids.indexOf('hip-thrust');
    if (lunge >= 0 && deadlift >= 0) assert.ok(deadlift < lunge, `${day.name}: ${ids.join(', ')}`);
    if (hipThrust >= 0 && deadlift >= 0) assert.ok(deadlift < hipThrust, `${day.name}: ${ids.join(', ')}`);
  }
});

test('dumbbell and kettlebell leads run 6–10, a swing never leads, and a pullover never leads', () => {
  const profile = at(['Dumbbell'], ['Bench'], 3);
  for (const { ids } of week(profile)) {
    const lead = leadCompoundId(ids);
    if (!lead) continue;
    assert.ok(!['kettlebell-swing', 'dumbbell-pullover'].includes(lead));
    assert.deepEqual(roleTarget(exerciseById(lead)!, profile, true).range, { min: 6, max: 10 }, lead);
  }
  assert.equal(leadCompoundId(['kettlebell-swing', 'kettlebell-goblet-squat']), 'kettlebell-goblet-squat');
});

const media = JSON.parse(readFileSync(new URL('../src/data/media.json', import.meta.url), 'utf8')) as Record<string, { frames: string[] }>;

test('every new exercise ships two demo frames', () => {
  for (const id of ['dumbbell-romanian-deadlift', 'dumbbell-calf-raise', 'dumbbell-pullover', 'kettlebell-swing',
    'kettlebell-row', 'kettlebell-press', 'bodyweight-squat', 'bodyweight-lunge']) {
    assert.ok(exerciseById(id), id);
    const frames: string[] = media[id]?.frames ?? [];
    assert.equal(frames.length, 2, id);
    for (const frame of frames) assert.ok(existsSync(new URL(`../public${frame}`, import.meta.url)), frame);
  }
});
