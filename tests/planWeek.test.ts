import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import type { Profile } from '../src/types.ts';

// #186: Plan showed only the day up next and left the week blank.
const gym = { name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
  support: ['Bench', 'Rack', 'Pull-up bar'], exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60 } as unknown as Profile;

test('Plan lists every day of the week after the one up next, and names a gym kit', async () => {
  const slots = planSlots(buildPlan(gym));
  const program = slotProgram(gym, slots[0], []);
  const upcoming = slots.slice(1).map((day) => ({ id: day.id, name: day.name, focus: day.focus, exercises: 6, sets: 20, minutes: 58, approx: false, status: 'ok' as const }));
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Plan } = await server.ssrLoadModule('/src/screens/PlanScreen.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(Plan, { profile: gym, upcoming, focus: slots[0].focus, program,
      today: todayGlance(adaptWorkout(program, defaultConstraints(gym), [], gym.goal), null), slotLabel: 'Day 1 of 4', history: [], unit: 'kg',
      onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // (#297) Rows are Today / Next / Then, focus in plain words, one stats line, no numbered circles.
    assert.match(text, /Your usual: Gym · 60 min · 4 days a week Edit/);
    assert.match(text, /Today Upper A chest, back, shoulders, biceps, triceps/);
    assert.match(text, /Next Lower A quads, hamstrings, glutes, calves 6 exercises · 20 sets · 58 min/);
    assert.match(text, /Then Upper B/);
    assert.doesNotMatch(text, /UP NEXT|AFTER THAT|Your selected equipment/);
    assert.match(text, /Then the plan starts again from Upper A/);
  } finally {
    await server.close();
  }
});
