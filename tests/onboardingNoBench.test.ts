import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { DEFAULT_SUPPORT, EXERCISES } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import type { Profile } from '../src/types.ts';

test('choosing At home pre-selects no support equipment', async () => {
  // Onboarding now starts At a gym (owner default, #222), where a gym's racks and benches are
  // preselected. Home gear must still never assume a bench: choosing At home resets support to
  // DEFAULT_SUPPORT. The chips live on step 4, which a static render cannot reach, so assert the source.
  assert.deepEqual(DEFAULT_SUPPORT, []);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const source = (await server.transformRequest('/src/components/Onboarding.tsx'))!.code;
    assert.match(source, /setSupport\(DEFAULT_SUPPORT\)/);
  } finally {
    await server.close();
  }
});

test('dumbbell-only, no support: no bench exercise, and every day reports its feasibility', () => {
  const profile: Profile = {
    goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
    equipment: ['Dumbbell'], support: [], exclusions: [], loads: {},
  };
  const statuses: string[] = [];
  buildPlan(profile).forEach((day, index) => {
    const session = generateWorkout(profile, day, index);
    statuses.push(`${day.name}:${session.feasibility.status}`);
    for (const item of session.exercises) {
      const needs = EXERCISES.find((exercise) => exercise.id === item.exerciseId)!.needs;
      assert.ok(!needs.includes('bench'), `${day.name} includes bench exercise ${item.name}`);
    }
    if (session.feasibility.status !== 'ok') assert.ok(session.feasibility.alternatives.length > 0);
  });
  console.log(statuses.join(' '));
});
