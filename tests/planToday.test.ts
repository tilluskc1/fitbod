import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, todayGlance, type AdaptedWorkout } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { createSession } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #189: Plan's header and Up next described the saved day while View session showed today's.
const gym = { name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
  support: ['Bench', 'Rack', 'Pull-up bar'], exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60 } as unknown as Profile;
const slot = planSlots(buildPlan(gym))[0];
const program = slotProgram(gym, slot, []);
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

async function render(adapted: AdaptedWorkout, current: WorkoutRecord | null, adjusted = false) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Plan } = await server.ssrLoadModule('/src/screens/PlanScreen.tsx');
    const { DaySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    // What App hands View session: the running session, else today's adapted day.
    const exercises = current?.exercises ?? liveExercises(liveAdapted(adapted, gym, []), gym, []);
    const today = todayGlance(program, adapted, current);
    const sheet = plain(renderToStaticMarkup(createElement(DaySheet, { name: today.name, minutes: today.minutes, exercises, unit: 'kg', onClose: noop })));
    const plan = plain(renderToStaticMarkup(createElement(Plan, { profile: gym, upcoming: [], focus: slot.focus, program, today, adjusted, history: [], unit: 'kg',
      now: new Date('2026-11-07T10:00:00Z'), onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop })));
    return { sheet, plan };
  } finally {
    await server.close();
  }
}

test('a today-only 30 min day: Plan header and Up next match View session', async () => {
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, []);
  const { sheet, plan } = await render(adapted, null, true);
  const [, minutes, exercises, sets] = sheet.match(/(\d+) min estimated · (\d+) exercises · (\d+) sets/) ?? [];
  assert.equal(`${minutes}/${exercises}/${sets}`, '30/6/12', 'View session shows the trimmed day');
  assert.match(plan, new RegExp(`${exercises} exercises · ${sets} sets · ${minutes} minutes · Full gym`), 'header');
  assert.match(plan, new RegExp(`UP NEXT Upper A Chest .*? ${minutes} min · ${exercises} exercises · ${sets} sets · Adjusted for today`), 'Up next');
});

test('a running session: Plan header and Up next match the session, not the day as it would build now', async () => {
  const started = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, []);
  const current = createSession({ id: 's1', name: started.name, dayIndex: 0, exercises: liveExercises(started, gym, []), now: '2026-11-07T09:00:00Z', durationMin: started.minutes });
  // The override has lapsed since the start; today's adapted day is the full 60 minutes again.
  const adapted = adaptWorkout(program, defaultConstraints(gym), []);
  const { sheet, plan } = await render(adapted, current);
  assert.match(sheet, /30 min estimated · 6 exercises · 12 sets/);
  assert.match(plan, /6 exercises · 12 sets · 30 minutes · Full gym/);
  assert.match(plan, /UP NEXT Upper A Chest .*? 30 min · 6 exercises · 12 sets/);
  assert.doesNotMatch(plan, /Adjusted for today/, 'a running session is not labelled as an adjusted plan');
});

test('no override and no session: Plan numbers are the saved day, as before', async () => {
  const adapted = adaptWorkout(program, defaultConstraints(gym), []);
  const { sheet, plan } = await render(adapted, null);
  assert.match(sheet, /60 min estimated · 7 exercises · 23 sets/);
  assert.match(plan, /7 exercises · 23 sets · 60 minutes · Full gym/);
  assert.match(plan, /UP NEXT Upper A Chest .*? 60 min · 7 exercises · 23 sets/);
  assert.doesNotMatch(plan, /Adjusted for today/);
});
