import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { restSecondsFor, REST_SECONDS, SHORT_REST_SECONDS } from '../src/lib/sessionTime.ts';
import { leadCompoundId } from '../src/lib/progression.ts';
import { exerciseById } from '../src/data/exercises.ts';
import type { Goal, Profile } from '../src/types.ts';

// #229: a 30-minute session gave 3 exercises and 9 sets: full rests at exactly 30 minutes, a 4-5 set
// lead, and whole movements cut before any set. A today-only 30 of a 60-minute day gave 5 and 10.

const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  bodyweight: { equipment: [], support: [] },
} as const;
const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

function* days(kits: (keyof typeof KITS)[], sessionMinutes: number) {
  for (const kit of kits) for (const goal of GOALS) for (const experience of LEVELS) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    const profile = { goal, experience, daysPerWeek, unit: 'lb', sessionMinutes, ...KITS[kit], exclusions: [], loads: {} } as unknown as Profile;
    for (const slot of planSlots(buildPlan(profile))) yield { kit, profile, slot, label: `${kit} ${goal} ${experience} ${daysPerWeek}d ${slot.name}` };
  }
}

function today(profile: Profile, slot: ReturnType<typeof planSlots>[number], minutes: number) {
  const constraints = { ...defaultConstraints(profile), minutes };
  const program = todayProgram(profile, slot, [], minutes === profile.sessionMinutes ? {} : { minutes });
  const adapted = adaptWorkout(program, constraints, profile.exclusions, profile.goal);
  return { program, adapted, glance: todayGlance(adapted, null, false, profile.goal) };
}

test('a 30-minute session rests at the short end; 45 minutes keeps full rests', () => {
  const press = exerciseById('dumbbell-bench-press')!;
  assert.equal(restSecondsFor(press, true, 'Build Muscle', 30), SHORT_REST_SECONDS.lead);
  assert.equal(restSecondsFor(press, false, 'Build Muscle', 30), SHORT_REST_SECONDS.compound);
  assert.equal(restSecondsFor(press, true, 'Build Muscle', 45), REST_SECONDS.lead);
});

test('a saved 30-minute gym or home day has at least 4 movements, none past 3 sets or the lead, within 30 minutes', () => {
  const thin: string[] = [];
  for (const { profile, slot, label } of days(['gym', 'home'], 30)) {
    const { adapted, glance } = today(profile, slot, 30);
    if (adapted.exercises.length === 0) continue;
    const lead = leadCompoundId(adapted.exercises.map((exercise) => exercise.exerciseId));
    const leadSets = adapted.exercises.find((exercise) => exercise.exerciseId === lead)?.sets ?? 3;
    if (adapted.exercises.length < 4) thin.push(`${label}: ${adapted.exercises.length}`);
    for (const exercise of adapted.exercises) {
      assert.ok(exercise.sets <= 3, `${label}: ${exercise.name} ${exercise.sets} sets`);
      assert.ok(exercise.sets <= leadSets, `${label}: ${exercise.name} passes the lead`);
    }
    assert.ok(glance.minutes <= 30, `${label}: ${glance.minutes} min`);
  }
  assert.deepEqual(thin, []);
});

test('under 45 minutes no movement passes 3 sets, saved or shortened for today', () => {
  for (const { profile, slot, label } of days(['gym', 'home'], 60)) {
    const { adapted } = today(profile, slot, 30);
    for (const exercise of adapted.exercises) assert.ok(exercise.sets <= 3, `${label} today 30: ${exercise.name} ${exercise.sets}`);
  }
});

test('a saved 30-minute day and a 60-minute day shortened to 30 for today are the same day', () => {
  const differ: string[] = [];
  for (const { profile, slot, label } of days(['gym', 'home', 'bodyweight'], 30)) {
    const saved = today(profile, slot, 30);
    const shortened = today({ ...profile, sessionMinutes: 60 }, slot, 30);
    const shape = (day: typeof saved) => `${day.adapted.exercises.map((exercise) => `${exercise.exerciseId}x${exercise.sets}`).join(' ')} | ${day.glance.minutes}`;
    if (shape(saved) !== shape(shortened)) differ.push(`${label}\n  saved ${shape(saved)}\n  today ${shape(shortened)}`);
  }
  assert.deepEqual(differ, []);
});

test('a bodyweight 30-minute day with 0 or 1 movement is never called Ready', () => {
  for (const { profile, slot, label } of days(['bodyweight'], 30)) {
    const { program, adapted } = today(profile, slot, 30);
    if (adapted.exercises.length <= 1) assert.notEqual(program.feasibility?.status ?? 'ok', 'ok', label);
  }
});

test('45 and 60 minutes are unchanged: saved 45, saved 60, and 60 shortened to 45 for today', () => {
  // Fingerprints of every generated day (exercises x sets, promised minutes, status) on main 460970b,
  // before #229. A change here is a change to 45/60-minute programming: owner decision, not a fix.
  const fingerprint = (saved: number, minutes: number) => {
    const lines: string[] = [];
    for (const { profile, slot } of days(['gym', 'home', 'bodyweight'], saved)) {
      const { program, adapted, glance } = today(profile, slot, minutes);
      lines.push(`${adapted.exercises.map((exercise) => `${exercise.exerciseId}x${exercise.sets}`).join(' ')}|${glance.minutes}|${program.feasibility?.status}`);
    }
    return `${lines.length} ${createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)}`;
  };
  assert.equal(fingerprint(45, 45), '720 0a32976338351765');
  assert.equal(fingerprint(60, 60), '720 9e4652a30bc81703');
  assert.equal(fingerprint(60, 45), '720 2fe9cffcf719b9ea');
});
