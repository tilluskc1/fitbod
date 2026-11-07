import type { Program } from '../data/flagship.ts';
import { EXERCISES, exerciseById } from '../data/exercises.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { kitProfile } from './sequence.ts';
import type { MuscleGroup, Profile } from '../types.ts';
import { isGymKit, promisedMinutes, setupFor } from './adapt.ts';
import type { AdaptedWorkout, Constraints, EquipmentChoice } from './adapt.ts';
import { AREAS, AREA_MUSCLES, AREA_NOUN, areasOf, musclesOf, worksSkipped } from './areas.ts';
import type { Area } from './areas.ts';
import { keywordParser, resolveConstraints } from './constraints.ts';
import type { ConstraintNotice, ParsedConstraints } from './constraints.ts';
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
  /** The skipped areas the lifter called sore (or hurting), as opposed to just leaving out. */
  sore: Area[];
  /** Pain was mentioned: nothing is built. */
  pain: boolean;
  /** Anything asked that could not be used as asked (time clamped, unsupported gear). */
  notices: ConstraintNotice[];
}

/* ---------- the composer's reading of a sentence ---------- */

/** The shared parser's reading (gear, time, loads), plus what only the composer reads. */
export interface TalkParse extends ParsedConstraints {
  train?: Area[];
  avoid?: Area[];
  sore?: Area[];
  pain?: true;
}

/** Words for each area; "upper body" and "lower body" name several. */
const AREA_WORDS: { word: string; areas: Area[] }[] = [
  { word: 'chest|pecs?', areas: ['Chest'] },
  // "Back" the muscle, not the adverb: "back at the gym", "get back", "came back" train nothing.
  { word: `(?<!\\b(?:get|got|getting|came|come|coming|go|going|went|be|been|i'm|im|we're)\\s)back(?!\\s+(?:at|home|to|in|into|from|on)\\b)|lats?`, areas: ['Back'] },
  { word: 'shoulders?|delts?', areas: ['Shoulders'] },
  { word: 'arms?|biceps?|triceps?', areas: ['Arms'] },
  { word: 'legs?|quads?|hamstrings?|glutes?|calf|calves', areas: ['Legs'] },
  { word: 'abs|core|abdominals?', areas: ['Core'] },
  { word: 'upper body', areas: ['Chest', 'Back', 'Shoulders', 'Arms'] },
  { word: 'lower body', areas: ['Legs'] },
];
const HURT = 'hurts?|hurting|injured|tweaked|pulled|strained';
/** After the area: "legs are sore", "shoulder hurts". */
const SORE_AFTER = `sore|tired|fried|wrecked|dead|aching|achy|stiff|pain|painful|${HURT}`;
/** Before the area, sore: "sore legs", "pulled a hamstring". */
const SORE_BEFORE = 'sore|tired|achy|stiff|pulled|tweaked|injured|strained|hurt';
/** Before the area, left out: "skip back", "no chest". */
const LEAVE_BEFORE = 'skip|skipping|no|not|avoid|avoiding|rest|resting';
/** Only a determiner may sit between those words and the area: "no time chest" names no skip. */
const DET = '(?:(?:my|the|a|an|your)\\s+)?';
const NEGATED = /\b(?:not|no|never)\b|n['’]?t\b/;
const PAIN = /\b(?:pain|painful|hurts?|hurting|injur(?:ed|y|ies)|tweaked|pulled|strained)\b/i;
/** "No pain today", "nothing hurts", "injury free", "doesn't hurt" say there is no pain. */
const NO_PAIN = new RegExp([
  `\\b(?:no|zero|without|not|nothing|never)\\s+(?:\\w+\\s+)?(?:pain\\w*|${HURT}|injur\\w*)\\b`,
  '\\b(?:pain|injury|hurt)[\\s-]*free\\b',
  `\\b(?:doesn['’]?t|does not|don['’]?t|do not|isn['’]?t|is not|didn['’]?t|did not)\\s+(?:\\w+\\s+)?(?:hurt\\w*|injured)\\b`,
].join('|'), 'gi');
/** "No gym today", "not at home": a negated place selects nothing. */
const NO_PLACE = /\b(?:no|not|without|skip(?:ping)?|instead of)\s+(?:(?:at|to|the|a|my)\s+)*(?:gym|hotel|travel|home|garage)\b/gi;

/**
 * Areas named per clause. "<area> … sore" or "sore/skip/no <area>" skips it, unless negated
 * ("legs not sore", "not sore legs"); any other mention trains it. A clause ends at punctuation
 * or "but", so "tired, legs" never skips legs.
 */
function readAreas(text: string): { train: Area[]; skip: Area[]; sore: Area[] } {
  const train = new Set<Area>();
  const skip = new Set<Area>();
  const sore = new Set<Area>();
  for (const clause of text.toLowerCase().split(/[,.;:!?\n]+|\bbut\b/)) {
    for (const { word, areas } of AREA_WORDS) {
      if (!new RegExp(`\\b(?:${word})\\b`).test(clause)) continue;
      const after = new RegExp(`\\b(?:${word})((?:\\s+[\\w'’]+){0,2}?)\\s+(?:${SORE_AFTER})\\b`).exec(clause);
      const notBefore = '(?<!\\b(?:not|no|never)\\s)';
      const soreAfter = Boolean(after && !NEGATED.test(after[1]));
      const soreBefore = new RegExp(`${notBefore}\\b(?:${SORE_BEFORE})\\s+${DET}(?:${word})\\b`).test(clause);
      const left = new RegExp(`${notBefore}\\b(?:${LEAVE_BEFORE})\\s+${DET}(?:${word})\\b`).test(clause);
      for (const area of areas) {
        if (soreAfter || soreBefore) sore.add(area);
        (soreAfter || soreBefore || left ? skip : train).add(area);
      }
    }
  }
  return {
    train: AREAS.filter((area) => train.has(area) && !skip.has(area)),
    skip: AREAS.filter((area) => skip.has(area)),
    sore: AREAS.filter((area) => sore.has(area)),
  };
}

/** Hours said in words or digits, in minutes; undefined when the sentence names none. */
function hoursIn(text: string): number | undefined {
  if (/\bhalf an? hour\b/i.test(text)) return 30;
  const digits = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i.exec(text);
  if (digits) return Math.round(Number(digits[1]) * 60);
  if (/\b(?:an?|one)\s+(?:hour|hr)\b/i.test(text)) return /\band a half\b/i.test(text) ? 90 : 60;
  return undefined;
}

/**
 * The composer's own reading. Gear, time and loads come from the shared parser (unchanged for
 * the Adjust sheet) on the sentence minus "no pain"/"no gym" phrases; on top of it the composer
 * reads areas, pain, hours, a plain "gym" (the saved setup) and a "travel" gym.
 */
export function talkParse(text: string): TalkParse {
  const plain = text.replace(NO_PAIN, ' ').replace(NO_PLACE, ' ');
  const result: TalkParse = keywordParser.parse(plain);
  if (result.equipment === undefined) {
    if (/\b(?:travel|hotel)\b/i.test(plain)) result.equipment = 'hotel';
    else if (/\bgym\b/i.test(plain)) result.equipment = 'home';
    if (result.equipment) delete result.unsupportedEquipment;
  }
  const hours = hoursIn(plain);
  if (hours !== undefined && !/\d\s*-?\s*(?:minutes?|mins?)\b/i.test(plain)) result.minutes = hours;
  const areas = readAreas(text.replace(NO_PAIN, ' '));
  if (areas.train.length > 0) result.train = areas.train;
  if (areas.skip.length > 0) result.avoid = areas.skip;
  if (areas.sore.length > 0) result.sore = areas.sore;
  if (PAIN.test(plain)) result.pain = true;
  return result;
}

/* ---------- chips ---------- */

/** The chips before anything is said: today's gear and time, and today's day. */
export function baseTalk(constraints: Pick<Constraints, 'minutes' | 'equipment' | 'focus' | 'skip'>, plannedFocus: MuscleGroup[]): TalkState {
  const skip = areasOf(constraints.skip ?? []);
  return {
    equipment: constraints.equipment,
    minutes: constraints.minutes,
    train: areasOf(constraints.focus ?? plannedFocus).filter((area) => !skip.includes(area)),
    skip,
    sore: [],
    pain: false,
    notices: [],
  };
}

/** The text read on top of the base; whatever it does not name keeps the base's value. */
export function talkFromText(text: string, base: TalkState): TalkState {
  if (!text.trim()) return base;
  const parsed = talkParse(text);
  const resolved = resolveConstraints({ minutes: base.minutes, equipment: base.equipment }, parsed);
  const skip = parsed.avoid ?? base.skip;
  return {
    equipment: resolved.constraints.equipment,
    minutes: resolved.constraints.minutes,
    train: (parsed.train ?? base.train).filter((area) => !skip.includes(area)),
    skip,
    sore: parsed.sore ?? [],
    pain: Boolean(parsed.pain),
    notices: resolved.notices,
  };
}

/** Chip taps, kept apart from the text so typing more cannot undo them. */
export interface Taps {
  equipment?: EquipmentChoice;
  minutes?: number;
  areas: Partial<Record<Area, 'train' | 'skip' | 'off'>>;
}
export const NO_TAPS: Taps = { areas: {} };

/** What the lifter sees: the base, then the text, then their taps. */
export function composeTalk(base: TalkState, text: string, taps: Taps): TalkState {
  const said = talkFromText(text, base);
  const has = (list: Area[], area: Area, on: boolean) => AREAS.filter((item) => (item === area ? on : list.includes(item)));
  let talk: TalkState = {
    ...said,
    equipment: taps.equipment ?? said.equipment,
    minutes: taps.minutes ?? said.minutes,
  };
  for (const area of AREAS) {
    const tap = taps.areas[area];
    if (!tap) continue;
    talk = {
      ...talk,
      train: has(talk.train, area, tap === 'train'),
      skip: has(talk.skip, area, tap === 'skip'),
      sore: talk.sore.filter((item) => item !== area),
    };
  }
  return talk;
}

/** An edit to the text overrides only the taps whose field its reading changed. */
export function tapsAfterEdit(taps: Taps, before: string, after: string): Taps {
  const was = before.trim() ? talkParse(before) : {};
  const now = after.trim() ? talkParse(after) : {};
  const status = (parsed: TalkParse, area: Area) =>
    parsed.avoid?.includes(area) ? 'skip' : parsed.train?.includes(area) ? 'train' : 'none';
  const areas = Object.fromEntries(Object.entries(taps.areas)
    .filter(([area]) => status(was, area as Area) === status(now, area as Area)));
  return {
    ...(taps.equipment !== undefined && was.equipment === now.equipment ? { equipment: taps.equipment } : {}),
    ...(taps.minutes !== undefined && was.minutes === now.minutes ? { minutes: taps.minutes } : {}),
    areas,
  };
}

/** A tap on a Train chip: on or off, and never also in Skip. */
export function tapTrain(talk: TalkState, taps: Taps, area: Area): Taps {
  return { ...taps, areas: { ...taps.areas, [area]: talk.train.includes(area) ? 'off' : 'train' } };
}

/** A tap on a Skip chip: on or off, and never also in Train. */
export function tapSkip(talk: TalkState, taps: Taps, area: Area): Taps {
  return { ...taps, areas: { ...taps.areas, [area]: talk.skip.includes(area) ? 'off' : 'skip' } };
}

/**
 * Whether the chips describe a day of their own. Train equal to the planned day's areas with
 * nothing skipped is the planned day: only gear and time change, and the plan moves as usual.
 */
export function describesDay(talk: TalkState, plannedFocus: MuscleGroup[]): boolean {
  const planned = areasOf(plannedFocus);
  return talk.skip.length > 0 || talk.train.length !== planned.length || talk.train.some((area) => !planned.includes(area));
}

/** Today's constraints from the chips: a described day carries focus (Train minus Skip) and skip. */
export function talkConstraints(talk: TalkState, loads: number[] | undefined, plannedFocus: MuscleGroup[]): Constraints {
  const skip = musclesOf(talk.skip);
  const focus = musclesOf(talk.train).filter((muscle) => !skip.includes(muscle));
  const described = describesDay(talk, plannedFocus) && focus.length > 0;
  return {
    minutes: talk.minutes,
    equipment: talk.equipment,
    ...(loads ? { loads } : {}),
    ...(described ? { focus } : {}),
    ...(described && skip.length > 0 ? { skip } : {}),
  };
}

/** The gear as a chip names it: the saved setup is "Your gym" for a gym kit, else "Home". */
export function gearLabel(choice: EquipmentChoice, profile: Pick<Profile, 'equipment'>): string {
  if (choice === 'home') return isGymKit(profile) ? 'Your gym' : 'Home';
  return setupFor(choice).chip;
}

/* ---------- preview ---------- */

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

export type GapCause = 'gear' | 'skip' | 'time';

export interface CustomDayPreview {
  title: string;
  gear: string;
  status: 'ready' | 'limited' | 'none';
  minutes: number;
  sets: number;
  exercises: PreviewExercise[];
  /** A day of its own (moves nothing in the plan), not the planned day with new gear or time. */
  described: boolean;
  /** Asked areas with no exercise in the day, and why. */
  gaps: { area: Area; cause: GapCause }[];
  /** The why box, line by line: a bold label and its sentence. */
  why: { label: string; text: string }[];
}

const nouns = (areas: Area[]) => {
  const list = areas.map((area) => AREA_NOUN[area]);
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
};
const named = (areas: Area[]) => areas.map((area) => area.toLowerCase()).join(' and ');

/**
 * The preview card, all read from the generated day and the adaptation that Start runs: status
 * from the generator's feasibility plus any asked area left without an exercise, minutes by the
 * time model, rest by role.
 */
export function customDayPreview(
  talk: TalkState,
  program: Program,
  adapted: AdaptedWorkout,
  profile: Profile,
  plannedFocus: MuscleGroup[],
): CustomDayPreview {
  const primary = (exerciseId: string) => exerciseById(exerciseId)?.muscles[0];
  const described = describesDay(talk, plannedFocus);
  const skipMuscles = musclesOf(talk.skip);
  const kit = kitProfile(profile, talk.equipment);
  const caps = capabilitiesFor(kit);
  const gaps = (described ? talk.train : []).flatMap((area) => {
    if (adapted.exercises.some((exercise) => AREA_MUSCLES[area].includes(primary(exercise.exerciseId) as MuscleGroup))) return [];
    const possible = EXERCISES.filter((exercise) => AREA_MUSCLES[area].includes(exercise.muscles[0])
      && provides(caps, exercise.needs) && !kit.exclusions.includes(exercise.id));
    const cause: GapCause = possible.length === 0 ? 'gear'
      : possible.every((exercise) => worksSkipped(exercise, skipMuscles)) ? 'skip'
      : 'time';
    return [{ area, cause }];
  });
  const of = (cause: GapCause) => gaps.filter((gap) => gap.cause === cause).map((gap) => gap.area);
  const why: CustomDayPreview['why'] = [];
  if (talk.skip.length > 0) {
    const allSore = talk.skip.every((area) => talk.sore.includes(area));
    const noneSore = talk.skip.every((area) => !talk.sore.includes(area));
    why.push({
      label: 'Skipped:',
      text: allSore ? `${talk.skip.join(', ')}, because you said sore.`
        : noneSore ? `${talk.skip.join(', ')}.`
        : `${talk.skip.map((area) => (talk.sore.includes(area) ? `${area} (sore)` : area)).join(', ')}.`,
    });
  }
  if (of('gear').length) why.push({ label: 'Not possible here:', text: `no ${nouns(of('gear'))} exercise with this gear.` });
  if (of('skip').length) why.push({ label: 'Not possible today:', text: `every ${nouns(of('skip'))} exercise here also works ${named(talk.skip)}.` });
  if (of('time').length) why.push({ label: 'Not enough time:', text: `no ${nouns(of('time'))} work fit in ${talk.minutes} min.` });
  why.push({ label: 'Loads:', text: 'from your last sessions; first-timers ask you to pick a weight.' });
  why.push({ label: 'Time:', text: `includes a ${Math.round(warmUpSeconds(talk.minutes) / 60)}-minute warm-up and rest by exercise.` });

  const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
  const rests = sessionRests(ids, profile.goal, adapted.minutes);
  const lead = leadCompoundId(ids);
  const status = adapted.exercises.length === 0 || program.feasibility?.status === 'infeasible' ? 'none'
    : program.feasibility?.status === 'limited' || gaps.length > 0 ? 'limited'
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
    described,
    gaps,
    why,
  };
}
