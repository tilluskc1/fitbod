import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { AdaptedWorkout, EquipmentChoice } from '../src/lib/adapt.ts';
import type { Constraints } from '../src/lib/constraints.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveExercises } from '../src/lib/liveProgression.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { createSession, logSet, swapPendingExercise, updatePerformedSet } from '../src/lib/session.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

/**
 * #250 fuzz: random logs, swaps, length and gear changes on generated days, each change applied
 * through `restore`. The fuzz knows which exercise each replacement took over, so it can say what
 * every prescribed exercise should still owe. `tests/fixtures/restoreFuzz250.main.json` holds main's
 * counts (3d9f3d1); regenerate with the same seed only on purpose.
 */
export type Restore = (session: WorkoutRecord, original: AdaptedWorkout, profile?: Profile | null, history?: WorkoutRecord[]) => WorkoutRecord;
export interface FuzzCounts {
  restores: number;
  /** A prescribed exercise owing other than its sets minus its own (and its replacements') logged sets. */
  wrongPending: number;
  /** Owing sets but listed with none. */
  lost: number;
  /** Any logged set changed, dropped or added. */
  changed: number;
  /** An exercise listed twice on one setup. */
  doubled: number;
}

const base = { exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60 } as const;
export const FUZZ_PROFILES: Profile[] = [
  { ...base, goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 5,
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'], exclusions: [], loads: {} },
  { ...base, goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3,
    equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'], exclusions: [], loads: {} },
  { ...base, goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, equipment: ['Dumbbell'], support: ['Bench'], exclusions: [], loads: {} },
];
const NOW = Date.parse('2026-11-08T10:00:00.000Z');

export function fuzz(restore: Restore, rounds = 400): Record<'length' | 'gear', FuzzCounts> {
  let seed = 250;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const counts = {
    length: { restores: 0, wrongPending: 0, lost: 0, changed: 0, doubled: 0 },
    gear: { restores: 0, wrongPending: 0, lost: 0, changed: 0, doubled: 0 },
  };
  let tick = 0;
  const at = () => new Date(NOW + (tick += 1) * 60_000).toISOString();
  const doneKey = (session: WorkoutRecord) => JSON.stringify(session.exercises.flatMap((exercise) => exercise.performed
    .filter((set) => set.done).map((set) => `${exercise.exerciseId}|${set.weight}|${set.reps}|${set.completedAt}`)).sort());
  for (let round = 0; round < rounds; round += 1) {
    const profile = pick(FUZZ_PROFILES);
    const slot = pick(planSlots(buildPlan(profile)));
    const day = (today: Partial<Constraints>) => adaptWorkout(todayProgram(profile, slot, [], today),
      { ...defaultConstraints(profile), ...today }, profile.exclusions, profile.goal);
    const full = day({});
    let session = createSession({ id: `f-${round}`, name: full.name, dayIndex: slot.index, now: at(), durationMin: full.minutes,
      exercises: liveExercises(full, profile, []) });
    // Which exercise each replacement took over; every other exercise is its own.
    const tookOver = new Map<string, string>();
    const slotOf = (id: string) => tookOver.get(id) ?? id;
    for (let step = 0; step < 14; step += 1) {
      const open = session.exercises.flatMap((exercise, index) => exercise.performed.some((set) => !set.done) ? [index] : []);
      const roll = random();
      if (roll < 0.45 && open.length) {
        const index = pick(open);
        const set = session.exercises[index].performed.findIndex((entry) => !entry.done);
        session = logSet(updatePerformedSet(session, index, set, { weight: 30 }, at()), index, set, at());
      } else if (roll < 0.6 && open.length) {
        const index = pick(open);
        const id = session.exercises[index].exerciseId;
        const candidate = rankedReplacements(exerciseById(id)!, profile,
          session.exercises.flatMap((exercise) => exerciseById(exercise.exerciseId) ?? []))[0];
        if (!candidate || session.exercises.some((exercise) => exercise.exerciseId === candidate.id)) continue;
        session = swapPendingExercise(session, index, { exerciseId: candidate.id, name: candidate.name, weight: 20, reps: 8 });
        tookOver.set(candidate.id, slotOf(id));
      } else {
        const kind = random() < 0.3 ? 'gear' : 'length';
        const today: Partial<Constraints> = kind === 'gear'
          ? { equipment: pick(['hotel', 'bodyweight', 'home'] as EquipmentChoice[]) }
          : { minutes: pick([15, 20, 30, 45, 60]) };
        const target = day(today);
        if (target.exercises.length === 0) continue;
        const before = doneKey(session);
        session = restore(session, target, profile, []);
        const tally = counts[kind];
        tally.restores += 1;
        if (doneKey(session) !== before) tally.changed += 1;
        const listed = session.exercises.map((exercise) => `${exercise.exerciseId}|${exercise.setup ?? ''}`);
        if (new Set(listed).size !== listed.length) tally.doubled += 1;
        for (const prescribed of target.exercises) {
          const own = session.exercises.filter((exercise) => slotOf(exercise.exerciseId) === prescribed.exerciseId);
          const logged = own.reduce((sum, exercise) => sum + exercise.performed.filter((set) => set.done).length, 0);
          const owed = Math.max(0, prescribed.sets - logged);
          const pending = own.reduce((sum, exercise) => sum + exercise.performed.filter((set) => !set.done).length, 0);
          if (pending !== owed) tally.wrongPending += 1;
          if (owed > 0 && pending === 0) tally.lost += 1;
        }
      }
    }
  }
  return counts;
}
