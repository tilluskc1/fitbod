// (#372) A short note per exercise: saved on that exercise in the session, shown next time as "Last time: …".
import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { exerciseActions } from '../src/lib/exerciseActions.ts';
import { cleanNote, lastNote, MAX_NOTE, setExerciseNote } from '../src/lib/notes.ts';
import { completeSession, createSession, logSet, swapPendingExercise } from '../src/lib/session.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, WorkoutRecord } from '../src/types.ts';

function open(id = 'w1', now = '2026-11-01T10:00:00.000Z'): WorkoutRecord {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes: 35, equipment: 'home' }, [], undefined);
  return createSession({ id, name: adapted.name, dayIndex: 0, exercises: toWorkoutExercises(adapted), now });
}

function finish(session: WorkoutRecord, now: string): WorkoutRecord {
  return completeSession(logSet(session, 0, 0, now), { early: true, now });
}

/* ---------- save, clear, trim, cap ---------- */

test('a note is saved trimmed on that exercise only', () => {
  const session = open();
  const id = session.exercises[0].exerciseId;
  const next = setExerciseNote(session, 0, id, '  use pin 6  ');
  assert.equal(next.exercises[0].note, 'use pin 6');
  assert.equal(next.exercises[1].note, undefined);
  assert.equal(session.exercises[0].note, undefined, 'the old session object is not mutated');
});

test('an empty or blank note removes it', () => {
  const session = setExerciseNote(open(), 0, open().exercises[0].exerciseId, 'seat 4');
  const id = session.exercises[0].exerciseId;
  for (const blank of ['', '   ']) {
    const cleared = setExerciseNote(session, 0, id, blank);
    assert.equal('note' in cleared.exercises[0], false, `"${blank}" removes the field`);
  }
});

test('a note is capped at 120 characters', () => {
  assert.equal(MAX_NOTE, 120);
  const long = 'x'.repeat(200);
  assert.equal(cleanNote(long)?.length, 120);
  assert.equal(cleanNote('a'.repeat(120)), 'a'.repeat(120));
  assert.equal(cleanNote('  '), undefined);
});

test('a stale index (the exercise moved) changes nothing', () => {
  const session = open();
  const next = setExerciseNote(session, 0, 'not-this-exercise', 'use pin 6');
  assert.equal(next, session);
});

test('the note action reads Add note, then Edit note, and needs a session', () => {
  const add = exerciseActions(3, 0, true, false).find((action) => action.id === 'note');
  assert.equal(add?.label, 'Add note');
  assert.equal(add?.blockedReason, undefined);
  assert.equal(exerciseActions(3, 0, true, false, true).find((action) => action.id === 'note')?.label, 'Edit note');
  // Every set logged, or skipped for today: a note can still be written.
  assert.equal(exerciseActions(0, 3, true, false).find((action) => action.id === 'note')?.blockedReason, undefined);
  assert.equal(exerciseActions(3, 0, true, true).find((action) => action.id === 'note')?.blockedReason, undefined);
  assert.ok(exerciseActions(3, 0, false, false).find((action) => action.id === 'note')?.blockedReason);
});

/* ---------- last note lookup ---------- */

test('last note comes from the most recent finished session with a note on that exercise', () => {
  const id = open().exercises[0].exerciseId;
  const oldest = finish(setExerciseNote(open('w1', '2026-11-01T10:00:00.000Z'), 0, id, 'seat 3'), '2026-11-01T10:30:00.000Z');
  const middle = finish(setExerciseNote(open('w2', '2026-11-03T10:00:00.000Z'), 0, id, 'use pin 6'), '2026-11-03T10:30:00.000Z');
  const newest = finish(open('w3', '2026-11-05T10:00:00.000Z'), '2026-11-05T10:30:00.000Z');
  // Order in the array does not decide it; the date does.
  assert.equal(lastNote([oldest, newest, middle], id), 'use pin 6');
  assert.equal(lastNote([newest], id), undefined);
  assert.equal(lastNote([], id), undefined);
  // Another exercise in the same session never borrows it.
  assert.equal(lastNote([middle], middle.exercises[1].exerciseId), undefined);
});

test('an unfinished session is not "last time"', () => {
  const id = open().exercises[0].exerciseId;
  const active = setExerciseNote(open('w9'), 0, id, 'still going');
  assert.equal(lastNote([active], id), undefined);
});

test('a swap keeps the note on the exercise it was written on, never the replacement', () => {
  const base = logSet(open(), 0, 0, '2026-11-01T10:05:00.000Z');
  const id = base.exercises[0].exerciseId;
  const noted = setExerciseNote(base, 0, id, 'use pin 6');
  const swapped = swapPendingExercise(noted, 0, { exerciseId: 'push-up', name: 'Push-up', weight: 0, reps: 10 } as never);
  assert.equal(swapped.exercises[0].exerciseId, id);
  assert.equal(swapped.exercises[0].note, 'use pin 6');
  assert.equal(swapped.exercises[1].exerciseId, 'push-up');
  assert.equal(swapped.exercises[1].note, undefined);
  const done = completeSession(swapped, { early: true, now: '2026-11-01T10:30:00.000Z' });
  assert.equal(lastNote([done], 'push-up'), undefined);
  assert.equal(lastNote([done], id), 'use pin 6');
});

/* ---------- export, restore, validation ---------- */

const withHistory = (history: WorkoutRecord[]): AppState => ({ ...EMPTY_STATE, history });

test('export then import keeps the note', () => {
  const id = open().exercises[0].exerciseId;
  const workout = finish(setExerciseNote(open(), 0, id, 'use pin 6'), '2026-11-01T10:30:00.000Z');
  const parsed = parseState(serializeExport(withHistory([workout])));
  assert.ok(parsed.ok);
  assert.equal(parsed.state.history[0].exercises[0].note, 'use pin 6');
  assert.equal(lastNote(parsed.state.history, id), 'use pin 6');
});

test('an old record without a note loads and shows nothing', () => {
  const workout = finish(open(), '2026-11-01T10:30:00.000Z');
  const result = validateState(withHistory([workout]));
  assert.ok(result.ok);
  assert.equal('note' in result.state.history[0].exercises[0], false);
  assert.equal(lastNote(result.state.history, workout.exercises[0].exerciseId), undefined);
});

test('an invalid note on import is dropped, the record is kept', () => {
  const workout = finish(open(), '2026-11-01T10:30:00.000Z');
  for (const bad of [42, null, '', '   ', 'x'.repeat(121), { text: 'hi' }]) {
    const raw = JSON.parse(JSON.stringify(withHistory([workout])));
    raw.history[0].exercises[0].note = bad;
    const result = validateState(raw);
    assert.ok(result.ok, `record with note ${JSON.stringify(bad)} still loads`);
    if (result.ok) assert.equal('note' in result.state.history[0].exercises[0], false, `drops ${JSON.stringify(bad)}`);
  }
  const raw = JSON.parse(JSON.stringify(withHistory([workout])));
  raw.history[0].exercises[0].note = '  seat 4 ';
  const trimmed = validateState(raw);
  assert.ok(trimmed.ok);
  if (trimmed.ok) assert.equal(trimmed.state.history[0].exercises[0].note, 'seat 4');
});
