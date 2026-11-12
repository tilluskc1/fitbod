import type { Exercise, MovementPattern, Profile } from '../types.ts';
import { exerciseById } from '../data/exercises.ts';
import { leadCompoundId } from './progression.ts';
import { TRANSITION_SECONDS, WORK_SECONDS, exerciseSeconds } from './sessionTime.ts';

/**
 * Supersets (#88): two exercises done back to back, set by set, to save time.
 *
 * Nothing is stored. Pairs are derived from the session's own exercise list and the lifter's level,
 * toggle and the session length, by this one file, for the generator's time model, every minute the app
 * promises and the logger alike (lesson 9). Settings are read live: flipping the toggle mid-session
 * changes pairing from the next set and leaves logged sets alone.
 */

/** What decides whether a day pairs: the profile fits it. Absent means no pairing (the old path). */
export type Pairing = Pick<Profile, 'experience' | 'pairExercises'>;

/** Moving from A to B inside a round. */
export const PAIR_SWITCH_SECONDS = 30;
/** Pairing saves the most time on short days; longer ones keep straight sets. */
export const PAIRING_MAX_MINUTES = 45;

/** Intermediate and Advanced, the toggle not Off, on a day of known length 45 min or less. Beginners never. */
export function pairingOn(pairing: Pairing | null | undefined, minutes: number | undefined): boolean {
  return Boolean(pairing) && pairing!.experience !== 'Beginner' && pairing!.pairExercises !== false
    && minutes !== undefined && minutes <= PAIRING_MAX_MINUTES;
}

/**
 * The body region a movement works, by its pattern. Rear-delt work is its own region, so a face pull
 * pairs with a curl even though both list a pulling muscle.
 */
const REGION: Record<MovementPattern, string> = {
  horizontal_push: 'push',
  vertical_push: 'push',
  elbow_extension: 'push',
  shoulder_abduction: 'push',
  horizontal_pull: 'pull',
  vertical_pull: 'pull',
  elbow_flexion: 'pull',
  shoulder_horizontal_abduction: 'rear-delt',
  squat: 'knee',
  lunge: 'knee',
  knee_extension: 'knee',
  hinge: 'hip',
  hip_extension: 'hip',
  knee_flexion: 'hip',
  calf_raise: 'calf',
  core_flexion: 'core',
  core_stability: 'core',
};

/**
 * Two exercises can run back to back: they work different regions (antagonists like chest and back,
 * or unrelated ones like rear delts and biceps, core with anything), they share no muscle at all (so
 * never the same main muscle, and no deadlift beside lunges), and they are not two barbell lifts.
 */
export function canPair(a: Pick<Exercise, 'muscles' | 'pattern' | 'equipment'>, b: Pick<Exercise, 'muscles' | 'pattern' | 'equipment'>): boolean {
  if (a.equipment === 'Barbell' && b.equipment === 'Barbell') return false;
  if (REGION[a.pattern] === REGION[b.pattern]) return false;
  return !a.muscles.some((muscle) => b.muscles.includes(muscle));
}

/** An entry of a session, or a planned exercise: only its id and whether it was set aside today. */
export interface PairEntry {
  exerciseId: string;
  skipped?: boolean;
}

/**
 * The day's pairs as index pairs `[a, b]`, a before b, always next to each other in the list. Walked
 * from the top: an exercise pairs with the one after it when both can (never the lead), else it stays
 * straight. A skipped exercise keeps its place, so its partner goes straight and nothing re-pairs.
 */
export function sessionPairs(entries: PairEntry[], pairing: Pairing | null | undefined, minutes: number | undefined): [number, number][] {
  if (!pairingOn(pairing, minutes)) return [];
  const lead = leadCompoundId(entries.map((entry) => entry.exerciseId));
  const eligible = (index: number) => {
    const id = entries[index]?.exerciseId;
    return id !== undefined && id !== lead && exerciseById(id) !== undefined;
  };
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < entries.length; index += 1) {
    if (!eligible(index) || !eligible(index + 1)) continue;
    if (!canPair(exerciseById(entries[index].exerciseId)!, exerciseById(entries[index + 1].exerciseId)!)) continue;
    pairs.push([index, index + 1]);
    index += 1;
  }
  return pairs.filter(([a, b]) => !entries[a].skipped && !entries[b].skipped);
}

/**
 * The generator's order with more pairs side by side (#88): walking the day top down, an exercise that
 * cannot pair with the one after it takes the first later one it can pair with, but only from its own
 * group (`movable`), so the day keeps its order of roles (#133). `sessionPairs` on the result finds
 * the pairs this built, and any others already side by side.
 */
export function pairOrder<T extends PairEntry>(
  entries: T[],
  pairing: Pairing | null | undefined,
  minutes: number | undefined,
  /** Whether `later` may move up next to `entry`: the generator allows it within the isolation work. */
  movable: (entry: T, later: T) => boolean,
): T[] {
  if (!pairingOn(pairing, minutes)) return entries;
  const lead = leadCompoundId(entries.map((entry) => entry.exerciseId));
  const out = [...entries];
  const eligible = (entry: T) => entry.exerciseId !== lead && exerciseById(entry.exerciseId) !== undefined;
  for (let index = 0; index + 1 < out.length; index += 1) {
    if (!eligible(out[index])) continue;
    const first = exerciseById(out[index].exerciseId)!;
    const fits = (entry: T) => eligible(entry) && canPair(first, exerciseById(entry.exerciseId)!);
    if (fits(out[index + 1])) { index += 1; continue; }
    const partner = out.findIndex((entry, other) => other > index + 1 && movable(out[index], entry) && fits(entry));
    if (partner < 0) continue;
    const [moved] = out.splice(partner, 1);
    out.splice(index + 1, 0, moved);
    index += 1;
  }
  return out;
}

/**
 * One pair's time: one move to the two stations, then per round A, the 30 s switch and B, the longer of
 * the two rests between rounds; sets one has past the other run straight after the last round's rest.
 */
export function pairSeconds(a: { sets: number; rest: number }, b: { sets: number; rest: number }): number {
  if (a.sets <= 0 || b.sets <= 0) return exerciseSeconds(a.sets, a.rest) + exerciseSeconds(b.sets, b.rest);
  const rounds = Math.min(a.sets, b.sets);
  const full = Math.max(a.rest, b.rest);
  const longer = a.sets > b.sets ? a : b;
  const extra = Math.abs(a.sets - b.sets);
  return TRANSITION_SECONDS + rounds * (2 * WORK_SECONDS + PAIR_SWITCH_SECONDS) + (rounds - 1) * full
    + (extra > 0 ? full + extra * WORK_SECONDS + (extra - 1) * longer.rest : 0);
}

/** A whole session on the timer's clock with these pairs, warm-up included. Empty work takes no time. */
export function pairedSessionSeconds(items: { sets: number; rest: number }[], pairs: [number, number][], warmUp: number): number {
  const paired = new Map<number, number>();
  for (const [a, b] of pairs) { paired.set(a, b); paired.set(b, a); }
  let work = 0;
  items.forEach((item, index) => {
    const partner = paired.get(index);
    if (partner === undefined) work += exerciseSeconds(item.sets, item.rest);
    else if (partner > index) work += pairSeconds(item, items[partner]);
  });
  return work > 0 ? warmUp + work : 0;
}

interface LoggerEntry extends PairEntry {
  performed: { done: boolean }[];
}

const doneOf = (entry: LoggerEntry) => entry.performed.filter((set) => set.done).length;
const pendingOf = (entry: LoggerEntry) => entry.performed.length - doneOf(entry);
const live = (entry: LoggerEntry | undefined) => entry !== undefined && !entry.skipped && pendingOf(entry) > 0;

/** The other half of `index`'s pair, or undefined. */
export function partnerOf(pairs: [number, number][], index: number): number | undefined {
  const pair = pairs.find(([a, b]) => a === index || b === index);
  return pair === undefined ? undefined : pair[0] === index ? pair[1] : pair[0];
}

/**
 * The exercise with work to log next (#88): the first one still on offer, and within a pair whichever
 * half is behind (A on a tie), so A1, B1, A2, B2; once one half is finished the other runs straight.
 * Without pairs it is `pendingExerciseIndex`. Read from the done sets alone, so a reload resumes in place.
 */
export function pairedPendingIndex(session: { exercises: LoggerEntry[] }, pairs: [number, number][]): number {
  const first = session.exercises.findIndex(live);
  if (first < 0) return first;
  const partner = partnerOf(pairs, first);
  if (partner === undefined || !live(session.exercises[partner])) return first;
  const [a, b] = first < partner ? [first, partner] : [partner, first];
  return doneOf(session.exercises[b]) < doneOf(session.exercises[a]) ? b : a;
}

/**
 * The rest after logging a set of `index` (#88): the 30 s switch when its partner is up next, the longer
 * of the pair's rests once a round is done, its own rest when it runs straight.
 */
export function restAfterLog(
  session: { exercises: LoggerEntry[] },
  index: number,
  rests: number[],
  pairs: [number, number][],
): number {
  const own = rests[index];
  const partner = partnerOf(pairs, index);
  if (partner === undefined || !live(session.exercises[partner])) return own;
  const entry = session.exercises[index];
  // Done counts once this set is logged.
  const doneHere = doneOf(entry) + 1;
  const donePartner = doneOf(session.exercises[partner]);
  if (donePartner < doneHere) return PAIR_SWITCH_SECONDS;
  return Math.max(own, rests[partner]);
}

/** "Round 2 of 3" for the exercise on screen, while its pair still runs rounds; null when it runs straight. */
export function pairRound(session: { exercises: LoggerEntry[] }, index: number, pairs: [number, number][]): { round: number; rounds: number } | null {
  const partner = partnerOf(pairs, index);
  if (partner === undefined) return null;
  const here = session.exercises[index];
  const there = session.exercises[partner];
  if (!live(here) || !live(there)) return null;
  const rounds = Math.min(here.performed.length, there.performed.length);
  const round = Math.min(doneOf(here), doneOf(there)) + 1;
  return round <= rounds ? { round, rounds } : null;
}
