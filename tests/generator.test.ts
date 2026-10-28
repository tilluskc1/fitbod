import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { capabilitiesFor, provides } from '../src/lib/capabilities.ts';
import { buildPlan, generateWorkout, targetCountFor } from '../src/lib/generator.ts';
import type {
  CoverageResult,
  Exercise,
  MovementPattern,
  Profile,
  WorkoutExercise,
} from '../src/types.ts';

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

function meta(exerciseId: string): Exercise {
  const exercise = EXERCISES.find((item) => item.id === exerciseId);
  assert.ok(exercise, `unknown exercise ${exerciseId}`);
  return exercise;
}

function patternCounts(exercises: WorkoutExercise[]): Map<MovementPattern, number> {
  const counts = new Map<MovementPattern, number>();
  for (const exercise of exercises) {
    const pattern = meta(exercise.exerciseId).pattern;
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return counts;
}

function coverageItem(feasibility: { coverage: CoverageResult[] }, id: string): CoverageResult {
  const item = feasibility.coverage.find((entry) => entry.id === id);
  assert.ok(item, `missing coverage ${id}`);
  return item;
}

test('kettlebell-only: Push is honestly limited, Pull is infeasible', () => {
  const profile = makeProfile({ equipment: ['Kettlebell'] });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);
  const pull = generateWorkout(profile, plan[1], 1);

  assert.equal(push.feasibility.status, 'limited');
  assert.equal(push.exercises.length, 2);
  assert.deepEqual(
    push.exercises.map((exercise) => exercise.exerciseId).sort(),
    ['diamond-push-up', 'push-up'],
  );
  assert.ok(push.exercises.every((exercise) => meta(exercise.exerciseId).equipment === 'Bodyweight'));

  assert.equal(pull.feasibility.status, 'infeasible');
  assert.equal(pull.exercises.length, 0);
  assert.ok(pull.feasibility.alternatives.length > 0);
  assert.ok(
    pull.feasibility.alternatives.some((alternative) => alternative.support === 'Pull-up bar'),
    'offers a pull-up bar as an explicit alternative',
  );
});

test('no feasible exercise: bodyweight-only Pull never starts a core-only workout', () => {
  const profile = makeProfile({ equipment: [] });
  const plan = buildPlan(profile);
  const pull = generateWorkout(profile, plan[1], 1);

  assert.equal(pull.feasibility.status, 'infeasible');
  assert.equal(pull.exercises.length, 0);
  assert.ok(coverageItem(pull.feasibility, 'pull').satisfied === false);
  assert.ok(
    pull.feasibility.alternatives.some((alternative) => alternative.kind === 'capability'),
  );
});

test('movement coverage replaces exercise-count padding', () => {
  const profile = makeProfile({ equipment: [] });
  const plan = buildPlan(profile);
  const legs = generateWorkout(profile, plan[2], 2);
  const counts = patternCounts(legs.exercises);

  assert.equal(legs.feasibility.status, 'limited');
  assert.ok((counts.get('core_stability') ?? 0) <= 1);
  assert.ok((counts.get('core_flexion') ?? 0) <= 1);
  assert.ok(coverageItem(legs.feasibility, 'calf').satisfied === false);
  assert.ok(legs.exercises.some((exercise) => exercise.exerciseId === 'glute-bridge'));
  assert.ok(!legs.exercises.some((exercise) => exercise.exerciseId === 'goblet-squat'));
});

test('kettlebell-only Legs keeps the squat and reports the calf gap', () => {
  const profile = makeProfile({ equipment: ['Kettlebell'] });
  const plan = buildPlan(profile);
  const legs = generateWorkout(profile, plan[2], 2);

  assert.equal(legs.feasibility.status, 'limited');
  // The catalog's goblet squat is the dumbbell movement; the kettlebell version
  // is its own entry, so a kettlebell-only kit still gets a squat.
  assert.ok(legs.exercises.some((exercise) => exercise.exerciseId === 'kettlebell-goblet-squat'));
  assert.ok(!legs.exercises.some((exercise) => exercise.exerciseId === 'goblet-squat'));
  assert.ok(coverageItem(legs.feasibility, 'calf').satisfied === false);
});

test('full equipment produces a full, coverage-complete Push session', () => {
  const profile = makeProfile({
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'],
    support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'],
  });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);
  const counts = patternCounts(push.exercises);

  assert.equal(push.feasibility.status, 'ok');
  assert.equal(push.exercises.length, targetCountFor(profile));
  assert.ok(push.feasibility.coverage.every((item) => item.satisfied));
  assert.ok((counts.get('core_stability') ?? 0) <= 1);
  assert.ok((counts.get('core_flexion') ?? 0) <= 1);
  for (const count of counts.values()) assert.ok(count <= 2, 'never more than two of one movement');
  assert.equal(new Set(push.exercises.map((exercise) => exercise.exerciseId)).size, push.exercises.length);
});

test('a common home kit still fills a full Push session', () => {
  const profile = makeProfile({
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
    support: ['Bench', 'Rack', 'Pull-up bar'],
  });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);

  assert.equal(push.feasibility.status, 'ok');
  assert.equal(push.exercises.length, targetCountFor(profile));
  assert.ok(push.feasibility.coverage.every((item) => item.satisfied));
  assert.ok(push.feasibility.alternatives.length === 0);
});

test('every limited or infeasible day offers at least one concrete alternative', () => {
  for (const profile of [
    makeProfile({ equipment: ['Kettlebell'] }),
    makeProfile({ equipment: [] }),
  ]) {
    const plan = buildPlan(profile);
    plan.forEach((day, dayIndex) => {
      const session = generateWorkout(profile, day, dayIndex);
      if (session.feasibility.status !== 'ok') {
        assert.ok(
          session.feasibility.alternatives.length > 0,
          `${day.name} (${profile.equipment.join('+') || 'bodyweight'}) reports ${session.feasibility.status} with no alternative`,
        );
      }
    });
  }
});

test('dumbbell + bench is a real combination, never barbell or rack', () => {
  const withoutBench = makeProfile({ equipment: ['Dumbbell'] });
  const withBench = makeProfile({ equipment: ['Dumbbell'], support: ['Bench'] });
  const benchPress = meta('dumbbell-bench-press');

  assert.equal(provides(capabilitiesFor(withoutBench), benchPress.needs), false);
  assert.equal(provides(capabilitiesFor(withBench), benchPress.needs), true);

  const plan = buildPlan(withBench);
  for (let dayIndex = 0; dayIndex < plan.length; dayIndex += 1) {
    const session = generateWorkout(withBench, plan[dayIndex], dayIndex);
    for (const exercise of session.exercises) {
      const defined = meta(exercise.exerciseId);
      assert.ok(provides(capabilitiesFor(withBench), defined.needs));
      assert.ok(!defined.needs.includes('barbell'));
      assert.ok(!defined.needs.includes('rack'));
    }
  }
});

test('exclusions are respected and surfaced explicitly, never silently substituted', () => {
  const profile = makeProfile({
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
    support: ['Bench', 'Rack'],
    exclusions: ['barbell-bench-press'],
  });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);
  assert.ok(!push.exercises.some((exercise) => exercise.exerciseId === 'barbell-bench-press'));

  const blocked = makeProfile({ exclusions: ['push-up', 'diamond-push-up'] });
  const blockedPlan = buildPlan(blocked);
  const blockedPush = generateWorkout(blocked, blockedPlan[0], 0);
  assert.equal(blockedPush.feasibility.status, 'infeasible');
  assert.ok(
    blockedPush.feasibility.alternatives.some(
      (alternative) =>
        alternative.kind === 'allow-exercise' && alternative.exerciseId === 'push-up',
    ),
  );
});

test('selection stays deterministic for the same seed input', () => {
  const profile = makeProfile({
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
    support: ['Bench', 'Rack'],
  });
  const plan = buildPlan(profile);
  const first = generateWorkout(profile, plan[0], 0);
  const second = generateWorkout(profile, plan[0], 0);
  assert.deepEqual(first, second);
});

test('every exercise declares a pattern and complete needs', () => {
  for (const exercise of EXERCISES) {
    assert.ok(exercise.pattern, `${exercise.id} has a pattern`);
    assert.ok(Array.isArray(exercise.needs), `${exercise.id} has needs`);
    if (exercise.equipment === 'Bodyweight') {
      assert.ok(
        exercise.needs.length > 0 || exercise.muscles.length > 0,
        `${exercise.id} is well formed`,
      );
    }
  }
  assert.equal(new Set(EXERCISES.map((exercise) => exercise.id)).size, EXERCISES.length);
});
