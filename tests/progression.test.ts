import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { generateWorkout } from '../src/lib/generator.ts';
import { programExercise } from '../src/data/flagship.ts';
import {
  availableLoads,
  describePrescription,
  incrementFor,
  lastExercisePerformance,
  nextLoad,
  prescribeExercise,
  leadCompoundId,
  repRangeFor,
  roleTarget,
} from '../src/lib/progression.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Intermediate',
    daysPerWeek: 3,
    equipment: [],
    support: [],
    exclusions: [],
    loads: {},
    ...overrides,
  };
}

function meta(exerciseId: string) {
  const exercise = EXERCISES.find((item) => item.id === exerciseId);
  assert.ok(exercise, `unknown exercise ${exerciseId}`);
  return exercise;
}

interface Entry {
  id: string;
  date: string;
  exerciseId: string;
  planned: { weight: number; reps: number }[];
  performed: { weight: number; reps: number; done?: boolean }[];
  status?: WorkoutRecord['status'];
}

function record(entry: Entry): WorkoutRecord {
  return {
    id: entry.id,
    date: entry.date,
    name: 'Push',
    dayIndex: 0,
    status: entry.status ?? 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: [
      {
        exerciseId: entry.exerciseId,
        name: meta(entry.exerciseId).name,
        planned: entry.planned,
        performed: entry.performed.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          done: set.done ?? true,
          completedAt: null,
        })),
      },
    ],
  };
}

/** Four completed working sets. */
function sets(weight: number, reps: number, count = 4) {
  return Array.from({ length: count }, () => ({ weight, reps }));
}

/** One exercise slot in a workout, possibly split into repeated segments. */
interface Segment {
  planned: { weight: number; reps: number }[];
  performed: { weight: number; reps: number; done: boolean }[];
  originalPlannedSets?: number;
}

function slotRecord(
  id: string,
  date: string,
  exerciseId: string,
  segments: Segment[],
): WorkoutRecord {
  return {
    id,
    date,
    name: 'Push',
    dayIndex: 0,
    status: 'completed',
    completedEarly: false,
    endedAt: null,
    exercises: segments.map((segment) => ({
      exerciseId,
      name: meta(exerciseId).name,
      planned: segment.planned,
      performed: segment.performed.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        done: set.done,
        completedAt: set.done ? date : null,
      })),
      ...(segment.originalPlannedSets === undefined
        ? {}
        : { originalPlannedSets: segment.originalPlannedSets }),
    })),
  };
}

test('a first prescription invents no load and starts inside the rep range', () => {
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), []);

  assert.equal(prescription.weight, 0);
  assert.equal(prescription.reps, 8);
  // Not the day's lead: behind an intermediate's heavy lead a compound takes three sets (#97).
  assert.equal(prescription.sets, 3);
  assert.equal(prescription.basis, 'first-time');
  assert.equal(prescription.last, null);
});

test('rep ranges follow the movement class instead of one global number', () => {
  assert.deepEqual(repRangeFor(meta('back-squat')), { min: 6, max: 10 });
  // Isolation is 10–15 whatever the muscle size (#97); small muscles 12–20.
  assert.deepEqual(repRangeFor(meta('leg-extension')), { min: 10, max: 15 });
  assert.deepEqual(repRangeFor(meta('lateral-raise')), { min: 10, max: 15 });
  assert.deepEqual(repRangeFor(meta('cable-fly')), { min: 10, max: 15 });
  assert.deepEqual(repRangeFor(meta('standing-calf-raise')), { min: 12, max: 20 });
  assert.deepEqual(repRangeFor(meta('rear-delt-fly')), { min: 12, max: 20 });
  // One source: outside the lead the role's range is the movement's own.
  for (const exercise of EXERCISES.filter((item) => !programExercise(item.id))) {
    assert.deepEqual(roleTarget(exercise, makeProfile()).range, repRangeFor(exercise), exercise.id);
  }
});

test('every set at the top of the range adds one step and resets reps', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 10),
      performed: sets(60, 10),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'load-increase');
  assert.equal(prescription.weight, 62.5);
  assert.equal(prescription.reps, 6);
});

test('finishing below the top of the range adds a rep at the same load', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 8),
      performed: sets(60, 8),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'rep-increase');
  assert.equal(prescription.weight, 60);
  assert.equal(prescription.reps, 9);
});

test('the rep climb is capped at the top of the range', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'lateral-raise',
      planned: sets(10, 14),
      performed: sets(10, 14),
    }),
  ];

  const prescription = prescribeExercise(meta('lateral-raise'), makeProfile(), history);
  assert.equal(prescription.reps, 15);
  assert.equal(prescription.weight, 10);
});

test('repeated segments all count: one swapped-off set of three never progresses', () => {
  // The original 3-set press: 1 set logged, 2 swapped away to push-ups,
  // 1 of those returned and logged. Segments add to 2 of 3, not a 1-of-1 win.
  const history = [
    slotRecord('w1', '2026-01-05T10:00:00.000Z', 'barbell-bench-press', [
      {
        planned: [sets(60, 10, 1)[0]],
        performed: [{ weight: 60, reps: 10, done: true }],
        originalPlannedSets: 3,
      },
      {
        planned: [sets(60, 10, 1)[0]],
        performed: [{ weight: 60, reps: 10, done: false }],
        originalPlannedSets: 3,
      },
    ]),
  ];

  const last = lastExercisePerformance(history, 'barbell-bench-press');
  assert.equal(last?.plannedSets, 3);
  assert.equal(last?.done.length, 1);
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
  assert.equal(prescription.reps, 10);
});

test('sets logged across repeated segments all contribute', () => {
  const history = [
    slotRecord('w1', '2026-01-05T10:00:00.000Z', 'barbell-bench-press', [
      {
        planned: [sets(60, 10, 1)[0]],
        performed: [{ weight: 60, reps: 10, done: true }],
        originalPlannedSets: 3,
      },
      {
        planned: [sets(60, 9, 1)[0]],
        performed: [{ weight: 60, reps: 9, done: true }],
      },
    ]),
  ];

  const last = lastExercisePerformance(history, 'barbell-bench-press');
  assert.equal(last?.done.length, 2);
  // 2 of the original 3 required sets: still unfinished.
  assert.equal(last?.plannedSets, 3);
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
});

test('a swap replacement that completes the whole slot still earns its step', () => {
  // The full 3-set slot was completed under push-ups; bodyweight caps as hold.
  const history = [
    slotRecord('w1', '2026-01-05T10:00:00.000Z', 'push-up', [
      {
        planned: sets(0, 10, 3),
        performed: sets(0, 10, 3).map((set) => ({ ...set, done: true })),
        originalPlannedSets: 3,
      },
    ]),
  ];

  const prescription = prescribeExercise(meta('push-up'), makeProfile(), history);
  assert.equal(prescription.basis, 'hold');
  assert.equal(prescription.reps, 10);
});

test('an unfinished exercise repeats its load instead of progressing', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(60, 10),
      performed: [
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: true },
        { weight: 60, reps: 10, done: false },
      ],
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 60);
  assert.equal(prescription.reps, 10);
});

test('a session whose sets were never logged repeats the prescription', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(70, 8),
      performed: sets(70, 8).map((set) => ({ ...set, done: false })),
    }),
  ];

  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), history);
  assert.equal(prescription.basis, 'repeat');
  assert.equal(prescription.weight, 70);
  assert.equal(prescription.reps, 8);
});

test('the most recent completed session with the exercise drives the next load', () => {
  const history = [
    record({
      id: 'current',
      date: '2026-03-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(90, 10),
      performed: sets(90, 10),
      status: 'active',
    }),
    record({
      id: 'unrelated',
      date: '2026-02-20T10:00:00.000Z',
      exerciseId: 'lateral-raise',
      planned: sets(12, 12),
      performed: sets(12, 12),
    }),
    record({
      id: 'recent',
      date: '2026-02-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(55, 10),
      performed: sets(55, 10),
    }),
    record({
      id: 'old',
      date: '2026-01-01T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(50, 10),
      performed: sets(50, 10),
    }),
  ];

  const last = lastExercisePerformance(history, 'barbell-bench-press');
  assert.equal(last?.workoutId, 'recent');
  assert.equal(last?.workoutName, 'Push');
  assert.equal(prescribeExercise(meta('barbell-bench-press'), makeProfile(), history).weight, 57.5);
});

test('recorded loads supply both the step and the next selectable load', () => {
  const loads = { Barbell: [20, 25, 30] };
  const profile = makeProfile({ loads });
  const available = availableLoads(profile, 'Barbell');

  assert.deepEqual(available, [20, 25, 30]);
  assert.equal(incrementFor('Barbell', available), 5);
  assert.equal(nextLoad(25, 5, available), 30);
  // No recorded inventory: the next load is the step above the working weight.
  assert.equal(nextLoad(60, 2.5, []), 62.5);
  // An off-grid weight still moves up one whole step, never down.
  assert.equal(nextLoad(61, 2.5, []), 65);

  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(25, 10),
      performed: sets(25, 10),
    }),
  ];
  const up = prescribeExercise(meta('barbell-bench-press'), profile, history);
  assert.equal(up.weight, 30);
  assert.equal(up.reps, 6);

  const topped = prescribeExercise(meta('barbell-bench-press'), profile, [
    record({
      id: 'w2',
      date: '2026-02-05T10:00:00.000Z',
      exerciseId: 'barbell-bench-press',
      planned: sets(30, 10),
      performed: sets(30, 10),
    }),
  ]);
  assert.equal(topped.basis, 'hold');
  assert.equal(topped.weight, 30);
  assert.equal(topped.reps, 10);
  assert.match(describePrescription(topped), /available loads/);
});

test('bodyweight movements hold at the top of the range instead of inventing load', () => {
  const history = [
    record({
      id: 'w1',
      date: '2026-01-05T10:00:00.000Z',
      exerciseId: 'push-up',
      planned: sets(0, 10),
      performed: sets(0, 10),
    }),
  ];

  const prescription = prescribeExercise(meta('push-up'), makeProfile(), history);
  assert.equal(prescription.increment, 0);
  assert.equal(prescription.basis, 'hold');
  assert.equal(prescription.weight, 0);
  assert.equal(prescription.reps, 10);
  // Behind an intermediate's heavy lead, other compounds take three sets (#97).
  assert.equal(roleTarget(meta('push-up'), makeProfile()).sets, 3);
  assert.equal(roleTarget(meta('push-up'), makeProfile({ goal: 'General Fitness' })).sets, 4);
  assert.equal(roleTarget(meta('lateral-raise'), makeProfile()).sets, 3);
});

test('generated sessions carry the prescription into planned and performed sets', () => {
  const profile = makeProfile({ equipment: ['Dumbbell'], support: ['Bench'] });
  const pushExercises = [
    'dumbbell-bench-press',
    'incline-dumbbell-press',
    'dumbbell-shoulder-press',
    'arnold-press',
    'lateral-raise',
    'rear-delt-fly',
  ];
  const history = pushExercises.map((exerciseId, index) =>
    record({
      id: `h${index}`,
      date: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      exerciseId,
      planned: sets(20, 10),
      performed: sets(20, 10),
    }),
  );

  const generated = generateWorkout(
    profile,
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    0,
    history,
  );
  assert.ok(generated.exercises.length > 0);
  const lead = leadCompoundId(generated.exercises.map((exercise) => exercise.exerciseId));

  for (const exercise of generated.exercises) {
    const definition = meta(exercise.exerciseId);
    const prescription = prescribeExercise(definition, profile, history, exercise.exerciseId === lead);
    assert.deepEqual(exercise.planned[0], {
      weight: prescription.weight,
      reps: prescription.reps,
    });
    assert.deepEqual(exercise.performed[0], {
      weight: prescription.weight,
      reps: prescription.reps,
      done: false,
      completedAt: null,
    });
    assert.equal(exercise.planned.length, exercise.performed.length);
  }

  const loaded = generated.exercises.filter((exercise) => exercise.planned[0].weight > 0);
  assert.ok(loaded.length >= 2, 'logged dumbbell work should produce prescribed loads');
  for (const exercise of loaded) {
    // Compound work at the top of its range (6–10, or the lead's 4–6) earned a
    // load step, which with no confirmed rack keeps the load and asks for the
    // next dumbbell up (#57); reps restart at the bottom. Isolation work at 10
    // reps earned a rep instead, never below its range (12 for a rear delt).
    const { range } = roleTarget(meta(exercise.exerciseId), profile, exercise.exerciseId === lead);
    assert.deepEqual(
      exercise.planned[0],
      range.max <= 10 ? { weight: 20, reps: range.min } : { weight: 20, reps: Math.max(11, range.min) },
    );
  }
});

test('the reason names the real gap to the next load: rack steps, lb display, barbell', () => {
  // `planned` differs from `from` when the user typed the load.
  const reason = (id: string, loads: number[], from: number, unit: 'kg' | 'lb' = 'kg', planned = from) => {
    const eq = meta(id).equipment;
    const history = [record({ id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: id,
      planned: sets(planned, 12), performed: sets(from, 12) })];
    const p = prescribeExercise(meta(id), makeProfile({ loads: { [eq]: loads } }), history);
    return { p, text: describePrescription(p, unit) };
  };
  const rack = [10, 15, 18];
  const a = reason('dumbbell-floor-press', rack, 10);
  assert.equal(a.p.weight, 15);
  assert.match(a.text, /\(\+5 kg\)/);
  assert.match(reason('dumbbell-floor-press', rack, 15).text, /\(\+3 kg\)/);
  assert.match(reason('dumbbell-floor-press', rack, 15, 'lb').text, /\(\+6\.5 lb\)/); // 18 kg targets 39.5 lb, 15 kg reads 33 lb
  assert.match(reason('kettlebell-goblet-squat', [16, 20], 16, 'lb').text, /\(\+8\.5 lb\)/);
  assert.match(reason('kettlebell-goblet-squat', [4, 6], 4, 'lb').text, /\(\+4 lb\)/);
  // A typed load just under the rack top displays as the same step: no "+0".
  const near = reason('dumbbell-floor-press', rack, 17.995, 'kg', 18);
  assert.doesNotMatch(near.text, /\+0|\(\+/);
  assert.match(near.text, /Next load/);
  // Typed off-rack loads: +N is target minus the load as shown.
  assert.match(reason('barbell-bench-press', [], 61.25, 'kg', 60).text, /61\.25 kg\. One step up \(\+3\.75 kg\)/);
  assert.match(reason('dumbbell-floor-press', rack, 17.75, 'kg', 15).text, /\(\+0\.25 kg\)/);
  // Barbell with no inventory: the default increment still equals the actual gap.
  const bb = reason('barbell-bench-press', [], 60);
  assert.match(bb.text, new RegExp(`\\(\\+${bb.p.weight - 60} kg\\)`));
});
