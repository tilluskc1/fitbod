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
  homeBar: { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
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
  // The app passes the profile as pairing (#88).
  const adapted = adaptWorkout(program, constraints, profile.exclusions, profile.goal, profile);
  return { program, adapted, glance: todayGlance(adapted, null, false, profile.goal, profile) };
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
  for (const { profile, slot, label } of days(['gym', 'home', 'homeBar'], 60)) {
    const { adapted } = today(profile, slot, 30);
    for (const exercise of adapted.exercises) assert.ok(exercise.sets <= 3, `${label} today 30: ${exercise.name} ${exercise.sets}`);
  }
});

test('a saved short day and a longer day shortened to it for today are the same day', () => {
  // Reviewer repro: a saved 45 picked down to 30 still gave 3 exercises (#229 review 1).
  const differ: string[] = [];
  const shape = (day: ReturnType<typeof today>) => `${day.adapted.exercises.map((exercise) => `${exercise.exerciseId}x${exercise.sets}`).join(' ')} | ${day.glance.minutes}`;
  for (const minutes of [15, 20, 30]) {
    for (const { profile, slot, label } of days(['gym', 'home', 'homeBar', 'bodyweight'], minutes)) {
      const saved = shape(today(profile, slot, minutes));
      for (const from of [45, 60, 90]) {
        const shortened = shape(today({ ...profile, sessionMinutes: from }, slot, minutes));
        if (saved !== shortened) differ.push(`${label} ${from} -> ${minutes}\n  saved ${saved}\n  today ${shortened}`);
      }
    }
  }
  assert.deepEqual(differ.slice(0, 5), [], `${differ.length} differ`);
});

test('a gym or home day shortened to 30 for today has at least 4 movements, from any saved length', () => {
  const thin: string[] = [];
  for (const from of [45, 60, 90]) {
    for (const { profile, slot, label } of days(['gym', 'home', 'homeBar'], from)) {
      const { adapted, glance } = today(profile, slot, 30);
      if (adapted.exercises.length > 0 && adapted.exercises.length < 4) thin.push(`${label} ${from} -> 30: ${adapted.exercises.length}`);
      assert.ok(glance.minutes <= 30, `${label} ${from} -> 30: ${glance.minutes} min`);
    }
  }
  assert.deepEqual(thin, []);
});

test('a day shortened under 45 for today names what it dropped and says it was trimmed', () => {
  const profile = { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, unit: 'lb', sessionMinutes: 60, ...KITS.gym, exclusions: [], loads: {} } as unknown as Profile;
  const slot = planSlots(buildPlan(profile))[0];
  const { adapted } = today(profile, slot, 30);
  assert.ok(adapted.skipped.some((item) => item.reason === 'time'), JSON.stringify(adapted.skipped));
  assert.match(adapted.note, /^Volume trimmed to \d+ sets to fit 30 min\. .+ skipped to fit 30 min\./);
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
      // #88: Intermediate and Advanced days of 45 min pair accessories by design; the rest stays pinned
      // (every Beginner and over-45 day is also pinned in tests/supersets88Off.test.ts).
      if (minutes <= 45 && profile.experience !== 'Beginner') continue;
      const { program, adapted, glance } = today(profile, slot, minutes);
      lines.push(`${adapted.exercises.map((exercise) => `${exercise.exerciseId}x${exercise.sets}`).join(' ')}|${glance.minutes}|${program.feasibility?.status}`);
    }
    return `${lines.length} ${createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)}`;
  };
  assert.equal(fingerprint(45, 45), '240 a6714e4d0db6ad85'); // Beginners only (#88), recomputed on 460970b
  assert.equal(fingerprint(60, 60), '720 9e4652a30bc81703');
  assert.equal(fingerprint(60, 45), '240 e5820b14fa6deee4'); // Beginners only (#88), recomputed on 460970b
});
