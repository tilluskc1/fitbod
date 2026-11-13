import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, restorePendingWorkout, todayGlance, workMinutes } from '../src/lib/adapt.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { exerciseById } from '../src/data/exercises.ts';
import { leadCompoundId } from '../src/lib/progression.ts';
import { createSession, logSet, skipExercise, swapPendingExercise, unskipExercise } from '../src/lib/session.ts';
import { sessionRests, TRANSITION_SECONDS, WORK_SECONDS } from '../src/lib/sessionTime.ts';
import {
  PAIR_SWITCH_SECONDS, canPair, keepPairs, pairRound, partnerOf, pairSeconds, pairedPendingIndex, pairingOn, restAfterLog, sessionPairs,
  startPairs, storedPairs,
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

test('who pairs: Intermediate and Advanced at 45 min or less; never Beginner, over 45, or an unknown length', () => {
  assert.equal(pairingOn({ experience: 'Intermediate' }, 45), true);
  assert.equal(pairingOn({ experience: 'Advanced' }, 15), true);
  assert.equal(pairingOn({ experience: 'Beginner' }, 30), false);
  assert.equal(pairingOn({ experience: 'Intermediate' }, 46), false);
  assert.equal(pairingOn({ experience: 'Intermediate' }, 60), false);
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

test('promised minutes stay honest at 15, 20, 30 and 45 min: within the length, or at a 15/20 min floor no longer than straight sets', () => {
  for (const kit of ['gym', 'home', 'homeBar'] as const) for (const goal of GOALS) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    for (const sessionMinutes of [15, 20, 30, 45]) {
      const on = profileOf({ kit, goal, daysPerWeek, sessionMinutes });
      for (const slot of planSlots(buildPlan(on))) {
        const label = `${kit} ${goal} ${daysPerWeek}d ${sessionMinutes} ${slot.name}`;
        const paired = adaptWorkout(todayProgram(on, slot, []), defaultConstraints(on), [], goal, on);
        const glanceOn = todayGlance(paired, null, false, goal, on);
        const straight = workMinutes(paired.exercises, goal, sessionMinutes, null);
        // Within the length, or (a 15/20 min floor) never longer than the same work in straight sets.
        assert.ok(glanceOn.minutes <= sessionMinutes || glanceOn.minutes <= straight, `${label}: ${glanceOn.minutes} (straight ${straight})`);
        // The minutes shown are the paired model of the exercises as listed, the one the logger runs.
        assert.equal(glanceOn.minutes, workMinutes(paired.exercises, goal, sessionMinutes, on), label);
      }
    }
  }
});

/** A session started from these exercises, `sets` each, at `durationMin`, with the pairs stored as Start stores them. */
const sessionOf = (ids: string[], sets: number[] | number = 3, durationMin = 30, profile: Profile = profileOf()): WorkoutRecord => createSession({
  id: 's1', name: 'Upper A', dayIndex: 0, now: '2026-11-12T10:00:00.000Z', durationMin,
  exercises: startPairs(ids.map((exerciseId, index): WorkoutExercise => {
    const count = Array.isArray(sets) ? sets[index] : sets;
    const planned = Array.from({ length: count }, () => ({ weight: 10, reps: 10 }));
    return { exerciseId, name: exerciseId, planned, performed: planned.map((set) => ({ ...set, done: false, completedAt: null })) };
  }), profile, durationMin),
});
const IDS = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown'];
const PROFILE = profileOf();
const pairsOf = (session: WorkoutRecord) => storedPairs(session.exercises);
/** The session's pairs as exercise ids, for comparing across a swap that inserts an entry. */
const idPairs = (session: WorkoutRecord) => pairsOf(session).map(([a, b]) => `${session.exercises[a].exerciseId}+${session.exercises[b].exerciseId}`);

/** Logs whatever the logger shows next, with the rest it would start; returns the order and rests. */
function run(session: WorkoutRecord, steps: number) {
  const order: string[] = [];
  const rests: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const pairs = pairsOf(session);
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

test('Start stores the preview\'s pairs on the record: two entries per number, the lead and straight work hold none', () => {
  const session = sessionOf(['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'plank']);
  assert.deepEqual(session.exercises.map((entry) => entry.pair), [undefined, 1, 1, 2, 2]);
  assert.deepEqual(pairsOf(session), sessionPairs(session.exercises, PROFILE, 30));
  // A Beginner or a 60 min day stores nothing: the record keeps the shape it always had.
  for (const straight of [sessionOf(IDS, 3, 30, profileOf({ experience: 'Beginner' })), sessionOf(IDS, 3, 60)]) {
    assert.ok(straight.exercises.every((entry) => !('pair' in entry)));
  }
});

test('logging a pair alternates A1, B1, A2, B2 with 30 s between them and the full rest after each round', () => {
  const session = sessionOf(IDS);
  assert.deepEqual(pairsOf(session), [[1, 2]]);
  const { order, rests } = run(session, 9);
  assert.deepEqual(order, [
    'barbell-bench-press#1', 'barbell-bench-press#2', 'barbell-bench-press#3',
    'face-pull#1', 'hammer-curl#1', 'face-pull#2', 'hammer-curl#2', 'face-pull#3', 'hammer-curl#3',
  ]);
  const short = sessionRests(IDS, 'Build Muscle', 30);
  assert.deepEqual(rests.slice(3), [30, Math.max(short[1], short[2]), 30, Math.max(short[1], short[2]), 30, Math.max(short[1], short[2])]);
  const logged = run(session, 9).session;
  assert.ok(logged.exercises.slice(0, 3).every((exercise) => exercise.performed.every((set) => set.done)));
});

test('"Round 2 of 3" while a pair runs; the leftover sets of an unequal pair run straight with their own rest', () => {
  let session = sessionOf(IDS, [3, 3, 2, 3]);
  session = run(session, 4).session; // bench 3, face pull 1
  const pairs = pairsOf(session);
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

test('a reload or export/restore keeps the stored pairs and resumes mid-round; a session open across midnight keeps them', () => {
  const half = run({ ...sessionOf(IDS), date: '2026-11-12T23:58:00.000Z' }, 4).session; // bench 3, face pull 1
  const reloaded = valid({ profile: PROFILE, plan: [], history: [], current: half }).current!;
  assert.deepEqual(reloaded.exercises.map((entry) => entry.pair), half.exercises.map((entry) => entry.pair));
  assert.equal(reloaded.exercises[pairedPendingIndex(reloaded, pairsOf(reloaded))].exerciseId, 'hammer-curl');
  const afterMidnight = logSet(reloaded, 2, 0, '2026-11-13T00:01:00.000Z', 30);
  assert.deepEqual(pairsOf(afterMidnight), [[1, 2]]);
  // A finished session in history round-trips too.
  const restored = valid({ profile: PROFILE, plan: [], history: [{ ...run(sessionOf(IDS), 9).session, status: 'completed', endedAt: '2026-11-12T11:00:00.000Z' }], current: null });
  assert.deepEqual(restored.history[0].exercises.map((entry) => entry.pair), [undefined, 1, 1, undefined]);
});

test('validate: an older record without pair numbers reads straight; a bad pair value is refused', () => {
  const legacy = { ...sessionOf(IDS), exercises: sessionOf(IDS).exercises.map(({ pair: _pair, ...entry }) => entry) };
  const read = valid({ profile: PROFILE, plan: [], history: [], current: legacy }).current!;
  assert.ok(read.exercises.every((entry) => !('pair' in entry)));
  assert.deepEqual(pairsOf(read), []);
  assert.deepEqual(run(read, 5).order, ['barbell-bench-press#1', 'barbell-bench-press#2', 'barbell-bench-press#3', 'face-pull#1', 'face-pull#2']);
  for (const bad of [0, -1, 1.5, '1', null, 41, true]) {
    const current = sessionOf(IDS);
    (current.exercises[1] as unknown as Record<string, unknown>).pair = bad;
    assert.equal(validateState({ profile: PROFILE, plan: [], history: [], current }).ok, false, String(bad));
  }
  // A number held once or three times reads straight rather than pairing the wrong exercises.
  assert.deepEqual(storedPairs([{ exerciseId: 'a', pair: 1 }, { exerciseId: 'b', pair: 2 }, { exerciseId: 'c', pair: 2 }, { exerciseId: 'd', pair: 2 }]), []);
});

test('a running session ignores later settings: a Beginner level or another length changes neither its pairs nor its minutes (#200)', () => {
  const session = run(sessionOf(IDS), 4).session;
  const adapted = adaptWorkout(todayProgram(PROFILE, upper(PROFILE), []), defaultConstraints(PROFILE), [], 'Build Muscle', PROFILE);
  const before = todayGlance(adapted, session, false, 'Build Muscle', PROFILE).minutes;
  for (const later of [profileOf({ experience: 'Beginner' }), profileOf({ sessionMinutes: 60 })]) {
    assert.equal(todayGlance(adapted, session, false, 'Build Muscle', later).minutes, before);
  }
  assert.equal(before, workMinutes(session.exercises.map((entry) => ({ exerciseId: entry.exerciseId, sets: entry.planned.length, pair: entry.pair })), 'Build Muscle', 30, 'stored'));
  assert.deepEqual(run(session, 1).order, ['hammer-curl#1']);
});

test('skipping one half sends its partner straight; Return brings it back straight; no other pair moves', () => {
  const ids = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'plank'];
  let session = sessionOf(ids);
  assert.deepEqual(pairsOf(session), [[1, 2], [3, 4]]);
  session = run(session, 4).session; // bench 3, face pull 1
  session = skipExercise(session, 2);
  assert.deepEqual(pairsOf(session), [[3, 4]]);
  const next = run(session, 2);
  assert.deepEqual(next.order, ['face-pull#2', 'face-pull#3']);
  assert.equal(next.rests[0], sessionRests(ids, 'Build Muscle', 30)[1]);
  const back = unskipExercise(session, 2);
  assert.deepEqual(pairsOf(back), [[3, 4]]);
  assert.equal(back.exercises[2].pair, undefined);
});

test('review 2 repro: skip hammer curl, log pushdown 1 + leg curl 1, Return, Replace hammer curl with chin-up: pushdown + leg curl keep their pair', () => {
  const ids = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'leg-curl'];
  let session = sessionOf(ids);
  assert.deepEqual(idPairs(session), ['face-pull+hammer-curl', 'triceps-pushdown+leg-curl']);
  session = skipExercise(session, 2);
  session = logSet(session, 3, 0, '2026-11-12T10:01:00.000Z', 30);
  session = logSet(session, 4, 0, '2026-11-12T10:02:00.000Z', 60);
  session = unskipExercise(session, 2);
  session = swapPendingExercise(session, 2, { exerciseId: 'chin-up', name: 'Chin-Up', weight: 0, reps: 8 });
  assert.deepEqual(idPairs(session), ['triceps-pushdown+leg-curl']);
  const chin = session.exercises.findIndex((entry) => entry.exerciseId === 'chin-up');
  assert.equal(partnerOf(pairsOf(session), chin), undefined);
});

test('the lead swapped to a fly or a push-up, before or after set 1, stays straight and moves no pair', () => {
  const ids = ['barbell-bench-press', 'face-pull', 'hammer-curl', 'triceps-pushdown', 'leg-curl'];
  const fresh = sessionOf(ids);
  const pairs = idPairs(fresh);
  for (const to of ['cable-fly', 'push-up']) {
    const before = swapPendingExercise(fresh, 0, { exerciseId: to, name: to, weight: 0, reps: 10 });
    assert.deepEqual(idPairs(before), pairs, `${to} before set 1`);
    const after = swapPendingExercise(logSet(fresh, 0, 0, '2026-11-12T10:01:00.000Z', 120), 0, { exerciseId: to, name: to, weight: 0, reps: 10 });
    assert.deepEqual(idPairs(after), pairs, `${to} after set 1`);
    assert.ok(after.exercises.slice(0, 2).every((entry) => entry.pair === undefined));
  }
});

test('swap sheet sweep, before AND after set 1: the replacement and its partner go straight, 0 untouched pairs move', () => {
  let swaps = 0;
  const moved: string[] = [];
  for (const kit of ['gym', 'home', 'homeBar'] as const) for (const goal of GOALS) for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of [20, 30, 45]) {
    const profile = profileOf({ kit, goal, daysPerWeek, sessionMinutes, experience: 'Advanced' });
    for (const slot of planSlots(buildPlan(profile))) {
      const program = todayProgram(profile, slot, []);
      const fresh = sessionOf(program.exercises.map((exercise) => exercise.exerciseId), program.exercises.map((exercise) => exercise.sets), sessionMinutes, profile);
      fresh.exercises.forEach((entry, index) => {
        const partner = partnerOf(pairsOf(fresh), index);
        // Before set 1, and after a logged round (the slot's set 1 and its partner's).
        let logged = logSet(fresh, index, 0, '2026-11-12T10:01:00.000Z', 60);
        if (partner !== undefined) logged = logSet(logged, partner, 0, '2026-11-12T10:02:00.000Z', 60);
        for (const [when, session] of [['before set 1', fresh], ['after set 1', logged]] as const) {
          const untouched = idPairs(session).filter((pair) => !pair.split('+').includes(entry.exerciseId));
          const inDay = session.exercises.filter((_, i) => i !== index).map((item) => exerciseById(item.exerciseId)!);
          for (const option of rankedReplacements(exerciseById(entry.exerciseId)!, profile, inDay, 6)) {
            const swapped = swapPendingExercise(session, index, swapCandidateFor(option, profile, [], session));
            if (swapped === session) continue; // nothing left to swap (a one-set slot already logged)
            swaps += 1;
            const label = `${kit} ${goal} ${daysPerWeek}d ${sessionMinutes} ${slot.name} ${when}: ${entry.exerciseId} -> ${option.id}`;
            if (JSON.stringify(idPairs(swapped)) !== JSON.stringify(untouched)) moved.push(label);
            const replacement = swapped.exercises.findIndex((item, i) => i >= index && item.exerciseId === option.id);
            assert.equal(swapped.exercises[replacement].pair, undefined, label);
            if (partner !== undefined) {
              const other = swapped.exercises.findIndex((item) => item.exerciseId === session.exercises[partner].exerciseId);
              assert.equal(swapped.exercises[other].pair, undefined, label);
            }
          }
        }
      });
    }
  }
  assert.deepEqual(moved, []);
  assert.ok(swaps > 1000, `${swaps}`);
});

test('shortening or lengthening a running session: a cut half sends its partner straight, surviving pairs keep their number, nothing new pairs (sweep)', () => {
  let kept = 0;
  let dropped = 0;
  for (const kit of ['gym', 'home'] as const) for (const goal of GOALS) for (const daysPerWeek of [3, 4, 5]) {
    const profile = profileOf({ kit, goal, daysPerWeek, sessionMinutes: 45, experience: 'Advanced' });
    for (const slot of planSlots(buildPlan(profile))) {
      const at = (minutes: number) => adaptWorkout(todayProgram(profile, slot, [], { minutes }), { ...defaultConstraints(profile), minutes }, [], goal, profile);
      const start = at(45);
      let session = createSession({ id: 's', name: start.name, dayIndex: 0, now: '2026-11-12T10:00:00.000Z', durationMin: 45,
        exercises: startPairs(liveExercises(start, profile, []), profile, 45) });
      session = run(session, 4).session;
      const before = new Map(pairsOf(session).map(([a, b]) => [session.exercises[a].exerciseId, session.exercises[b].exerciseId]));
      for (const minutes of [15, 20, 30, 60]) {
        const label = `${kit} ${goal} ${daysPerWeek}d ${slot.name} 45 -> ${minutes}`;
        const rebuilt = restorePendingWorkout(session, at(minutes), profile, []);
        for (const [a, b] of pairsOf(rebuilt)) {
          const [x, y] = [rebuilt.exercises[a].exerciseId, rebuilt.exercises[b].exerciseId];
          assert.ok(before.get(x) === y, `${label}: new pair ${x}+${y}`);
          assert.equal(rebuilt.exercises[a].pair, session.exercises.find((entry) => entry.exerciseId === x)!.pair, label);
          kept += 1;
        }
        for (const [x, y] of before) {
          const count = (id: string) => rebuilt.exercises.filter((entry) => entry.exerciseId === id).length;
          if (count(x) === 1 && count(y) === 1) assert.ok(idPairs(rebuilt).includes(`${x}+${y}`), `${label}: lost ${x}+${y}`);
          else {
            dropped += 1;
            for (const id of [x, y]) assert.ok(rebuilt.exercises.filter((entry) => entry.exerciseId === id).every((entry) => entry.pair === undefined), `${label}: ${id}`);
          }
        }
      }
    }
  }
  assert.ok(kept > 50 && dropped > 10, `kept ${kept}, dropped ${dropped}`);
});

test('keepPairs: a half split into two entries (a gear switch) or skipped sends both halves straight', () => {
  const before = [{ exerciseId: 'a' }, { exerciseId: 'b', pair: 1 }, { exerciseId: 'c', pair: 1 }, { exerciseId: 'd', pair: 2 }, { exerciseId: 'e', pair: 2 }];
  const after = keepPairs(before, [{ exerciseId: 'a' }, { exerciseId: 'b' }, { exerciseId: 'b' }, { exerciseId: 'c' }, { exerciseId: 'e', skipped: true }, { exerciseId: 'd' }]);
  assert.ok(after.every((entry) => !('pair' in entry)));
  assert.deepEqual(keepPairs(before, [{ exerciseId: 'e' }, { exerciseId: 'c' }, { exerciseId: 'd' }, { exerciseId: 'b' }]).map((entry) => entry.pair), [2, 1, 2, 1]);
});
