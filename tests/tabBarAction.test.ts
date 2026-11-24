import assert from 'node:assert/strict';
import test from 'node:test';
import { tabBarAction } from '../src/lib/tabBarAction.ts';

test('a live session resumes', () => {
  assert.deepEqual(tabBarAction({}), { kind: 'resume', label: 'Resume', name: 'Resume workout', disabled: false });
});

// (#428) The button never starts a workout; it opens "Plan today with me", which always has
// something to offer, so it is never disabled, feasible day or not. The caption reads "Talk"
// (not "Plan"), since the nav bar already has a Plan tab with the same plain text.
test('no current session opens the planner, never disabled', () => {
  assert.deepEqual(tabBarAction(null), { kind: 'plan', label: 'Talk', name: 'Plan today with me', disabled: false });
});
