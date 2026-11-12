import assert from 'node:assert/strict';
import test from 'node:test';
import { RAMP_FLOOR, rampSets } from '../src/lib/warmUp.ts';
import { toKg } from '../src/lib/units.ts';
import type { Equipment } from '../src/types.ts';

// #345: under 30 lb / 15 kg (display unit) the lift is its own warm-up, so no ramp rows.

const LOADED: Equipment[] = ['Dumbbell', 'Kettlebell', 'Machine', 'Cable'];

test('the floor is 30 lb and 15 kg', () => {
  assert.deepEqual(RAMP_FLOOR, { lb: 30, kg: 15 });
});

test('25 lb and 12.5 kg give no rows on every loaded kit', () => {
  for (const equipment of LOADED) {
    assert.deepEqual(rampSets({ equipment, working: toKg(25, 'lb'), unit: 'lb' }), [], `${equipment} lb`);
    assert.deepEqual(rampSets({ equipment, working: 12.5, unit: 'kg' }), [], `${equipment} kg`);
    // Just under the floor, too.
    assert.deepEqual(rampSets({ equipment, working: toKg(29, 'lb'), unit: 'lb' }), [], `${equipment} 29 lb`);
    assert.deepEqual(rampSets({ equipment, working: 14.9, unit: 'kg' }), [], `${equipment} 14.9 kg`);
  }
});

test('exactly 30 lb and 15 kg still give two rows', () => {
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: toKg(30, 'lb'), unit: 'lb' }).map((set) => set.weight),
    [toKg(15, 'lb'), toKg(20, 'lb')]);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 15, unit: 'kg' }).map((set) => set.weight), [7.5, 10]);
  for (const equipment of LOADED) {
    assert.equal(rampSets({ equipment, working: toKg(30, 'lb'), unit: 'lb' }).length, 2, `${equipment} lb`);
    assert.equal(rampSets({ equipment, working: 15, unit: 'kg' }).length, 2, `${equipment} kg`);
  }
});

test('the floor reads the display unit: 14 kg is under for a kg lifter, 31 lb is over for an lb lifter', () => {
  // 14 kg is about 30.9 lb: under the kg floor, over the lb floor.
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 14, unit: 'kg' }), []);
  assert.equal(rampSets({ equipment: 'Dumbbell', working: 14, unit: 'lb' }).length, 2);
});

test('barbell is unchanged: the empty bar stays the floor', () => {
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: toKg(45, 'lb'), unit: 'lb' }), []);
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 20, unit: 'kg' }), []);
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: toKg(135, 'lb'), unit: 'lb' }).map((set) => set.weight),
    [toKg(65, 'lb'), toKg(100, 'lb')]);
  assert.deepEqual(rampSets({ equipment: 'Barbell', working: 60, unit: 'kg' }).map((set) => set.weight), [30, 45]);
});

test('a listed dumbbell rack follows the floor, under and over', () => {
  const lbRack = [5, 10, 15, 20, 25, 30, 35, 40].map((load) => toKg(load, 'lb'));
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: toKg(25, 'lb'), unit: 'lb', rack: lbRack }), []);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: toKg(40, 'lb'), unit: 'lb', rack: lbRack }).map((set) => set.weight),
    [toKg(20, 'lb'), toKg(30, 'lb')]);
  assert.equal(rampSets({ equipment: 'Dumbbell', working: toKg(30, 'lb'), unit: 'lb', rack: lbRack }).length, 2);
  // A rack whose lightest load is above the floor: the lightest-load rule still applies.
  const heavy = [16, 20, 24, 28].map(Number);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 16, unit: 'kg', rack: heavy }), []);
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 28, unit: 'kg', rack: heavy }).map((set) => set.weight), [16, 20]);
  // A rack whose lightest load is below the floor: still nothing under 15 kg.
  const light = [2, 4, 6, 8, 10, 12, 14, 16];
  assert.deepEqual(rampSets({ equipment: 'Dumbbell', working: 14, unit: 'kg', rack: light }), []);
  assert.equal(rampSets({ equipment: 'Dumbbell', working: 16, unit: 'kg', rack: light }).length, 2);
});
