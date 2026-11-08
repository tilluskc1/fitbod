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
      today: todayGlance(adaptWorkout(program, defaultConstraints(gym), [], gym.goal), null), slotLabel: 'Day 1 of 4 this week', history: [], unit: 'kg',
      now: new Date('2026-11-07T10:00:00Z'), onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /UP NEXT · DAY 1 OF 4 THIS WEEK Upper A Chest · Back · Shoulders · Biceps · Triceps/);
    assert.match(text, /THEN Lower A Quads · Hamstrings · Glutes · Calves · Core 58 min · 6 exercises · 20 sets/);
    assert.match(text, /AFTER THAT Upper B/);
    assert.match(text, /AFTER THAT Lower B/);
    assert.match(text, /Then the plan starts again from Upper A/);
    assert.match(text, /Full gym/);
  } finally {
    await server.close();
  }
});
