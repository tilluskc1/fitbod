import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, restorePendingWorkout, confirmedLoads, EQUIPMENT_OPTIONS, lengthOptions, loadOptions, promisedMinutes, promisedProgramMinutes, setupConsequence, setupOptions } from '../src/lib/adapt.ts';
import { switchOptions } from '../src/lib/switchDay.ts';
import type { EquipmentChoice } from '../src/lib/adapt.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { FULL_BODY_A, NEEDS_LOAD_REASON } from '../src/data/flagship.ts';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import { planSlots, slotProgram, todayProgram } from '../src/lib/sequence.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

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
  // Today-only gear: no chip to add gear to the saved setup, which already has it.
  assert.deepEqual(program.feasibility?.alternatives.filter((alt) => alt.kind === 'capability'), []);
  assert.ok(!adapted.exercises.some((exercise) => exerciseById(exercise.exerciseId)?.muscles[0] === 'Calves'));
});

test('#188: the saved setup keeps today\'s program exactly', () => {
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 60, equipment: 'home' }), slotProgram(gym, legs, []));
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 30, equipment: 'home' }), slotProgram(gym, legs, []), 'shorter trims later');
  assert.deepEqual(todayProgram(gym, legs, [], { minutes: 90, equipment: 'home' }), slotProgram({ ...gym, sessionMinutes: 90 }, legs, []), 'longer rebuilds (#17)');
  assert.deepEqual(todayProgram(gym, legs, []), slotProgram(gym, legs, []));
});

/** One completed session of one exercise: three sets planned at `planned`, done at `lifted`. */
const workout = (id: string, now: string, planned: number, lifted = planned, exerciseId = 'goblet-squat', name = 'Goblet Squat', reps = 8) => {
  let session = createSession({
    id, name: 'Legs', dayIndex: legs.index, now,
    exercises: [{
      exerciseId, name,
      planned: [0, 1, 2].map(() => ({ weight: planned, reps })),
      performed: [0, 1, 2].map(() => ({ weight: lifted, reps, done: false, completedAt: null })),
    }],
  });
  for (const index of [0, 1, 2]) session = updatePerformedSet(session, 0, index, { done: true }, now);
  return completeSession(session, { early: false, now });
};
const goblet = exerciseById('goblet-squat')!;

test('#188: a dumbbell load above the travel rack caps to its top and says so', () => {
  const top = Math.max(...EQUIPMENT_OPTIONS.hotel.loads);
  const history = [workout('w-1', '2026-11-01T10:00:00.000Z', 40)];
  const { adapted } = day('hotel', 60, history);
  const squat = adapted.exercises.find((exercise) => exercise.exerciseId === 'goblet-squat');
  assert.ok(squat, adapted.exercises.map((exercise) => exercise.exerciseId).join());
  assert.equal(squat.weight, top);
  assert.match(adapted.note, new RegExp(`Goblet Squat ${top} kg`));
  assert.equal(liveAdapted(adapted, gym, history).exercises.find((exercise) => exercise.exerciseId === 'goblet-squat')?.weight, top);
  assert.ok(liveExercises(adapted, gym, history).find((exercise) => exercise.exerciseId === 'goblet-squat')?.planned.every((set) => set.weight === top));
});

/** Run today's travel day as prescribed: every planned set done as planned, then finished. */
const travelSession = (id: string, now: string, history: WorkoutRecord[]) => {
  const { adapted } = day('hotel', 60, history);
  let session = createSession({ id, name: 'Legs', dayIndex: legs.index, now, exercises: liveExercises(adapted, gym, history) });
  session.exercises.forEach((exercise, i) => exercise.performed.forEach((_, j) => {
    session = updatePerformedSet(session, i, j, { done: true }, now);
  }));
  return completeSession(session, { early: false, now });
};
const gobletSets = (record: WorkoutRecord) => record.exercises.filter((exercise) => exercise.exerciseId === 'goblet-squat');
const rx = (history: WorkoutRecord[], setup?: EquipmentChoice) => {
  const prescription = prescribeExercise(goblet, gym, history, true, true, setup);
  return { weight: prescription.weight, reps: prescription.reps, basis: prescription.basis };
};

test('#188: a go-heavier target above the travel rack plans its top at one more rep, never a 0 kg pick', () => {
  const home = workout('w-1', '2026-11-01T10:00:00.000Z', 40, 40, 'goblet-squat', 'Goblet Squat', 30);
  const before = rx([home]);
  assert.equal(before.basis, 'go-heavier');
  const { adapted } = day('hotel', 60, [home]);
  const planned = liveExercises(adapted, gym, [home]).find((exercise) => exercise.exerciseId === 'goblet-squat')!;
  assert.deepEqual(planned.planned.map((set) => set.weight), planned.planned.map(() => 25));
  assert.ok(planned.planned.every((set) => set.reps === 31), JSON.stringify(planned.planned));
  assert.equal(planned.setup, 'hotel', 'the session records the setup its sets ran on');
  const travel = travelSession('t-1', '2026-11-02T10:00:00.000Z', [home]);
  assert.deepEqual(rx([home, travel]), before, 'a travel session never changes the home prescription');
});

test('#188: a mid-session switch records each segment\'s setup and never lowers home loads', () => {
  const home = workout('w-1', '2026-11-01T10:00:00.000Z', 40);
  let session = createSession({ id: 'w-2', name: 'Legs', dayIndex: legs.index, now: '2026-11-03T10:00:00.000Z',
    exercises: [{ exerciseId: 'goblet-squat', name: 'Goblet Squat',
      planned: [0, 1, 2, 3].map(() => ({ weight: 40, reps: 8 })),
      performed: [0, 1, 2, 3].map(() => ({ weight: 40, reps: 8, done: false, completedAt: null })) }] });
  for (const index of [0, 1]) session = updatePerformedSet(session, 0, index, { done: true }, '2026-11-03T10:05:00.000Z');
  const switched = restorePendingWorkout(session, day('hotel', 60, [home]).adapted, gym, [home]);
  const segments = gobletSets(switched);
  assert.deepEqual(segments.map((segment) => segment.setup), [undefined, 'hotel']);
  assert.deepEqual(segments[0].performed.map((set) => [set.weight, set.done]), [[40, true], [40, true]]);
  assert.ok(segments[1].planned.every((set) => set.weight <= 25));
  let finished = switched;
  finished.exercises.forEach((exercise, i) => exercise.performed.forEach((set, j) => {
    if (!set.done) finished = updatePerformedSet(finished, i, j, { done: true }, '2026-11-03T10:30:00.000Z');
  }));
  const history = [home, completeSession(finished, { early: false, now: '2026-11-03T10:30:00.000Z' })];
  assert.equal(rx(history).weight, 40, 'home reads only the home sets: 2 of 4 at 40 repeat 40');
  // And back again: travel sets done first never pull a home day down either.
  const back = restorePendingWorkout(createSession({ id: 'w-3', name: 'Legs', dayIndex: legs.index, now: '2026-11-04T10:00:00.000Z',
    exercises: liveExercises(day('hotel', 60, [home]).adapted, gym, [home]) }), adaptWorkout(slotProgram(gym, legs, [home]), { minutes: 60, equipment: 'home' }, []), gym, [home]);
  assert.ok(gobletSets(back).every((segment) => segment.setup === undefined), 'nothing done yet: the whole exercise moves to home');
});

test('#188: travel lifts progress from travel history while home holds', () => {
  const home = workout('w-1', '2026-11-01T10:00:00.000Z', 18, 18, 'goblet-squat', 'Goblet Squat', 30);
  const homeNext = rx([home]);
  let history = [home];
  const seen: { weight: number; reps: number }[] = [];
  for (let k = 0; k < 5; k += 1) {
    const next = rx(history, 'hotel');
    seen.push({ weight: next.weight, reps: next.reps });
    history = [...history, travelSession(`t-${k}`, `2026-11-1${k}T10:00:00.000Z`, history)];
  }
  for (let k = 1; k < seen.length; k += 1) {
    const up = seen[k].weight > seen[k - 1].weight || (seen[k].weight === seen[k - 1].weight && seen[k].reps > seen[k - 1].reps);
    assert.ok(up, JSON.stringify(seen));
  }
  assert.ok(seen.every((step) => EQUIPMENT_OPTIONS.hotel.loads.includes(step.weight)), JSON.stringify(seen));
  assert.deepEqual(rx(history), homeNext, 'five travel sessions leave home where it was');
});

test('#188: records without a setup are the saved setup\'s, and a travel-only exercise starts fresh at home', () => {
  const legacy = workout('w-1', '2026-11-01T10:00:00.000Z', 30);
  assert.equal(gobletSets(legacy)[0].setup, undefined);
  assert.equal(rx([legacy]).weight, rx([legacy], 'home').weight);
  const travelOnly = travelSession('t-1', '2026-11-02T10:00:00.000Z', []);
  assert.equal(rx([travelOnly]).basis, 'first-time');
});

test('#188: the stored setup validates and round-trips through export and restore', () => {
  const record = travelSession('t-1', '2026-11-02T10:00:00.000Z', [workout('w-1', '2026-11-01T10:00:00.000Z', 30)]);
  const state = { ...EMPTY_STATE, profile: gym, plan: buildPlan(gym), history: [workout('w-1', '2026-11-01T10:00:00.000Z', 30), record] };
  const parsed = parseState(serializeExport(state, '2026-11-07T10:00:00.000Z'));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.deepEqual(parsed.state.history.map((item) => item.exercises.map((exercise) => exercise.setup ?? null)),
    state.history.map((item) => item.exercises.map((exercise) => exercise.setup ?? null)));
  assert.ok(parsed.state.history[1].exercises.every((exercise) => exercise.setup === 'hotel'));
  assert.ok(!('setup' in parsed.state.history[0].exercises[0]) || parsed.state.history[0].exercises[0].setup === undefined);
  const bad = structuredClone(state);
  (bad.history[1].exercises[0] as { setup?: string }).setup = 'gym';
  assert.equal(validateState(bad).ok, false);
});

test('#188: a lighter load the user chose, or a mixed-load hold, still drives the next load', () => {
  const home = workout('w-1', '2026-11-01T10:00:00.000Z', 40);
  const lighter = workout('w-2', '2026-11-03T10:00:00.000Z', 40, 35);
  assert.equal(prescribeExercise(goblet, gym, [home, lighter], true).last?.workoutId, 'w-2', 'typed lighter at their own setup');
  assert.ok(prescribeExercise(goblet, gym, [home, lighter], true).weight < 40);
  // Mixed loads hold at the lowest; that session is planned below the last top load but not capped.
  let mixed = createSession({
    id: 'w-4', name: 'Legs', dayIndex: legs.index, now: '2026-11-05T10:00:00.000Z',
    exercises: [{ exerciseId: 'goblet-squat', name: 'Goblet Squat',
      planned: [0, 1, 2].map(() => ({ weight: 40, reps: 8 })),
      performed: [40, 40, 35].map((weight) => ({ weight, reps: 8, done: false, completedAt: null })) }],
  });
  for (const index of [0, 1, 2]) mixed = updatePerformedSet(mixed, 0, index, { done: true }, '2026-11-05T10:00:00.000Z');
  const held = [home, completeSession(mixed, { early: false, now: '2026-11-05T10:00:00.000Z' })];
  assert.equal(prescribeExercise(goblet, gym, held, true).weight, 35);
  const after = [...held, workout('w-5', '2026-11-07T10:00:00.000Z', 35)];
  assert.equal(prescribeExercise(goblet, gym, after, true).last?.workoutId, 'w-5');
});

test('#188: a load under the lightest travel dumbbell keeps the exercise and asks for the pick', async () => {
  const history = [workout('w-1', '2026-11-01T10:00:00.000Z', 8)];
  const { adapted } = day('hotel', 60, history);
  const squat = adapted.exercises.find((exercise) => exercise.exerciseId === 'goblet-squat');
  assert.ok(squat, adapted.exercises.map((exercise) => exercise.exerciseId).join());
  assert.equal(squat.weight, 0, 'never raised to the rack');
  assert.match(adapted.note, /Goblet Squat/);
  assert.match(adapted.note, /pick/);
  const live = liveExercises(adapted, gym, history).find((exercise) => exercise.exerciseId === 'goblet-squat')!;
  assert.ok(live.planned.every((set) => set.weight === 0));
  // The logger blocks the ✓ until a load is picked and offers the travel rack to pick from.
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const session = createSession({ id: 's-travel', name: 'Legs', dayIndex: legs.index, now: '2026-11-07T10:00:00.000Z', exercises: [live] });
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(Train, { session, history, now: Date.parse('2026-11-07T10:01:00.000Z'),
      loadOptions: loadOptions('hotel'), calibrationLoads: confirmedLoads('hotel'), unit: 'kg', onMinimize: noop, onFinish: noop,
      onUpdateSet: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onReturn: noop }));
    assert.match(html, new RegExp(NEEDS_LOAD_REASON));
    assert.match(html, /<button[^>]*aria-label="Log set 1"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Log set 1"/);
    for (const kg of EQUIPMENT_OPTIONS.hotel.loads) assert.match(html, new RegExp(`>${kg}<`));
  } finally {
    await server.close();
  }
});

test('#188: the note pairs each capped exercise with its own load', () => {
  const program = { ...FULL_BODY_A, exercises: FULL_BODY_A.exercises.map((exercise) =>
    exercise.exerciseId === 'dumbbell-floor-press' ? { ...exercise, weight: 30 }
    : exercise.exerciseId === 'goblet-squat' ? { ...exercise, weight: 20 } : exercise) };
  const { note } = adaptWorkout(program, { minutes: 35, equipment: 'hotel' }, []);
  assert.match(note, /Dumbbell floor press 25 kg and Goblet squat 18 kg/);
});

test('#188: the gym sheet previews each setup as the day it rebuilds', () => {
  const build = (choice: EquipmentChoice) => todayProgram(gym, legs, [], { minutes: 60, equipment: choice });
  const options = setupOptions(build('hotel'), { minutes: 60, equipment: 'hotel' }, [], build);
  assert.equal(options[0].kind, 'program');
  assert.equal(options[0].totalSets, adaptWorkout(build('home'), { minutes: 60, equipment: 'home' }, []).totalSets);
  for (const option of options.slice(1)) {
    assert.equal(option.kind, 'rebuilt', option.choice);
    assert.equal(option.totalSets, adaptWorkout(build(option.choice), { minutes: 60, equipment: option.choice }, []).totalSets);
    assert.match(setupConsequence(option, 'Legs'), option.choice === 'bands' ? /^\d+ sets · bodyweight moves$/ : /^\d+ sets · rebuilt for this gear$/);
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
  const bands = day('bands').adapted;
  assert.match(bands.note, /^No band exercises yet: Legs uses bodyweight moves today\./);
  assert.doesNotMatch(bands.note, /rebuilt for resistance bands/);
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
    const limited = day('bodyweight').adapted;
    const review = renderToStaticMarkup(createElement(AdaptScreen, {
      originalSets: limited.originalSets, adapted: limited, constraints: { minutes: 60, equipment: 'bodyweight' }, profile: gym,
      notices: [], onStart: () => {}, onKeep: () => {}, onEdit: () => {},
    }));
    assert.match(review, /Limited session/);
    assert.match(review, /calves/);
  } finally {
    await server.close();
  }
});
