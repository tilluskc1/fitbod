// (#389/#391) The kg results pinned before the lb-grid fix (decision 6: kg lifters see no change at all).
import { EXERCISES } from '../../src/data/exercises.ts';
import { coachLine, describePrescription, nextLoad, prescribeExercise } from '../../src/lib/progression.ts';
import { weightSteps } from '../../src/lib/weightSteps.ts';
import type { Equipment, Profile, WorkoutRecord } from '../../src/types.ts';

const KIT: Equipment[] = ['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Bodyweight'];
const LOADS = [0, 2.5, 4, 9.5, 20, 22.5, 24.948, 25, 40, 57.5, 60, 61, 61.235, 62.4, 100, 1997.5, 2000];
const RACKS: number[][] = [[], [5, 7.5, 10, 12.5, 15, 20], [10, 15, 18, 22, 25], [6.804, 9.072, 11.34, 13.608]];

function history(exerciseId: string, weight: number, planned: number, done: number, sets = 4): WorkoutRecord[] {
  return [{
    id: 'w1', date: '2026-11-01T10:00:00.000Z', name: 'Push', dayIndex: 0, status: 'completed',
    completedEarly: false, endedAt: null,
    exercises: [{
      exerciseId, name: exerciseId,
      planned: Array.from({ length: sets }, () => ({ weight, reps: planned })),
      performed: Array.from({ length: sets }, () => ({ weight, reps: done, done: true, completedAt: null })),
    }],
  }];
}

const IDS = ['barbell-bench-press', 'back-squat', 'face-pull', 'skull-crusher', 'dumbbell-curl', 'dumbbell-floor-press',
  'kettlebell-goblet-squat', 'leg-press', 'lat-pulldown', 'cable-row', 'push-up', 'pull-up'];

/** Just after this file's 2026-11-01 `history()` fixtures — pinned before break-detection existed. */
const NOW = new Date('2026-11-02T10:00:00.000Z');

export function kgPinCases() {
  const steps = KIT.flatMap((equipment) => LOADS.flatMap((kg) => RACKS.map((available) =>
    ({ equipment, kg, available, out: weightSteps({ kg, equipment, available, unit: 'kg' }) }))));
  const next = LOADS.flatMap((weight) => [2.5, 4, 5].flatMap((increment) => RACKS.map((available) =>
    ({ weight, increment, available, out: nextLoad(weight, increment, available) }))));
  const profile: Profile = {
    goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 3, equipment: [], support: [], exclusions: [], loads: {},
  };
  const prescriptions = IDS.flatMap((id) => {
    const exercise = EXERCISES.find((item) => item.id === id);
    if (!exercise) return [];
    return [20, 25, 61.235, 100].flatMap((weight) => [[8, 8], [10, 10], [12, 12], [6, 6], [20, 20], [8, 12]].flatMap(([planned, done]) =>
      RACKS.slice(0, 2).flatMap((rack) => [undefined, 'kg' as const].map((unit) => {
        const p = prescribeExercise(exercise, { ...profile, unit, loads: rack.length ? { [exercise.equipment]: rack } : {} },
          history(id, weight, planned, done), false, true, 'home', NOW);
        return { id, weight, planned, done, rack, unit: unit ?? null, out: { weight: p.weight, reps: p.reps, basis: p.basis, increment: p.increment },
          reason: describePrescription(p, 'kg'), coach: coachLine(p, 'kg') };
      }))));
  });
  return { steps, next, prescriptions };
}
