import { EXERCISES, exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { Constraints } from '../src/lib/adapt.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import type { Equipment, Experience, MuscleGroup, Profile, SupportEquipment } from '../src/types.ts';

/**
 * #357: one sweep over every split, length and level, read by the "absent field = main" snapshot
 * and by the "Leg press unticked" sweep. Each case lists what a lifter can be handed: the planned day
 * (with its feasibility line and alternatives), every Replace list for it, and described days.
 */
export const LEVELS: Experience[] = ['Beginner', 'Intermediate', 'Advanced'];
export const LENGTHS = [15, 20, 30, 45, 60, 90];
export const SPLITS = [2, 3, 4, 5, 6];
export const DESCRIBED: MuscleGroup[][] = [['Quads'], ['Quads', 'Glutes', 'Hamstrings', 'Calves'], ['Chest', 'Triceps'], ['Back', 'Biceps'], ['Shoulders'], ['Core']];

export type Kit = { equipment: Equipment[]; support: SupportEquipment[] };
export const KITS: Record<string, Kit> = {
  gym: { equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] },
  machines: { equipment: ['Dumbbell', 'Machine', 'Cable'], support: ['Bench'] },
  home: { equipment: ['Dumbbell'], support: ['Bench'] },
  bodyweight: { equipment: [], support: [] },
};

export const profileOf = (kit: Kit, experience: Experience, daysPerWeek: number, sessionMinutes: number, extra: Partial<Profile> = {}): Profile =>
  ({ goal: 'Build Muscle', experience, daysPerWeek, unit: 'lb', sessionMinutes, ...kit, exclusions: [], loads: {}, ...extra });

export type Case = { key: string; ids: string[] };

/** Every case for one profile. `ids` holds every exercise id a lifter could be shown or handed. */
export function casesFor(profile: Profile, label: string): { key: string; text: string; ids: string[] }[] {
  const out: { key: string; text: string; ids: string[] }[] = [];
  buildPlan(profile).forEach((day, index) => {
    const session = generateWorkout(profile, day, index, []);
    const inDay = session.exercises.map((entry) => exerciseById(entry.exerciseId)!);
    const swaps = inDay.map((exercise) => rankedReplacements(exercise, profile, inDay, EXERCISES.length).map((item) => item.id));
    const f = session.feasibility;
    out.push({
      key: `${label} ${day.name} #${index}`,
      text: [
        session.exercises.map((entry) => `${entry.exerciseId}:${entry.planned.length}`).join(' '),
        `${f.status} | ${f.reason} | ${f.alternatives.map((alt) => alt.label).join(', ')}`,
        swaps.map((list) => list.join(',')).join(' / '),
      ].join('\n'),
      ids: [...session.exercises.map((entry) => entry.exerciseId), ...swaps.flat()],
    });
  });
  const slot = planSlots(buildPlan(profile))[0];
  for (const focus of DESCRIBED) {
    const next: Constraints = { minutes: profile.sessionMinutes ?? 35, equipment: 'home', focus };
    const program = todayProgram(profile, slot, [], next);
    const adapted = adaptWorkout(program, next, profile.exclusions, profile.goal, profile);
    const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
    out.push({ key: `${label} described ${focus.join('+')}`, text: `${ids.join(' ')} | ${program.feasibility.status}`, ids });
  }
  return out;
}

/** The whole sweep for a profile transform; `extra` is merged into every profile. */
export function sweep(extra: (kit: string) => Partial<Profile> = () => ({}), kits = Object.keys(KITS)) {
  const out: { key: string; text: string; ids: string[] }[] = [];
  for (const kit of kits) for (const level of LEVELS) for (const days of SPLITS) for (const minutes of LENGTHS) {
    out.push(...casesFor(profileOf(KITS[kit], level, days, minutes, extra(kit)), `${kit} ${level} ${days}d ${minutes}m`));
  }
  return out;
}
