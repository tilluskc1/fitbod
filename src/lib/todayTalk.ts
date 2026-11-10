import type { Program } from '../data/flagship.ts';
import { EXERCISES, areIncompatible, exerciseById } from '../data/exercises.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { isDescribedSession, kitProfile } from './sequence.ts';
import type { Exercise, MuscleGroup, Profile, TodayOverride, WorkoutRecord } from '../types.ts';
import { isGymKit, setupFor, todayGlance } from './adapt.ts';
import type { AdaptedWorkout, Constraints, EquipmentChoice } from './adapt.ts';
import { AREAS, AREA_MUSCLES, MUSCLE_NOUN, areasOf, musclesOf, worksSkipped } from './areas.ts';
import type { Area } from './areas.ts';
import { keywordParser, resolveConstraints, todayConstraints } from './constraints.ts';
import { dayKey } from './plan.ts';
import type { ConstraintNotice, ParsedConstraints } from './constraints.ts';
import { MAX_EXERCISES } from './generator.ts';
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
  /** (#298) The saved kit is a full gym, so "dumbbells only" reads as the dumbbell-and-bench kit. */
  gymKit?: true;
}

/* ---------- the composer's reading of a sentence ---------- */

/** The shared parser's reading (gear, time, loads), plus what only the composer reads. */
export interface TalkParse extends ParsedConstraints {
  train?: Area[];
  avoid?: Area[];
  sore?: Area[];
  pain?: true;
  /** (#298) "Dumbbells only", "just dumbbells": a restriction, not the saved setup. */
  dumbbellsOnly?: true;
}

/** (#298) A restriction to dumbbells. Best effort, one round only (lessons #3). */
const DUMBBELLS_ONLY = /\b(?:dumbbells?\s+only|only\s+(?:the\s+)?dumbbells?|just\s+(?:the\s+)?dumbbells?)\b/i;

/** Words for each area; "upper body", "lower body" and "full body" name several. */
const AREA_WORDS: { word: string; areas: Area[] }[] = [
  { word: 'chest|pecs?', areas: ['Chest'] },
  // "Back" the muscle, not the adverb: "back at the gym", "get back", "came back" train nothing.
  { word: `(?<!\\b(?:get|got|getting|came|come|coming|go|going|went|be|been|i'm|im|we're)\\s)back(?!\\s+(?:at|home|to|in|into|from|on|after)\\b)|lats?`, areas: ['Back'] },
  { word: 'shoulders?|delts?', areas: ['Shoulders'] },
  { word: 'arms?|biceps?|triceps?', areas: ['Arms'] },
  { word: 'leg[\\s-]?day|legs?|quads?|hamstrings?|glutes?|calf|calves', areas: ['Legs'] },
  { word: 'abs|core|abdominals?', areas: ['Core'] },
  // #237: "upperbody", "upper-body", "full body" and a bare "upper". "Upper back" and "upper chest"
  // name only that muscle, so a bare "upper" never counts before a muscle word.
  { word: 'upper[\\s-]?body|upper(?![\\s-]*(?:back|chest|body|arms?|traps?|lats?|shoulders?|delts?|abs)\\b)', areas: ['Chest', 'Back', 'Shoulders', 'Arms'] },
  { word: 'lower[\\s-]?body', areas: ['Legs'] },
  { word: 'full[\\s-]?body', areas: [...AREAS] },
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
/**
 * (#241) "Nothing hurts except my knee", "apart from my knee, nothing hurts": a pain denial with an
 * exception word anywhere in the text, before or after it, names pain. Deliberately blunt after three
 * parser rounds (lesson 3): unsure reads as pain, so "no pain, but short on time" stops too, and
 * "It's only soreness" answers it. Reading the text is best effort; the chips are the safety net.
 */
const EXCEPT_WORD = /\b(?:except|apart from|aside from|other than|besides|save|excluding|minus|but|only|just|though)\b/i;
const NO_PAIN_ONCE = new RegExp(NO_PAIN.source, 'i');
const PAIN_EXCEPT = { test: (text: string) => NO_PAIN_ONCE.test(text) && EXCEPT_WORD.test(text) };
/** "No gym today", "not at home": a negated place selects nothing. */
const NO_PLACE = /\b(?:no|not|without|skip(?:ping)?|instead of)\s+(?:(?:at|to|the|a|my)\s+)*(?:gym|hotel|travel|home|garage)\b/gi;

/** One area, maybe after "my"/"the". */
const ONE = `${DET}(?:${AREA_WORDS.map(({ word }) => `(?:${word})`).join('|')})\\b`;
/** A list of areas: "legs", "legs and arms", "chest, back and shoulders". Commas only before the and/or. */
const LIST = `${ONE}(?:\\s*,\\s*${ONE})*(?:\\s*,?\\s+(?:and|or)\\s+${ONE})*`;
const RUN = new RegExp(`\\b${LIST}`, 'g');
/**
 * "Everything but legs", "anything except chest": all six areas minus those. With a sore word
 * after it ("everything but legs is sore") it is the other way round: those train, the rest skip.
 */
const EXCEPT = new RegExp(`\\b(?:everything|anything|all)\\s+(?:but|except(?:\\s+for)?|other than|apart from|besides)\\s+(${ONE}(?:\\s+(?:and|or)\\s+${ONE})*)((?:\\s*,)?(?:\\s+[\\w'’]+){0,3})`, 'g');
/** A sore word in the few words after an "everything but" list: "is sore", "is really sore", ", sore".
 * The excepted list ends at a comma, so "everything but legs, chest sore" excepts legs only. */
const EXCEPT_SORE = /\b(?:sore|tired|fried|wrecked|dead|aching|achy|stiff)\b/;
/** "Legs are fine": neither trained nor skipped. */
const FINE = /^\s+(?:(?:is|are|feel|feels|feeling|seem|seems)\s+)?(?:fine|ok|okay|good|great|alright|fresh)\b/;
/** "Everything is sore", "whole body is tired": every area is skipped. */
const ALL_SORE = /(?<!\bnot\s)\b(?:everything|(?<!\b(?:is|are|feel|feels)\s)all|(?:my\s+)?(?:whole\s+|full[\s-]?)body)(?:['’]s|\s+(?:is|are|feels?))?\s+(?:sore|tired|fried|wrecked|dead|aching|achy|stiff)\b/;
const NOT_BEFORE = '(?<!\\b(?:not|no|never)\\s)';
const SORE_BEFORE_RE = new RegExp(`${NOT_BEFORE}\\b(?:${SORE_BEFORE})\\s+$`);
const LEAVE_BEFORE_RE = new RegExp(`${NOT_BEFORE}\\b(?:${LEAVE_BEFORE})\\s+$`);
const SORE_AFTER_RE = new RegExp(`^((?:\\s+[\\w'’]+){0,2}?)\\s+(?:${SORE_AFTER})\\b`);

const areasIn = (text: string): Area[] =>
  AREA_WORDS.filter(({ word }) => new RegExp(`\\b(?:${word})\\b`).test(text)).flatMap(({ areas }) => areas);

/**
 * Areas named, list by list. A sore or skip word before or after a list ("legs and arms are
 * sore", "skip legs, arms and chest") covers the whole list, unless negated ("legs not sore");
 * "<area> is fine" names it for neither; any other mention trains it. A comma alone is no list,
 * and a sentence ends at . ; : ! ? or "but", so "tired, legs" never skips legs.
 */
function readAreas(text: string): { train: Area[]; skip: Area[]; sore: Area[] } {
  const train = new Set<Area>();
  const skip = new Set<Area>();
  const sore = new Set<Area>();
  if (ALL_SORE.test(text.toLowerCase())) return { train: [], skip: [...AREAS], sore: [...AREAS] };
  const said = text.toLowerCase().replace(EXCEPT, (_match, list: string, rest: string) => {
    // Any sore word within the next few words, not negated, makes the rest of the body the sore part.
    const soreRest = EXCEPT_SORE.test(rest) && !NEGATED.test(rest);
    const except = areasIn(list);
    for (const area of AREAS) {
      if (except.includes(area) === Boolean(soreRest)) train.add(area);
      else if (soreRest) { skip.add(area); sore.add(area); }
    }
    return soreRest ? ' ' : ` ${rest}`;
  });
  for (const clause of said.split(/[.;:!?\n]+|\bbut\b/)) {
    for (const run of clause.matchAll(RUN)) {
      const at = run.index ?? 0;
      // "chest, legs are sore" is two mentions, not a list: only an and/or makes one.
      const pieces = /\b(?:and|or)\b/.test(run[0]) ? [{ text: run[0], at }]
        : [...run[0].matchAll(new RegExp(ONE, 'g'))].map((one) => ({ text: one[0], at: at + (one.index ?? 0) }));
      for (const whole of pieces) {
        // "Fine/ok" covers only the areas it follows: "no legs, arms and chest ok" still skips legs.
        const fine = FINE.test(clause.slice(whole.at + whole.text.length));
        const cut = whole.text.lastIndexOf(',');
        if (fine && cut < 0) continue;
        const piece = fine ? { text: whole.text.slice(0, cut), at: whole.at } : whole;
        const before = clause.slice(0, piece.at);
        const after = fine ? '' : clause.slice(piece.at + piece.text.length);
        const named = SORE_AFTER_RE.exec(after);
        const isSore = Boolean(named && !NEGATED.test(named[1])) || SORE_BEFORE_RE.test(before);
        const left = LEAVE_BEFORE_RE.test(before);
        for (const area of areasIn(piece.text)) {
          if (isSore) sore.add(area);
          (isSore || left ? skip : train).add(area);
        }
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
  if (PAIN.test(plain) || PAIN_EXCEPT.test(text)) result.pain = true;
  if (DUMBBELLS_ONLY.test(plain)) result.dumbbellsOnly = true;
  return result;
}

/* ---------- chips ---------- */

/** The chips before anything is said: today's gear and time, and today's day. */
export function baseTalk(constraints: Pick<Constraints, 'minutes' | 'equipment' | 'focus' | 'skip'>, plannedFocus: MuscleGroup[], gymKit = false): TalkState {
  const skip = areasOf(constraints.skip ?? []);
  return {
    equipment: constraints.equipment,
    minutes: constraints.minutes,
    train: areasOf(constraints.focus ?? plannedFocus).filter((area) => !skip.includes(area)),
    skip,
    sore: [],
    pain: false,
    notices: [],
    ...(gymKit ? { gymKit: true as const } : {}),
  };
}

/** The text read on top of the base; whatever it does not name keeps the base's value. */
export function talkFromText(text: string, base: TalkState): TalkState {
  if (!text.trim()) return base;
  const parsed = talkParse(text);
  // (#298) At a gym, "dumbbells only" restricts today to the dumbbell-and-bench kit (the travel gym's).
  if (base.gymKit && parsed.dumbbellsOnly && parsed.equipment === 'home') parsed.equipment = 'hotel';
  const resolved = resolveConstraints({ minutes: base.minutes, equipment: base.equipment }, parsed);
  const skip = parsed.avoid ?? base.skip;
  return {
    ...(base.gymKit ? { gymKit: true as const } : {}),
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
  /** 'sore' skips the area and says why (#236 asks "anything sore?"). */
  areas: Partial<Record<Area, 'train' | 'skip' | 'sore' | 'off'>>;
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
      skip: has(talk.skip, area, tap === 'skip' || tap === 'sore'),
      sore: has(talk.sore, area, tap === 'sore'),
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

/** Why a muscle has no exercise: gear, skip, time, the day's exercise count (`cap`), or its only move repeats one in the day (`twin`). */
export type GapCause = 'gear' | 'skip' | 'time' | 'cap' | 'twin';

export interface CustomDayPreview {
  title: string;
  gear: string;
  status: 'ready' | 'limited' | 'none';
  /** The day's minutes by the timer's model, the figure Today shows once it starts (#203). */
  minutes: number;
  /** The work cannot come close to the length asked for: shown with ≈, as on Today (#203). */
  approx: boolean;
  sets: number;
  exercises: PreviewExercise[];
  /** A day of its own (moves nothing in the plan), not the planned day with new gear or time. */
  described: boolean;
  /** Muscles of the asked areas with no exercise of their own in the day, and why (#211). */
  gaps: { area: Area; muscle: MuscleGroup; cause: GapCause; repeats?: { exercise: string; of: string } }[];
  /** The why box, line by line: a bold label and its sentence. */
  why: { label: string; text: string }[];
}

const nouns = (muscles: MuscleGroup[]) => {
  const list = muscles.map((muscle) => MUSCLE_NOUN[muscle]);
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
};
const named = (areas: Area[]) => areas.map((area) => area.toLowerCase()).join(' and ');

/** The exercises a status reads: a generated day's, or a running session's (#220). */
type DayExercises = { exercises: readonly { exerciseId: string; name: string }[] };

/** A described day's status and the lines that explain it: one source for the preview and Today (#219). */
export interface DayStatus {
  status: CustomDayPreview['status'];
  gaps: CustomDayPreview['gaps'];
  /** One line per kind of gap; empty when every asked muscle has an exercise. */
  reasons: CustomDayPreview['why'];
}

/**
 * A described day's status (#219): Not enough equipment when nothing can be built, Limited only
 * for a muscle of an asked area left without an exercise whose primary muscle it is, named with
 * its cause (#211), else Ready. The generator's planned-day requirements ("no pressing and
 * pulling work") do not apply: the lifter asked for areas, not a Push or Pull day.
 */
export function describedStatus(
  day: Pick<TalkState, 'train' | 'skip' | 'equipment' | 'minutes'>,
  program: Pick<Program, 'feasibility'>,
  adapted: DayExercises,
  profile: Profile,
): DayStatus {
  const primary = (exerciseId: string) => exerciseById(exerciseId)?.muscles[0];
  const skipMuscles = musclesOf(day.skip);
  const kit = kitProfile(profile, day.equipment);
  const caps = capabilitiesFor(kit);
  const gaps = day.train.flatMap((area) => AREA_MUSCLES[area].flatMap((muscle): CustomDayPreview['gaps'] => {
    if (adapted.exercises.some((exercise) => primary(exercise.exerciseId) === muscle)) return [];
    const possible = EXERCISES.filter((exercise) => exercise.muscles[0] === muscle
      && provides(caps, exercise.needs) && !kit.exclusions.includes(exercise.id));
    if (possible.length === 0) return [{ area, muscle, cause: 'gear' }];
    const allowed = possible.filter((exercise) => !worksSkipped(exercise, skipMuscles));
    if (allowed.length === 0) return [{ area, muscle, cause: 'skip' }];
    // A twin of an exercise already in the day (Diamond Push-Up beside Push-Up) cannot join it.
    const twinOf = (exercise: Exercise) => adapted.exercises.find((item) => areIncompatible(item.exerciseId, exercise.id));
    const repeated = twinOf(allowed[0]);
    if (repeated && allowed.every((exercise) => twinOf(exercise))) {
      return [{ area, muscle, cause: 'twin', repeats: { exercise: allowed[0].name, of: repeated.name } }];
    }
    // An empty day left nothing out for time or the cap: it is the day's "Not enough equipment" (#216).
    if (adapted.exercises.length === 0) return [{ area, muscle, cause: 'gear' }];
    return [{ area, muscle, cause: adapted.exercises.length >= MAX_EXERCISES[profile.experience] ? 'cap' : 'time' }];
  }));
  const of = (cause: GapCause) => gaps.filter((gap) => gap.cause === cause).map((gap) => gap.muscle);
  const reasons: DayStatus['reasons'] = [];
  if (of('gear').length) reasons.push({ label: 'Not possible here:', text: `no ${nouns(of('gear'))} exercise with this gear.` });
  if (of('skip').length) reasons.push({ label: 'Not possible today:', text: `every ${nouns(of('skip'))} exercise here also works ${named(day.skip)}.` });
  if (of('time').length) reasons.push({ label: 'Not enough time:', text: `no ${nouns(of('time'))} work fit in ${day.minutes} min.` });
  if (of('cap').length) reasons.push({ label: `Room for ${MAX_EXERCISES[profile.experience]} exercises:`, text: `no ${nouns(of('cap'))} work today.` });
  for (const gap of gaps) {
    if (gap.repeats) reasons.push({ label: `No separate ${MUSCLE_NOUN[gap.muscle]} move:`, text: `${gap.repeats.exercise} repeats ${gap.repeats.of}.` });
  }
  const status = adapted.exercises.length === 0 || program.feasibility?.status === 'infeasible' ? 'none'
    : gaps.length > 0 ? 'limited'
    : 'ready';
  return { status, gaps, reasons };
}

/** Today's described day, read back from its constraints (#219); null on a planned day. */
export function describedDayStatus(constraints: Constraints, program: Pick<Program, 'feasibility'>, adapted: DayExercises, profile: Profile): DayStatus | null {
  if (!constraints.focus) return null;
  const day = { train: areasOf(constraints.focus), skip: areasOf(constraints.skip ?? []), equipment: constraints.equipment, minutes: constraints.minutes };
  return describedStatus(day, program, adapted, profile);
}

/**
 * (#220) A running described session's status: the session's own exercises and planned sets,
 * judged against what was asked (the override's focus and skip). The ask is today-only; once the
 * override is not the session's day's (midnight passed), nothing honest is left to judge against,
 * so null: no chip and no note, never the planned day's status. Null for a planned session.
 */
export function describedSessionStatus(session: WorkoutRecord, override: TodayOverride | null, profile: Profile): DayStatus | null {
  if (!isDescribedSession(session) || !override?.focus || override.date !== dayKey(new Date(session.date))) return null;
  // A running session has its exercises: no generator verdict applies to it.
  return describedDayStatus(todayConstraints(profile, override), {}, session, profile);
}

/**
 * The preview card, all read from the generated day and the adaptation that Start runs: a
 * described day's status and reasons from `describedStatus` (#219), a planned day's from the
 * generator's feasibility; minutes by the time model, rest by role.
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
  // Train is never empty on a day built from focus; with nothing to train the planned day is built.
  const shown = described && talk.train.length > 0 ? describedStatus(talk, program, adapted, profile) : null;
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
  why.push(...(shown?.reasons ?? []));
  why.push({ label: 'Loads:', text: 'from your last sessions; first-timers ask you to pick a weight.' });
  why.push({ label: 'Time:', text: `includes a ${Math.round(warmUpSeconds(talk.minutes) / 60)}-minute warm-up and rest by exercise.` });

  const ids = adapted.exercises.map((exercise) => exercise.exerciseId);
  const rests = sessionRests(ids, profile.goal, adapted.minutes);
  // One minutes model on every surface (#203): the preview names what Today will.
  const glance = todayGlance(adapted, null, false, profile.goal);
  const lead = leadCompoundId(ids);
  const status = shown?.status
    ?? (adapted.exercises.length === 0 || program.feasibility?.status === 'infeasible' ? 'none'
      : program.feasibility?.status === 'limited' ? 'limited'
      : 'ready');
  return {
    title: adapted.name,
    gear: gearLabel(talk.equipment, profile),
    status,
    minutes: glance.minutes,
    approx: glance.approx,
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
    gaps: shown?.gaps ?? [],
    why,
  };
}
