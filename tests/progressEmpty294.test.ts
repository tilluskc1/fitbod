import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { completeSession, createSession, updatePerformedSet } from '../src/lib/session.ts';
import { progressTotals } from '../src/lib/progressTotals.ts';
import { validateState } from '../src/lib/validate.ts';
import type { AppState, Unit, WorkoutRecord } from '../src/types.ts';

// #294: a user with no finished workouts sees one empty-state card, not 0 / 0 / 0. With history,
// the tiles read Workouts / Sets / Minutes from the stored records, and Coach agrees with them.

const START = '2026-11-08T10:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60000).toISOString();

/** A workout built the way the app builds one: log `logged` sets per exercise, then finish. */
function finished(id: string, logged: number[], minutes: number, skip: number[] = []): WorkoutRecord {
  let session = createSession({
    id,
    name: 'Upper A',
    dayIndex: 0,
    now: START,
    exercises: logged.map((count, index) => ({
      exerciseId: index === 0 ? 'goblet-squat' : 'barbell-row',
      name: index === 0 ? 'Goblet squat' : 'Barbell Row',
      planned: Array.from({ length: Math.max(5, count) }, () => ({ weight: 20, reps: 10 })),
      performed: Array.from({ length: Math.max(5, count) }, () => ({ weight: 20, reps: 10, done: false, completedAt: null })),
    })),
  });
  logged.forEach((count, exercise) => {
    for (let set = 0; set < count; set += 1) session = updatePerformedSet(session, exercise, set, { done: true }, START);
  });
  for (const index of skip) session.exercises[index].skipped = true;
  return completeSession(session, { early: true, now: at(minutes) });
}

/** A legacy record: no end time, only the planned length it was saved with. */
function legacy(id: string, sets: number, durationMin: number): WorkoutRecord {
  const record = finished(id, [sets], 10);
  return { ...record, endedAt: null, durationMin };
}

const EMPTY: AppState = { profile: null, plan: [], history: [], current: null, todayOverride: null };
function assertReal(history: WorkoutRecord[]) {
  const result = validateState({ ...EMPTY, history });
  assert.equal(result.ok, true, result.ok ? '' : result.error);
}

const profile = {
  name: 'Sam', goal: 'muscle', experience: 'intermediate', daysPerWeek: 4, sessionMinutes: 45,
  equipment: ['Dumbbell'], support: [], unit: 'kg', loads: {},
};

async function render(history: WorkoutRecord[], options: { unit?: Unit; running?: boolean } = {}) {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: Progress } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    const { default: Coach } = await server.ssrLoadModule('/src/screens/CoachScreen.tsx');
    const noop = () => {};
    const progress = renderToStaticMarkup(createElement(Progress, {
      history, unit: options.unit ?? 'kg', running: options.running ?? false,
      onExport: noop, onCorrect: noop, onDelete: noop, onFeedback: noop, onStartToday: noop,
    }));
    const coach = renderToStaticMarkup(createElement(Coach, {
      profile: { ...profile, unit: options.unit ?? 'kg' }, history,
      program: { name: 'Upper A', minutes: 45 }, onWhy: noop, onEdit: noop,
    }));
    const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return { progress, coach, progressText: text(progress), coachText: text(coach) };
  } finally {
    await server.close();
  }
}

const tiles = (html: string) =>
  [...html.matchAll(/<span class="stat-label">([^<]+)<\/span><span class="stat-value">([^<]+)<\/span>/g)]
    .map((match) => `${match[1]} ${match[2]}`);

/* ---------- the totals the tiles read ---------- */

test('totals count only finished workouts with a logged set, minutes from start to finish', () => {
  const one = finished('w1', [8, 5], 41);
  assertReal([one]);
  assert.deepEqual(progressTotals([one]), { workouts: 1, sets: 13, minutes: 41, approx: false });
  assert.deepEqual(progressTotals([]), { workouts: 0, sets: 0, minutes: 0, approx: false });
});

test('a workout whose exercises were all skipped is not a workout', () => {
  const skipped = finished('w1', [0, 0], 12, [0, 1]);
  assertReal([skipped]);
  assert.deepEqual(progressTotals([skipped]), { workouts: 0, sets: 0, minutes: 0, approx: false });
});

test('a legacy record without times counts its planned minutes and flags the total as approximate', () => {
  const old = legacy('old', 3, 30);
  assertReal([old]);
  assert.deepEqual(progressTotals([finished('new', [4], 20), old]), { workouts: 2, sets: 7, minutes: 50, approx: true });
});

test('a legacy record with neither times nor a planned length still counts, at 0 minutes', () => {
  const { durationMin: _drop, ...bare } = legacy('bare', 2, 30);
  assertReal([bare]);
  assert.deepEqual(progressTotals([bare]), { workouts: 1, sets: 2, minutes: 0, approx: true });
});

/* ---------- no finished workouts ---------- */

for (const [label, history] of [
  ['no workouts', [] as WorkoutRecord[]],
  ['only a skipped workout', [finished('s', [0, 0], 9, [0, 1])]],
  ['only an empty record', [finished('e', [0], 4)]],
] as const) {
  test(`${label}: Progress shows the empty-state card, no tiles, no zero (#294)`, async () => {
    const { progress, progressText, coach, coachText } = await render(history);
    assert.equal(tiles(progress).length, 0, 'no stat tiles');
    assert.doesNotMatch(progress, /stat-value/);
    assert.match(progressText, /Your progress starts with your first workout\./);
    assert.match(progressText, /After it, you'll see your workouts, sets and minutes here, and a chart for each lift\./);
    assert.match(progress, /<button[^>]*class="primary"[^>]*>Start today(?:'|&#x27;)s workout/);
    assert.doesNotMatch(progressText, /Your first session starts the story/, 'the chart empty state is gone');
    assert.doesNotMatch(progressText, /Working loads/, 'no chart card without a workout');
    assert.match(progress, /class="[^"]*empty-state/);

    // Coach: one line instead of the context rows.
    assert.match(coachText, /After your first workout I(?:'|&#x27;|’)ll show what changed and why\./);
    assert.doesNotMatch(coach, /context-row/);
    assert.doesNotMatch(coachText, /Sessions recorded/);
    assert.match(coachText, /A FAMILIAR STARTING POINT/);
  });
}

test('a running session and no finished one: the button reads Resume workout', async () => {
  const { progress } = await render([], { running: true });
  assert.match(progress, />Resume workout/);
  assert.doesNotMatch(progress, /Start today/);
});

/* ---------- one or more finished workouts ---------- */

for (const unit of ['kg', 'lb'] as const) {
  test(`one 41-minute workout of 13 sets reads 1 / 13 / 41 in ${unit}, and Coach agrees`, async () => {
    const history = [finished('w1', [8, 5], 41)];
    const totals = progressTotals(history);
    const { progress, progressText, coachText } = await render(history, { unit });
    assert.deepEqual(tiles(progress), [`Workouts ${totals.workouts}`, `Sets ${totals.sets}`, `Minutes ${totals.minutes}`]);
    assert.deepEqual(tiles(progress), ['Workouts 1', 'Sets 13', 'Minutes 41']);
    assert.match(progress, /<p class="stats-note">all time<\/p>/);
    assert.doesNotMatch(progressText, /includes planned time/);
    assert.doesNotMatch(progressText, /Your progress starts with your first workout/);
    assert.match(coachText, new RegExp(`Sessions recorded ${totals.workouts} `));
    assert.match(coachText, /FROM YOUR EXERCISE HISTORY/);
  });
}

test('an empty record next to a real one does not inflate either screen', async () => {
  const history = [finished('w2', [3], 25), finished('empty', [0], 3)];
  const { progress, coachText } = await render(history);
  assert.deepEqual(tiles(progress), ['Workouts 1', 'Sets 3', 'Minutes 25']);
  assert.match(coachText, /Sessions recorded 1 /);
});

test('restored legacy history: tiles at once, with the planned-time footnote', async () => {
  const history = [finished('w2', [4], 20), legacy('old', 3, 30)];
  assertReal(history);
  const { progress, progressText } = await render(history);
  assert.deepEqual(tiles(progress), ['Workouts 2', 'Sets 7', 'Minutes 50']);
  assert.match(progressText, /≈ includes planned time for older workouts\./);
});

test('Session history with no workouts says so in the new words', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { NO_WORKOUTS_YET } = await server.ssrLoadModule('/src/screens/ProgressScreen.tsx');
    assert.equal(NO_WORKOUTS_YET, 'No workouts yet. Your first one will appear here.');
  } finally {
    await server.close();
  }
});
