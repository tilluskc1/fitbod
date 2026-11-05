import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { catalogRowMeta, liveAdapted, liveExercises, targetReason } from '../src/lib/liveProgression.ts';
import { tabBarAction } from '../src/lib/tabBarAction.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

const RACK = [10, 15, 18];
const profile: Profile = {
  name: 'Krishna', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: RACK }, unit: 'kg',
};
const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home', loads: RACK });
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

function liveSession(history: WorkoutRecord[]) {
  return createSession({ id: 's', name: adapted.name, dayIndex: 0, durationMin: 35,
    exercises: liveExercises(adapted, profile, history), now: '2026-11-02T10:00:00.000Z' });
}

/** History in which the press earned the next rack load (3 × 10 at 15 kg). */
function earnedHistory(): WorkoutRecord[] {
  let session = liveSession([]);
  for (let index = 0; index < 3; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight: 15, reps: 10 }), 0, index,
      `2026-11-02T10:0${index + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

async function withServer<T>(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<T>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try { return await run((path) => server.ssrLoadModule(path)); } finally { await server.close(); }
}

function renderToday(Today: unknown, who: Profile, history: WorkoutRecord[], current: WorkoutRecord | null = null) {
  return renderToStaticMarkup(createElement(Today as never, { profile: who, program: FULL_BODY_A,
    adapted: liveAdapted(adapted, who, history), equipment: 'home', adjusted: false, history,
    current, now: new Date('2026-11-04T10:00:00.000Z'), onPreview: noop, onAdjust: noop,
    onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop }));
}

/** History in which the press stopped after 2 of 3 sets at 15 kg × 10. */
function unfinishedHistory(): WorkoutRecord[] {
  let session = liveSession([]);
  for (let index = 0; index < 2; index += 1) {
    session = logSet(updatePerformedSet(session, 0, index, { weight: 15, reps: 10 }), 0, index,
      `2026-11-02T10:0${index + 1}:00.000Z`);
  }
  return applyFinish({ ...EMPTY_STATE, profile, current: session }, session.id,
    { early: true, now: '2026-11-02T10:30:00.000Z' }).history;
}

test('Today coach line is short and states the same numbers as the target', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const cases: [string, Profile, WorkoutRecord[], string, string][] = [
      ['earned step', profile, earnedHistory(), 'You owned 15 kg. Today: 18 kg for 8.', '8 · 8 · 8 @ 18 kg each'],
      ['ceiling', { ...profile, loads: { Dumbbell: [10, 15] } }, earnedHistory(),
        'Top of your rack — own 15 kg for 10.', '10 · 10 · 10 @ 15 kg each'],
      ['unfinished', profile, unfinishedHistory(), 'Same as last time: 15 kg for 10.', '10 · 10 · 10 @ 15 kg each'],
      ['first session', profile, [], 'First time on this one. Start light, log what you lift.', '8 · 8 · 8'],
      ['lb', { ...profile, unit: 'lb' }, earnedHistory(), 'You owned 33 lb. Today: 39.5 lb for 8.', '8 · 8 · 8 @ 39.5 lb each'],
    ];
    for (const [label, who, history, line, target] of cases) {
      const today = plain(renderToday(Today, who, history));
      assert.ok(today.includes(line), `${label}: coach line`);
      assert.ok(line.split(/\s+/).length <= 12, `${label}: short`);
      assert.ok(today.includes(`Today’s target ${target} `), `${label}: target`);
      assert.doesNotMatch(today, /One step up|Repeat that/, `${label}: the precise reason lives in Why`);
    }
  });
});

test('"Why this target" keeps the precise reason', async () => {
  const history = earnedHistory();
  await withServer(async (load) => {
    const { WhySheet } = await load('/src/screens/Sheets.tsx');
    const why = plain(renderToStaticMarkup(createElement(WhySheet as never, { exerciseId: 'dumbbell-floor-press',
      exerciseName: 'Floor press', planned: [{ weight: 18, reps: 8 }], history, unit: 'kg', onClose: noop,
      reason: targetReason('dumbbell-floor-press', profile, history, 'kg') })));
    assert.match(why, /3 sets at 10 reps, 15 kg\. One step up \(\+3 kg\); reps restart at 8\./);
  });
});

const startControls = (html: string) =>
  (html.match(/<button[\s\S]*?<\/button>/g) ?? []).filter((button) => /Start|Resume/.test(button));

test('Today has exactly one Start/Resume: the tab action; the dock is Preview', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { TabBar } = await load('/src/components/ui/Chrome.tsx');
    const live = liveAdapted(adapted, profile, []);
    for (const current of [null, liveSession([])]) {
      const html = renderToday(Today, profile, [], current) + renderToStaticMarkup(createElement(TabBar as never,
        { active: 'today', onChange: noop, workoutAction: { ...tabBarAction(current, live), onActivate: noop } }));
      assert.equal(startControls(html).length, 1, current ? 'resume' : 'start');
      assert.equal(html.includes('Preview workout'), !current, 'preview only before a session opens');
    }
  });
});

type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
function findButton(node: unknown, text: string): Node | null {
  if (Array.isArray(node)) return node.map((child) => findButton(child, text)).find(Boolean) ?? null;
  const element = node as Node;
  if (!element?.props) return null;
  if (element.type === 'button' && JSON.stringify(element.props.children ?? '').includes(text)) return element;
  return findButton(element.props.children, text);
}

test('Preview lists live targets and its Start calls the start it was given', async () => {
  await withServer(async (load) => {
    const { DaySheet } = await load('/src/screens/Sheets.tsx');
    const exercises = liveExercises(adapted, profile, earnedHistory());
    let started = 0;
    const props = { name: 'Full Body A', minutes: 35, exercises, unit: 'kg', onClose: noop };
    const sheet = (DaySheet as (p: object) => unknown)({ ...props, onStart: () => { started += 1; } });
    assert.match(plain(renderToStaticMarkup(sheet as never)), /18 kg each/);
    findButton(sheet, 'Start workout')?.props?.onClick?.();
    assert.equal(started, 1);
    assert.equal(findButton((DaySheet as (p: object) => unknown)(props), 'Start workout'), null, 'no start without one');
  });
});

test('Plan available rows show the live prescription, not the fixture', () => {
  const press = exerciseById('dumbbell-floor-press');
  const plank = exerciseById('plank');
  assert.ok(press && plank);
  assert.equal(catalogRowMeta(press, profile, [], 'kg'), '3 sets · 8 reps', 'uncalibrated: no load');
  assert.equal(catalogRowMeta(press, profile, earnedHistory(), 'kg'), '3 sets · 8 reps · 18 kg each');
  assert.equal(catalogRowMeta(plank, profile, [], 'kg'), '2 sets · 45s', 'holds keep seconds');
});

test('the logger names the equipment, not bodyweight, and shows the prescribed reps', async () => {
  let session = liveSession([]);
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Train } = await server.ssrLoadModule('/src/screens/TrainScreen.tsx');
    const render = (current: WorkoutRecord) => plain(renderToStaticMarkup(createElement(Train, {
      session: current, history: [], now: Date.now(), loadOptions: RACK, unit: 'kg', onMinimize: noop,
      onFinish: noop, onUpdateSet: noop, onLogNext: noop, onToggleRestPause: noop, onExtendRest: noop,
      onSwap: noop, onSkip: noop, onReturn: noop })));
    const press = render(session);
    assert.doesNotMatch(press, /Bodyweight · Floor mat/);
    assert.match(press, /Dumbbell · Floor mat/);
    for (let index = 0; index < 3; index += 1) session = logSet(session, 0, index, `2026-11-02T10:0${index + 1}:00.000Z`);
    const squat = render(session);
    assert.match(squat, /Goblet squat/i);
    assert.match(squat, /Today’s target: 8 · 8 · 8/);
  } finally { await server.close(); }
});
