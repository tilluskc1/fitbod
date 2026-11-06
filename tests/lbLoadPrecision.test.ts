import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { catalogRowMeta, liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { inputValue, toKg } from '../src/lib/units.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
// The exercise action sheet opens on its history view, where recorded loads are listed.
const historyView = { name: 'action-sheet-history', enforce: 'pre' as const, transform(code: string, file: string) {
  if (file.endsWith('/src/screens/Sheets.tsx')) return code.replace("useState<ActionMode>(initialMode)", "useState<ActionMode>('history')");
} };
const actionProps = (profile: Profile) => ({ exerciseIndex: 0, exerciseCount: 1, pending: 0, done: 0, profile, inSession: false,
  skipped: false, onReplace() {}, onSaveProfile() {}, onRemoveToday() {}, onReturn() {} });
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
  let session = sessionAt(weight, 18); // the app planned 18 kg; the weight differs only when typed
  for (let i = 0; i < 3; i += 1) {
    session = logSet(updatePerformedSet(session, 0, i, { weight, reps: 10 }), 0, i, `2026-11-02T10:0${i + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

/** The visible text of the control with this accessible name. */
const cellText = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*>([^<]*)<`))?.[1];
const weights = (html: string) => [1, 2, 3].map((n) => cellText(html, `Edit weight for set ${n}`));

test('rack loads read like the target on every surface; typed loads keep their exact value (lb and kg)', async () => {
  const server = await createServer({ plugins: [historyView], server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { ExerciseActionsSheet, WhySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { progressionLines } = await server.ssrLoadModule('/src/lib/liveProgression.ts');
    for (const unit of ['lb', 'kg'] as const) {
      const who = { ...profile, unit };
      const props = { now: Date.parse('2026-11-04T10:01:00.000Z'), loadOptions: RACK, profileLoads: who.loads, unit,
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogSet() {}, onToggleRestPause() {},
        onExtendRest() {}, onReturn() {} };
      const trainHtml = (history: WorkoutRecord[], weight: number, planned: number) =>
        renderToStaticMarkup(createElement(TrainScreen, { ...props, history, session: sessionAt(weight, planned) }));
      const train = (history: WorkoutRecord[], weight: number, planned: number) => plain(trainHtml(history, weight, planned));
      const sheets = (history: WorkoutRecord[]) => [
        ['exercise history', ExerciseActionsSheet, /own records\. .*?@ ([\d.]+) lb|own records\. .*?@ ([\d.]+) kg/],
        ['why sheet', WhySheet, /Working load (.+?) lb|Working load (.+?) kg/],
      ].map(([label, Sheet, re]) => {
        const html = plain(renderToStaticMarkup(createElement(Sheet as never, { exerciseId: id, exerciseName: 'x',
          planned: [{ weight: 18, reps: 10 }], history, unit, loads: who.loads, ...actionProps(who), onClose() {} })));
        const m = html.match(re as RegExp);
        return [label, m ? `${m[1] ?? m[2]} ${unit}` : html] as const;
      });
      const recap = (history: WorkoutRecord[]) =>
        plain(progressionLines(history[0], who, history, unit)[0].performed ?? '');

      // Rack: 15 kg is 33.07 lb stored but reads 33 lb everywhere (15 kg in kg).
      const shown = unit === 'lb' ? '33 lb' : '15 kg';
      const number = shown.split(' ')[0];
      const rack = train(historyAt(15), 18, 18);
      assert.match(rack, new RegExp(`Set Previous ${unit} each Reps Log 1 ${number} × 10 `), `${unit} previous`);
      assert.deepEqual(weights(trainHtml(historyAt(15), 15, 15)), [number, number, number], `${unit} the rows ✓ logs`);
      assert.deepEqual(weights(trainHtml(historyAt(15), 18, 18)), Array(3).fill(unit === 'lb' ? '39.5' : '18'), `${unit} planned rows`);
      assert.doesNotMatch(rack, /39\.68|33\.07/);
      for (const [label, text] of sheets(historyAt(15))) assert.equal(text, shown, `${unit} ${label}`);
      assert.match(recap(historyAt(15)), new RegExp(`@ ${shown} each`), `${unit} recap`);

      // Typed 42.3 is off the confirmed rack: exact everywhere, even when planned equals it.
      const typed = unit === 'lb' ? toKg(42.3, 'lb') : 42.3;
      const exact = `42.3 ${unit}`;
      for (const planned of [18, typed]) {
        const off = trainHtml(historyAt(typed), typed, planned);
        assert.match(plain(off), new RegExp(`Previous ${unit} each Reps Log 1 42\\.3 × 10 `), `${unit} typed previous (planned ${planned})`);
        assert.deepEqual(weights(off), ['42.3', '42.3', '42.3'], `${unit} typed rows (planned ${planned})`);
      }
      for (const [label, text] of sheets(historyAt(typed))) assert.equal(text, exact, `${unit} typed ${label}`);
      assert.match(recap(historyAt(typed)), new RegExp(`@ ${exact} each`), `${unit} typed recap`);
    }
  } finally { await server.close(); }
});

/** A held typed load: next target equals what was logged. */
test('a held typed load reads as typed on target, header, chip, Today row and recap; new off-rack steps read half-unit', async () => {
  const server = await createServer({ plugins: [historyView], server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const { ExerciseActionsSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { progressionLines } = await server.ssrLoadModule('/src/lib/liveProgression.ts');
    for (const unit of ['lb', 'kg'] as const) {
      const who = { ...profile, unit };
      const typed = unit === 'lb' ? toKg(42.3, 'lb') : 42.3;
      const history = historyAt(typed);
      const exact = `42.3 ${unit}`;
      // Held target: the next prescription repeats the typed load (rep-increase).
      const held = liveExercises(adapted, who, history)[0];
      assert.equal(held.planned[0].weight, typed, 'held load');
      const session = createSession({ id: 'n', name: 'A', dayIndex: 0, now: '2026-11-04T10:00:00.000Z', exercises: [held] });
      const trainHtml = renderToStaticMarkup(createElement(TrainScreen, { now: Date.parse('2026-11-04T10:01:00.000Z'),
        loadOptions: RACK, profileLoads: who.loads, unit, history, session, onMinimize() {}, onFinish() {}, onUpdateSet() {},
        onLogSet() {}, onToggleRestPause() {}, onExtendRest() {}, onReturn() {} }));
      assert.match(plain(trainHtml), new RegExp(`Previous ${unit} each Reps Log 1 42\\.3 × 10 `), `${unit} previous`);
      assert.deepEqual(weights(trainHtml), ['42.3', '42.3', '42.3'], `${unit} target rows`);
      const today = plain(renderToStaticMarkup(createElement(Today, { profile: who, program: FULL_BODY_A,
        adapted: liveAdapted(adapted, who, history), equipment: 'home', adjusted: false, history, current: null,
        now: new Date('2026-11-04T10:00:00.000Z'), onPreview() {}, onAdjust() {}, onWhy() {}, onRestore() {},
        onOpenSettings() {}, onOpenExercise() {} })));
      assert.match(today, new RegExp(`@ ${exact.replace('.', '\\.')} each`), `${unit} Today row`);
      // Logged above the listed rack at the top of the range: the next one up is the lifter's to name (#129).
      assert.match(today, /Ready to go heavier: use your next dumbbell up\./, `${unit} Today coach`);
      assert.doesNotMatch(today, /42\.5/, `${unit} Today shows no 42.5`);
      const sheet = plain(renderToStaticMarkup(createElement(ExerciseActionsSheet, { exerciseId: id, exerciseName: 'x', planned: held.planned,
        history, unit, ...actionProps(who), onClose() {} })));
      assert.match(sheet, new RegExp(`Exercise 1 of 1 · 3 sets · .*@ ${exact.replace('.', '\\.')} each`), `${unit} sheet target`);
      const line = progressionLines(history[0], who, history, unit)[0];
      assert.match(line.next, new RegExp(`@ ${exact.replace('.', '\\.')} each`), `${unit} recap Next`);
    }
    // A new off-rack barbell step 40 -> 42.5 kg reads half-unit in lb, never 93.71.
    const bar = { ...profile, unit: 'lb' as const, equipment: ['Barbell'], loads: { Barbell: [] } } as Profile;
    let s = createSession({ id: 'b', name: 'B', dayIndex: 0, now: '2026-11-02T10:00:00.000Z', exercises: [{ exerciseId: 'barbell-row',
      name: 'Barbell Row', planned: [0, 1, 2].map(() => ({ weight: 40, reps: 10 })), performed: [0, 1, 2].map(() => ({ weight: 40, reps: 10, done: false })) }] });
    for (let i = 0; i < 3; i += 1) s = logSet(updatePerformedSet(s, 0, i, { weight: 40, reps: 10 }), 0, i, `2026-11-02T10:0${i + 1}:00.000Z`);
    const hist = applyFinish({ ...EMPTY_STATE, profile: bar, current: s }, s.id, { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
    const { exerciseById } = await server.ssrLoadModule('/src/data/exercises.ts');
    const meta = catalogRowMeta(exerciseById('barbell-row'), bar, hist, 'lb');
    assert.match(meta, /\b9[0-9](\.5)? lb/, 'barbell step is half-unit');
    assert.doesNotMatch(meta, /\.\d\d lb/);
    // Rack loads are unchanged.
    assert.match(plain(renderToStaticMarkup(createElement(Today, { profile: { ...profile, unit: 'lb' }, program: FULL_BODY_A,
      adapted: liveAdapted(adapted, profile, historyAt(15)), equipment: 'home', adjusted: false, history: historyAt(15), current: null,
      now: new Date('2026-11-04T10:00:00.000Z'), onPreview() {}, onAdjust() {}, onWhy() {}, onRestore() {},
      onOpenSettings() {}, onOpenExercise() {} }))), /You owned 33 lb\. Today: 39\.5 lb/);
  } finally { await server.close(); }
});

/** Barbell: a typed 42.3 lb steps to a new off-rack load that must read one way everywhere. */
test('an app-prescribed barbell step reads the same on target, rows, Log button and input, and stays so once accepted', async () => {
  const server = await createServer({ plugins: [historyView], server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { default: Adapt } = await server.ssrLoadModule('/src/screens/AdaptScreen.tsx');
    const { plannedLoad } = await server.ssrLoadModule('/src/lib/liveProgression.ts');
    const bar = { ...profile, unit: 'lb' as const, equipment: ['Barbell'], loads: { Barbell: [] } } as Profile;
    const row = exerciseById('barbell-row')!;
    const typed = toKg(42.3, 'lb');
    const record = (weight: number, planned: number, count = 3): WorkoutRecord[] => {
      let s = createSession({ id: `b${weight}`, name: 'B', dayIndex: 0, now: '2026-11-02T10:00:00.000Z', exercises: [{ exerciseId: 'barbell-row',
        name: 'Barbell Row', planned: [0, 1, 2].map(() => ({ weight: planned, reps: 10 })), performed: [0, 1, 2].map(() => ({ weight, reps: 10, done: false })) }] });
      for (let i = 0; i < count; i += 1) s = logSet(s, 0, i, `2026-11-02T10:0${i + 1}:00.000Z`);
      return applyFinish({ ...EMPTY_STATE, profile: bar, current: s }, s.id, { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
    };
    const history = record(typed, 40);
    const step = prescribeExercise(row, bar, history).weight;
    assert.notEqual(step, typed, 'a load step');
    const X = inputValue(step, 'lb');
    assert.doesNotMatch(X, /\.\d\d/);
    const held = liveExercises(adapted, bar, history)[0]; // unused shape check
    const session = createSession({ id: 'n', name: 'B', dayIndex: 0, now: '2026-11-04T10:00:00.000Z', exercises: [{ exerciseId: 'barbell-row',
      name: 'Barbell Row', planned: [0, 1, 2].map(() => ({ weight: step, reps: 10 })), performed: [0, 1, 2].map(() => ({ weight: step, reps: 10, done: false })) }] });
    const html = renderToStaticMarkup(createElement(TrainScreen, { now: Date.parse('2026-11-04T10:01:00.000Z'), loadOptions: [], profileLoads: bar.loads,
      unit: 'lb', history, session, onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogSet() {}, onToggleRestPause() {}, onExtendRest() {},
      onReturn() {} }));
    const text = plain(html);
    assert.match(text, /Set Previous lb total Reps/, 'target header');
    // The rows, the ✓ that logs them and the editor's input all read showPending.
    assert.deepEqual(weights(html), [X, X, X], 'pending rows');
    assert.doesNotMatch(text, /\d\.\d\d/);
    // Accept the step unchanged, log and finish: the next session still reads X, not the exact conversion.
    const accepted = record(step, step);
    assert.equal(plannedLoad(bar.loads, accepted, 'barbell-row', 'lb')(step), X, 'accepted step stays half-unit');
    // A deliberately typed off-rack value stays exact (planned differs from performed).
    assert.equal(plannedLoad(bar.loads, record(typed, 40), 'barbell-row', 'lb')(typed), '42.3');
    // AdaptScreen: a held typed load reads as typed.
    const adaptedTyped = liveAdapted(adapted, { ...profile, unit: 'lb' }, historyAt(toKg(42.3, 'lb')));
    const review = plain(renderToStaticMarkup(createElement(Adapt, { originalSets: 11, adapted: adaptedTyped,
      constraints: { minutes: 35, equipment: 'home' }, notices: [], unit: 'lb', loads: profile.loads,
      history: historyAt(toKg(42.3, 'lb')), onStart() {}, onKeep() {}, onEdit() {} })));
    assert.match(review, /42\.3 lb each/, 'Adapt review');
    assert.doesNotMatch(review, /42\.5/);
    void held;
  } finally { await server.close(); }
});

/** Overhead Press: typed 42.3 lb, then the app's 22.5 kg step logged unchanged (or typed again). */
test('a logged load reads like its target when accepted unchanged and as typed otherwise, on every logged surface', async () => {
  const server = await createServer({ plugins: [historyView], server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: TrainScreen } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const { default: Progress } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    const { ExerciseActionsSheet, WhySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { progressionLines, recapHighlight } = await server.ssrLoadModule('/src/lib/liveProgression.ts');
    const ohp = exerciseById('overhead-press')!;
    for (const unit of ['lb', 'kg'] as const) {
      const bar = { ...profile, unit, equipment: ['Barbell'], loads: { Barbell: [] } } as Profile;
      const typed = unit === 'lb' ? toKg(42.3, 'lb') : 19.3;
      const typedText = unit === 'lb' ? '42.3' : '19.3';
      const exercise = (planned: number, weight: number, reps = 10) => ({ exerciseId: 'overhead-press', name: 'Overhead Press',
        planned: [0, 1, 2].map(() => ({ weight: planned, reps })), performed: [0, 1, 2].map(() => ({ weight, reps, done: false })) });
      const finish = (prior: WorkoutRecord[], sid: string, day: string, planned: number, weight: number, reps = 10) => {
        let s = createSession({ id: sid, name: 'B', dayIndex: 0, now: `${day}T10:00:00.000Z`, exercises: [exercise(planned, weight, reps)] });
        for (let i = 0; i < 3; i += 1) s = logSet(s, 0, i, `${day}T10:0${i + 1}:00.000Z`);
        return applyFinish({ ...EMPTY_STATE, profile: bar, history: prior, current: s }, s.id, { early: true, now: `${day}T10:30:00.000Z` }).history;
      };
      const first = finish([], 'a', '2026-11-02', 18, typed);
      const step = prescribeExercise(ohp, bar, first).weight;
      assert.equal(step, 22.5, 'the app steps to 22.5 kg');
      const X = inputValue(step, unit); // 49.5 lb / 22.5 kg
      const trainProps = { now: Date.parse('2026-11-04T10:01:00.000Z'), loadOptions: [], profileLoads: bar.loads, unit,
        onMinimize() {}, onFinish() {}, onUpdateSet() {}, onLogSet() {}, onToggleRestPause() {}, onExtendRest() {},
        onReturn() {} };
      const re = (value: string) => value.replace('.', '\\.');

      for (const [weight, shown] of [[step, X], [typed, typedText]] as const) {
        const tag = `${unit} ${shown}`;
        // In session: set 1 saved at `weight`, the step still planned for the rest.
        let live = createSession({ id: 'b', name: 'B', dayIndex: 0, now: '2026-11-04T10:00:00.000Z', exercises: [exercise(step, step)] });
        live = logSet(updatePerformedSet(live, 0, 0, { weight }), 0, 0, '2026-11-04T10:01:00.000Z');
        const rowHtml = renderToStaticMarkup(createElement(TrainScreen, { ...trainProps, history: first, session: live }));
        const row = plain(rowHtml);
        assert.match(rowHtml, /<tr class="lg-row--done">/, `${tag} saved row`);
        assert.equal(cellText(rowHtml, 'Edit weight for set 1'), shown, `${tag} saved row`);

        // 8 reps: a rep step, so the recap headline is the new best rather than an earned load.
        const history = finish(first, 'b', '2026-11-04', step, weight, 8);
        const lines = progressionLines(history[0], bar, history, unit);
        assert.match(lines[0].performed ?? '', new RegExp(`best 8 reps @ ${re(shown)} ${unit}`), `${tag} recap best`);
        assert.match(lines[0].reason, new RegExp(`[:,] ${re(shown)} ${unit}`), `${tag} reason/history line`);
        if (weight === step) {
          assert.match(recapHighlight(history[0], history, lines, unit, bar), new RegExp(`New best: .*@ ${re(X)} ${unit}`), `${tag} New best`);
          assert.match(lines[0].next, new RegExp(`@ ${re(X)} ${unit}`), `${tag} Next`);
        }
        const progress = plain(renderToStaticMarkup(createElement(Progress, { history, unit, loads: bar.loads,
          onExport() {}, onCorrect() {}, onDelete() {}, onFeedback() {}, onGoTrain() {} })));
        assert.match(progress, new RegExp(`${re(shown)} ${unit} total ×`), `${tag} Progress`);
        for (const [label, Sheet, pattern] of [['exercise history', ExerciseActionsSheet, 'own records\\. .*?@'], ['why sheet', WhySheet, 'Working load']] as const) {
          const sheet = plain(renderToStaticMarkup(createElement(Sheet as never, { exerciseId: 'overhead-press', exerciseName: 'x',
            planned: [{ weight: step, reps: 10 }], history, unit, loads: bar.loads, ...actionProps(bar), onClose() {} })));
          assert.match(sheet, new RegExp(`${pattern} ${re(shown)} ${unit}`), `${tag} ${label}`);
        }
        // Next session: last session and target side by side.
        const next = createSession({ id: 'c', name: 'B', dayIndex: 0, now: '2026-11-06T10:00:00.000Z', exercises: [exercise(weight, weight)] });
        const trainHtml = renderToStaticMarkup(createElement(TrainScreen, { ...trainProps, history, session: next }));
        const train = plain(trainHtml);
        assert.match(train, new RegExp(`Previous ${unit} total Reps Log 1 ${re(shown)} × 8 `), `${tag} last session`);
        assert.equal(cellText(trainHtml, 'Edit weight for set 1'), shown, `${tag} next target`);
        if (unit === 'lb') assert.doesNotMatch(`${row} ${lines[0].performed} ${lines[0].reason} ${progress} ${train}`, /49\.6/, `${tag} no 49.6`);
      }
    }
  } finally { await server.close(); }
});
