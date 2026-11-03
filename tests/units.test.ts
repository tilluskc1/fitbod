import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationInputValue, displayValue, formatWeight, toKg } from '../src/lib/units.ts';

test('pounds are a readout; kilograms stay canonical', () => {
  assert.equal(displayValue(15, 'kg'), 15);
  assert.equal(displayValue(15, 'lb'), 33);
  assert.equal(formatWeight(15, 'lb', { perSide: true }), '33 lb each');
  assert.ok(Math.abs(toKg(33, 'lb') - 14.97) < 0.01);
});

test('readouts use one decimal only when the plate needs it', () => {
  assert.equal(formatWeight(22.5, 'kg'), '22.5 kg');
  assert.equal(formatWeight(0, 'kg'), 'Bodyweight');
});

test('editable loads keep calibrated precision without plate rounding', () => {
  assert.equal(calibrationInputValue(42.3, 'kg'), '42.3');
  assert.equal(calibrationInputValue(toKg(95.3, 'lb'), 'lb'), '95.3');
});
