import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
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

/** Every generated day of one kit, level, split and length, all goals, hashed. */
function sweep(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kit of Object.keys(KITS) as (keyof typeof KITS)[]) for (const experience of LEVELS)
    for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const minutes of LENGTHS) {
      const hash = createHash('sha256');
      for (const goal of GOALS) {
        const profile = profileOf(kit, experience, daysPerWeek, minutes, goal);
        buildPlan(profile).forEach((day, index) => hash.update(JSON.stringify(generateWorkout(profile, day, index, []))));
      }
      out[`${kit} ${experience} ${daysPerWeek}d ${minutes}`] = hash.digest('hex').slice(0, 16);
    }
  return out;
}

// The fixture is the generator's output on main 32d59c2, before #96 (`WRITE_FIXTURE=1` rewrites it).
if (process.env.WRITE_FIXTURE) writeFileSync(FIXTURE, `${JSON.stringify(sweep(), null, 1)}\n`);

test('beginners, every day under 45 minutes, and intermediates under 60 are unchanged from main', () => {
  const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const now = sweep();
  assert.equal(Object.keys(now).length, 360);
  const changed = Object.keys(now).filter((key) => now[key] !== main[key]);
  const unchangeable = changed.filter((key) => {
    const [, experience, , minutes] = key.split(' ');
    return experience === 'Beginner' || Number(minutes) < 45 || (experience === 'Intermediate' && Number(minutes) < 60);
  });
  assert.deepEqual(unchangeable, []);
});
