import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, todayGlance, workMinutes } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { leadCompoundId } from '../src/lib/progression.ts';
import { createSession, logSet, skipExercise, swapPendingExercise } from '../src/lib/session.ts';
import { sessionRests, TRANSITION_SECONDS, WORK_SECONDS } from '../src/lib/sessionTime.ts';
import {
  PAIR_SWITCH_SECONDS, canPair, pairRound, partnerOf, pairSeconds, pairedPendingIndex, pairingOn, restAfterLog, sessionPairs,
} from '../src/lib/supersets.ts';
import { validateState } from '../src/lib/validate.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { swapCandidateFor } from '../src/lib/adapt.ts';
import type { Goal, Profile, WorkoutExercise, WorkoutRecord } from '../src/types.ts';

const KITS = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  homeBar: { equipment: ['Dumbbell'], support: ['Bench', 'Pull-up bar'] },
  bodyweight: { equipment: [], support: [] },
} as const;
const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];

const profileOf = (over: Partial<Profile> & { kit?: keyof typeof KITS } = {}): Profile => {
  const { kit = 'gym', ...rest } = over;
  return { goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, unit: 'kg', sessionMinutes: 30, ...KITS[kit], exclusions: [], loads: {}, ...rest } as unknown as Profile;
};
/** A state through validation, as a reload or restore reads it. */
const valid = (value: unknown) => {
  const result = validateState(JSON.parse(JSON.stringify(value)));
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.state;
};
const upper = (profile: Profile) => planSlots(buildPlan(profile)).find((slot) => slot.name.startsWith('Upper'))!;

test('Intermediate, 30 min Upper: at least one accessory pair, the lead stays straight; Beginner none', () => {
  for (const kit of ['gym', 'home'] as const) {
    const profile = profileOf({ kit });
    const program = todayProgram(profile, upper(profile), []);
    const pairs = sessionPairs(program.exercises, profile, 30);
    assert.ok(pairs.length >= 1, kit);
    const lead = leadCompoundId(program.exercises.map((exercise) => exercise.exerciseId));
    assert.equal(program.exercises[0].exerciseId, lead);
    assert.ok(pairs.every(([a, b]) => a > 0 && b === a + 1), kit);
    const beginner = profileOf({ kit, experience: 'Beginner' });
    assert.deepEqual(sessionPairs(todayProgram(beginner, upper(beginner), []).exercises, beginner, 30), []);
  }
  // The gym Pull day pairs a face pull with a curl, the story's own example.
  const gym = profileOf({ daysPerWeek: 3 });
  const pull = planSlots(buildPlan(gym)).find((slot) => slot.name === 'Pull')!;
  const ids = todayProgram(gym, pull, []).exercises.map((exercise) => exercise.exerciseId);
  const pairs = sessionPairs(ids.map((exerciseId) => ({ exerciseId })), gym, 30).map(([a, b]) => [ids[a], ids[b]].join('+'));
  assert.ok(pairs.includes('face-pull+hammer-curl'), pairs.join());
});

test('who pairs: Intermediate and Advanced at 45 min or less with the toggle not Off; never Beginner, over 45, or an unknown length', () => {
  assert.equal(pairingOn({ experience: 'Intermediate' }, 45), true);
  assert.equal(pairingOn({ experience: 'Advanced' }, 15), true);
  assert.equal(pairingOn({ experience: 'Advanced', pairExercises: true }, 30), true);
  assert.equal(pairingOn({ experience: 'Beginner' }, 30), false);
  assert.equal(pairingOn({ experience: 'Intermediate' }, 46), false);
  assert.equal(pairingOn({ experience: 'Intermediate' }, 60), false);
  assert.equal(pairingOn({ experience: 'Intermediate', pairExercises: false }, 30), false);
  assert.equal(pairingOn({ experience: 'Intermediate' }, undefined), false);
  assert.equal(pairingOn(null, 30), false);
});

test('sweep: pairs never share a main muscle, never hold the lead or two barbell lifts, sit side by side; across kits, goals, levels, days and lengths', () => {
  let pairsSeen = 0;
  for (const kit of Object.keys(KITS) as (keyof typeof KITS)[]) for (const goal of GOALS) for (const experience of ['Intermediate', 'Advanced'] as const) {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of [15, 20, 30, 45]) {
      const profile = profileOf({ kit, goal, experience, daysPerWeek, sessionMinutes });
      for (const slot of planSlots(buildPlan(profile))) {
        for (const equipment of ['home', 'hotel', 'bodyweight', 'bands'] as const) {
          const program = todayProgram(profile, slot, [], { equipment });
          const adapted = adaptWorkout(program, { ...defaultConstraints(profile), equipment }, [], goal, profile);
          const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
          const lead = leadCompoundId(ids);
          for (const [a, b] of sessionPairs(adapted.exercises, profile, adapted.minutes)) {
            pairsSeen += 1;
            const first = exerciseById(ids[a])!;
            const second = exerciseById(ids[b])!;
            const label = `${kit} ${goal} ${experience} ${daysPerWeek}d ${sessionMinutes} ${slot.name} ${equipment}: ${ids[a]}+${ids[b]}`;
            assert.equal(b, a + 1, label);
            assert.notEqual(ids[a], lead, label);
            assert.notEqual(ids[b], lead, label);
            assert.notEqual(first.muscles[0], second.muscles[0], label);
            assert.ok(!second.muscles.includes(first.muscles[0]) && !first.muscles.includes(second.muscles[0]), label);
            assert.ok(!(first.equipment === 'Barbell' && second.equipment === 'Barbell'), label);
            assert.ok(canPair(first, second), label);
          }
        }
      }
    }
  }
  assert.ok(pairsSeen > 100);
});

test('grouping is stable: the same inputs give the same pairs', () => {
  const profile = profileOf({ experience: 'Advanced', sessionMinutes: 20 });
  const one = todayProgram(profile, upper(profile), []);
  const two = todayProgram(profile, upper(profile), []);
  assert.deepEqual(one.exercises.map((exercise) => exercise.exerciseId), two.exercises.map((exercise) => exercise.exerciseId));
  assert.deepEqual(sessionPairs(one.exercises, profile, 20), sessionPairs(two.exercises, profile, 20));
});

test('a pair is timed as it runs: one move in, A + 30 s + B per round, the longer rest between rounds, leftovers straight', () => {
  const round = 2 * WORK_SECONDS + PAIR_SWITCH_SECONDS;
  assert.equal(pairSeconds({ sets: 3, rest: 60 }, { sets: 3, rest: 60 }), TRANSITION_SECONDS + 3 * round + 2 * 60);
  assert.equal(pairSeconds({ sets: 2, rest: 90 }, { sets: 2, rest: 60 }), TRANSITION_SECONDS + 2 * round + 90);
  // 3 and 2: two rounds, then the round rest and A's third set.
  assert.equal(pairSeconds({ sets: 3, rest: 60 }, { sets: 2, rest: 45 }), TRANSITION_SECONDS + 2 * round + 60 + 60 + WORK_SECONDS);
  // A pair takes less time than the same work straight.
  const straight = 2 * (3 * WORK_SECONDS + 2 * 60 + TRANSITION_SECONDS);
  assert.ok(pairSeconds({ sets: 3, rest: 60 }, { sets: 3, rest: 60 }) < straight);
});

test('promised minutes stay honest and a short day fits at least as much work paired, at 15, 20, 30 and 45 min', () => {
  for (const kit of ['gym', 'home', 'homeBar'] as const) for (const goal of GOALS) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    for (const sessionMinutes of [15, 20, 30, 45]) {
      const on = profileOf({ kit, goal, daysPerWeek, sessionMinutes });
      const off = { ...on, pairExercises: false };
      for (const slot of planSlots(buildPlan(on))) {
        const label = `${kit} ${goal} ${daysPerWeek}d ${sessionMinutes} ${slot.name}`;
        const paired = adaptWorkout(todayProgram(on, slot, []), defaultConstraints(on), [], goal, on);
        const straight = adaptWorkout(todayProgram(off, slot, []), defaultConstraints(off), [], goal, off);
        const glanceOn = todayGlance(paired, null, false, goal, on);
        const glanceOff = todayGlance(straight, null, false, goal, off);
        assert.ok(paired.totalSets >= straight.totalSets, label);
        // Within the length whenever the straight day is (the 15/20 min floors may run over either way).
        if (glanceOff.minutes <= sessionMinutes) assert.ok(glanceOn.minutes <= sessionMinutes, `${label}: ${glanceOn.minutes}`);
        // At a 15/20 min floor that runs over, pairing never runs longer than the straight day did.
        else assert.ok(glanceOn.minutes <= glanceOff.minutes, `${label}: floor ${glanceOn.minutes} > ${glanceOff.minutes}`);
        // The minutes shown are the paired model of the exercises as listed, the one the logger runs.
        assert.equal(glanceOn.minutes, workMinutes(paired.exercises, goal, sessionMinutes, on), label);
      }
    }
  }
});

/** A running session of these exercises, `sets` each, at `durationMin`. */
const sessionOf = (ids: string[], sets: number[] | number = 3, durationMin = 30): WorkoutRecord => createSession({
  id: 's1', name: 'Upper A', dayIndex: 0, now: '2026-11-12T10:00:00.000Z', durationMin,
  exercises: ids.map((exerciseId, index): WorkoutExercise => {
    const count = Array.isArray(sets) ? sets[index] : sets;
    const planned = Array.from({ length: count }, () => ({ weight: 10, reps: 10 }));
    return { exerciseId, name: exerciseId, planned, performed: planned.map((set) => ({ ...set, done: false, completedAt: null })) };
  }),
});
const IDS = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown'];
const PROFILE = profileOf();

/** Logs whatever the logger shows next, with the rest it would start; returns the order and rests. */
function run(session: WorkoutRecord, steps: number, profile: Pick<Profile, 'experience' | 'pairExercises'> = PROFILE) {
  const order: string[] = [];
  const rests: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const pairs = sessionPairs(session.exercises, profile, session.durationMin);
    const index = pairedPendingIndex(session, pairs);
    if (index < 0) break;
    const exercise = session.exercises[index];
    const setIndex = exercise.performed.findIndex((set) => !set.done);
    const rest = restAfterLog(session, index, sessionRests(session.exercises.map((item) => item.exerciseId), 'Build Muscle', session.durationMin), pairs);
    order.push(`${exercise.exerciseId}#${setIndex + 1}`);
    rests.push(rest);
    session = logSet(session, index, setIndex, `2026-11-12T10:${String(10 + step).padStart(2, '0')}:00.000Z`, rest);
  }
  return { session, order, rests };
}

test('logging a pair alternates A1, B1, A2, B2 with 30 s between them and the full rest after each round', () => {
  const session = sessionOf(IDS);
  assert.deepEqual(sessionPairs(session.exercises, PROFILE, 30), [[1, 2]]);
  const { order, rests } = run(session, 9);
  assert.deepEqual(order, [
    'barbell-bench-press#1', 'barbell-bench-press#2', 'barbell-bench-press#3',
    'face-pull#1', 'hammer-curl#1', 'face-pull#2', 'hammer-curl#2', 'face-pull#3', 'hammer-curl#3',
  ]);
  const short = sessionRests(IDS, 'Build Muscle', 30);
  assert.deepEqual(rests.slice(3), [30, Math.max(short[1], short[2]), 30, Math.max(short[1], short[2]), 30, Math.max(short[1], short[2])]);
  // Each set is logged on its own exercise.
  const logged = run(session, 9).session;
  assert.ok(logged.exercises.slice(0, 3).every((exercise) => exercise.performed.every((set) => set.done)));
});

test('"Round 2 of 3" while a pair runs; the leftover sets of an unequal pair run straight with their own rest', () => {
  let session = sessionOf(IDS, [3, 3, 2, 3]);
  session = run(session, 4).session; // bench 3, face pull 1
  const pairs = sessionPairs(session.exercises, PROFILE, 30);
  assert.equal(pairedPendingIndex(session, pairs), 2);
  assert.deepEqual(pairRound(session, 2, pairs), { round: 1, rounds: 2 });
  session = run(session, 1).session; // curl 1
  assert.deepEqual(pairRound(session, 1, pairs), { round: 2, rounds: 2 });
  const rest = run(session, 3);
  assert.deepEqual(rest.order, ['face-pull#2', 'hammer-curl#2', 'face-pull#3']);
  const own = sessionRests(IDS, 'Build Muscle', 30)[1];
  assert.equal(rest.rests[2], own);
  assert.equal(pairRound(rest.session, 1, pairs), null);
});

test('a reload mid-round resumes at the right set: the next step reads only the logged sets', () => {
  const half = run(sessionOf(IDS), 4).session; // bench 3, face pull 1
  const reloaded = valid({ profile: PROFILE, plan: [], history: [], current: half }).current!;
  const pairs = sessionPairs(reloaded.exercises, PROFILE, reloaded.durationMin);
  assert.equal(reloaded.exercises[pairedPendingIndex(reloaded, pairs)].exerciseId, 'hammer-curl');
});

test('skipping one exercise of a pair turns its partner straight, and nothing re-pairs', () => {
  const ids = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'plank'];
  let session = sessionOf(ids);
  assert.deepEqual(sessionPairs(session.exercises, PROFILE, 30), [[1, 2], [3, 4]]);
  session = run(session, 4).session; // bench 3, face pull 1
  session = skipExercise(session, 2);
  // Face pull goes straight from its next set; pushdown + plank keep their own pair.
  assert.deepEqual(sessionPairs(session.exercises, PROFILE, 30), [[3, 4]]);
  const next = run(session, 2);
  assert.deepEqual(next.order, ['face-pull#2', 'face-pull#3']);
  assert.equal(next.rests[0], sessionRests(ids, 'Build Muscle', 30)[1]);
});

test('a swap keeps the pair when the replacement can pair, and turns the partner straight when it cannot', () => {
  let session = run(sessionOf(IDS), 4).session; // bench 3, face pull 1
  const curl = swapPendingExercise(session, 2, { exerciseId: 'dumbbell-curl', name: 'Dumbbell Curl', weight: 10, reps: 10 });
  assert.deepEqual(sessionPairs(curl.exercises, PROFILE, 30), [[1, 2]]);
  const press = swapPendingExercise(session, 2, { exerciseId: 'dumbbell-row', name: 'Dumbbell Row', weight: 10, reps: 10 });
  // Face pull and a row share the back: face pull goes straight. The row now sits beside the pushdown,
  // which had no partner, and those two may pair (derived from the list; nothing is stored).
  assert.equal(partnerOf(sessionPairs(press.exercises, PROFILE, 30), 1), undefined);
  session = press;
  assert.deepEqual(run(session, 1).order, ['face-pull#2']);
});

test('the toggle is read live: Off mid-session runs the next set straight and leaves logged sets alone', () => {
  const half = run(sessionOf(IDS), 4).session; // bench 3, face pull 1
  const off = { ...PROFILE, pairExercises: false };
  const after = run(half, 1, off);
  assert.deepEqual(after.order, ['face-pull#2']);
  assert.deepEqual(after.session.exercises[1].performed[0], half.exercises[1].performed[0]);
  // On again: face pull already ran two straight sets ahead of the curl, so it is not switched into a
  // superset mid-way; it finishes straight.
  assert.deepEqual(run(after.session, 1).order, ['face-pull#3']);
  // On again one set later than a round: the pair resumes from the logged sets.
  assert.deepEqual(run(half, 1).order, ['hammer-curl#1']);
});

test('finishing early, an older record without a length, and a Beginner all log straight', () => {
  const legacy = { ...sessionOf(IDS), durationMin: undefined };
  assert.deepEqual(sessionPairs(legacy.exercises, PROFILE, legacy.durationMin), []);
  assert.deepEqual(sessionPairs(sessionOf(IDS).exercises, { experience: 'Beginner' }, 30), []);
  assert.deepEqual(sessionPairs(sessionOf(IDS, 3, 60).exercises, PROFILE, 60), []);
  // A finished pair half leaves the other straight: nothing waits on a finished exercise.
  const { session } = run(sessionOf(IDS, [3, 1, 3, 3]), 5); // bench 3, face pull 1, curl 1
  assert.equal(pairedPendingIndex(session, sessionPairs(session.exercises, PROFILE, 30)), 2);
});

test('Settings key: pairExercises round-trips through validate, absent stays absent (On), a bad value is refused', () => {
  const base = { plan: [], history: [], current: null };
  const on = valid({ ...base, profile: profileOf() }).profile!;
  assert.equal('pairExercises' in on, false);
  const off = valid({ ...base, profile: profileOf({ pairExercises: false }) }).profile!;
  assert.equal(off.pairExercises, false);
  assert.equal(validateState({ ...base, profile: { ...profileOf(), pairExercises: 'no' } }).ok, false);
});

/** The session's pairs as exercise-id pairs, for comparing across a swap that inserts an entry. */
const idPairs = (session: WorkoutRecord, profile: Profile, skip: number[] = []) => sessionPairs(session.exercises, profile, session.durationMin)
  .filter(([a, b]) => !skip.includes(a) && !skip.includes(b))
  .map(([a, b]) => `${session.exercises[a].exerciseId}+${session.exercises[b].exerciseId}`);

test('review 1: a swap after logged sets leaves every other pair where it was; the partner of the swapped slot goes straight (sweep)', () => {
  let swaps = 0;
  for (const kit of ['gym', 'home', 'homeBar'] as const) for (const goal of GOALS) for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of [20, 30, 45]) {
    const profile = profileOf({ kit, goal, daysPerWeek, sessionMinutes, experience: 'Advanced' });
    for (const slot of planSlots(buildPlan(profile))) {
      const program = todayProgram(profile, slot, []);
      const fresh = sessionOf(program.exercises.map((exercise) => exercise.exerciseId), program.exercises.map((exercise) => exercise.sets), sessionMinutes);
      const pairs = sessionPairs(fresh.exercises, profile, sessionMinutes);
      fresh.exercises.forEach((entry, index) => {
        // One logged set on the slot (and on its partner, so a pair has run a round), then swap the rest.
        let session = logSet(fresh, index, 0, '2026-11-12T10:01:00.000Z', 60);
        const partner = partnerOf(pairs, index);
        if (partner !== undefined) session = logSet(session, partner, 0, '2026-11-12T10:02:00.000Z', 60);
        const inDay = session.exercises.filter((_, i) => i !== index).map((item) => exerciseById(item.exerciseId)!);
        for (const option of rankedReplacements(exerciseById(entry.exerciseId)!, profile, inDay, 6)) {
          const swapped = swapPendingExercise(session, index, swapCandidateFor(option, profile, [], session));
          swaps += 1;
          const label = `${kit} ${goal} ${daysPerWeek}d ${sessionMinutes} ${slot.name}: ${entry.exerciseId} -> ${option.id}`;
          // Every pair not holding the swapped slot is unchanged.
          const before = idPairs(session, profile, partner === undefined ? [index] : [index, partner]);
          const after = idPairs(swapped, profile).filter((pair) => !pair.split('+').includes(entry.exerciseId) && !pair.split('+').includes(option.id)
            && (partner === undefined || !pair.split('+').includes(session.exercises[partner].exerciseId)));
          assert.deepEqual(after, before, label);
          // The replacement runs straight, and so does the partner.
          const replacement = swapped.exercises.findIndex((item, i) => i >= index && item.exerciseId === option.id);
          const swappedPairs = sessionPairs(swapped.exercises, profile, sessionMinutes);
          assert.equal(partnerOf(swappedPairs, replacement), undefined, label);
          if (partner !== undefined) {
            const moved = swapped.exercises.findIndex((item) => item.exerciseId === session.exercises[partner].exerciseId);
            const other = partnerOf(swappedPairs, moved);
            // Its only possible pairing is the done half of the slot, which has nothing left: it runs straight.
            assert.ok(other === undefined || swapped.exercises[other].performed.every((set) => set.done), label);
          }
        }
      });
    }
  }
  assert.ok(swaps > 500, `${swaps}`);
});

test('review 1: the lead is the first slot, by position: a lead swapped to a fly or a push-up stays straight and moves no pair', () => {
  const ids = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'leg-curl'];
  const fresh = sessionOf(ids);
  assert.deepEqual(sessionPairs(fresh.exercises, PROFILE, 30), [[1, 2], [3, 4]]);
  for (const to of ['cable-fly', 'push-up']) {
    const before = swapPendingExercise(fresh, 0, { exerciseId: to, name: to, weight: 0, reps: 10 });
    assert.deepEqual(sessionPairs(before.exercises, PROFILE, 30), [[1, 2], [3, 4]], `${to} before set 1`);
    const after = swapPendingExercise(logSet(fresh, 0, 0, '2026-11-12T10:01:00.000Z', 120), 0, { exerciseId: to, name: to, weight: 0, reps: 10 });
    assert.deepEqual(sessionPairs(after.exercises, PROFILE, 30), [[2, 3], [4, 5]], `${to} after set 1`);
  }
  // Home Full Body A at 20 min: the lead swapped to a push-up keeps the row's pair.
  const home = profileOf({ kit: 'home', daysPerWeek: 2, sessionMinutes: 20 });
  const day = todayProgram(home, planSlots(buildPlan(home))[0], []);
  const session = sessionOf(day.exercises.map((exercise) => exercise.exerciseId), day.exercises.map((exercise) => exercise.sets), 20);
  const pairs = sessionPairs(session.exercises, home, 20);
  assert.ok(pairs.length > 0);
  assert.deepEqual(sessionPairs(swapPendingExercise(session, 0, { exerciseId: 'push-up', name: 'Push-Up', weight: 0, reps: 10 }).exercises, home, 20), pairs);
});

test('review 1: a slot that already ran straight sets is not switched into a superset by a later change', () => {
  // Bench before hip thrust ran 2 straight sets; a swap that would make it pairable does not pair it mid-way.
  const ids = ['barbell-row', 'deadlift', 'barbell-bench-press', 'glute-bridge', 'chin-up', 'leg-curl'];
  let session = sessionOf(ids);
  session = logSet(logSet(session, 2, 0, '2026-11-12T10:01:00.000Z', 90), 2, 1, '2026-11-12T10:02:00.000Z', 90);
  assert.equal(partnerOf(sessionPairs(session.exercises, PROFILE, 30), 2), undefined);
});
