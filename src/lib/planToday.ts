import { AREAS } from './areas.ts';
import type { Area } from './areas.ts';
import { SETUP_CHOICES } from './adapt.ts';
import type { EquipmentChoice } from './adapt.ts';
import { composeTalk, tapTrain } from './todayTalk.ts';
import type { TalkState, Taps } from './todayTalk.ts';

/**
 * "Plan today with me" (#236): four questions whose answers are chip taps on the #193 composer.
 * Every answer goes through `composeTalk`, so taps, text and the chips are one path (lessons #9):
 * the same answers build the same day, whichever way they were given.
 */
export type Question = 'time' | 'sore' | 'train' | 'gear';
export const QUESTIONS: Question[] = ['time', 'sore', 'train', 'gear'];
export const PLAN_TIMES = [15, 20, 30, 45, 60, 90];

const UPPER: Area[] = ['Chest', 'Back', 'Shoulders', 'Arms'];

/** Q1 choices: the fixed times plus today's and the saved length, so a pre-selected chip always shows. */
export function timeChoices(...also: number[]): number[] {
  return [...new Set([...PLAN_TIMES, ...also])].sort((a, b) => a - b);
}

/** Q4 choices: the saved setup first; a no-gear profile's saved setup is bodyweight, so "home" is not offered twice. */
export function gearChoices(saved: EquipmentChoice, current: EquipmentChoice): EquipmentChoice[] {
  const list = [saved, ...SETUP_CHOICES.filter((choice) => choice !== saved && !(choice === 'home' && saved === 'bodyweight'))];
  return list.includes(current) ? list : [...list, current];
}

/** Q2, one area: sore on, or off again. Off returns the area to what it was without the tap, never still skipped. */
export function toggleSore(base: TalkState, text: string, taps: Taps, area: Area): Taps {
  const talk = composeTalk(base, text, taps);
  if (!talk.skip.includes(area)) return { ...taps, areas: { ...taps.areas, [area]: 'sore' } };
  return unSore(base, text, taps, [area]);
}

/** Q2 "Nothing": every skipped area back; one the text skipped is left neither trained nor skipped. */
export function nothingSore(base: TalkState, text: string, taps: Taps): Taps {
  return unSore(base, text, taps, composeTalk(base, text, taps).skip);
}

function unSore(base: TalkState, text: string, taps: Taps, areas: Area[]): Taps {
  let next = taps;
  for (const area of areas) {
    const rest = { ...next.areas };
    delete rest[area];
    next = { ...next, areas: rest };
    if (composeTalk(base, text, next).skip.includes(area)) next = { ...next, areas: { ...next.areas, [area]: 'off' } };
  }
  return next;
}

/** Q2's pain answers: "It hurts" tapped, and the text "It's only soreness" answered (null: none). */
export interface PainAnswer { hurts: boolean; soreFor: string | null }
export const NO_PAIN_ANSWER: PainAnswer = { hurts: false, soreFor: null };

/** "Nothing" and "It hurts" set only the tap; just "It's only soreness" answers the text's pain, as it reads now. */
export function answerPain(answer: PainAnswer, tap: 'nothing' | 'hurts' | 'soreness', text: string): PainAnswer {
  if (tap === 'soreness') return { hurts: false, soreFor: text };
  return { ...answer, hurts: tap === 'hurts' && !answer.hurts };
}

/** Pain stops the build: a tapped "It hurts", or text pain that "It's only soreness" did not answer (new or changed text). */
export function painStops(answer: PainAnswer, text: string, textPain: boolean): boolean {
  return answer.hurts || (textPain && text !== answer.soreFor);
}

/** Q3 "My planned day": the planned day's areas, minus anything sore or skipped (sore wins). */
export function pickPlanned(base: TalkState, text: string, taps: Taps, plannedAreas: Area[]): Taps {
  const talk = composeTalk(base, text, taps);
  const areas = { ...taps.areas };
  for (const area of AREAS) {
    if (!talk.skip.includes(area)) areas[area] = plannedAreas.includes(area) ? 'train' : 'off';
  }
  return { ...taps, areas };
}

/** Whether Q3 reads as "My planned day": every area not skipped trains exactly when the plan does. */
export function isPlannedPick(talk: TalkState, plannedAreas: Area[]): boolean {
  return AREAS.every((area) => talk.skip.includes(area) || talk.train.includes(area) === plannedAreas.includes(area));
}

/**
 * Q3, one area. Leaving "My planned day" starts from none, so the first tap trains just that
 * area; after that a tap turns the area on or off. Sore and skipped areas are not offered.
 */
export function toggleTrain(base: TalkState, text: string, taps: Taps, area: Area, plannedAreas: Area[]): Taps {
  const talk = composeTalk(base, text, taps);
  if (!isPlannedPick(talk, plannedAreas)) return tapTrain(talk, taps, area);
  const none = Object.fromEntries(AREAS.filter((item) => !talk.skip.includes(item)).map((item) => [item, 'off']));
  return { ...taps, areas: { ...taps.areas, ...none, [area]: 'train' } };
}

const words = (areas: Area[]) =>
  areas.length < 2 ? areas.join('') : `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
const same = (a: Area[], b: Area[]) => a.length === b.length && a.every((area) => b.includes(area));

/** What Q3 trains, in words: the planned day's name, "Upper body", "Full body", or the areas. */
export function trainLabel(talk: TalkState, plannedName: string, plannedAreas: Area[]): string {
  if (talk.train.length === 0) return 'Nothing to train';
  if (talk.skip.length === 0 && isPlannedPick(talk, plannedAreas)) return plannedName;
  if (same(talk.train, UPPER)) return 'Upper body';
  if (same(talk.train, AREAS)) return 'Full body';
  const list = words(talk.train).toLowerCase();
  return list.charAt(0).toUpperCase() + list.slice(1);
}

/** The summary line: "30 min · Upper body · skipping Legs · Home gym". */
export function planLine(talk: TalkState, plannedName: string, plannedAreas: Area[], gear: string): string {
  return [
    `${talk.minutes} min`,
    trainLabel(talk, plannedName, plannedAreas),
    ...(talk.skip.length ? [`skipping ${words(talk.skip)}`] : []),
    gear,
  ].join(' · ');
}
