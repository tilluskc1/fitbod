import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { swapCandidateFor } from '../src/lib/adapt.ts';
import { prescribeExercise } from '../src/lib/progression.ts';
import { createSession, logSet, swapPendingExercise } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// UI7-10 (#152): a replacement starts from its own prescription, never the original's,
// and sets already logged stay under the exercise they were logged on.

const profile: Profile = {
  goal: 'Build Muscle',
  experience: 'Intermediate',
  daysPerWeek: 3,
  equipment: ['Dumbbell'],
  support: [],
  exclusions: [],
  loads: {},
};

const incline = exerciseById('incline-dumbbell-press')!;
const pushup = exerciseById('push-up')!;

const history: WorkoutRecord[] = [
  {
    id: 'h1',
    name: 'Push',
    dayIndex: 0,
    startedAt: '2026-11-01T10:00:00.000Z',
    completedAt: '2026-11-01T10:40:00.000Z',
    exercises: [
      {
        exerciseId: incline.id,
        name: incline.name,
        planned: [{ weight: 30, reps: 8 }, { weight: 30, reps: 8 }, { weight: 30, reps: 8 }],
        performed: [
          { weight: 30, reps: 8, done: true },
          { weight: 30, reps: 8, done: true },
          { weight: 30, reps: 8, done: true },
        ],
      },
    ],
  } as WorkoutRecord,
];

function openSession(): WorkoutRecord {
  const planned = [{ weight: 30, reps: 9 }, { weight: 30, reps: 9 }, { weight: 30, reps: 9 }];
  return createSession({
    id: 's1',
    name: 'Push',
    dayIndex: 0,
    exercises: [{ exerciseId: incline.id, name: incline.name, planned, performed: planned.map((s) => ({ ...s, done: false })) }],
    now: '2026-11-07T10:00:00.000Z',
  });
}

test('incline press to push-up: replacement takes push-up prescription, not the press load', () => {
  let session = openSession();
  session = logSet(session, 0, 0, '2026-11-07T10:05:00.000Z');
  const candidate = swapCandidateFor(pushup, profile, history, session);
  const own = prescribeExercise(pushup, profile, history, false);
  assert.deepEqual({ weight: candidate.weight, reps: candidate.reps }, { weight: own.weight, reps: own.reps });
  assert.notEqual(candidate.weight, 30, 'press load must not carry over to push-ups');

  const swapped = swapPendingExercise(session, 0, candidate);
  const press = swapped.exercises.find((e) => e.exerciseId === incline.id);
  const push = swapped.exercises.find((e) => e.exerciseId === pushup.id);
  assert.ok(press && push);
  // The logged set stays with the press.
  assert.equal(press.performed.length, 1);
  assert.deepEqual(press.performed[0], { ...press.performed[0], weight: 30, reps: 9, done: true });
  // The two pending sets moved to push-ups at push-up's own numbers.
  assert.equal(push.performed.length, 2);
  for (const set of push.planned) assert.deepEqual(set, { weight: own.weight, reps: own.reps });
  assert.ok(push.performed.every((set) => !set.done));
});

test('swapping back to the press uses the press prescription, not the push-up numbers', () => {
  const session = openSession();
  const candidate = swapCandidateFor(incline, profile, history, session);
  const own = prescribeExercise(incline, profile, history, false);
  assert.deepEqual({ weight: candidate.weight, reps: candidate.reps }, { weight: own.weight, reps: own.reps });
});
