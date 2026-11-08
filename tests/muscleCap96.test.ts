import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout, muscleCap } from '../src/lib/generator.ts';
import type { Goal, Profile } from '../src/types.ts';

// #96: a muscle may take a third exercise on its focus day for an advanced lifter, and for an
// intermediate one at 60 minutes or more. Beginners keep 2. An exercise counts for its first muscle.

const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  homeBar: { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
  bodyweight: { equipment: [], support: [] },
} as const;
const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const LENGTHS = [15, 20, 30, 45, 60, 90];
const FIXTURE = new URL('./fixtures/muscleCap96-main.json', import.meta.url);

const profileOf = (kit: keyof typeof KITS, experience: Profile['experience'], daysPerWeek: number, sessionMinutes: number, goal: Goal = 'Build Muscle') =>
  ({ goal, experience, daysPerWeek, unit: 'lb', sessionMinutes, ...KITS[kit], exclusions: [], loads: {} }) as unknown as Profile;

type Sweep = { output: Record<string, string>; muscles: Record<string, string> };

/** Every generated day of one kit, level, split and length, all goals, hashed: whole output, and muscles trained. */
function sweep(): Sweep {
  const out: Sweep = { output: {}, muscles: {} };
  for (const kit of Object.keys(KITS) as (keyof typeof KITS)[]) for (const experience of LEVELS)
    for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const minutes of LENGTHS) {
      const output = createHash('sha256');
      const muscles = createHash('sha256');
      for (const goal of GOALS) {
        const profile = profileOf(kit, experience, daysPerWeek, minutes, goal);
        buildPlan(profile).forEach((day, index) => {
          const session = generateWorkout(profile, day, index, []);
          output.update(JSON.stringify(session));
          muscles.update(`${[...new Set(session.exercises.map((exercise) => exerciseById(exercise.exerciseId)!.muscles[0]))].sort()}\n`);
        });
      }
      const key = `${kit} ${experience} ${daysPerWeek}d ${minutes}`;
      out.output[key] = output.digest('hex').slice(0, 16);
      out.muscles[key] = muscles.digest('hex').slice(0, 16);
    }
  return out;
}

// The fixture is the generator's output on main 32d59c2, before #96 (`WRITE_FIXTURE=1` rewrites it).
if (process.env.WRITE_FIXTURE) writeFileSync(FIXTURE, `${JSON.stringify(sweep(), null, 1)}\n`);

const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Sweep;
const now = sweep();
const changed = Object.keys(now.output).filter((key) => now.output[key] !== main.output[key]);
const level = (key: string) => key.split(' ')[1];
const minutesOf = (key: string) => Number(key.split(' ')[3]);

test('beginners get the same days as on main, for every split, length and kit', () => {
  assert.equal(Object.keys(now.output).length, 360);
  assert.deepEqual(changed.filter((key) => level(key) === 'Beginner'), []);
});

test('under 45 minutes no day changes, so a third exercise never pushes out another muscle (#229)', () => {
  assert.deepEqual(changed.filter((key) => minutesOf(key) < 45), []);
  assert.deepEqual(changed.filter((key) => level(key) === 'Intermediate' && minutesOf(key) < 60), []);
});

test('a third exercise never costs a day a muscle it trained on main, at any length', () => {
  assert.deepEqual(Object.keys(now.muscles).filter((key) => now.muscles[key] !== main.muscles[key]), []);
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

test('an advanced Push day at 60 minutes in a full gym holds three chest presses', () => {
  for (const [daysPerWeek, name] of [[3, 'Push'], [6, 'Push A']] as const) {
    const day = primaries(profileOf('gym', 'Advanced', daysPerWeek, 60), name);
    const presses = day.filter((exercise) => exercise.pattern === 'horizontal_push').map((exercise) => exercise.id);
    assert.ok(presses.length === 3, `${name}: ${presses.join(', ')}`);
  }
});
