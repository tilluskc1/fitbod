import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import type { Goal, Profile } from '../src/types.ts';

// #88: with "Pair exercises to save time" Off, a Beginner, or a day over 45 minutes, every day is
// byte-identical to main before supersets: same exercises, order, sets, loads, reps and minutes.
// The fixture is every case on main 522f2f1 (`WRITE_FIXTURE=1` with main's code rewrites it; main
// ignores the pairing argument and the profile key).

const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  homeBar: { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
  bodyweight: { equipment: [], support: [] },
} as const;
const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const SAVED = [15, 20, 30, 45, 60];
const TODAY = [15, 20, 30, 45];
const SETUPS = ['home', 'hotel', 'bodyweight', 'bands'] as const;

/** Every case, grouped by profile and whether today's length is over 45; the value is what a lifter sees of each day. */
function cases(pairExercises?: boolean) {
  const out: Record<string, string> = {};
  for (const kit of Object.keys(KITS) as (keyof typeof KITS)[]) for (const goal of GOALS) for (const experience of LEVELS) {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of SAVED) {
      const profile = {
        goal, experience, daysPerWeek, unit: 'kg', sessionMinutes, ...KITS[kit], exclusions: [], loads: {},
        ...(pairExercises === undefined ? {} : { pairExercises }),
      } as unknown as Profile;
      for (const slot of planSlots(buildPlan(profile))) {
        for (const equipment of SETUPS) for (const minutes of [sessionMinutes, ...TODAY.filter((value) => value !== sessionMinutes)]) {
          if (equipment !== 'home' && minutes !== sessionMinutes && minutes !== 30) continue;
          const constraints = { ...defaultConstraints(profile), minutes, equipment };
          const program = todayProgram(profile, slot, [], { minutes, equipment });
          const adapted = adaptWorkout(program, constraints, profile.exclusions, goal, profile);
          const glance = todayGlance(adapted, null, false, goal, profile);
          const key = `${kit}|${goal}|${experience}|${daysPerWeek}|${sessionMinutes}|${minutes > 45 ? 'over45' : 'short'}`;
          out[key] = (out[key] ?? '') + `${slot.id}|${equipment}|${minutes}` + JSON.stringify({
            program: program.exercises.map((exercise) => [exercise.exerciseId, exercise.sets, exercise.weight, exercise.targetReps]),
            adapted: adapted.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]),
            minutes: glance.minutes,
            note: adapted.note,
          });
        }
      }
    }
  }
  return out;
}

const FIXTURE = new URL('./fixtures/supersets88-main.json.gz', import.meta.url);
const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 10);

if (process.env.WRITE_FIXTURE === '1') {
  const all = cases();
    writeFileSync(FIXTURE, gzipSync(JSON.stringify(Object.fromEntries(Object.entries(all).map(([key, value]) => [key, hash(value)])))));
}

const main: Record<string, string> = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());
const on = cases();

test('switch Off: every day, at every saved and today-only length and setup, is byte-identical to main', () => {
  const off = cases(false);
  assert.equal(Object.keys(off).length, Object.keys(main).length);
  const changed = Object.entries(off).filter(([key, value]) => main[key] !== hash(value)).map(([key]) => key);
  assert.deepEqual(changed, []);
});

test('switch absent (On): Beginners and days over 45 minutes are byte-identical to main', () => {
  const changed = Object.entries(on)
    .filter(([key]) => {
      const [, , experience, , , length] = key.split('|');
      return experience === 'Beginner' || length === 'over45';
    })
    .filter(([key, value]) => main[key] !== hash(value)).map(([key]) => key);
  assert.deepEqual(changed, []);
});

test('pairing changes some Intermediate and Advanced days of 45 min or less', () => {
  const changed = Object.entries(on).filter(([key, value]) => main[key] !== hash(value)).map(([key]) => key);
  assert.ok(changed.length > 0);
  assert.ok(changed.every((key) => !key.includes('|Beginner|')));
});
