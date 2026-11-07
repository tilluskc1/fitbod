import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { readFileSync } from 'node:fs';
import { adaptWorkout, setupOptions, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints, noticeText, withCeiling } from '../src/lib/constraints.ts';
import { switchOptions, upcomingDays } from '../src/lib/switchDay.ts';
import { EMPTY_STATE, saveState } from '../src/lib/storage.ts';
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
            const today = todayGlance(adaptWorkout(program, constraints, [], profile.goal), null, false, profile.goal);
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
  // Plan used to promise 20. Fixing the generator's floor is #197's, not this issue's.
  assert.deepEqual(over, [
    'gym Get Stronger 2d 20min Full Body A: 21',
    'home Get Stronger 2d 20min Full Body A: 21',
  ]);
});

test('#203: the review names the honest figure, not the asked length', async () => {
  const profile = profileFor(KITS.gym, 4, 60);
  const program = slotProgram(profile, planSlots(buildPlan(profile))[1], []);
  const constraints = { ...defaultConstraints(profile), minutes: 30 };
  const adapted = adaptWorkout(program, constraints, [], profile.goal);
  const before = todayGlance(adaptWorkout(program, defaultConstraints(profile), [], profile.goal), null, false, profile.goal);
  const after = todayGlance(adapted, null, false, profile.goal);
  assert.ok(after.minutes !== 30 && before.minutes !== 60, `pick a case where the honest figure differs: ${before.minutes} → ${after.minutes}`);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const html = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: before.sets, adapted, constraints, notices: [], before, after,
      onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, new RegExp(`Start ${after.minutes}-min workout`));
    assert.match(text, new RegExp(`${before.minutes} min → ${after.minutes} min`));
    assert.doesNotMatch(text, /Start 30-min workout/);
    // The title names the length asked for as the setting it is, not as the session's duration.
    assert.match(text, /Lower A, set to 30 min/);
    assert.doesNotMatch(text, /30-minute version/);
  } finally {
    await server.close();
  }
});

/** The day Today offers at a length chosen for today only: longer rebuilds it, shorter trims it (as App). */
const todayDay = (profile: Profile, slot: Parameters<typeof slotProgram>[1], minutes: number) => {
  const saved = profile.sessionMinutes ?? 35;
  const program = slotProgram(minutes > saved ? { ...profile, sessionMinutes: minutes } : profile, slot, []);
  return todayGlance(adaptWorkout(program, { ...defaultConstraints(profile), minutes }, [], profile.goal), null, false, profile.goal);
};

test('#203: a length chosen for today reads one figure in the switch sheet and on Today, never over the ask', () => {
  const over: string[] = [];
  for (const [kit, gear] of Object.entries(KITS)) {
    for (const goal of ['Build Muscle', 'Get Stronger']) {
      for (const days of [2, 3, 4, 5, 6]) {
        for (const saved of [20, 30, 45, 60]) {
          const profile = profileFor(gear, days, saved, goal);
          const plan = buildPlan(profile);
          const slots = planSlots(plan);
          const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 } } as unknown as AppState;
          for (const minutes of [15, 20, 30, 45, 60, 90]) {
            if (minutes === saved) continue;
            const switches = switchOptions(profile, state, [], { ...defaultConstraints(profile), minutes });
            slots.forEach((slot, k) => {
              const today = todayDay(profile, slot, minutes);
              const where = `${kit} ${goal} ${days}d saved ${saved} today ${minutes} ${slot.name}`;
              assert.equal(switches[k].minutes, today.minutes, `switch sheet minutes, ${where}`);
              assert.equal(switches[k].totalSets, today.sets, `switch sheet sets, ${where}`);
              if (today.minutes > minutes) over.push(`${where}: ${today.minutes}`);
            });
          }
        }
      }
    }
  }
  // A trimmed day fits its length by the rest timer's own clock. Rebuilt longer days fit by the generator.
  assert.deepEqual(over, []);
});

test('#203: a 90-min ask on a 60-min day: the ceiling notice and the time cell both read the honest figure', async () => {
  const profile = profileFor(KITS.gym, 4, 60);
  const program = slotProgram(profile, planSlots(buildPlan(profile))[1], []);
  const constraints = { ...defaultConstraints(profile), minutes: 90 };
  const adapted = adaptWorkout(program, constraints, [], profile.goal);
  const before = todayGlance(adaptWorkout(program, defaultConstraints(profile), [], profile.goal), null, false, profile.goal);
  const after = todayGlance(adapted, null, false, profile.goal);
  assert.equal(after.minutes, 58);
  const notices = withCeiling([], adapted);
  assert.match(noticeText(notices[0]), /shows the 58 min it takes/);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const text = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: before.sets, adapted, constraints, notices, before, after,
      onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /shows the 58 min it takes/);
    assert.match(text, /Time Same 58 min/);
    assert.doesNotMatch(text, /60 min it takes/);
  } finally {
    await server.close();
  }
});

test('#203: rendered, the app\'s Today, Plan\'s later list, the switch sheet and the review name one figure', async () => {
  const profile = profileFor(KITS.gym, 4, 60);
  const plan = buildPlan(profile);
  const slots = planSlots(plan);
  const lowerA = slots[1];
  // App wiring: Plan's later days, the switch sheet and the review's "before" use the shared helpers.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /upcomingDays\(profile, state\.plan, slot, state\.history\)/);
  assert.match(app, /switchOptions\(profile, state, state\.history, constraints\)/);
  assert.match(app, /before=\{todayDay\}/);
  assert.match(app, /upcoming=\{upcoming\}/);

  const values = new Map<string, string>();
  const stub = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  };
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  try {
    // Today, rendered by the app itself with Lower A up next.
    const saved = saveState({ ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 1 } } as AppState, 0);
    assert.ok(saved.ok, JSON.stringify(saved));
    const { default: App } = await server.ssrLoadModule('/src/App.tsx');
    const todayText = plain(renderToStaticMarkup(createElement(App)));
    const shown = todayText.match(/Your Lower A Day Starts Here! timer (\d+) min/);
    assert.ok(shown, todayText.slice(0, 400));
    const minutes = shown[1];

    // Plan with Upper A up next lists Lower A as a later day.
    const { default: Plan } = await server.ssrLoadModule('/src/screens/PlanScreen.tsx');
    const upperA = slotProgram(profile, slots[0], []);
    const planText = plain(renderToStaticMarkup(createElement(Plan, {
      profile, upcoming: upcomingDays(profile, plan, slots[0], []), focus: slots[0].focus, program: upperA,
      today: todayGlance(adaptWorkout(upperA, defaultConstraints(profile), [], profile.goal), null, false, profile.goal),
      slotLabel: 'Slot 1 of 4', history: [], unit: 'kg', now: new Date('2026-11-07T10:00:00Z'),
      onOpenSettings() {}, onViewDay() {}, onOpenLibrary() {},
    })));
    assert.match(planText, new RegExp(`THEN Lower A [^0-9]*${minutes} min · `));

    // The switch sheet from Upper A.
    const { default: SwitchSheet } = await server.ssrLoadModule('/src/components/SwitchSheet.tsx');
    const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 } } as unknown as AppState;
    const switchText = plain(renderToStaticMarkup(createElement(SwitchSheet, {
      options: switchOptions(profile, state, [], defaultConstraints(profile)), onPick() {}, onClose() {},
    })));
    assert.match(switchText, new RegExp(`Lower A Ready · \\d+ sets · ${minutes} min · skips Upper A`));

    // The review of Lower A at 30 min starts from that same figure.
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const program = slotProgram(profile, lowerA, []);
    const before = todayGlance(adaptWorkout(program, defaultConstraints(profile), [], profile.goal), null, false, profile.goal);
    const adapted = adaptWorkout(program, { ...defaultConstraints(profile), minutes: 30 }, [], profile.goal);
    const reviewText = plain(renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: before.sets, adapted, constraints: { ...defaultConstraints(profile), minutes: 30 }, notices: [],
      before, after: todayGlance(adapted, null, false, profile.goal), onStart() {}, onKeep() {}, onEdit() {},
    })));
    assert.match(reviewText, new RegExp(`Time -\\d+ min ${minutes} min → `));
  } finally {
    await server.close();
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
