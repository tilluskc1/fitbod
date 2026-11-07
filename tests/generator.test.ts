import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES, INCOMPATIBLE_GROUPS } from '../src/data/exercises.ts';
import { capabilitiesFor, provides } from '../src/lib/capabilities.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
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

test('kettlebell-only: Push fills a short session, Pull names the biceps gap and the gear that fills it (#67, #174)', () => {
  const profile = makeProfile({ equipment: ['Kettlebell'] });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);
  const pull = generateWorkout(profile, plan[1], 1);

  // A kettlebell presses overhead; Push-Up covers the horizontal press. At 35 min that fills the
  // session, so it is Ready (#67); at 60 min two exercises cannot fill half the time, so it is Limited.
  assert.equal(push.feasibility.status, 'ok');
  assert.deepEqual(push.exercises.map((exercise) => exercise.exerciseId), ['kettlebell-press', 'push-up']);
  const long = generateWorkout({ ...profile, sessionMinutes: 60 }, plan[0], 0);
  assert.equal(long.feasibility.status, 'limited');
  assert.match(long.feasibility.reason, /^Limited session: 2 of \d exercises are possible/);

  // A kettlebell rows, so Pull is a real day, but nothing here trains biceps directly: it says so
  // instead of claiming "biceps curls" from the row, and offers gear that adds a curl.
  assert.equal(pull.feasibility.status, 'limited');
  assert.equal(pull.exercises[0].exerciseId, 'kettlebell-row');
  assert.match(pull.feasibility.reason, / No biceps exercise is possible with these constraints\./);
  assert.doesNotMatch(pull.feasibility.reason, /covering/);
  assert.ok(pull.feasibility.alternatives.some((alternative) => alternative.support === 'Pull-up bar'),
    'offers a pull-up bar as an explicit alternative');
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
    sessionMinutes: 60, // long enough for every exercise the Push caps allow at honest rest (#89, #132)
  });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);
  const counts = patternCounts(push.exercises);

  assert.equal(push.feasibility.status, 'ok');
  assert.equal(push.exercises.length, 6, 'every exercise the Push caps allow');
  assert.equal(push.targetCount, 6);
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
    sessionMinutes: 60, // long enough for every exercise the Push caps allow at honest rest (#89, #132)
  });
  const plan = buildPlan(profile);
  const push = generateWorkout(profile, plan[0], 0);

  assert.equal(push.feasibility.status, 'ok');
  assert.equal(push.exercises.length, 6, 'every exercise the Push caps allow');
  assert.equal(push.targetCount, 6);
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

// #67: a Push day must be filled by slots, not left short by the per-muscle caps.
test('beginner dumbbells + bench: Push is a full Ready day with one triceps-primary and at most two shoulder-primary', () => {
  // 50 min: the five-exercise Beginner day this case was written against (#89), at honest rest (#132)
  // with the beginner lead's fourth set (#133).
  const profile = makeProfile({ experience: 'Beginner', equipment: ['Dumbbell'], support: ['Bench'], sessionMinutes: 50 });
  const push = generateWorkout(profile, buildPlan(profile)[0], 0);
  const primaries = push.exercises.map((exercise) => meta(exercise.exerciseId).muscles[0]);

  assert.equal(push.exercises.length, 5, push.feasibility.reason);
  assert.equal(push.feasibility.status, 'ok');
  assert.equal(primaries.filter((muscle) => muscle === 'Triceps').length, 1);
  assert.ok(primaries.filter((muscle) => muscle === 'Shoulders').length <= 2);
});

// #67: incompatible pairs, named open slots, ranked replacements.
const PROFILES: Profile[] = [
  makeProfile({ experience: 'Beginner', equipment: ['Dumbbell'], support: ['Bench'] }),
  makeProfile({ experience: 'Intermediate', equipment: ['Dumbbell', 'Barbell', 'Cable', 'Machine'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars'] }),
  makeProfile({ experience: 'Advanced', equipment: ['Kettlebell'], support: [] }),
  makeProfile({ experience: 'Beginner', equipment: [], support: [] }),
  makeProfile({ experience: 'Intermediate', equipment: ['Dumbbell', 'Cable'], support: ['Dip bars'] }),
];

test('incompatible exercises never share a day, across splits and kits', () => {
  for (const profile of PROFILES) {
    for (let daysPerWeek = 2; daysPerWeek <= 6; daysPerWeek += 1) {
      const p = { ...profile, daysPerWeek };
      buildPlan(p).forEach((day, index) => {
        const ids = generateWorkout(p, day, index).exercises.map((exercise) => exercise.exerciseId);
        for (const group of INCOMPATIBLE_GROUPS) {
          const hits = ids.filter((id) => group.includes(id));
          assert.ok(hits.length <= 1, `${day.name}: ${hits.join(' + ')} are incompatible`);
        }
      });
    }
  }
});

test('incompatible groups only name real exercises', () => {
  for (const group of INCOMPATIBLE_GROUPS) {
    assert.ok(group.length >= 2);
    for (const id of group) meta(id);
  }
});

test('the open-slot note names exactly the focus muscles nothing can train, and only those', () => {
  let named = 0;
  for (const profile of PROFILES) {
    for (let daysPerWeek = 2; daysPerWeek <= 6; daysPerWeek += 1) {
      const p = { ...profile, daysPerWeek };
      const caps = capabilitiesFor(p);
      buildPlan(p).forEach((day, index) => {
        const session = generateWorkout(p, day, index);
        const picked = new Set(session.exercises.map((exercise) => meta(exercise.exerciseId).muscles[0]));
        const expected = day.focus.filter(
          (muscle) =>
            !picked.has(muscle) &&
            !EXERCISES.some((item) => item.muscles[0] === muscle && provides(caps, item.needs) && !p.exclusions.includes(item.id)),
        );
        const note = session.feasibility.reason.match(/ No (.+) exercise is possible with these constraints\./);
        const label = `${day.name} (${p.equipment.join('+') || 'bodyweight'}, ${daysPerWeek}d)`;
        if (session.exercises.length === 0) return; // infeasible days have their own wording
        if (expected.length === 0) {
          assert.equal(note, null, `${label} must not claim a muscle is impossible`);
        } else {
          assert.ok(note, `${label} must name ${expected.join(', ')}`);
          assert.deepEqual(note[1].split(/, | and /).sort(), expected.map((muscle) => muscle.toLowerCase()).sort(), label);
          named += 1;
        }
      });
    }
  }
  assert.ok(named > 0, 'the matrix must exercise at least one named gap');
});

test('a focus muscle that has an exercise but lost the slot race is not called impossible', () => {
  const profile = makeProfile({ experience: 'Beginner', equipment: ['Dumbbell'], support: [], daysPerWeek: 2 });
  const session = generateWorkout(profile, buildPlan(profile)[0], 0);
  assert.doesNotMatch(session.feasibility.reason, /No core exercise/);
});

test('a "more" preference still wins over focus order', () => {
  const kit = { experience: 'Beginner' as const, equipment: ['Dumbbell', 'Barbell', 'Cable', 'Machine', 'Kettlebell'] as Profile['equipment'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] as Profile['support'] };
  const cases: [number, number, string][] = [
    [6, 5, 'hip-thrust'], // Legs B
    [3, 0, 'diamond-push-up'], // Push
    [4, 0, 'deadlift'], // Upper A
  ];
  for (const [daysPerWeek, dayIndex, id] of cases) {
    const profile = makeProfile({ ...kit, daysPerWeek, preferences: { [id]: 'more' } });
    const ids = generateWorkout(profile, buildPlan(profile)[dayIndex], dayIndex).exercises.map((item) => item.exerciseId);
    assert.ok(ids.includes(id), `${id} is marked "more" but ${buildPlan(profile)[dayIndex].name} picked ${ids.join(', ')}`);
  }
});

test('the dumbbell and cable overhead triceps extensions never share a day', () => {
  const profile = makeProfile({ experience: 'Intermediate', equipment: ['Dumbbell', 'Cable'], support: ['Dip bars'] });
  const ids = generateWorkout(profile, buildPlan(profile)[0], 0).exercises.map((item) => item.exerciseId);
  assert.ok(!(ids.includes('dumbbell-overhead-triceps-extension') && ids.includes('overhead-triceps-extension')), ids.join(', '));
});

test('ranked replacements: same primary muscle, feasible, allowed, stable, best match first', () => {
  const profile = makeProfile({ experience: 'Beginner', equipment: ['Dumbbell'], support: ['Bench'], exclusions: ['push-up'] });
  const caps = capabilitiesFor(profile);
  const incline = meta('incline-dumbbell-press');
  const ranked = rankedReplacements(incline, profile);

  assert.ok(ranked.length > 0 && ranked.length <= 5);
  assert.deepEqual(ranked.map((item) => item.id), rankedReplacements(incline, profile).map((item) => item.id));
  for (const item of ranked) {
    assert.notEqual(item.id, incline.id);
    assert.equal(item.muscles[0], incline.muscles[0]);
    assert.ok(provides(caps, item.needs), `${item.id} needs gear the profile lacks`);
    assert.ok(!profile.exclusions.includes(item.id));
  }
  assert.equal(ranked[0].pattern, incline.pattern, 'same movement pattern outranks the rest');
});

test('ranked replacements skip what is already in the day or incompatible with it', () => {
  const profile = makeProfile({ experience: 'Beginner', equipment: ['Dumbbell'], support: ['Bench'] });
  const arnold = meta('arnold-press');
  const withPress = rankedReplacements(arnold, profile, [meta('dumbbell-shoulder-press')]);
  assert.ok(!withPress.some((item) => item.id === 'dumbbell-shoulder-press'));
  const others = rankedReplacements(arnold, profile, [meta('lateral-raise')]);
  assert.ok(!others.some((item) => item.id === 'lateral-raise'), 'already picked');
});

// #177: the logger's Replace list is this ranking, against the rest of today's workout.
test('ranked replacements respect the day: no duplicate, no incompatible pair, no third of a pattern', () => {
  const profile = makeProfile({ experience: 'Intermediate', equipment: ['Dumbbell'], support: ['Bench'] });
  const incline = meta('incline-dumbbell-press');
  // Home Push: incline is being replaced; bench press and shoulder press stay.
  const day = [meta('dumbbell-bench-press'), meta('dumbbell-shoulder-press'), meta('lateral-raise')];
  const ids = rankedReplacements(incline, profile, day, 6).map((item) => item.id);
  assert.ok(!ids.includes('dumbbell-bench-press'), 'already in the day');
  assert.ok(!ids.includes('dumbbell-floor-press'), 'incompatible with the bench press in the day');
  assert.ok(ids.length > 0, 'still offers something');

  // Gym pull day: two rows stay, the pull-up is replaced. A third row is never offered; a pulldown is.
  const gym = makeProfile({ equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'], support: ['Bench', 'Rack', 'Pull-up bar', 'Ab wheel'] });
  const rows = [meta('barbell-row'), meta('seated-cable-row')];
  const forPullUp = rankedReplacements(meta('pull-up'), gym, rows, 10);
  assert.ok(forPullUp.some((item) => item.id === 'lat-pulldown'), forPullUp.map((item) => item.id).join(', '));
  for (const item of forPullUp) assert.notEqual(item.pattern, 'horizontal_pull', item.id);
  // One move per core pattern: with a plank in the day the ab wheel is out, a leg raise is fine.
  const forTwist = rankedReplacements(meta('russian-twist'), gym, [meta('plank')], 10).map((item) => item.id);
  assert.ok(!forTwist.includes('ab-wheel'), forTwist.join(', '));
  assert.ok(forTwist.includes('hanging-leg-raise'), forTwist.join(', '));
});

test('the logger Replace sheet lists rankedReplacements against today\'s other exercises', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // #193: a described session passes the same profile with its skipped work left out.
  assert.match(app, /rankedReplacements\(meta, swapProfile, inDay, 6\)/);
  assert.match(app, /const swapProfile = describedSession && state\.todayOverride\?\.skip \? withSkipped\(profile, state\.todayOverride\.skip\) : profile;/);
  assert.match(app, /index !== sheet\.exerciseIndex/);
});
