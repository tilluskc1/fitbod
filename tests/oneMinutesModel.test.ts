import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram, slotProgramAt } from '../src/lib/sequence.ts';
import { estimatedSeconds } from '../src/lib/generator.ts';
import { sessionRests } from '../src/lib/sessionTime.ts';
import { leadCompoundId } from '../src/lib/progression.ts';
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
  // #197: a 2-day strength Full Body day at 20 min used to run 21 at the generator's floor.
  assert.deepEqual(over, []);
});

test('#197: no day promises more than its length, at any level, and a short day keeps its movements', () => {
  const over: string[] = [];
  for (const [kit, gear] of Object.entries(KITS)) {
    for (const goal of ['Build Muscle', 'Get Stronger']) {
      for (const experience of ['Beginner', 'Intermediate', 'Advanced']) {
        for (const days of [2, 3, 4, 5, 6]) {
          for (const saved of [20, 30, 45, 60]) {
            const profile = { ...profileFor(gear, days, saved, goal), experience } as Profile;
            for (const slot of planSlots(buildPlan(profile))) {
              for (const minutes of new Set([saved, 15, 20])) {
                if (minutes > saved) continue;
                const today = todayDay(profile, slot, minutes);
                if (today.minutes > minutes) over.push(`${kit} ${goal} ${experience} ${days}d saved ${saved} today ${minutes} ${slot.name}: ${today.minutes}`);
              }
            }
          }
        }
      }
    }
  }
  assert.deepEqual(over, []);
  // The floor gives up a set, not a required movement: the day stays Ready with all four.
  for (const gear of [KITS.gym, KITS.home]) {
    const profile = profileFor(gear, 2, 20, 'Get Stronger');
    const program = slotProgram(profile, planSlots(buildPlan(profile))[0], []);
    assert.equal(program.name, 'Full Body A');
    assert.equal(program.feasibility?.status, 'ok');
    assert.equal(program.exercises.length, 4);
  }
});

test('#203: the review names the honest figure, not the asked length', async () => {
  const profile = profileFor(KITS.gym, 4, 60);
  const program = slotProgram(profile, planSlots(buildPlan(profile))[1], []);
  const constraints = { ...defaultConstraints(profile), minutes: 20 };
  const adapted = adaptWorkout(program, constraints, [], profile.goal);
  const before = todayGlance(adaptWorkout(program, defaultConstraints(profile), [], profile.goal), null, false, profile.goal);
  const after = todayGlance(adapted, null, false, profile.goal);
  assert.ok(after.minutes !== 20 && before.minutes !== 60, `pick a case where the honest figure differs: ${before.minutes} → ${after.minutes}`);
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
    assert.doesNotMatch(text, /Start 20-min workout/);
    // The title names the length asked for as the setting it is, not as the session's duration.
    assert.match(text, /Lower A, set to 20 min/);
    assert.doesNotMatch(text, /20-minute version/);
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

test('#203: a trimmed day fits its length, cannot take one more set back, and keeps its lead', () => {
  const seconds = (work: { exerciseId: string; sets: number }[], goal: Profile['goal'], minutes: number) => {
    const live = work.filter((exercise) => exercise.sets > 0);
    return estimatedSeconds(live.map((exercise) => exercise.sets), sessionRests(live.map((exercise) => exercise.exerciseId), goal, minutes), minutes);
  };
  const problems: string[] = [];
  for (const [kit, gear] of Object.entries(KITS)) {
    for (const goal of ['Build Muscle', 'Get Stronger']) {
      for (const days of [2, 3, 4, 5, 6]) {
        for (const saved of [20, 30, 45, 60]) {
          const profile = profileFor(gear, days, saved, goal);
          for (const slot of planSlots(buildPlan(profile))) {
            for (const minutes of [15, 20, 30, 45]) {
              if (minutes >= saved) continue;
              const program = slotProgramAt(profile, slot, [], minutes);
              const adapted = adaptWorkout(program, { ...defaultConstraints(profile), minutes }, [], profile.goal);
              const where = `${kit} ${goal} ${days}d saved ${saved} today ${minutes} ${slot.name}`;
              if (adapted.exercises.length === 0) continue;
              const work = adapted.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, sets: exercise.sets }));
              if (seconds(work, profile.goal, minutes) > minutes * 60) problems.push(`over: ${where}`);
              const lead = leadCompoundId(program.exercises.map((exercise) => exercise.exerciseId));
              const leadSets = adapted.exercises.find((exercise) => exercise.exerciseId === lead)?.sets;
              if (lead && leadSets === undefined) problems.push(`lead dropped: ${where}`);
              adapted.exercises.forEach((exercise, index) => {
                if (exercise.sets > exercise.originalSets) problems.push(`above its program: ${where} ${exercise.exerciseId}`);
                const isLead = exercise.exerciseId === lead;
                // #133: the lead keeps the most sets, so a later movement stops at the lead's count.
                if (!isLead && leadSets !== undefined && exercise.sets > leadSets) problems.push(`above the lead: ${where} ${exercise.exerciseId}`);
                const cap = isLead || leadSets === undefined ? exercise.originalSets : Math.min(exercise.originalSets, leadSets);
                if (exercise.sets >= cap) return;
                const more = work.map((item, k) => (k === index ? { ...item, sets: item.sets + 1 } : item));
                if (seconds(more, profile.goal, minutes) <= minutes * 60) problems.push(`room for a set: ${where} ${exercise.exerciseId}`);
              });
            }
          }
        }
      }
    }
  }
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} problems`);
});

test('#203: the refill keeps the lead on top and the day even (#133)', () => {
  const sets = (goal: string, saved: number, minutes: number) => {
    const profile = profileFor(KITS.gym, 4, saved, goal);
    const program = slotProgram(profile, planSlots(buildPlan(profile))[1], []);
    const adapted = adaptWorkout(program, { ...defaultConstraints(profile), minutes }, [], profile.goal);
    assert.equal(adapted.name, 'Lower A');
    return Object.fromEntries(adapted.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]));
  };
  // A lead-first refill stopped at the lead's first miss and let cheaper movements pass it.
  const strength15 = sets('Get Stronger', 60, 15);
  assert.ok(strength15['back-squat'] >= strength15['deadlift'], JSON.stringify(strength15));
  const muscle30 = sets('Build Muscle', 60, 30);
  assert.ok(muscle30['back-squat'] >= muscle30['leg-curl'], JSON.stringify(muscle30));
  // ...and filled the lead to 5 sets with every other movement left at 2.
  const muscle45 = Object.values(sets('Build Muscle', 60, 45));
  assert.ok(Math.max(...muscle45) - Math.min(...muscle45) <= 2, JSON.stringify(muscle45));
});
