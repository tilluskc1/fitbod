import assert from 'node:assert/strict';
import test from 'node:test';
import { liveRampBurst, rampExerciseIndex } from '../src/lib/warmUp.ts';
import { toKg } from '../src/lib/units.ts';

// #344: the ramp burst (#326) lives only while set 1's cell is still the ramp cell of the slot it began in.
// Set 1's ✓ keeps the cell focused, so logging it ends the ramp cell with no blur; the burst must go then.

const key = 's344:0:dumbbell-bench-press';
const at = (rampIndex: number, index = 0, slotKey = key) => ({ key: slotKey, rampIndex, index });

test('a burst on the ramp cell holds (kg and lb)', () => {
  for (const kg of [22.5, toKg(50, 'lb')]) {
    const burst = { key, kg };
    assert.equal(liveRampBurst(burst, at(0)), burst);
  }
});

test('set 1 stops being the ramp cell while focused: the burst clears', () => {
  const burst = { key, kg: toKg(135, 'lb') };
  // A logged lead set (or a skipped lead) takes the ramps away: rampIndex goes to -1.
  const lead = (done: boolean, skipped = false) => ({ exercises: [{ exerciseId: 'barbell-bench-press', skipped,
    performed: [{ weight: 60, reps: 8, done, completedAt: null }, { weight: 60, reps: 8, done: false, completedAt: null }] }] });
  assert.equal(rampExerciseIndex(lead(false) as never), 0);
  assert.equal(liveRampBurst(burst, at(rampExerciseIndex(lead(false) as never))), burst);
  assert.equal(liveRampBurst(burst, at(rampExerciseIndex(lead(true) as never))), null, 'a logged lead set');
  assert.equal(liveRampBurst(burst, at(rampExerciseIndex(lead(false, true) as never))), null, 'a skipped lead');
  // The open slot moved on while the ramp slot stayed 0.
  assert.equal(liveRampBurst(burst, at(0, 1)), null);
});

test('a burst from another slot or exercise never carries over (lead swapped before set 1, lesson 23)', () => {
  const burst = { key, kg: 40 };
  assert.equal(liveRampBurst(burst, at(0, 0, 's344:0:push-up')), null);
  assert.equal(liveRampBurst(burst, at(0, 0, 's345:0:dumbbell-bench-press')), null);
  assert.equal(liveRampBurst(null, at(0)), null);
});
