import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { rampSets, rampWorking } from '../src/lib/warmUp.ts';
import { createSession } from '../src/lib/session.ts';
import { toKg } from '../src/lib/units.ts';
import type { Unit, WorkoutRecord } from '../src/types.ts';

// #326: the ramp (W) rows read the load set 1 shows, the suggested start included, and hold the
// value set 1 showed when its typing burst began (lesson 26).

const noop = () => {};
const at = (minute: number) => `2026-11-12T10:${String(minute).padStart(2, '0')}:00.000Z`;
const warmRows = (html: string) => [...html.matchAll(/aria-label="Warm-up set (\d), ([\d.]+) [^"]*× (\d+), done"/g)]
  .map((match) => ({ weight: Number(match[2]), reps: Number(match[3]) }));

test('rampWorking: set 1\'s typed load, else the suggested start, else none', () => {
  assert.equal(rampWorking({ setOneKg: 60, suggestedKg: null }), 60);
  assert.equal(rampWorking({ setOneKg: 60, suggestedKg: 11 }), 60, 'a typed load wins over the suggestion');
  assert.equal(rampWorking({ setOneKg: 0, suggestedKg: 11 }), 11, 'the muted suggested start counts');
  assert.equal(rampWorking({ setOneKg: 0, suggestedKg: null }), 0);
  assert.equal(rampWorking({ setOneKg: 0, suggestedKg: 0 }), 0);
});

test('rampWorking: during a burst, the start-of-burst value holds through every keystroke', () => {
  const start = toKg(135, 'lb');
  // Focus selects the text, so 135 to 140 passes through 1 and 14; backspacing passes through empty.
  for (const typed of [1, 14, 140, 0, 4].map((lb) => toKg(lb, 'lb'))) {
    assert.equal(rampWorking({ setOneKg: typed, suggestedKg: null, burstStartKg: start }), start);
  }
  // A burst that began on the suggested start holds it, even after the cell is emptied.
  assert.equal(rampWorking({ setOneKg: 0, suggestedKg: null, burstStartKg: 11 }), 11);
  // A burst that began on nothing holds nothing (no rows appear mid-burst either).
  assert.equal(rampWorking({ setOneKg: toKg(140, 'lb'), suggestedKg: null, burstStartKg: 0 }), 0);
  // No burst: the live value.
  assert.equal(rampWorking({ setOneKg: toKg(140, 'lb'), suggestedKg: null, burstStartKg: null }), toKg(140, 'lb'));
});

function firstTime(exerciseId: string, name: string): WorkoutRecord {
  return createSession({ id: 's326', name: 'Push', dayIndex: 0, now: at(0), exercises: [{
    exerciseId, name,
    planned: Array.from({ length: 4 }, () => ({ weight: 0, reps: 8 })),
    performed: Array.from({ length: 4 }, () => ({ weight: 0, reps: 8, done: false, completedAt: null })),
  }] });
}

type Render = (session: WorkoutRecord, unit: Unit, extra?: Record<string, unknown>) => string;
async function withTrain(run: (render: Render) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    run((session, unit, extra = {}) => renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at(1)),
      rampLoads: [], calibrationLoads: [], unit, experience: 'Intermediate', onMinimize: noop, onFinish: noop,
      onUpdateSet: noop, onLogSet: noop, onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop, ...extra })));
  } finally { await server.close(); }
}

test('a first-time Dumbbell Bench lead ramps two W rows from its suggested start (lb and kg)', async () => {
  await withTrain((render) => {
    const session = firstTime('dumbbell-bench-press', 'Dumbbell Bench Press');
    // Advanced upper-body start: 35 lb or 16 kg each, above the #345 floor.
    const advanced = { experience: 'Advanced' };
    const lb = render(session, 'lb', advanced);
    assert.match(lb, /Suggested start 35 lb each/);
    const lbRamps = rampSets({ equipment: 'Dumbbell', working: toKg(35, 'lb'), unit: 'lb' });
    assert.deepEqual(warmRows(lb).map((row) => row.weight), [15, 25]);
    assert.deepEqual(warmRows(lb).map((row) => row.reps), lbRamps.map((ramp) => ramp.reps));
    const kg = render(session, 'kg', advanced);
    assert.match(kg, /Suggested start 16 kg each/);
    assert.deepEqual(warmRows(kg).map((row) => row.weight), rampSets({ equipment: 'Dumbbell', working: 16, unit: 'kg' }).map((r) => r.weight));
    assert.equal(warmRows(kg).length, 2);
    // On the user's own rack, the start and its ramps come from the same dumbbells.
    const rack = [10, 15, 20, 25, 30, 35].map((load) => toKg(load, 'lb'));
    const owned = render(session, 'lb', { ...advanced, rampLoads: rack, calibrationLoads: rack });
    assert.equal(warmRows(owned).length, 2);
    assert.ok(warmRows(owned).every((row) => row.weight < 35));
    // #345: the Intermediate start (25 lb or 10 kg each) is under the floor, so no W rows.
    assert.match(render(session, 'lb'), /Suggested start 25 lb each/);
    assert.equal(warmRows(render(session, 'lb')).length, 0);
    assert.match(render(session, 'kg'), /Suggested start 10 kg each/);
    assert.equal(warmRows(render(session, 'kg')).length, 0);
  });
});

test('a first-time Barbell Bench lead whose suggested start is the empty bar has no W rows, as before', async () => {
  await withTrain((render) => {
    const session = firstTime('barbell-bench-press', 'Barbell Bench Press');
    for (const unit of ['lb', 'kg'] as const) {
      const html = render(session, unit);
      assert.match(html, /Suggested start (45 lb|20 kg)/);
      assert.equal(warmRows(html).length, 0, unit);
    }
  });
});

test('the suggested start ramps only the lead slot, never a first-time lift further down', async () => {
  await withTrain((render) => {
    const day = createSession({ id: 's326b', name: 'Push', dayIndex: 0, now: at(0), exercises: [
      { exerciseId: 'push-up', name: 'Push-Up', planned: [{ weight: 0, reps: 10 }], performed: [{ weight: 0, reps: 10, done: false, completedAt: null }] },
      { exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', planned: [{ weight: 0, reps: 8 }], performed: [{ weight: 0, reps: 8, done: false, completedAt: null }] },
    ] });
    const done = { ...day, exercises: [{ ...day.exercises[0], performed: [{ weight: 0, reps: 10, done: true, completedAt: at(1) }] }, day.exercises[1]] };
    const html = render(done, 'lb');
    assert.match(html, /Dumbbell Bench Press/);
    assert.equal(warmRows(html).length, 0);
  });
});
