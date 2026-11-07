import type { Program } from '../data/flagship.ts';
import { EXERCISES, exerciseById } from '../data/exercises.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { kitProfile } from './sequence.ts';
import type { MuscleGroup, Profile } from '../types.ts';
import { isGymKit, promisedMinutes, setupFor } from './adapt.ts';
import type { AdaptedWorkout, Constraints, EquipmentChoice } from './adapt.ts';
import { AREAS, AREA_MUSCLES, areasOf, musclesOf } from './areas.ts';
import type { Area } from './areas.ts';
import { keywordParser, resolveConstraints } from './constraints.ts';
import type { ConstraintNotice } from './constraints.ts';
import { leadCompoundId } from './progression.ts';
import { sessionRests, warmUpSeconds } from './sessionTime.ts';

export { customDayName } from './areas.ts';

/**
 * "Tell me about today" (#193): what the lifter said, as four editable things — gear, areas to
 * train, areas to skip, minutes. It only ever produces constraints; the generator picks the
 * exercises, sets and loads, the same as for every other day.
 */
export interface TalkState {
  equipment: EquipmentChoice;
  minutes: number;
  train: Area[];
  skip: Area[];
  /** Pain was mentioned: nothing is built. */
  pain: boolean;
  /** Anything asked that could not be used as asked (time clamped, unsupported gear). */
  notices: ConstraintNotice[];
}

/** The chips before anything is said: today's gear and time, and today's day. */
export function baseTalk(constraints: Pick<Constraints, 'minutes' | 'equipment' | 'focus' | 'skip'>, plannedFocus: MuscleGroup[]): TalkState {
  const skip = areasOf(constraints.skip ?? []);
  return {
    equipment: constraints.equipment,
    minutes: constraints.minutes,
    train: areasOf(constraints.focus ?? plannedFocus).filter((area) => !skip.includes(area)),
    skip,
    pain: false,
    notices: [],
  };
}

/** The text read on top of the base; whatever it does not name keeps the base's value. */
export function talkFromText(text: string, base: TalkState): TalkState {
  if (!text.trim()) return base;
  const parsed = keywordParser.parse(text);
  const resolved = resolveConstraints({ minutes: base.minutes, equipment: base.equipment }, parsed);
  const skip = parsed.avoid ?? base.skip;
  return {
    equipment: resolved.constraints.equipment,
    minutes: resolved.constraints.minutes,
    train: (parsed.train ?? base.train).filter((area) => !skip.includes(area)),
    skip,
    pain: Boolean(parsed.pain),
    notices: resolved.notices,
  };
}

const toggled = (list: Area[], area: Area) =>
  list.includes(area) ? list.filter((item) => item !== area) : AREAS.filter((item) => item === area || list.includes(item));

/** A Train chip: on or off, and never also in Skip. */
export function toggleTrain(talk: TalkState, area: Area): TalkState {
  return { ...talk, train: toggled(talk.train, area), skip: talk.skip.filter((item) => item !== area) };
}

/** A Skip chip: on or off, and never also in Train. */
export function toggleSkip(talk: TalkState, area: Area): TalkState {
  return { ...talk, skip: toggled(talk.skip, area), train: talk.train.filter((item) => item !== area) };
}

/** Today's constraints for the described day: focus is Train minus Skip, as muscle groups. */
export function talkConstraints(talk: TalkState, loads?: number[]): Constraints {
  const skip = musclesOf(talk.skip);
  const focus = musclesOf(talk.train).filter((muscle) => !skip.includes(muscle));
  return {
    minutes: talk.minutes,
    equipment: talk.equipment,
    ...(loads ? { loads } : {}),
    ...(focus.length > 0 ? { focus } : {}),
    ...(skip.length > 0 ? { skip } : {}),
  };
}

/** The gear as a chip names it: the saved setup is "Your gym" for a gym kit, else "Home". */
export function gearLabel(choice: EquipmentChoice, profile: Pick<Profile, 'equipment'>): string {
  if (choice === 'home') return isGymKit(profile) ? 'Your gym' : 'Home';
  return setupFor(choice).chip;
}

export interface PreviewExercise {
  exerciseId: string;
  name: string;
  muscle: string;
  restSeconds: number;
  sets: number;
  /** "4–6", "10–15", or "30 s" for a hold. */
  reps: string;
  lead: boolean;
}

export interface CustomDayPreview {
  title: string;
  gear: string;
  status: 'ready' | 'limited' | 'none';
  minutes: number;
  sets: number;
  exercises: PreviewExercise[];
  skipped: Area[];
  /** Areas asked for that today's gear has no exercise for. */
  missing: Area[];
  warmUpMinutes: number;
}

/**
 * The preview card's numbers, all read from the generated day and the adaptation that Start
 * runs: the status from the generator's feasibility, minutes by the time model, rest by role.
 */
export function customDayPreview(
  talk: TalkState,
  program: Program,
  adapted: AdaptedWorkout,
  profile: Profile,
): CustomDayPreview {
  const primary = (exerciseId: string) => exerciseById(exerciseId)?.muscles[0];
  // Gear gaps only: an area today's kit has no exercise for at all. One the time left out is
  // visible in the list, and is not called impossible (#67).
  const kit = kitProfile(profile, talk.equipment);
  const caps = capabilitiesFor(kit);
  const missing = talk.train.filter((area) => !EXERCISES.some((exercise) =>
    AREA_MUSCLES[area].includes(exercise.muscles[0]) && provides(caps, exercise.needs) && !kit.exclusions.includes(exercise.id)));
  const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
  const rests = sessionRests(ids, profile.goal, adapted.minutes);
  const lead = leadCompoundId(ids);
  const status = adapted.exercises.length === 0 || program.feasibility?.status === 'infeasible' ? 'none'
    : program.feasibility?.status === 'limited' || missing.length > 0 ? 'limited'
    : 'ready';
  return {
    title: adapted.name,
    gear: gearLabel(talk.equipment, profile),
    status,
    minutes: promisedMinutes(program, adapted),
    sets: adapted.totalSets,
    exercises: adapted.exercises.map((exercise, index) => {
      const [low, high] = exercise.repRange;
      return {
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        muscle: primary(exercise.exerciseId) ?? '',
        restSeconds: rests[index],
        sets: exercise.sets,
        reps: exercise.holdSeconds ? `${exercise.holdSeconds} s` : low === high ? `${low}` : `${low}–${high}`,
        lead: exercise.exerciseId === lead,
      };
    }),
    skipped: talk.skip,
    missing,
    warmUpMinutes: Math.round(warmUpSeconds(talk.minutes) / 60),
  };
}
