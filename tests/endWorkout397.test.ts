import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { applyCancel, createSession } from '../src/lib/session.ts';
import { currentSlot, cursorFor, skipCurrentSlot } from '../src/lib/sequence.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile } from '../src/types.ts';

// #397: the owner could not end a 5-day-old empty Push. The way out now says "End". (#430 retired the
// "Unfinished … from …" variant and the Today End link: an open workout now shows the quiet resume row,
// suspends after 10 idle minutes and closes itself after 6 hours; see tests/askFirst430.test.ts.)

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
];

test('End workout keeps Push next; End and skip to Pull moves the plan, recorded as a skip', () => {
  const session = createSession({ id: 'empty', name: 'Push', dayIndex: 0, now: '2026-11-12T10:00:00.000Z', exercises: [] });
  const state = { ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 }, current: session } as unknown as AppState;
  const ended = applyCancel(state, 'empty');
  assert.equal(ended.current, null);
  assert.equal(currentSlot(ended)?.name, 'Push');
  assert.equal(ended.history.length, 0);
  assert.equal(ended.slotSkips?.length ?? 0, 0);
  const skipped = skipCurrentSlot(applyCancel(state, 'empty'), '2026-11-17T10:00:00.000Z', cursorFor(state));
  assert.equal(currentSlot(skipped)?.name, 'Pull');
  assert.equal(skipped.slotSkips?.length, 1);
  assert.deepEqual(Object.keys(ended).sort(), Object.keys(state).sort(), 'no new stored key');
});

test('the empty sheet with no next day shows only End workout and Keep going', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { FinishSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(FinishSheet, { done: 0, total: 12, onSave: noop, onContinue: noop,
      onDiscard: noop, onClose: noop, onSkip: noop }));
    const words = text(html);
    assert.match(words, /End this workout\?/);
    assert.match(words, /End workout/);
    assert.match(words, /Keep going/);
    assert.doesNotMatch(words, /skip to/i);
    assert.match(html, /<button class="primary"[^>]*>End workout/, 'End workout is the primary action');
  } finally {
    await server.close();
  }
});
