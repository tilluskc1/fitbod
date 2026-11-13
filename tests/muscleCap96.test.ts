import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, estimatedSeconds, generateWorkout, muscleCap } from '../src/lib/generator.ts';
import { isCompound } from '../src/lib/progression.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { sessionRests } from '../src/lib/sessionTime.ts';
import type { Goal, MuscleGroup, Profile } from '../src/types.ts';

// #96: a muscle may take a third exercise on its focus day for an advanced lifter, and for an
// intermediate one at 60 minutes or more, only in time the day leaves over. Beginners keep 2.
// An exercise counts for its first muscle.

const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  homeBar: { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
  dumbbells: { equipment: ['Dumbbell'], support: [] },
  barbellRack: { equipment: ['Barbell'], support: ['Bench', 'Rack'] },
  barbellDumbbell: { equipment: ['Barbell', 'Dumbbell'], support: ['Bench', 'Rack', 'Pull-up bar'] },
  machines: { equipment: ['Machine', 'Cable'], support: [] },
  kettlebell: { equipment: ['Kettlebell'], support: [] },
  bodyweight: { equipment: [], support: [] },
} as const;
type Kit = keyof typeof KITS;
const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const LENGTHS = [15, 20, 30, 45, 50, 60, 75, 90, 120];
/** A saved length shortened for today: 45 or more keeps the saved day and trims it (#203). */
const TRIMS = [[50, 45], [60, 45], [75, 45], [75, 60], [90, 45], [90, 60], [90, 75], [120, 45], [120, 60], [120, 75]];
/** Days the lifter described (#193). */
const DESCRIBED: MuscleGroup[][] = [['Chest'], ['Chest', 'Triceps'], ['Back', 'Biceps'], ['Quads', 'Glutes'], ['Shoulders', 'Triceps'], ['Hamstrings', 'Glutes']];
const FIXTURE = new URL('./fixtures/muscleCap96-main.json.gz', import.meta.url);

const profileOf = (kit: Kit, experience: Profile['experience'], daysPerWeek: number, sessionMinutes: number, goal: Goal = 'Build Muscle') =>
  ({ goal, experience, daysPerWeek, unit: 'lb', sessionMinutes, ...KITS[kit], exclusions: [], loads: {} }) as unknown as Profile;
const listOf = (exercises: { exerciseId: string; sets: number }[]) => exercises.map((exercise) => `${exercise.exerciseId}:${exercise.sets}`).join(' ');

/**
 * Every case, keyed "kind kit level goal length split day", as exercise:sets (and minutes): a generated
 * day, a saved day shortened for today ("saved>today"), a described day. `hashes`: the whole generated
 * output of a kit, level and length, every goal and day.
 */
type Sweep = { cases: Record<string, string>; hashes: Record<string, string>; thirds: Record<string, string[]> };
function sweep(): Sweep {
  const out: Record<string, string> = {};
  /** The thirds the generated day or program carries (#96), by case. Not in the fixture. */
  const thirds: Record<string, string[]> = {};
  const hashes = new Map<string, ReturnType<typeof createHash>>();
  for (const kit of Object.keys(KITS) as Kit[]) for (const experience of LEVELS) for (const goal of GOALS) {
    const goalKey = goal.replace(' ', '-');
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      for (const minutes of LENGTHS) {
        const profile = profileOf(kit, experience, daysPerWeek, minutes, goal);
        buildPlan(profile).forEach((day, index) => {
          const session = generateWorkout(profile, day, index, []);
          const list = listOf(session.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, sets: exercise.planned.length })));
          out[`day ${kit} ${experience} ${goalKey} ${minutes} ${daysPerWeek}d ${day.name}`] = list;
          thirds[`day ${kit} ${experience} ${goalKey} ${minutes} ${daysPerWeek}d ${day.name}`] = session.thirds ?? [];
          const group = `${kit} ${experience} ${minutes}`;
          if (!hashes.has(group)) hashes.set(group, createHash('sha256'));
          hashes.get(group)!.update(JSON.stringify(session));
        });
      }
      for (const [saved, minutes] of TRIMS) {
        const profile = profileOf(kit, experience, daysPerWeek, saved, goal);
        for (const slot of planSlots(buildPlan(profile))) {
          const program = todayProgram(profile, slot, [], { minutes });
          const adapted = adaptWorkout(program, { ...defaultConstraints(profile), minutes }, profile.exclusions, goal);
          out[`trim ${kit} ${experience} ${goalKey} ${saved}>${minutes} ${daysPerWeek}d ${slot.name}`] =
            `${listOf(adapted.exercises)}|${todayGlance(adapted, null, false, goal).minutes}`;
          thirds[`trim ${kit} ${experience} ${goalKey} ${saved}>${minutes} ${daysPerWeek}d ${slot.name}`] = program.thirds ?? [];
        }
      }
    }
    for (const minutes of LENGTHS) for (const focus of DESCRIBED) {
      const profile = profileOf(kit, experience, 4, minutes, goal);
      const program = todayProgram(profile, planSlots(buildPlan(profile))[0], [], { focus });
      const adapted = adaptWorkout(program, { ...defaultConstraints(profile), minutes }, profile.exclusions, goal);
      out[`described ${kit} ${experience} ${goalKey} ${minutes} 4d ${focus.join('+')}`] =
        `${listOf(adapted.exercises)}|${todayGlance(adapted, null, false, goal).minutes}`;
      thirds[`described ${kit} ${experience} ${goalKey} ${minutes} 4d ${focus.join('+')}`] = program.thirds ?? [];
    }
  }
  return { cases: out, hashes: Object.fromEntries([...hashes].map(([group, hash]) => [group, hash.digest('hex').slice(0, 16)])), thirds };
}

/** Stored as each case's index into its distinct lists, in sweep order: the cases repeat a lot. */
type Stored = { lists: string[]; cases: number[]; hashes: Record<string, string> };

// The fixture is every case on main 32d59c2, before #96 (`WRITE_FIXTURE=1` with main's generator rewrites it).
if (process.env.WRITE_FIXTURE) {
  const { cases, hashes } = sweep();
  const lists = [...new Set(Object.values(cases))];
  writeFileSync(FIXTURE, gzipSync(JSON.stringify({ lists, cases: Object.values(cases).map((list) => lists.indexOf(list)), hashes })));
}

const stored = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()) as Stored;
const after = sweep();
const now = after.cases;
const main = Object.fromEntries(Object.keys(now).map((key, index) => [key, stored.lists[stored.cases[index]]]));
const before = { hashes: stored.hashes };
const sameOutput = (group: string) => before.hashes[group] === after.hashes[group];
const keys = Object.keys(now);
const field = (key: string) => {
  const [kind, kit, level, goal, length] = key.split(' ');
  // `built`: the length the day was generated at (the saved one, for a day shortened today).
  return { kind, kit, level, goal: goal.replace('-', ' ') as Goal, built: Number(length.split('>')[0]), today: Number(length.split('>').at(-1)) };
};
// #88: Intermediate and Advanced days of 45 min or less pair accessories, which changes them by design;
// they are checked in tests/supersets88.test.ts. Every other case is held to main here.
const paired = (key: string) => field(key).level !== 'Beginner' && field(key).today <= 45;
const pairedGroup = (group: string) => !group.includes(' Beginner ') && Number(group.split(' ')[2]) <= 45;
const changed = keys.filter((key) => !paired(key) && now[key] !== main[key]);
const setsOf = (value: string) => new Map(value.split('|')[0].split(' ').filter(Boolean).map((item) => [item.split(':')[0], Number(item.split(':')[1])]));

test('beginners get the same days as on main: every kit, length, shortened day and described day', () => {
  assert.equal(keys.length, stored.cases.length);
  assert.deepEqual(changed.filter((key) => field(key).level === 'Beginner'), []);
  // The whole generated output (loads and reps too), byte for byte.
  assert.deepEqual(Object.keys(after.hashes).filter((group) => group.includes(' Beginner ') && !sameOutput(group)), []);
});

test('a day built under 45 minutes, or an intermediate\'s under 60, is unchanged (#229)', () => {
  assert.deepEqual(changed.filter((key) => field(key).built < 45 || (field(key).level === 'Intermediate' && field(key).built < 60)), []);
  const unchanged = (group: string) => Number(group.split(' ')[2]) < 45 || (group.includes(' Intermediate ') && Number(group.split(' ')[2]) < 60);
  assert.deepEqual(Object.keys(after.hashes).filter((group) => !pairedGroup(group) && unchanged(group) && !sameOutput(group)), []);
});

test('a third only fills spare time: no exercise of main\'s day, built or shortened for today, loses a set', () => {
  const lost = changed.flatMap((key) => {
    const today = setsOf(now[key]);
    return [...setsOf(main[key])].filter(([id, sets]) => (today.get(id) ?? 0) < sets)
      .map(([id, sets]) => `${key}: ${id} ${sets} -> ${today.get(id) ?? 0}`);
  });
  assert.deepEqual(lost.slice(0, 10), [], `${lost.length} lose sets`);
});

test('a changed day stays within its length', () => {
  const over = changed.filter((key) => {
    const { kind, goal, today } = field(key);
    const sets = setsOf(now[key]);
    const minutes = kind === 'day'
      ? estimatedSeconds([...sets.values()], sessionRests([...sets.keys()], goal, today), today) / 60
      : Number(now[key].split('|')[1]);
    return minutes > today;
  });
  assert.deepEqual(over, []);
});

const added = changed.flatMap((key) => [...setsOf(now[key]).keys()].filter((id) => !setsOf(main[key]).has(id)).map((id) => ({ key, id })));

test('a third is a loaded move in a kit that loads the muscle: no push-up as a gym\'s third press', () => {
  assert.ok(added.length > 0);
  const loads = (key: string, muscle: MuscleGroup) => key.includes(' bodyweight ') ? false
    : [...setsOf(now[key]).keys()].some((id) => exerciseById(id)!.muscles[0] === muscle && exerciseById(id)!.equipment !== 'Bodyweight');
  assert.deepEqual(added.filter(({ key, id }) => exerciseById(id)!.equipment === 'Bodyweight' && loads(key, exerciseById(id)!.muscles[0])), []);
});

test('a third is a new movement for its muscle: a fly beside the presses, never a pulldown beside a chin-up', () => {
  const patterns = (id: string) => { const exercise = exerciseById(id)!; return [exercise.pattern, ...(exercise.secondaryPatterns ?? [])]; };
  const repeats = added.filter(({ key, id }) => {
    const trained = [...setsOf(now[key]).keys()].filter((other) => other !== id && exerciseById(other)!.muscles.includes(exerciseById(id)!.muscles[0]));
    // A compound third adds a pattern none of them has; an isolation third copies none of them.
    return isCompound(exerciseById(id)!)
      ? patterns(id).every((pattern) => trained.some((other) => patterns(other).includes(pattern)))
      : trained.some((other) => patterns(other).join() === patterns(id).join());
  });
  assert.deepEqual(repeats, []);
});

test('every added exercise is one of the thirds its day or program carries', () => {
  assert.deepEqual(added.filter(({ key, id }) => !after.thirds[key].includes(id)), []);
});

test('every day runs lead, compounds, isolation, core (#133): a third sits by its own role', () => {
  const ids = (key: string) => now[key].split('|')[0].split(' ').filter(Boolean).map((item) => item.split(':')[0]);
  const role = (id: string) => { const exercise = exerciseById(id)!; return exercise.muscles[0] === 'Core' ? 2 : isCompound(exercise) ? 0 : 1; };
  // The lead may be any role; from the second exercise on, no role comes back after a later one.
  const outOfOrder = keys.filter((key) => ids(key).slice(1).some((id, index, rest) => index > 0 && role(id) < role(rest[index - 1])));
  assert.deepEqual(outOfOrder.slice(0, 5), [], `${outOfOrder.length} out of order`);
});

test('a saved day shortened for today drops exactly its program\'s thirds before cutting a set', () => {
  const profile = profileOf('gym', 'Advanced', 3, 90);
  const slot = planSlots(buildPlan(profile))[0];
  const program = todayProgram(profile, slot, [], { minutes: 45 });
  assert.ok((program.thirds ?? []).length > 0, 'the saved 90-minute Push carries a third');
  const trim = (from: typeof program) => adaptWorkout(from, { ...defaultConstraints(profile), minutes: 45 }, [], profile.goal);
  const without = { ...program, exercises: program.exercises.filter((exercise) => !program.thirds!.includes(exercise.exerciseId)), thirds: undefined };
  const adapted = trim(program);
  assert.deepEqual(adapted.skipped.filter((item) => item.reason === 'time').map((item) => item.exerciseId), program.thirds);
  assert.deepEqual(listOf(adapted.exercises), listOf(trim(without).exercises), 'the rest trims as the day without its thirds');
  // A program without `thirds` (legacy, or another caller) drops nothing extra: the fly stays at its floor.
  assert.ok(trim({ ...program, thirds: undefined }).exercises.some((exercise) => exercise.exerciseId === program.thirds![0]));
});

test('the per-muscle cap: 2, or 3 on the focus day for advanced and for intermediate at 60+ minutes', () => {
  const table = LEVELS.map((level) => [45, 60, 90].map((minutes) => `${muscleCap(level, minutes, true)}${muscleCap(level, minutes, false)}`).join(' '));
  assert.deepEqual(table, ['22 22 22', '22 32 32', '32 32 32']);
  // Under 45 minutes movements come before sets (#229): no muscle takes a third.
  for (const level of LEVELS) assert.equal(muscleCap(level, 30, true), 2);
});

const primaries = (profile: Profile, name: string) => {
  const plan = buildPlan(profile);
  const index = plan.findIndex((day) => day.name === name);
  return generateWorkout(profile, plan[index], index, []).exercises.map((exercise) => exerciseById(exercise.exerciseId)!);
};

test('an advanced Push day with time to spare in a full gym holds a third, loaded chest movement', () => {
  // At 60 minutes the day's own sets fill the time, so no third (a third only takes spare time).
  for (const [daysPerWeek, name] of [[3, 'Push'], [6, 'Push A'], [6, 'Push B']] as const) {
    const day = primaries(profileOf('gym', 'Advanced', daysPerWeek, 90), name);
    const presses = day.filter((exercise) => exercise.pattern === 'horizontal_push');
    assert.ok(presses.length === 3 && presses.every((exercise) => exercise.equipment !== 'Bodyweight'),
      `${name}: ${presses.map((exercise) => exercise.id).join(', ')}`);
  }
});
