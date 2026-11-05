import assert from 'node:assert/strict';
import test from 'node:test';
import { tabBarAction } from '../src/lib/tabBarAction.ts';

test('a live session resumes, even with nothing feasible to start', () => {
  assert.deepEqual(tabBarAction({}, { exercises: [] }), { kind: 'resume', label: 'Resume', name: 'Resume workout', disabled: false });
});

test('no feasible exercises disables Start', () => {
  assert.deepEqual(tabBarAction(null, { exercises: [] }), { kind: 'start', label: 'Start', name: 'Start workout', disabled: true });
});

test('otherwise Start is enabled', () => {
  assert.deepEqual(tabBarAction(null, { exercises: [1] }), { kind: 'start', label: 'Start', name: 'Start workout', disabled: false });
});
