import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { applyCancel, createSession } from '../src/lib/session.ts';
import { currentSlot, cursorFor, skipCurrentSlot } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

// #184: Finish with nothing logged used to offer "Save completed work", then silently discard and keep
// the same day next. Now it asks whether the plan moves on.

const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];

test('an empty session skipped from Finish moves the plan to the next day and records a skip', () => {
  const session = createSession({ id: 'empty', name: 'Push', dayIndex: 0, now: '2026-11-07T10:00:00.000Z', exercises: [] });
  const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 }, current: session } as unknown as AppState;
  const offered = cursorFor(state);
  const next = skipCurrentSlot(applyCancel(state, 'empty'), '2026-11-07T10:05:00.000Z', offered);
  assert.equal(next.current, null);
  assert.equal(currentSlot(next)?.name, 'Pull');
  assert.equal(next.slotSkips?.length, 1);
  assert.equal(next.history.length, 0, 'nothing enters history');
});

test('the empty Finish sheet offers Skip to the next day and Keep this day, never "Save completed work"', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { FinishSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const noop = () => {};
    const empty = renderToStaticMarkup(createElement(FinishSheet, { done: 0, total: 24, onSave: noop, onContinue: noop,
      onDiscard: noop, onClose: noop, slotName: 'Push', nextName: 'Pull', onSkip: noop })).replace(/<[^>]+>/g, ' ');
    assert.match(empty, /No sets logged/);
    assert.match(empty, /Skip to Pull/);
    assert.match(empty, /Keep Push for next time/);
    assert.doesNotMatch(empty, /Save completed work/);
    const some = renderToStaticMarkup(createElement(FinishSheet, { done: 3, total: 24, onSave: noop, onContinue: noop,
      onDiscard: noop, onClose: noop, slotName: 'Push', nextName: 'Pull', onSkip: noop })).replace(/<[^>]+>/g, ' ');
    assert.match(some, /Save completed work/, 'with sets logged the sheet is unchanged');
  } finally {
    await server.close();
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onSkip=\{skipFromSession\}/);
});
