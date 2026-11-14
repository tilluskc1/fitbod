import assert from 'node:assert/strict';
import test from 'node:test';
import { weightSteps } from '../src/lib/weightSteps.ts';
import { toKg } from '../src/lib/units.ts';
import { MAX_WEIGHT } from '../src/lib/validate.ts';

// #371: the logger's − and + buttons step the next set by one real step.
const lb = (value: number) => toKg(value, 'lb');
const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test('a pound barbell steps 5 lb plates on the grid: 95 → 100 up, 90 down', () => {
  const steps = weightSteps({ kg: lb(95), equipment: 'Barbell', available: [], unit: 'lb' });
  assert.equal(steps.step, 5);
  close(steps.up, lb(100));
  close(steps.down, lb(90));
});

test('a barbell never steps below the empty bar: − is disabled at 45 lb and 20 kg', () => {
  assert.equal(weightSteps({ kg: lb(45), equipment: 'Barbell', available: [], unit: 'lb' }).down, null);
  close(weightSteps({ kg: lb(50), equipment: 'Barbell', available: [], unit: 'lb' }).down, lb(45));
  assert.equal(weightSteps({ kg: 20, equipment: 'Barbell', available: [], unit: 'kg' }).down, null);
  close(weightSteps({ kg: 22.5, equipment: 'Barbell', available: [], unit: 'kg' }).down, 20);
  // Below the bar (a lighter typed load): nothing lower, and + goes back up the grid.
  assert.equal(weightSteps({ kg: 15, equipment: 'Barbell', available: [], unit: 'kg' }).down, null);
  close(weightSteps({ kg: 15, equipment: 'Barbell', available: [], unit: 'kg' }).up, 17.5);
});

test('a kilogram barbell steps incrementFor (2.5 kg): 60 → 62.5 and 57.5', () => {
  const steps = weightSteps({ kg: 60, equipment: 'Barbell', available: [], unit: 'kg' });
  assert.equal(steps.step, 2.5);
  close(steps.up, 62.5);
  close(steps.down, 57.5);
});

test('a machine stack steps 5 kg, or 10 lb', () => {
  assert.equal(weightSteps({ kg: 40, equipment: 'Machine', available: [], unit: 'kg' }).step, 5);
  const steps = weightSteps({ kg: lb(100), equipment: 'Machine', available: [], unit: 'lb' });
  assert.equal(steps.step, 10);
  close(steps.up, lb(110));
  close(steps.down, lb(90));
});

test('an off-grid load moves to the next grid point, not past it', () => {
  const steps = weightSteps({ kg: 61, equipment: 'Barbell', available: [], unit: 'kg' });
  close(steps.up, 62.5);
  close(steps.down, 60);
  const pounds = weightSteps({ kg: lb(97), equipment: 'Barbell', available: [], unit: 'lb' });
  close(pounds.up, lb(100));
  close(pounds.down, lb(95));
});

test('three steps up from 45 lb read 60 lb, each one a real step', () => {
  let kg = lb(45);
  for (let tap = 0; tap < 3; tap += 1) kg = weightSteps({ kg, equipment: 'Barbell', available: [], unit: 'lb' }).up ?? kg;
  close(kg, lb(60));
});

test('− is never 0 or below: at one step it is disabled', () => {
  assert.equal(weightSteps({ kg: 2.5, equipment: 'Dumbbell', available: [], unit: 'kg' }).down, null);
  assert.equal(weightSteps({ kg: lb(5), equipment: 'Dumbbell', available: [], unit: 'lb' }).down, null);
  assert.equal(weightSteps({ kg: 0, equipment: 'Dumbbell', available: [], unit: 'kg' }).down, null);
  // An empty set steps up to the first load.
  close(weightSteps({ kg: 0, equipment: 'Dumbbell', available: [], unit: 'kg' }).up, 2.5);
});

test('+ is disabled past the loader limit', () => {
  assert.equal(weightSteps({ kg: MAX_WEIGHT, equipment: 'Barbell', available: [], unit: 'kg' }).up, null);
  close(weightSteps({ kg: MAX_WEIGHT - 2.5, equipment: 'Barbell', available: [], unit: 'kg' }).up, MAX_WEIGHT);
  assert.equal(weightSteps({ kg: MAX_WEIGHT, equipment: 'Barbell', available: [], unit: 'lb' }).up, null);
});

test('owned dumbbells: + goes to the next owned load, − to the previous one', () => {
  const rack = [5, 7.5, 10, 12.5, 15, 20];
  const steps = weightSteps({ kg: 12.5, equipment: 'Dumbbell', available: rack, unit: 'kg' });
  assert.equal(steps.step, 2.5);
  close(steps.up, 15);
  close(steps.down, 10);
  // A gap in the rack is one tap: 15 → 20 and 20 → 15.
  close(weightSteps({ kg: 15, equipment: 'Dumbbell', available: rack, unit: 'kg' }).up, 20);
  close(weightSteps({ kg: 20, equipment: 'Dumbbell', available: rack, unit: 'kg' }).down, 15);
});

test('owned dumbbells: − is disabled at the lightest, + at the heaviest', () => {
  const rack = [5, 7.5, 10];
  assert.equal(weightSteps({ kg: 5, equipment: 'Dumbbell', available: rack, unit: 'kg' }).down, null);
  assert.equal(weightSteps({ kg: 10, equipment: 'Dumbbell', available: rack, unit: 'kg' }).up, null);
  // A typed load above the rack goes back down to the heaviest owned, never further up.
  assert.equal(weightSteps({ kg: 12, equipment: 'Dumbbell', available: rack, unit: 'kg' }).up, null);
  close(weightSteps({ kg: 12, equipment: 'Dumbbell', available: rack, unit: 'kg' }).down, 10);
});

test('owned dumbbells in pounds: 25 → 30 and 20, a 5 lb step', () => {
  const rack = [15, 20, 25, 30, 35].map(lb);
  const steps = weightSteps({ kg: lb(25), equipment: 'Dumbbell', available: rack, unit: 'lb' });
  assert.equal(steps.step, 5);
  close(steps.up, lb(30));
  close(steps.down, lb(20));
});

test('bodyweight has no step', () => {
  assert.deepEqual(weightSteps({ kg: 0, equipment: 'Bodyweight', available: [], unit: 'kg' }), { step: 0, down: null, up: null });
});
