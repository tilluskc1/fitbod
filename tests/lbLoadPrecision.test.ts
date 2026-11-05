import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { toKg } from '../src/lib/units.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'lb',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = () => liveExercises(adapted, profile, []);
const id = base()[0].exerciseId;

function sessionAt(weight: number, planned: number) {
  const ex = base()[0];
  const sets = [0, 1, 2].map(() => ({ weight, reps: 10, done: false }));
  return createSession({ id: 's', name: 'A', dayIndex: 0, now: '2026-11-04T10:00:00.000Z',
    exercises: [{ ...ex, planned: sets.map((s) => ({ weight: planned, reps: s.reps })), performed: sets }] });
}

function historyAt(weight: number): WorkoutRecord[] {
  let session = sessionAt(weight, weight);
  for (let i = 0; i < 3; i += 1) {
    session = logSet(updatePerformedSet(session, 0, i, { weight, reps: 10 }), 0, i, `2026-11-02T10:0${i + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

test('rack loads read like the target on every surface; typed loads keep their exact value (lb and kg)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { ExerciseSheet, WhySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { progressionLines } = await server.ssrLoadModule('/src/lib/liveProgression.ts');
    for (const unit of ['lb', 'kg'] as const) {
      const who = { ...profile, unit };
      const props = { now: Date.parse('2026-11-04T10:01:00.000Z'), loadOptions: RACK, profileLoads: who.loads, unit,
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogNext() {}, onToggleRestPause() {},
        onExtendRest() {}, onSwap() {}, onSkip() {}, onReturn() {} };
      const train = (history: WorkoutRecord[], weight: number, planned: number) =>
        plain(renderToStaticMarkup(createElement(TrainScreen, { ...props, history, session: sessionAt(weight, planned) })));
      const sheets = (history: WorkoutRecord[]) => [
        ['exercise sheet', ExerciseSheet, /Last recorded (.+?) lb|Last recorded (.+?) kg/],
        ['why sheet', WhySheet, /Working load (.+?) lb|Working load (.+?) kg/],
      ].map(([label, Sheet, re]) => {
        const html = plain(renderToStaticMarkup(createElement(Sheet as never, { exerciseId: id, exerciseName: 'x',
          planned: [{ weight: 18, reps: 10 }], history, unit, loads: who.loads, onClose() {} })));
        const m = html.match(re as RegExp);
        return [label, m ? `${m[1] ?? m[2]} ${unit}` : html] as const;
      });
      const recap = (history: WorkoutRecord[]) =>
        plain(progressionLines(history[0], who, history, unit)[0].performed ?? '');

      // Rack: 15 kg is 33.07 lb stored but reads 33 lb everywhere (15 kg in kg).
      const shown = unit === 'lb' ? '33 lb' : '15 kg';
      const rack = train(historyAt(15), 18, 18);
      assert.match(rack, new RegExp(`Last session: .*@ ${shown} each`), `${unit} last-session`);
      assert.match(train(historyAt(15), 15, 15), new RegExp(`Log set 1 · .*@ ${shown}`), `${unit} Log button`);
      assert.match(train(historyAt(15), 18, 18), unit === 'lb' ? /10 reps @ 39\.5 lb each/ : /10 reps @ 18 kg each/, `${unit} planned rows`);
      assert.doesNotMatch(rack, /39\.68|33\.07/);
      for (const [label, text] of sheets(historyAt(15))) assert.equal(text, shown, `${unit} ${label}`);
      assert.match(recap(historyAt(15)), new RegExp(`@ ${shown} each`), `${unit} recap`);

      // Typed 42.3 is off the confirmed rack: exact everywhere, even when planned equals it.
      const typed = unit === 'lb' ? toKg(42.3, 'lb') : 42.3;
      const exact = `42.3 ${unit}`;
      for (const planned of [18, typed]) {
        const off = train(historyAt(typed), typed, planned);
        assert.match(off, new RegExp(`Last session: .*@ ${exact} each`), `${unit} typed last-session (planned ${planned})`);
        assert.match(off, new RegExp(`Log set 1 · .*@ ${exact}`), `${unit} typed Log button`);
        assert.match(off, new RegExp(`10 reps @ ${exact} each`), `${unit} typed planned rows`);
      }
      for (const [label, text] of sheets(historyAt(typed))) assert.equal(text, exact, `${unit} typed ${label}`);
      assert.match(recap(historyAt(typed)), new RegExp(`@ ${exact} each`), `${unit} typed recap`);
    }
  } finally { await server.close(); }
});
