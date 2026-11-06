import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { exerciseById } from '../src/data/exercises.ts';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, loadOptions } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { createSession } from '../src/lib/session.ts';
import { parseLoads } from '../src/lib/units.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #129: a gym user listed one dumbbell (10 lb) and was stuck at it.
const lb = (value: number) => parseLoads(String(value), 'lb')[0];
const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3, unit: 'lb',
  equipment: ['Dumbbell'], support: ['Bench'], exclusions: [], loads: { Dumbbell: [lb(10)] },
};
const press = exerciseById('dumbbell-floor-press')!;
const range = prescribeExercise(press, profile, []).range;

const pressedAt = (weight: number, reps: number): WorkoutRecord[] => [{
  id: 'w1', date: '2026-11-04T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
  completedEarly: false, endedAt: null,
  exercises: [{
    exerciseId: press.id, name: press.name,
    planned: Array.from({ length: 3 }, () => ({ weight: lb(10), reps: range.min })),
    performed: Array.from({ length: 3 }, () => ({ weight, reps, done: true, completedAt: null })),
  }],
}];

test('a load typed above the listed rack is the next target, at every rep count', () => {
  const below = prescribeExercise(press, profile, pressedAt(lb(20), range.min));
  assert.equal(below.basis, 'rep-increase');
  assert.equal(below.weight, lb(20));
  // At the top of the range there is no listed load above 20: the next one up is the lifter's to name.
  const top = prescribeExercise(press, profile, pressedAt(lb(20), range.max));
  assert.equal(top.basis, 'go-heavier');
  assert.equal(top.weight, lb(20));
});

test("Start's target keeps the typed 20, never the rack's 10", () => {
  const adapted = adaptWorkout(FULL_BODY_A, defaultConstraints(profile), []);
  const live = liveExercises(adapted, profile, pressedAt(lb(20), range.min)).find((entry) => entry.exerciseId === press.id);
  assert.ok(live, 'the floor press is on the day');
  assert.deepEqual([...new Set(live.planned.map((set) => set.weight))], [lb(20)]);
});

const noop = () => {};
async function renderTrain(history: WorkoutRecord[]) {
  const constraints = defaultConstraints(profile);
  const adapted = adaptWorkout(FULL_BODY_A, constraints, []);
  const session = createSession({ id: 's0', name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, history), now: '2026-11-05T10:00:00.000Z' });
  const rack = loadOptions(constraints.equipment, constraints.loads);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    return renderToStaticMarkup(createElement(Train, { session, history, now: Date.parse('2026-11-05T10:01:00.000Z'),
      loadOptions: rack, calibrationLoads: rack, experience: 'Beginner', unit: 'lb', onMinimize: noop, onFinish: noop,
      onUpdateSet: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onReturn: noop }));
  } finally { await server.close(); }
}

test('with a listed rack, the first-load step still takes a typed weight and confirms it', async () => {
  const html = await renderTrain([]);
  assert.match(html, /aria-label="10, suggested"/, 'the owned dumbbell is still a one-tap pick');
  assert.match(html, /<input[^>]*aria-label="Enter dumbbell load \(lb each\)"/, 'and any other weight can be typed');
  assert.match(html, /<button class="pill-primary"[^>]*>Confirm<\/button>/);
});

test('onboarding and Settings say to leave the rack blank at a gym', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['../src/components/Onboarding.tsx', '../src/screens/Sheets.tsx']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /Leave (this )?blank( at a gym)?[.;]/i, file);
  }
});

test("the set editor's rack buttons and typed field are pills, like the rest of the logger", async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  for (const selector of ['.weight-pills {', '.weight-pills button {', '.aw-field input {']) {
    const at = css.indexOf(selector.replace(' {', ''));
    assert.ok(at >= 0, selector);
    const rule = css.slice(css.lastIndexOf('}', at) + 1, css.indexOf('}', at));
    if (selector !== '.aw-field input {') assert.match(rule, /border-radius: 999px/, selector);
  }
  assert.match(css, /\.lg-first__typed input,\s*\.aw-field input \{[^}]*border-radius: 999px/);
});
