import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  EXPIRE_AFTER_MS,
  SUSPEND_AFTER_MS,
  applyFinish,
  createSession,
  expireOpenWorkout,
  hasNotes,
  idleFromMs,
  idleState,
  isSameWorkout,
  lastActiveIso,
  lastActiveMs,
  logSet,
  resumeSession,
  saveOpenWorkout,
  sessionProgress,
  startRest,
  toggleRestPause,
  unlinkedIfSameSlot,
  updatePerformedSet,
  withActivity,
} from '../src/lib/session.ts';
import { MAX_PAUSE_MS, parseState } from '../src/lib/validate.ts';
import { EMPTY_STATE, mergeImport } from '../src/lib/storage.ts';
import { progressTotals, trainedMinutes } from '../src/lib/progressTotals.ts';
import { HIDDEN_RESUME_KEY, readHiddenResume, writeHiddenResume } from '../src/lib/hiddenResume.ts';
import { agoLabel, menuStatus, rowKind, setsLabel } from '../src/lib/openWorkout.ts';
import type { AppState, Profile, WorkoutExercise, WorkoutRecord } from '../src/types.ts';

// #430: an open workout is active, suspended (10 idle minutes) or expired (6 idle hours, or idle past local
// midnight), all derived from timestamps with the clock injected. Expiry saves sets byte-for-byte and never
// moves the plan; the user's own Save advances it exactly once. Zero logged sets lost is the promise.

const MIN = 60_000;
const local = (y: number, m: number, d: number, h: number, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);
// A morning start, so six idle hours stay on the same local day unless a test crosses midnight on purpose.
const T0 = local(2026, 11, 12, 8, 0);
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

const exercises = (): WorkoutExercise[] => [
  { exerciseId: 'goblet-squat', name: 'Goblet squat', planned: [{ weight: 20, reps: 10 }, { weight: 20, reps: 10 }],
    performed: [{ weight: 20, reps: 10, done: false, completedAt: null }, { weight: 20, reps: 10, done: false, completedAt: null }] },
  { exerciseId: 'dumbbell-row', name: 'Dumbbell row', planned: [{ weight: 15, reps: 10 }],
    performed: [{ weight: 15, reps: 10, done: false, completedAt: null }] },
];
const open = (overrides: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  ...createSession({ id: 'w1', name: 'Push', dayIndex: 0, slotId: 'push', slotSeq: 0, planRevision: 1, durationMin: 45,
    exercises: exercises(), now: T0.toISOString() }),
  ...overrides,
});
/** Logs set `setIndex` of exercise 0 at `offsetMs`, stamping activity as the app does, rest skipped. */
const logged = (workout: WorkoutRecord, setIndex: number, offsetMs: number): WorkoutRecord => ({
  ...logSet(workout, 0, setIndex, iso(offsetMs)),
  restStartedAt: null,
  lastActiveAt: iso(offsetMs),
});

const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'],
  exclusions: [], loads: {}, name: 'Alex', unit: 'kg', sessionMinutes: 45 } as unknown as Profile;
const plan = [
  { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
  { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
  { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
] as AppState['plan'];
const stateWith = (current: WorkoutRecord | null, history: WorkoutRecord[] = []): AppState =>
  ({ ...EMPTY_STATE, profile, plan, planRevision: 1, programCursor: { revision: 1, seq: 0 }, history, current });

/* ---------- idle model ---------- */

test('active until 10 minutes idle, suspended from exactly 10:00, expired from exactly 6:00:00', () => {
  const w = logged(open(), 0, 0);
  assert.equal(idleState(w, at(SUSPEND_AFTER_MS - 1).getTime()), 'active', '9:59.999');
  assert.equal(idleState(w, at(SUSPEND_AFTER_MS).getTime()), 'suspended', '10:00');
  assert.equal(idleState(w, at(EXPIRE_AFTER_MS - 1).getTime()), 'suspended', '5:59:59.999');
  assert.equal(idleState(w, at(EXPIRE_AFTER_MS).getTime()), 'expired', '6:00:00');
  assert.equal(SUSPEND_AFTER_MS, 10 * MIN);
  assert.equal(EXPIRE_AFTER_MS, 6 * 60 * MIN);
});

test('a running rest counts as activity until its planned end; a paused rest does not', () => {
  const rested = startRest(logged(open(), 0, 0), iso(0), 180);
  assert.equal(idleFromMs(rested), at(180_000).getTime());
  assert.equal(idleState(rested, at(180_000 + SUSPEND_AFTER_MS - 1).getTime()), 'active', 'idle counts from rest end');
  assert.equal(idleState(rested, at(180_000 + SUSPEND_AFTER_MS).getTime()), 'suspended');
  const paused = toggleRestPause(rested, iso(30_000));
  assert.equal(idleFromMs(paused), lastActiveMs(paused), 'a paused rest is not resting');
  assert.equal(idleState(paused, at(SUSPEND_AFTER_MS).getTime()), 'suspended');
});

test('midnight: 11:58 PM to 12:03 AM stays active; 11:40 PM to 12:05 AM expires', () => {
  const late = (h: number, min: number, d = 12) => local(2026, 11, d, h, min).getTime();
  const at2358 = open({ date: new Date(late(23, 50)).toISOString(), lastActiveAt: new Date(late(23, 58)).toISOString() });
  assert.equal(idleState(at2358, late(0, 3, 13)), 'active', 'five minutes is active whatever the date');
  const at2340 = open({ date: new Date(late(23, 30)).toISOString(), lastActiveAt: new Date(late(23, 40)).toISOString() });
  assert.equal(idleState(at2340, late(23, 59)), 'suspended', 'same day, 19 minutes');
  assert.equal(idleState(at2340, late(0, 5, 13)), 'expired', 'idle across midnight');
});

test('a clock set back (activity in the future) reads suspended and never expires', () => {
  const w = logged(open(), 0, 2 * 60 * MIN);
  assert.equal(idleState(w, at(2 * 60 * MIN - 4 * MIN).getTime()), 'active', 'within the 5 min slack');
  assert.equal(idleState(w, at(0).getTime()), 'suspended');
  assert.equal(expireOpenWorkout(stateWith(w), at(0).getTime()), null);
  assert.equal(idleState(open({ date: 'not a date', lastActiveAt: undefined }), T0.getTime()), 'suspended', 'unreadable: never expires');
});

test('older records with no lastActiveAt derive it from the latest done set, the rest start or the start', () => {
  const legacy = logSet(open(), 0, 0, iso(7 * MIN));
  assert.equal(legacy.lastActiveAt, undefined);
  assert.equal(lastActiveMs(legacy), at(7 * MIN).getTime());
  assert.equal(lastActiveMs(open()), T0.getTime());
  assert.equal(lastActiveMs({ ...legacy, lastActiveAt: iso(9 * MIN) }), at(9 * MIN).getTime(), 'the stamp wins');
});

test('lastActiveIso is clamped between the start and now', () => {
  const w = logged(open(), 0, 20 * MIN);
  assert.equal(lastActiveIso(w, at(60 * MIN).getTime()), iso(20 * MIN));
  assert.equal(lastActiveIso(w, at(5 * MIN).getTime()), iso(5 * MIN), 'never after now');
  assert.equal(lastActiveIso({ ...w, lastActiveAt: iso(-60 * MIN) }, at(60 * MIN).getTime()), iso(0), 'never before the start');
});

/* ---------- activity stamps ---------- */

test('withActivity stamps a change to the same open workout and nothing else', () => {
  const w = open();
  const before = stateWith(w);
  const now = iso(3 * MIN);
  const changed = { ...before, current: logSet(w, 0, 0, now) };
  assert.equal(withActivity(before, changed, now).current?.lastActiveAt, now);
  assert.equal(withActivity(before, before, now), before, 'no change: no write');
  const otherField = { ...before, todayOverride: null };
  assert.equal(withActivity(before, otherField, now), otherField, 'same workout object: no stamp');
  const finished = { ...before, current: null };
  assert.equal(withActivity(before, finished, now), finished, 'closing it is not a stamp');
  const other = { ...before, current: { ...w, id: 'w2' } };
  assert.equal(withActivity(before, other, now).current?.lastActiveAt, undefined, 'a new workout is not stamped');
});

test('resume adds the time away to pausedMs, capped; an active workout only gets the stamp', () => {
  const w = logged(open(), 0, 0);
  const soon = resumeSession(w, at(4 * MIN).getTime());
  assert.equal(soon.pausedMs, 0, 'active: no gap');
  assert.equal(soon.lastActiveAt, iso(4 * MIN));
  const later = resumeSession(w, at(40 * MIN).getTime());
  assert.equal(later.pausedMs, 40 * MIN);
  assert.equal(idleState(later, at(40 * MIN).getTime()), 'active');
  const huge = resumeSession({ ...w, pausedMs: MAX_PAUSE_MS - MIN }, at(5 * 60 * MIN).getTime());
  assert.equal(huge.pausedMs, MAX_PAUSE_MS, 'never past what the loader keeps');
  // A resumed rest: the gap starts at the rest's planned end, not the set.
  const rested = startRest(w, iso(0), 120);
  assert.equal(resumeSession(rested, at(30 * MIN).getTime()).pausedMs, 30 * MIN - 120_000);
  // Sets are never touched by a resume.
  assert.deepEqual(later.exercises, w.exercises);
});

test('totals and the recap leave out pausedMs', () => {
  const w: WorkoutRecord = { ...logged(open(), 0, 0), status: 'completed', endedAt: iso(70 * MIN), pausedMs: 30 * MIN };
  assert.deepEqual(trainedMinutes(w), { minutes: 40, planned: false });
  assert.equal(progressTotals([w]).minutes, 40);
  const recap = readFileSync(new URL('../src/screens/RecapScreen.tsx', import.meta.url), 'utf8');
  assert.match(recap, /const away = \(workout\.pausedMs \?\? 0\) \/ 60000;/);
  assert.match(recap, /Math\.round\(span - away\)/);
});

/* ---------- expiry ---------- */

test('expiry saves done sets byte-identical, ends at last activity, never moves the plan, and is idempotent', () => {
  const w = logged(logged(open(), 0, 0), 1, 3 * MIN);
  const state = stateWith(w);
  const now = at(3 * MIN + EXPIRE_AFTER_MS).getTime();
  assert.equal(expireOpenWorkout(state, now - 1), null, 'not yet');
  const result = expireOpenWorkout(state, now);
  assert.ok(result);
  assert.equal(result.outcome, 'saved');
  assert.equal(result.sets, 2);
  const saved = result.state.history[0];
  assert.equal(result.state.current, null);
  assert.equal(saved.id, 'w1');
  assert.equal(saved.status, 'completed');
  assert.equal(saved.endedAt, iso(3 * MIN), 'ends at last activity, not at expiry');
  assert.equal(saved.completedEarly, true);
  assert.equal(JSON.stringify(saved.exercises), JSON.stringify(w.exercises), 'every set byte-identical');
  assert.deepEqual(result.state.programCursor, state.programCursor, 'no plan advance');
  assert.equal(sessionProgress(saved).done, 2);
  // Run again on the result, or on a state where another tab already saved it.
  assert.equal(expireOpenWorkout(result.state, now), null);
  const raced = expireOpenWorkout({ ...result.state, current: w }, now);
  assert.equal(raced?.outcome, 'already-saved');
  assert.equal(raced?.state.history.length, 1, 'never saved twice');
});

test('an empty workout: with no notes it just closes; with notes it waits until local midnight', () => {
  const empty = open();
  const sixHours = at(EXPIRE_AFTER_MS).getTime();
  const plain = expireOpenWorkout(stateWith(empty), sixHours);
  assert.equal(plain?.outcome, 'cancelled');
  assert.equal(plain?.state.history.length, 0);
  assert.equal(hasNotes(empty), false);
  const noted = { ...empty, exercises: empty.exercises.map((e, i) => (i === 0 ? { ...e, note: 'Left knee' } : e)) };
  assert.equal(hasNotes(noted), true);
  const morning = { ...noted, date: local(2026, 11, 12, 6).toISOString(), lastActiveAt: local(2026, 11, 12, 6).toISOString() };
  assert.equal(expireOpenWorkout(stateWith(morning), local(2026, 11, 12, 13).getTime()), null, 'same day: still offered');
  const nextDay = expireOpenWorkout(stateWith(morning), local(2026, 11, 13, 0, 1).getTime());
  assert.equal(nextDay?.outcome, 'closed');
  assert.equal(nextDay?.state.history.length, 0);
});

/* ---------- the user's own Save and starting ---------- */

test('saveOpenWorkout advances the plan exactly once and ends at last activity', () => {
  const w = logged(open(), 0, 5 * MIN);
  const state = stateWith(w);
  const saved = saveOpenWorkout(state, 'w1', at(50 * MIN).getTime());
  assert.equal(saved.current, null);
  assert.equal(saved.history[0].endedAt, iso(5 * MIN));
  assert.equal(saved.programCursor?.seq, 1);
  assert.equal(saveOpenWorkout(saved, 'w1', at(51 * MIN).getTime()), saved, 'no open workout: no change');
  assert.equal(saveOpenWorkout(state, 'other', at(50 * MIN).getTime()), state, 'wrong id: no change');
  // A restored duplicate of the same finish cannot advance again.
  const again = applyFinish({ ...saved, current: w }, 'w1', { early: false, now: iso(52 * MIN) });
  assert.equal(again.programCursor?.seq, 1);
  assert.equal(again.history.length, 1);
});

test('isSameWorkout: same slot, plan, name, length and setup resume; anything else is a different workout', () => {
  const w = open();
  const link = { slotId: 'push', slotSeq: 0, planRevision: 1 };
  const same = { name: 'Push', minutes: 45 };
  assert.equal(isSameWorkout(w, link, same), true);
  assert.equal(isSameWorkout(w, { ...link, slotSeq: 1 }, same), false, 'another slot');
  assert.equal(isSameWorkout(w, { ...link, planRevision: 2 }, same), false, 'another plan');
  assert.equal(isSameWorkout(w, link, { ...same, name: 'Pull' }), false);
  assert.equal(isSameWorkout(w, link, { ...same, minutes: 30 }), false, 'another length');
  assert.equal(isSameWorkout(w, link, { ...same, setup: 'hotel' }), false, 'other gear');
  assert.equal(isSameWorkout(w, { planRevision: 1 }, same), false, 'a described day is never the same');
  assert.equal(isSameWorkout({ ...w, slotSeq: undefined }, link, same), false);
});

test('unlinkedIfSameSlot: a new workout for the slot just saved starts unlinked, so the plan cannot advance twice', () => {
  const w = open();
  assert.deepEqual(unlinkedIfSameSlot({ slotId: 'push', slotSeq: 0, planRevision: 1 }, w), { planRevision: 1 });
  const next = { slotId: 'pull', slotSeq: 1, planRevision: 1 };
  assert.equal(unlinkedIfSameSlot(next, w), next);
  assert.deepEqual(unlinkedIfSameSlot({ slotSeq: 0 }, { ...w, planRevision: undefined }), {});
});

/* ---------- storage ---------- */

test('lastActiveAt survives a save and load; a bad one is dropped, never fails the record', () => {
  const w = logged(open(), 0, 2 * MIN);
  const round = parseState(JSON.stringify({ ...stateWith(w), version: 2 }));
  assert.ok(round.ok, round.ok ? '' : round.error);
  if (!round.ok) return;
  assert.equal(round.state.current?.lastActiveAt, iso(2 * MIN));
  const bad = parseState(JSON.stringify({ ...stateWith({ ...w, lastActiveAt: 'soon' }), version: 2 }));
  assert.ok(bad.ok);
  if (!bad.ok) return;
  assert.equal(bad.state.current?.lastActiveAt, undefined);
  assert.equal(bad.state.current?.exercises[0].performed[0].done, true);
});

test('restore: the same open workout keeps the later lastActiveAt; a different one with sets is saved, not dropped', () => {
  const mine = logged(open(), 0, 10 * MIN);
  const theirs = { ...logged(open(), 0, 1 * MIN), lastActiveAt: iso(30 * MIN) };
  const same = mergeImport(stateWith(mine), stateWith(theirs), at(40 * MIN).getTime());
  assert.equal(same.state.current?.lastActiveAt, iso(30 * MIN));
  assert.equal(same.state.history.length, 0);

  const other = { ...logged(logged(open(), 0, 0), 1, MIN), id: 'w-backup' };
  const kept = mergeImport(stateWith(mine), stateWith(other), at(40 * MIN).getTime());
  assert.equal(kept.state.current?.id, 'w1', 'this browser keeps its own open workout');
  assert.equal(kept.summary.backupSessionSavedSets, 2);
  const saved = kept.state.history.find((workout) => workout.id === 'w-backup');
  assert.ok(saved);
  assert.equal(saved.status, 'completed');
  assert.equal(JSON.stringify(saved.exercises), JSON.stringify(other.exercises), 'sets byte-identical');
  assert.deepEqual(kept.state.programCursor, { revision: 1, seq: 0 }, 'no plan advance');

  const emptyBackup = mergeImport(stateWith(mine), stateWith({ ...open(), id: 'w-empty' }), at(40 * MIN).getTime());
  assert.equal(emptyBackup.summary.backupSessionSavedSets, undefined);
  assert.equal(emptyBackup.state.history.length, 0);
});

test('hide-for-now is one device-local id; a refusing store only shows the row', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); } };
  assert.equal(readHiddenResume(store), null);
  writeHiddenResume('w1', store);
  assert.equal(data.get(HIDDEN_RESUME_KEY), 'w1');
  assert.equal(readHiddenResume(store), 'w1');
  writeHiddenResume(null, store);
  assert.equal(readHiddenResume(store), null);
  const refusing = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => { throw new Error('no'); } };
  assert.doesNotThrow(() => writeHiddenResume('w1', refusing));
  assert.equal(readHiddenResume(refusing), null);
  assert.equal(readHiddenResume(null), null);
});

/* ---------- words ---------- */

test('row kind, labels and the menu status line', () => {
  const empty = open();
  const one = logged(empty, 0, 0);
  assert.equal(rowKind(empty, T0.getTime()), 'empty');
  assert.equal(rowKind(one, at(MIN).getTime()), 'in-progress');
  assert.equal(rowKind(one, at(SUSPEND_AFTER_MS).getTime()), 'paused');
  assert.equal(setsLabel(1), '1 set');
  assert.equal(setsLabel(3), '3 sets');
  assert.equal(agoLabel(0, 30_000), 'just now');
  assert.equal(agoLabel(0, 25 * MIN), '25 min ago');
  assert.equal(agoLabel(0, 3 * 60 * MIN), '3 h ago');
  assert.equal(agoLabel(Number.NaN, 0), 'a while ago');
  assert.equal(menuStatus(one, at(25 * MIN).getTime()), 'Paused · last set 25 min ago');
  assert.equal(menuStatus(empty, at(2 * MIN).getTime()), 'Open · opened 2 min ago');
});

const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};
async function withOpenWorkout(run: (m: Record<string, (props: object) => unknown>) => void) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    run(await server.ssrLoadModule('/src/components/OpenWorkout.tsx'));
  } finally {
    await server.close();
  }
}
const render = (component: (props: object) => unknown, props: object) =>
  renderToStaticMarkup(createElement(component as never, props as never));

test('the resume row: one quiet line with Resume and More, never a primary button', async () => {
  const one = logged(open(), 0, 0);
  await withOpenWorkout(({ ResumeRow }) => {
    const live = render(ResumeRow, { workout: one, now: at(MIN).getTime(), onResume: noop, onMore: noop });
    assert.match(plainText(live), /^Push in progress · 1 of 3 sets Resume$/);
    assert.match(live, /class="rrow__go"[^>]*>Resume</);
    assert.match(live, /aria-label="More for Push"/);
    assert.doesNotMatch(live, /pill-primary|class="primary"/);
    assert.match(plainText(render(ResumeRow, { workout: one, now: at(20 * MIN).getTime(), onResume: noop, onMore: noop })), /Push paused · 1 of 3 sets/);
    assert.match(plainText(render(ResumeRow, { workout: open(), now: T0.getTime(), onResume: noop, onMore: noop })), /Push open · no sets logged/);
  });
});

test('the menu offers Save only with sets; discard confirms with the count; the expiry note never names a next day', async () => {
  const two = logged(logged(open(), 0, 0), 1, MIN);
  await withOpenWorkout(({ WorkoutMenuSheet, ExpiryNote }) => {
    const withSets = plainText(render(WorkoutMenuSheet, { workout: two, now: at(30 * MIN).getTime(), onSave: noop, onHide: noop, onDiscard: noop, onClose: noop }));
    assert.match(withSets, /Push · 2 of 3 sets/);
    assert.match(withSets, /Paused · last set 29 min ago/);
    assert.match(withSets, /Save 2 sets and finish/);
    assert.match(withSets, /Hide for now/);
    assert.match(withSets, /Discard workout/);
    const none = plainText(render(WorkoutMenuSheet, { workout: open(), now: T0.getTime(), onSave: noop, onHide: noop, onDiscard: noop, onClose: noop }));
    assert.doesNotMatch(none, /Save/);
    assert.match(none, /Push · no sets logged/);
    assert.match(plainText(render(ExpiryNote, { kind: 'saved', sets: 2, onDismiss: noop })), /Saved your paused workout: 2 sets\. Find it in Progress\./);
    assert.match(plainText(render(ExpiryNote, { kind: 'closed', sets: 0, onDismiss: noop })), /Closed your empty workout\. Its notes were not saved\./);
  });
});

test('start conflict: switch wording, and the notes-only variant offers Back first', async () => {
  await withOpenWorkout(({ StartConflictSheet }) => {
    const sw = plainText(render(StartConflictSheet, { openName: 'Push', sets: 2, nextName: 'Legs', action: 'switch',
      onSaveAndStart: noop, onBack: noop, onDiscardAndStart: noop }));
    assert.match(sw, /Save 2 sets and switch to Legs/);
    const notes = render(StartConflictSheet, { openName: 'Push', sets: 0, nextName: 'Legs', onSaveAndStart: noop, onBack: noop, onDiscardAndStart: noop });
    assert.match(plainText(notes), /It has notes but no sets/);
    assert.match(notes, /class="pill-primary"[^>]*>Back to Push/);
    assert.match(plainText(notes), /Discard and start Legs/);
  });
});

test('Ask with a workout open: four ways back, then the plan question; it never starts a workout', async () => {
  const one = logged(open(), 0, 0);
  await withOpenWorkout(({ WorkoutAskSheet }) => {
    const html = render(WorkoutAskSheet, { workout: one, voice: false, onLogSet: noop, onSwap: noop, onBack: noop, onFinish: noop,
      onVoice: noop, onText: noop, onClose: noop });
    const text = plainText(html);
    assert.match(text, /Log a set Set 2 of Goblet squat/);
    assert.match(text, /Swap this exercise/);
    assert.match(text, /Back to my workout/);
    assert.match(text, /Finish workout Save 1 set or discard/);
    assert.match(text, /Or ask about today(?:'|&#x27;)s plan/);
    assert.doesNotMatch(html, /aria-label="Ask by voice"/, 'no mic when voice is unavailable');
    assert.doesNotMatch(text, /Start/);
  });
});

/* ---------- App wiring (source checks for paths a render cannot reach) ---------- */

test('App: real actions go through act (withActivity); expiry and visibility read the injected clock', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const act = \(updater: \(currentState: AppState\) => AppState\) =>\s*setState\(\(previous\) => withActivity\(previous, updater\(previous\), stampNow\(\)\)\);/);
  assert.match(app, /expireOpenWorkout\(state, now\)/);
  assert.match(app, /addEventListener\('visibilitychange'/);
  assert.match(app, /addEventListener\('pageshow'/);
  assert.doesNotMatch(app, /tabBarAction|DiscardSessionSheet|unfinishedSince|workoutAction/, 'the retired paths are gone');
});
