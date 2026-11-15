import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createSession } from '../src/lib/session.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { coachLine, describePrescription, prescribeExercise } from '../src/lib/progression.ts';
import { toKg } from '../src/lib/units.ts';
import { weightSteps } from '../src/lib/weightSteps.ts';
import type { Profile, Unit, WorkoutRecord } from '../src/types.ts';
import { kgPinCases } from './fixtures/kgPins389.cases.ts';

// #389 / #391: a pound lifter sees whole-pound grid values: the next load, the coach line's "+5 lb" and the
// logger's −/+ steps. Stored loads stay kg. Kg lifters see no change at all (decision 6).
const lb = (value: number) => toKg(value, 'lb');
const close = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, message ?? `${actual} is not ${expected}`);

const FIXTURE = new URL('./fixtures/kgPins389-main.json.gz', import.meta.url);

test('decision 6: every pinned kg result from main 20d3e76 is unchanged', () => {
  const main = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());
  const now = JSON.parse(JSON.stringify(kgPinCases()));
  assert.equal(now.steps.length, main.steps.length);
  assert.equal(now.prescriptions.length, main.prescriptions.length);
  assert.deepEqual(now, main);
});

const base: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: [], support: [], exclusions: [], loads: {},
};

/** One completed session of `sets` sets, each planned and done at `weight` kg × `reps`. */
function history(exerciseId: string, weight: number, reps: number, sets = 3, plannedReps = reps): WorkoutRecord[] {
  return [{
    id: 'w1', date: '2026-11-01T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId, name: exerciseId,
      planned: Array.from({ length: sets }, () => ({ weight, reps: plannedReps })),
      performed: Array.from({ length: sets }, () => ({ weight, reps, done: true, completedAt: null })),
    }],
  }];
}

const prescribe = (id: string, rows: WorkoutRecord[], unit: Unit, loads: Profile['loads'] = {}) =>
  prescribeExercise(exerciseById(id)!, { ...base, unit, loads }, rows);

// --- #391: the next load ---

test('#391: 135 / 185 / 225 lb at the top of the range go to 140 / 190 / 230 lb, "+5 lb"', () => {
  for (const [from, to] of [[135, 140], [185, 190], [225, 230]]) {
    const p = prescribe('barbell-bench-press', history('barbell-bench-press', lb(from), 10), 'lb');
    assert.equal(p.basis, 'load-increase', `${from}`);
    close(p.weight, lb(to), `${from} lb → ${p.weight} kg, want ${to} lb`);
    assert.match(describePrescription(p, 'lb'), new RegExp(`${from} lb\\. One step up \\(\\+5 lb\\)`));
    assert.match(coachLine(p, 'lb'), new RegExp(`Today: ${to} lb for`));
  }
});

test('#391: an off-grid pound load rounds up on the 5 lb grid, one step at least (137 → 145)', () => {
  close(prescribe('barbell-bench-press', history('barbell-bench-press', lb(137), 10), 'lb').weight, lb(145));
});

test('#391: a 100 lb machine and a 50 lb cable step 5 lb', () => {
  const machine = prescribe('leg-press', history('leg-press', lb(100), 10), 'lb');
  assert.equal(machine.basis, 'load-increase');
  close(machine.weight, lb(105));
  assert.match(describePrescription(machine, 'lb'), /\(\+5 lb\)/);
  const cable = prescribe('lat-pulldown', history('lat-pulldown', lb(50), 10), 'lb');
  assert.equal(cable.basis, 'load-increase');
  close(cable.weight, lb(55));
});

test('#389: the second week from the 45 lb bar reads 50 lb, not 55.1 (25 kg)', () => {
  const p = prescribe('barbell-bench-press', history('barbell-bench-press', lb(45), 10), 'lb');
  close(p.weight, lb(50));
});

test('#391: a range reset in pounds lands on the 5 lb grid', () => {
  // Face Pull 45 lb × 8 from an old 6–10 range → 12–20: 45 × (38/30) / 1.4 = 40.7 lb → 40 lb.
  const p = prescribe('face-pull', history('face-pull', lb(45), 8, 3, 8), 'lb');
  assert.equal(p.basis, 'range-reset');
  close(p.weight, lb(40));
  assert.match(coachLine(p, 'lb'), /New rep range: 40 lb for 12\./);
  // Never below one step.
  close(prescribe('face-pull', history('face-pull', lb(5), 8, 3, 8), 'lb').weight, lb(5));
});

test('#391: an owned rack still picks its own next load in pounds', () => {
  const rack = [15, 20, 25, 30].map(lb);
  const p = prescribe('dumbbell-floor-press', history('dumbbell-floor-press', lb(20), 12, 3, 12), 'lb', { Dumbbell: rack });
  assert.equal(p.basis, 'load-increase');
  close(p.weight, lb(25));
});

test('#391: at the loader limit a pound lifter holds', () => {
  const p = prescribe('barbell-bench-press', history('barbell-bench-press', 2000, 10), 'lb');
  assert.equal(p.basis, 'hold');
  assert.equal(p.weight, 2000);
});

test('bodyweight work is untouched in pounds', () => {
  for (const unit of ['kg', 'lb'] as const) {
    const p = prescribe('push-up', history('push-up', 0, 20), unit);
    assert.equal(p.weight, 0);
    assert.equal(p.increment, 0);
  }
  assert.deepEqual(weightSteps({ kg: 0, equipment: 'Bodyweight', available: [], unit: 'lb' }), { step: 0, down: null, up: null, downBy: 0, upBy: 0 });
});

test('a unit switch kg → lb → kg leaves stored loads and the kg prescription unchanged', () => {
  const rows = history('barbell-bench-press', 60, 10);
  const before = JSON.stringify(rows);
  const kg1 = prescribe('barbell-bench-press', rows, 'kg');
  prescribe('barbell-bench-press', rows, 'lb');
  const kg2 = prescribe('barbell-bench-press', rows, 'kg');
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(kg2, kg1);
  assert.equal(kg1.weight, 62.5);
});

// --- #389: the logger's −/+ steps ---

test('#389: a 55 lb bench stored as 25 kg steps −5 / +5 lb to 50 and 60', () => {
  const steps = weightSteps({ kg: 25, equipment: 'Barbell', available: [], unit: 'lb' });
  assert.equal(steps.downBy, 5);
  assert.equal(steps.upBy, 5);
  close(steps.down, lb(50));
  close(steps.up, lb(60));
  // Typed 55 lb reads the same.
  const typed = weightSteps({ kg: lb(55), equipment: 'Barbell', available: [], unit: 'lb' });
  assert.deepEqual([typed.downBy, typed.upBy, typed.step], [5, 5, 5]);
});

test('#389: 25 kg for a kg lifter is unchanged: −2.5 / +2.5', () => {
  const steps = weightSteps({ kg: 25, equipment: 'Barbell', available: [], unit: 'kg' });
  assert.deepEqual([steps.down, steps.up, steps.downBy, steps.upBy], [22.5, 27.5, 2.5, 2.5]);
});

test('#389: machine and cable step 5 lb on the shared grid', () => {
  const machine = weightSteps({ kg: lb(100), equipment: 'Machine', available: [], unit: 'lb' });
  assert.deepEqual([machine.step, machine.downBy, machine.upBy], [5, 5, 5]);
  close(machine.up, lb(105));
  close(machine.down, lb(95));
  const cable = weightSteps({ kg: lb(50), equipment: 'Cable', available: [], unit: 'lb' });
  assert.deepEqual([cable.step, cable.downBy, cable.upBy], [5, 5, 5]);
});

test('#389: dumbbells on an owned pound rack step by its own gaps', () => {
  const steps = weightSteps({ kg: lb(25), equipment: 'Dumbbell', available: [15, 20, 25, 30, 35].map(lb), unit: 'lb' });
  assert.deepEqual([steps.step, steps.downBy, steps.upBy], [5, 5, 5]);
});

test('#389: a kg rack shown in pounds rounds each entry to 2.5 lb before the gap: never 5.1 or 5.5', () => {
  const rack = [10, 12.5, 15, 17.5, 20];
  const steps = weightSteps({ kg: 12.5, equipment: 'Dumbbell', available: rack, unit: 'lb' });
  close(steps.up, 15);
  close(steps.down, 10);
  assert.deepEqual([steps.step, steps.downBy, steps.upBy], [5, 5, 5]);
  // The same rack for a kg lifter: unchanged.
  const kg = weightSteps({ kg: 12.5, equipment: 'Dumbbell', available: rack, unit: 'kg' });
  assert.deepEqual([kg.step, kg.downBy, kg.upBy], [2.5, 2.5, 2.5]);
});

test('#389: the logger reads − 5 lb / + 5 lb on a 55 lb bench planned at 25 kg; a kg lifter reads 2.5', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const at = '2026-11-14T10:00:00.000Z';
    const session = createSession({ id: 's389', name: 'Push', dayIndex: 0, now: at, exercises: [{
      exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press',
      planned: [0, 1, 2].map(() => ({ weight: 25, reps: 8 })),
      performed: [0, 1, 2].map(() => ({ weight: 25, reps: 8, done: false, completedAt: null })),
    }] });
    const noop = () => {};
    const render = (unit: Unit) => renderToStaticMarkup(createElement(Train, { session, history: [], now: Date.parse(at) + 60000,
      rampLoads: [], calibrationLoads: [], unit, onMinimize: noop, onFinish: noop, onUpdateSet: noop, onLogSet: noop,
      onToggleRestPause: noop, onExtendRest: noop, onOpenActions: noop, onReturn: noop }));
    const pounds = render('lb');
    assert.match(pounds, /aria-label="− 5 lb"/);
    assert.match(pounds, /aria-label="\+ 5 lb"/);
    assert.doesNotMatch(pounds, /5\.1|4\.9/);
    const kg = render('kg');
    assert.match(kg, /aria-label="− 2.5 kg"/);
    assert.match(kg, /aria-label="\+ 2.5 kg"/);
  } finally { await server.close(); }
});
