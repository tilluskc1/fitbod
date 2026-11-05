import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_BODY_A } from '../src/data/flagship.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, toWorkoutExercises } from '../src/lib/adapt.ts';
import { lastExercisePerformance, prescribeExercise } from '../src/lib/progression.ts';
import { applyFinish, createSession, logSet, updatePerformedSet } from '../src/lib/session.ts';
import { EMPTY_STATE, loadState, saveState } from '../src/lib/storage.ts';
import type { Profile } from '../src/types.ts';

const profile: Profile = {
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: {},
};

function finishPressAndReload(minutes: number) {
  const adapted = adaptWorkout(FULL_BODY_A, { minutes, equipment: 'home' });
  let current = createSession({ id: 'progression-session', name: adapted.name,
    dayIndex: 0, durationMin: minutes, exercises: toWorkoutExercises(adapted),
    now: '2026-10-31T12:00:00.000Z' });
  for (let index = 0; index < current.exercises[0].planned.length; index += 1) {
    current = logSet(updatePerformedSet(current, 0, index, { weight: 15, reps: 10 }),
      0, index, `2026-10-31T12:0${index + 1}:00.000Z`);
  }
  const finished = applyFinish({ ...EMPTY_STATE, profile, current }, current.id,
    { early: true, now: '2026-10-31T12:06:00.000Z' });
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } });
  try {
    assert.equal(saveState(finished, 0).ok, true);
    const loaded = loadState();
    assert.equal(loaded.status, 'ok');
    assert.equal(JSON.stringify(loaded.state.history), JSON.stringify(finished.history));
    assert.equal(loaded.state.current, null);
    return loaded.state.history;
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('finishing a shortened workout cannot earn progression before its original target is met after reload', () => {
  const history = finishPressAndReload(20);
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  const next = prescribeExercise(press, profile, history);
  assert.equal(next.basis, 'repeat');
  assert.equal(next.weight, 15);
  assert.equal(next.reps, 10);
  assert.equal(lastExercisePerformance(history, press.id)?.plannedSets, 3);
  const saved = history[0].exercises[0];
  assert.equal(saved.originalPlannedSets, 3);
  assert.deepEqual(saved.planned, [{ weight: 15, reps: 9 }, { weight: 15, reps: 9 }]);
  assert.deepEqual(saved.performed.map(({ weight, reps, done }) => ({ weight, reps, done })),
    [{ weight: 15, reps: 10, done: true }, { weight: 15, reps: 10, done: true }]);
});

test('completing the original target still earns a load increase after finish and reload', () => {
  const history = finishPressAndReload(35);
  const press = exerciseById('dumbbell-floor-press');
  assert.ok(press);
  const saved = history[0].exercises[0];
  assert.equal(saved.originalPlannedSets, 3);
  assert.equal(saved.planned.length, 3);
  assert.equal(saved.performed.filter((set) => set.done).length, 3);
  const next = prescribeExercise(press, profile, history);
  assert.equal(next.basis, 'load-increase');
  assert.equal(next.weight, 17.5);
  assert.equal(next.reps, 8, "reps restart at the bottom of the program's 8–10 range");
});
