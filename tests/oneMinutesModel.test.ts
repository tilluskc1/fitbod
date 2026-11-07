import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, setupOptions, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { switchOptions, upcomingDays } from '../src/lib/switchDay.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

// #203: Today priced a day by the timer's model while Plan's later days, the sheets and the review
// still promised the asked length. One day must read one figure wherever it is shown.
const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack', 'Pull-up bar'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  bodyweight: { equipment: [], support: [] },
};

const profileFor = (gear: { equipment: string[]; support: string[] }, days: number, minutes: number, goal = 'Build Muscle') => ({
  name: 'K', goal, experience: 'Intermediate', daysPerWeek: days, ...gear, exclusions: [], loads: {}, unit: 'kg', sessionMinutes: minutes,
}) as unknown as Profile;

test('#203: each day reads the same minutes on Plan, the switch and gym sheets and as today', () => {
  const over: string[] = [];
  for (const [kit, gear] of Object.entries(KITS)) {
    for (const goal of ['Build Muscle', 'Get Stronger']) {
      for (const days of [2, 3, 4, 5, 6]) {
        for (const minutes of [20, 30, 45, 60]) {
          const profile = profileFor(gear, days, minutes, goal);
          const plan = buildPlan(profile);
          const slots = planSlots(plan);
          const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 } } as unknown as AppState;
          const constraints = defaultConstraints(profile);
          const switches = switchOptions(profile, state, [], constraints);
          const later = upcomingDays(profile, plan, slots[0], []);
          slots.forEach((slot, k) => {
            const program = slotProgram(profile, slot, []);
            const today = todayGlance(adaptWorkout(program, constraints, []), null, false, profile.goal);
            const where = `${kit} ${goal} ${days}d ${minutes}min ${slot.name}`;
            assert.equal(switches[k].minutes, today.minutes, `switch sheet, ${where}`);
            assert.equal(switches[k].approx, today.approx, `switch sheet ≈, ${where}`);
            if (k > 0) {
              assert.equal(later[k - 1].minutes, today.minutes, `Plan later day, ${where}`);
              assert.equal(later[k - 1].approx, today.approx, `Plan later day ≈, ${where}`);
              assert.equal(later[k - 1].sets, today.sets, `Plan later day sets, ${where}`);
            }
            const gymSheet = setupOptions(program, constraints, [], profile.goal).find((option) => option.choice === constraints.equipment);
            assert.equal(gymSheet?.minutes, today.minutes, `gym sheet, ${where}`);
            if (today.minutes > minutes) over.push(`${where}: ${today.minutes}`);
          });
        }
      }
    }
  }
  // Known overrun, exposed rather than hidden by the single model: a 2-day strength Full Body day
  // at 20 min hits the generator's floor (4 movements × 2 sets) and runs 21. Today already read 21;
  // Plan used to promise 20. Fixing the floor is its own issue, not this one.
  assert.deepEqual(over, [
    'gym Get Stronger 2d 20min Full Body A: 21',
    'home Get Stronger 2d 20min Full Body A: 21',
  ]);
});

test('#203: the review names the honest figure, not the asked length', async () => {
  const profile = profileFor(KITS.gym, 4, 60);
  const program = slotProgram(profile, planSlots(buildPlan(profile))[1], []);
  const constraints = { ...defaultConstraints(profile), minutes: 30 };
  const adapted = adaptWorkout(program, constraints, []);
  const before = todayGlance(adaptWorkout(program, defaultConstraints(profile), []), null, false, profile.goal);
  const after = todayGlance(adapted, null, false, profile.goal);
  assert.ok(after.minutes !== 30 && before.minutes !== 60, `pick a case where the honest figure differs: ${before.minutes} → ${after.minutes}`);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const html = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: adapted.originalSets, adapted, constraints, notices: [], before, after,
      onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, new RegExp(`Start ${after.minutes}-min workout`));
    assert.match(text, new RegExp(`${before.minutes} min → ${after.minutes} min`));
    assert.doesNotMatch(text, /Start 30-min workout/);
  } finally {
    await server.close();
  }
});
