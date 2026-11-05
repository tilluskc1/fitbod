import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { generateWorkout } from '../src/lib/generator.ts';
import {
  availableLoads,
  describePrescription,
  incrementFor,
  lastExercisePerformance,
  nextLoad,
  prescribeExercise,
  repRangeFor,
  setCountFor,
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
  assert.equal(prescription.sets, 4);
  assert.equal(prescription.basis, 'first-time');
  assert.equal(prescription.last, null);
});

test('rep ranges follow the movement class instead of one global number', () => {
  assert.deepEqual(repRangeFor(meta('back-squat').pattern), { min: 6, max: 10 });
  assert.deepEqual(repRangeFor(meta('leg-extension').pattern), { min: 8, max: 12 });
  assert.deepEqual(repRangeFor(meta('lateral-raise').pattern), { min: 10, max: 15 });
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

/** An early-finished session in which only the first set was logged. */
function earlyFinish(exerciseId: string, planned: { weight: number; reps: number }[], logged: { weight: number; reps: number }) {
  const workout = record({ id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId, planned, performed: planned.map((set, index) => (index === 0 ? { ...logged, done: true } : { ...set, done: false })) });
  return [{ ...workout, completedEarly: true }];
}

test('an early finish repeats the target instead of lowering it to the logged set (#104)', () => {
  // Bodyweight: Push-Up 4 × 8, one set of 7, finish early.
  const pushUp = prescribeExercise(meta('push-up'), makeProfile(), earlyFinish('push-up', sets(0, 8), { weight: 0, reps: 7 }));
  assert.equal(pushUp.basis, 'repeat');
  assert.deepEqual([pushUp.weight, pushUp.reps], [0, 8]);

  // Loaded: Bench 60 × 8, one lighter set of 6, finish early.
  const bench = prescribeExercise(meta('barbell-bench-press'), makeProfile(), earlyFinish('barbell-bench-press', sets(60, 8), { weight: 57.5, reps: 6 }));
  assert.equal(bench.basis, 'repeat');
  assert.deepEqual([bench.weight, bench.reps], [60, 8]);
  assert.match(describePrescription(bench, 'kg'), /^Repeat \d+ × 8 @ 60 kg: .+ was cut short\./);
  assert.match(describePrescription(pushUp, 'kg'), /^Repeat \d+ × 8: .+ was cut short\./);
});

test('an early finish never earns a step from one heavier or longer set (#104)', () => {
  const bench = meta('barbell-bench-press');
  // Heavier: 70 × 6 against 60 × 8 does not move the target to 70.
  const heavier = prescribeExercise(bench, makeProfile(), earlyFinish(bench.id, sets(60, 8), { weight: 70, reps: 6 }));
  assert.deepEqual([heavier.basis, heavier.weight, heavier.reps], ['repeat', 60, 8]);
  // Extra reps: 60 × 10 or a lighter 57.5 × 10 against 60 × 8 does not move reps to 10.
  for (const logged of [{ weight: 60, reps: 10 }, { weight: 57.5, reps: 10 }]) {
    const longer = prescribeExercise(bench, makeProfile(), earlyFinish(bench.id, sets(60, 8), logged));
    assert.deepEqual([longer.basis, longer.weight, longer.reps], ['repeat', 60, 8]);
  }
});

test('a first loaded session that ends early makes the logged set the baseline', () => {
  // No load was planned yet: the one logged set is the only real number.
  const first = prescribeExercise(meta('barbell-bench-press'), makeProfile(), earlyFinish('barbell-bench-press', sets(0, 8), { weight: 42.5, reps: 7 }));
  assert.deepEqual([first.basis, first.weight, first.reps], ['repeat', 42.5, 7]);
});

test('a finished exercise inside an early-finished session follows the normal rule', () => {
  const workout = record({ id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: 'barbell-bench-press', planned: sets(60, 8), performed: sets(60, 8) });
  const prescription = prescribeExercise(meta('barbell-bench-press'), makeProfile(), [{ ...workout, completedEarly: true }]);
  assert.equal(prescription.basis, 'rep-increase');
  assert.deepEqual([prescription.weight, prescription.reps], [60, 9]);
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
  assert.equal(setCountFor(meta('push-up')), 4);
  assert.equal(setCountFor(meta('lateral-raise')), 3);
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

  for (const exercise of generated.exercises) {
    const definition = meta(exercise.exerciseId);
    const prescription = prescribeExercise(definition, profile, history);
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
    // Compound work at the top of a 6–10 range earned a load step, which with no
    // confirmed rack keeps the load and asks for the next dumbbell up (#57);
    // accessory work at 10 reps in a 10–15 range earned a rep instead.
    const range = repRangeFor(meta(exercise.exerciseId).pattern);
    assert.deepEqual(
      exercise.planned[0],
      range.max === 10 ? { weight: 20, reps: 6 } : { weight: 20, reps: 11 },
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

test('one earned step moves to the next owned load on every lb and kg rack (#102)', () => {
  const kg = (lb: number) => Math.round(lb * 0.45359237 * 1000) / 1000; // stored like toKg
  const cases: { id: string; unit: 'kg' | 'lb'; rack: number[] }[] = [
    { id: 'rear-delt-fly', unit: 'lb', rack: [5, 10, 15, 20, 25, 30] }, // 5-lb dumbbells
    { id: 'rear-delt-fly', unit: 'lb', rack: [5, 7.5, 10, 12.5, 15] }, // 2.5-lb dumbbells
    { id: 'rear-delt-fly', unit: 'kg', rack: [4, 5, 6, 7, 8] }, // 1-kg dumbbells
    { id: 'rear-delt-fly', unit: 'kg', rack: [4, 6, 8, 10] }, // 2-kg dumbbells
    { id: 'barbell-bench-press', unit: 'lb', rack: [45, 50, 55, 60, 65] }, // 5-lb plate pairs
    { id: 'barbell-bench-press', unit: 'lb', rack: [95, 97.5, 100, 102.5] }, // 2.5-lb steps
    { id: 'barbell-bench-press', unit: 'kg', rack: [20, 22.5, 25, 27.5] }, // 2.5-kg steps
    { id: 'barbell-bench-press', unit: 'kg', rack: [40, 45, 50] }, // 5-kg steps
  ];
  for (const { id, unit, rack } of cases) {
    const stored = rack.map((v) => (unit === 'lb' ? kg(v) : v));
    const profile = makeProfile({ loads: { [meta(id).equipment]: stored } });
    for (let i = 0; i < rack.length - 1; i += 1) {
      const history = [record({ id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: id,
        planned: sets(stored[i], 30), performed: sets(stored[i], 30) })];
      const p = prescribeExercise(meta(id), profile, history);
      const label = `${id} ${rack[i]} ${unit}`;
      assert.equal(p.weight, stored[i + 1], `${label}: expected next ${rack[i + 1]} ${unit}`);
      const gap = Math.round((rack[i + 1] - rack[i]) * 100) / 100;
      assert.match(describePrescription(p, unit), new RegExp(`One step up \\(\\+${gap} ${unit}\\)`), label);
    }
  }
});

test('a load typed in the other unit still earns a real dumbbell up, never a +0.1 step (#102)', () => {
  const step = (rack: number[], typed: number, unit: 'kg' | 'lb') => {
    const history = [record({ id: 'w1', date: '2026-01-05T10:00:00.000Z', exerciseId: 'rear-delt-fly',
      planned: sets(rack[1], 30), performed: sets(typed, 30) })];
    const p = prescribeExercise(meta('rear-delt-fly'), makeProfile({ loads: { Dumbbell: rack } }), history);
    return { weight: p.weight, text: describePrescription(p, unit) };
  };
  const lbRack = [6.804, 9.072, 11.34, 13.608]; // 15/20/25/30 lb
  const a = step(lbRack, 9, 'kg'); // the 20-lb chip reads "9" in kg
  assert.equal(a.weight, 11.34);
  const b = step([8, 10, 12.5, 15], 9.979, 'lb'); // typed 22 lb on a kg rack
  assert.equal(b.weight, 12.5);
  for (const { text } of [a, b]) {
    assert.match(text, /One step up/);
    assert.doesNotMatch(text, /\(\+0\.\d/);
  }
  // Off-rack typed load between owned loads: the next owned load up.
  assert.equal(nextLoad(21, 2.5, [20, 22.5, 25]), 22.5);
});
