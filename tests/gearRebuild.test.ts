import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, EQUIPMENT_OPTIONS, lengthOptions, promisedMinutes, promisedProgramMinutes, setupConsequence, setupOptions } from '../src/lib/adapt.ts';
import { switchOptions } from '../src/lib/switchDay.ts';
import type { EquipmentChoice } from '../src/lib/adapt.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { planSlots, slotProgram, todayProgram } from '../src/lib/sequence.ts';
import type { Profile } from '../src/types.ts';

const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 5,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60,
};
const legs = planSlots(buildPlan(gym)).find((slot) => slot.name === 'Legs')!;

const day = (equipment: EquipmentChoice, minutes = 60, history: Parameters<typeof todayProgram>[2] = []) => {
  const program = todayProgram(gym, legs, history, { minutes, equipment });
  return { program, adapted: adaptWorkout(program, { minutes, equipment }, []) };
};
const patterns = (ids: string[]) => ids.map((id) => exerciseById(id)?.pattern);

test('#188: a travel gym rebuilds Legs from dumbbells and a bench', () => {
  const { adapted } = day('hotel');
  const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
  assert.ok(ids.length >= 5, ids.join());
  assert.ok(patterns(ids).some((pattern) => pattern === 'squat' || pattern === 'lunge'), ids.join());
  assert.ok(patterns(ids).includes('calf_raise'), ids.join());
  assert.deepEqual(adapted.skipped, [], 'the rebuilt day is built for this kit: nothing is dropped for gear');
});

test('#188: bodyweight rebuilds Legs from bodyweight work', () => {
  for (const choice of ['bodyweight', 'bands'] as const) {
    const { adapted } = day(choice);
    const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
    assert.ok(ids.length >= 4, `${choice}: ${ids.join()}`);
    assert.ok(ids.includes('bodyweight-squat') || ids.includes('bodyweight-lunge'), `${choice}: ${ids.join()}`);
  }
});

test('#188: promised minutes never exceed the length shown', () => {
  for (const choice of ['hotel', 'bodyweight', 'bands'] as const) {
    for (const minutes of [20, 30, 45, 60, 90]) {
      const { program, adapted } = day(choice, minutes);
      assert.ok(adapted.totalSets > 0, `${choice} ${minutes}`);
      assert.ok(adapted.minutes <= minutes, `${choice} ${minutes}: label ${adapted.minutes}`);
      assert.ok(promisedMinutes(program, adapted) <= minutes, `${choice} ${minutes}: promised ${promisedMinutes(program, adapted)}`);
      assert.ok(promisedProgramMinutes(program) <= minutes, `${choice} ${minutes}: program ${promisedProgramMinutes(program)}`);
    }
  }
});

test('#188: a focus muscle bodyweight cannot train reads Limited, not padded', () => {
  const { program, adapted } = day('bodyweight');
  assert.equal(program.feasibility?.status, 'limited');
  assert.match(program.feasibility?.reason ?? '', /calves/);
  assert.ok(!adapted.exercises.some((exercise) => exerciseById(exercise.exerciseId)?.muscles[0] === 'Calves'));
});

test('#188: the saved setup keeps today\'s program exactly', () => {
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 60, equipment: 'home' }), slotProgram(gym, legs, []));
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 30, equipment: 'home' }), slotProgram(gym, legs, []), 'shorter trims later');
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 90, equipment: 'home' }), slotProgram({ ...gym, sessionMinutes: 90 }, legs, []), 'longer rebuilds (#17)');
  assert.deepEqual(todayProgram(gym, legs, []), slotProgram(gym, legs, []));
});

test('#188: a dumbbell load above the travel rack caps to its top and says so', () => {
  const top = Math.max(...EQUIPMENT_OPTIONS.hotel.loads);
  const NOW = '2026-11-01T10:00:00.000Z';
  const heavy = 40;
  let session = createSession({
    id: 'w-1', name: 'Legs', dayIndex: legs.index, now: NOW,
    exercises: [{
      exerciseId: 'goblet-squat', name: 'Goblet Squat',
      planned: [{ weight: heavy, reps: 8 }, { weight: heavy, reps: 8 }, { weight: heavy, reps: 8 }],
      performed: [0, 1, 2].map(() => ({ weight: heavy, reps: 8, done: false, completedAt: null })),
    }],
  });
  for (const index of [0, 1, 2]) session = updatePerformedSet(session, 0, index, { done: true }, NOW);
  const history = [completeSession(session, { early: false, now: NOW })];
  const { adapted } = day('hotel', 60, history);
  const squat = adapted.exercises.find((exercise) => exercise.exerciseId === 'goblet-squat');
  assert.ok(squat, adapted.exercises.map((exercise) => exercise.exerciseId).join());
  assert.equal(squat.weight, top);
  assert.match(adapted.note, /Goblet Squat/);
  assert.match(adapted.note, new RegExp(`${top} kg`));
  assert.ok(liveAdapted(adapted, gym, history).exercises.every((exercise) => exercise.weight <= top));
  assert.ok(liveExercises(adapted, gym, history).every((exercise) => exercise.planned.every((set) => set.weight <= top)));
});

test('#188: the gym sheet previews each setup as the day it rebuilds', () => {
  const build = (choice: EquipmentChoice) => todayProgram(gym, legs, [], { minutes: 60, equipment: choice });
  const options = setupOptions(build('hotel'), { minutes: 60, equipment: 'hotel' }, [], build);
  assert.equal(options[0].kind, 'program');
  assert.equal(options[0].totalSets, adaptWorkout(build('home'), { minutes: 60, equipment: 'home' }, []).totalSets);
  for (const option of options.slice(1)) {
    assert.equal(option.kind, 'rebuilt', option.choice);
    assert.equal(option.totalSets, adaptWorkout(build(option.choice), { minutes: 60, equipment: option.choice }, []).totalSets);
    assert.match(setupConsequence(option, 'Legs'), /^\d+ sets · rebuilt for this gear$/);
  }
});

test('#188: the duration sheet on a rebuilt setup previews what each length builds', () => {
  const at = (minutes: number) => todayProgram(gym, legs, [], { minutes, equipment: 'hotel' });
  const options = lengthOptions(at(60), { minutes: 60, equipment: 'hotel' }, [], 60, at);
  for (const option of options) {
    assert.equal(option.totalSets, adaptWorkout(at(option.minutes), { minutes: option.minutes, equipment: 'hotel' }, []).totalSets, `${option.minutes}`);
  }
});

test('#188: the switch sheet rates each day from the day today\'s setup rebuilds', () => {
  const state = { plan: buildPlan(gym), planRevision: 0, programCursor: { revision: 0, seq: legs.index } };
  const options = switchOptions(gym, state, [], { minutes: 60, equipment: 'bodyweight' });
  const today = options.find((option) => option.slotId === legs.id)!;
  assert.equal(today.status, 'limited');
  assert.equal(today.totalSets, day('bodyweight').adapted.totalSets);
  const home = switchOptions(gym, state, [], { minutes: 60, equipment: 'home' }).find((option) => option.slotId === legs.id)!;
  assert.equal(home.totalSets, adaptWorkout(slotProgram(gym, legs, []), { minutes: 60, equipment: 'home' }, []).totalSets);
});

test('#188: a rebuilt day says it was rebuilt, never "same as your program"', async () => {
  for (const choice of ['hotel', 'bodyweight'] as const) {
    const { adapted } = day(choice);
    assert.equal(adapted.setup, choice);
    assert.doesNotMatch(adapted.note, /Same exercises/);
    assert.match(adapted.note, new RegExp(`Legs rebuilt for ${EQUIPMENT_OPTIONS[choice].chip.toLowerCase()} today\\.`));
  }
  assert.equal(adaptWorkout(slotProgram(gym, legs, []), { minutes: 60, equipment: 'home' }, []).setup, undefined);
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { default: AdaptScreen } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const { adapted } = day('hotel');
    const html = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: adapted.originalSets, adapted, constraints: { minutes: 60, equipment: 'hotel' },
      notices: [], onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    }));
    assert.doesNotMatch(html, /Same exercises/);
    assert.match(html, /Rebuilt for travel gym/);
  } finally {
    await server.close();
  }
});
