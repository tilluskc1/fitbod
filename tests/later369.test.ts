import assert from 'node:assert/strict';
import test from 'node:test';
import { canMoveLater, pairedPendingIndex } from '../src/lib/supersets.ts';

// #369: Later is offered only while another exercise still has work left today.
const entry = (done: number, total: number, skipped = false) => ({
  exerciseId: 'x',
  performed: Array.from({ length: total }, (_, index) => ({ done: index < done })),
  ...(skipped ? { skipped: true } : {}),
});

test('Later shows while another exercise has pending, unskipped sets', () => {
  const session = { exercises: [entry(0, 3), entry(0, 3)] };
  assert.equal(canMoveLater(session, 0), true);
  assert.equal(canMoveLater(session, 1), true);
});

test('Later hides on the only exercise with work left', () => {
  // The other one is finished.
  assert.equal(canMoveLater({ exercises: [entry(3, 3), entry(1, 3)] }, 1), false);
  // The other one is skipped, though it has pending sets.
  assert.equal(canMoveLater({ exercises: [entry(0, 3, true), entry(1, 3)] }, 1), false);
  // A lone exercise.
  assert.equal(canMoveLater({ exercises: [entry(0, 3)] }, 0), false);
});

test('Later never offers an exercise with nothing left to move', () => {
  assert.equal(canMoveLater({ exercises: [entry(3, 3), entry(0, 3)] }, 0), false);
  assert.equal(canMoveLater({ exercises: [entry(0, 3, true), entry(0, 3)] }, 0), false);
  assert.equal(canMoveLater({ exercises: [entry(0, 3)] }, 5), false);
});

test('after Later the logger moves to the next exercise with work left', () => {
  const session = { exercises: [{ ...entry(1, 3), skipped: true }, entry(3, 3), entry(0, 2)] };
  assert.equal(pairedPendingIndex(session, []), 2);
});
