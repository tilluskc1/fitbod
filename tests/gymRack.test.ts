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
  const adapted = adaptWorkout(FULL_BODY_A, defaultConstraints(profile), [], profile.goal);
  const live = liveExercises(adapted, profile, pressedAt(lb(20), range.min)).find((entry) => entry.exerciseId === press.id);
  assert.ok(live, 'the floor press is on the day');
  assert.deepEqual([...new Set(live.planned.map((set) => set.weight))], [lb(20)]);
});

const noop = () => {};
async function renderTrain(history: WorkoutRecord[]) {
  const constraints = defaultConstraints(profile);
  const adapted = adaptWorkout(FULL_BODY_A, constraints, [], undefined);
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

test('with a listed rack, the first-load suggestion is the owned dumbbell, in the set cells, and any weight can be typed', async () => {
  const html = await renderTrain([]);
  const cell = (label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*value="([^"]*)"`))?.[1];
  for (const n of [1, 2, 3]) {
    assert.equal(cell(`Set ${n} weight, pounds each`), '10', `set ${n} starts at the owned 10 lb`);
    assert.match(html, new RegExp(`aria-label="Log set ${n}">`), 'and the ✓ is ready');
  }
  assert.match(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Suggested start 10 lb each\. Do 5 easy reps with it, then adjust set 1\./);
  assert.match(html, /<input[^>]*aria-label="Set 1 weight, pounds each"/, 'any other weight is typed in the cell');
  // #309: the one-tap rack pills and Confirm are gone; the owned dumbbell is the prefilled cell value.
  assert.doesNotMatch(html, /<button(?![^>]*lg-wcheck)[^>]*aria-pressed|suggested"|>Confirm</);
});

test('a gym user is never asked for an owned rack: onboarding hides it, Settings says leave it blank (#180)', async () => {
  const { readFileSync } = await import('node:fs');
  const onboarding = readFileSync(new URL('../src/components/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(onboarding, /place === 'home' && equipment\.includes\('Dumbbell'\) \?/, 'owned-dumbbell field only at home');
  assert.match(onboarding, /loads: place === 'home'/, 'a gym onboarding saves no rack');
  assert.match(onboarding, /setEquipment\(\[\.\.\.EQUIPMENT_OPTIONS\]\)/, 'a gym starts with every primary item');
  assert.match(readFileSync(new URL('../src/screens/Sheets.tsx', import.meta.url), 'utf8'), /Leave (this )?blank( at a gym)?[.;]/i);
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
  assert.match(css, /\.aw-field input \{[^}]*border-radius: 999px/);
});

test("the rack's top typed in the other unit is still the top of the rack, not above it", () => {
  const kgRack: Profile = { ...profile, unit: 'kg', loads: { Dumbbell: [9] } };
  assert.equal(prescribeExercise(press, kgRack, pressedAt(lb(20), range.max)).basis, 'hold');
  assert.equal(prescribeExercise(press, kgRack, pressedAt(lb(25), range.max)).basis, 'go-heavier');
});

test('a full-gym kit reads as "Gym" on Today, never "Home" (#180)', async () => {
  const { isGymKit, setupFor } = await import('../src/lib/adapt.ts');
  const gym = { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] } as Parameters<typeof isGymKit>[0];
  const home = { equipment: ['Dumbbell'] } as Parameters<typeof isGymKit>[0];
  assert.equal(isGymKit(gym), true);
  assert.equal(isGymKit(home), false);
  assert.equal(setupFor('home', gym).short, 'Gym');
  assert.equal(setupFor('home', gym).chip, 'Your gym');
  assert.equal(setupFor('home', home).short, 'Home');
  assert.equal(setupFor('hotel', gym).short, 'Travel', 'only the saved setup is renamed');
  assert.equal(setupFor('hotel', gym).label, 'Travel gym', 'the today-only travel option is never called a plain gym');
});

test('Adjust today never shows a stale rack on a gym profile; a home profile keeps "Yours:" (#192)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { AdjustSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const render = (equipment: Profile['equipment']) => renderToStaticMarkup(createElement(AdjustSheet, {
      constraints: { minutes: 35, equipment: 'home', loads: [lb(10)] }, originalMinutes: 35, unit: 'lb',
      profile: { ...profile, equipment }, onClose: noop, onPreview: noop })).replace(/<[^>]+>/g, ' ');
    const gym = render(['Barbell', 'Dumbbell', 'Machine', 'Cable']);
    assert.doesNotMatch(gym, /Yours:/, 'a gym has every dumbbell, not the stored 10 lb');
    assert.match(gym, /Your gym: enter weights as you lift/);
    assert.match(render(['Dumbbell']), /Yours: 10 lb/);
  } finally { await server.close(); }
});
