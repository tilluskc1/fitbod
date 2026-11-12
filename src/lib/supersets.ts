import type { Exercise, MovementPattern, Profile } from '../types.ts';
import { exerciseById } from '../data/exercises.ts';
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

/** An entry of a session, or a planned exercise: its id, whether it was set aside today, and its sets. */
export interface PairEntry {
  exerciseId: string;
  skipped?: boolean;
  planned?: unknown[];
  performed?: { done: boolean }[];
  originalPlannedSets?: number;
}

/**
 * Entry `index` carries on the slot before it: a gear switch's next segment (same exercise, #188), or
 * a swap's replacement after its done half (`swapPendingExercise`): the half is all done and short of
 * the slot's requirement, both carry that requirement, together they hold no more sets than it, and
 * the replacement works the same main muscle (the swap sheet only offers those).
 */
function continues(entries: PairEntry[], index: number): boolean {
  const before = entries[index - 1];
  const here = entries[index];
  if (!before || !here) return false;
  if (before.exerciseId === here.exerciseId) return true;
  const required = before.originalPlannedSets;
  const kept = before.planned?.length ?? 0;
  return required !== undefined && here.originalPlannedSets === required && kept < required
    && kept + (here.planned?.length ?? 0) <= required
    && (before.performed ?? []).length > 0 && (before.performed ?? []).every((set) => set.done)
    && exerciseById(before.exerciseId)?.muscles[0] === exerciseById(here.exerciseId)?.muscles[0];
}

const doneCount = (entry: PairEntry) => entry.performed?.filter((set) => set.done).length ?? 0;
const hasPending = (entry: PairEntry) => (entry.performed ?? []).some((set) => !set.done);

/**
 * The day's pairs as index pairs `[a, b]`, a before b. The walk goes over slots, not entries: a split
 * slot's later entries (`continues`) belong to its first, so a swap never moves where pairs fall. The
 * first slot is the lead, by position (lesson 23), and never pairs, whatever now fills it. From the
 * second slot down, a slot pairs with the next one when their exercises can; else it stays straight.
 * Then a pair is dropped, its partner going straight from the next set, when one half was skipped or
 * split by a swap or gear switch, or when its logged sets show it did not run as a pair (both still
 * open, more than one set apart: a lifter who already did straight sets is not switched mid-way).
 * On a planned day the halves of each pair sit next to each other.
 */
export function sessionPairs(entries: PairEntry[], pairing: Pairing | null | undefined, minutes: number | undefined): [number, number][] {
  if (!pairingOn(pairing, minutes)) return [];
  const slots = entries.map((_, index) => index).filter((index) => !continues(entries, index));
  const split = (index: number) => continues(entries, index + 1);
  const known = (index: number) => exerciseById(entries[index].exerciseId) !== undefined;
  const pairs: [number, number][] = [];
  for (let slot = 1; slot + 1 < slots.length; slot += 1) {
    const [a, b] = [slots[slot], slots[slot + 1]];
    if (!known(a) || !known(b) || !canPair(exerciseById(entries[a].exerciseId)!, exerciseById(entries[b].exerciseId)!)) continue;
    pairs.push([a, b]);
    slot += 1;
  }
  return pairs.filter(([a, b]) => !entries[a].skipped && !entries[b].skipped && !split(a) && !split(b)
    && !(hasPending(entries[a]) && hasPending(entries[b]) && Math.abs(doneCount(entries[a]) - doneCount(entries[b])) > 1));
}

/**
 * The generator's order with more pairs side by side (#88): walking the day top down as `sessionPairs`
 * does, an exercise that cannot pair with the one after it takes the first later one it can pair with,
 * but only from its own group (`movable`), so the day keeps its order of roles (#133).
 */
export function pairOrder<T extends PairEntry>(
  entries: T[],
  pairing: Pairing | null | undefined,
  minutes: number | undefined,
  /** Whether `later` may move up next to `entry`: the generator allows it within the isolation work. */
  movable: (entry: T, later: T) => boolean,
): T[] {
  if (!pairingOn(pairing, minutes)) return entries;
  // A planned day has no split slots, so each entry is a slot; the first is the lead.
  const out = [...entries];
  const known = (entry: T) => exerciseById(entry.exerciseId) !== undefined;
  for (let index = 1; index + 1 < out.length; index += 1) {
    if (!known(out[index])) continue;
    const first = exerciseById(out[index].exerciseId)!;
    const fits = (entry: T) => exerciseById(entry.exerciseId) !== undefined && canPair(first, exerciseById(entry.exerciseId)!);
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
