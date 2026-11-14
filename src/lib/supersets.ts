import type { Exercise, MovementPattern, Profile } from '../types.ts';
import { exerciseById } from '../data/exercises.ts';
import { TRANSITION_SECONDS, WORK_SECONDS, exerciseSeconds } from './sessionTime.ts';

/**
 * Supersets (#88): two exercises done back to back, set by set, to save time.
 *
 * A day that has not started derives its pairs here, from its exercise list, the lifter's level and the
 * session length (`sessionPairs`), for the generator's time model, every minute the app promises and the
 * preview alike (lesson 9). Starting writes those pairs onto the record (`WorkoutExercise.pair`); from
 * then on only the stored numbers count (`storedPairs`). Nothing re-derives them: a swap or skip of one
 * half clears both halves (`unpair`), a rebuild keeps a pair only while both halves survive untouched
 * (`keepPairs`), and older records, which hold no numbers, run straight.
 */

/** What decides whether a day pairs: the lifter's level and switch. Absent means no pairing (the old path). */
export type Pairing = Pick<Profile, 'experience' | 'pairExercises'>;

/**
 * A running session's own pairs, by exercise id (#88): what a rebuild mid-session is fitted and priced
 * with, because `keepPairs` keeps exactly these and pairs nothing new.
 */
export interface KeptPairs { kept: [string, string][] }
/** Where a list's pairs come from: the profile (a day not started) or a running session's kept pairs. */
export type PairSource = Pairing | KeptPairs;

/** Moving from A to B inside a round. */
export const PAIR_SWITCH_SECONDS = 30;
/** Pairing saves the most time on short days; longer ones keep straight sets. */
export const PAIRING_MAX_MINUTES = 45;

/**
 * Intermediate and Advanced, the switch not Off, on a day of known length 45 min or less. Beginners
 * never. Read for a day that has not started; a running session keeps the pairs it stored.
 */
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

/** A barbell squat or hinge (back squat, deadlift, RDL, good morning): never paired (owner, 2026-11-13). */
export function heavyBarbell(exercise: Pick<Exercise, 'pattern' | 'equipment'>): boolean {
  return exercise.equipment === 'Barbell' && (exercise.pattern === 'squat' || exercise.pattern === 'hinge');
}

/**
 * Two exercises can run back to back: neither is a barbell squat or hinge; they work different regions
 * (antagonists like chest and back, or unrelated ones like rear delts and biceps, core with anything),
 * they share no muscle at all (so never the same main muscle, and no deadlift beside lunges), and they
 * are not two barbell lifts.
 */
export function canPair(a: Pick<Exercise, 'muscles' | 'pattern' | 'equipment'>, b: Pick<Exercise, 'muscles' | 'pattern' | 'equipment'>): boolean {
  if (heavyBarbell(a) || heavyBarbell(b)) return false;
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
  pair?: number;
}

/**
 * A planned day's pairs, as index pairs `[a, b]`, a before b. Only for a day that has not started: a
 * running session reads `storedPairs`. The first exercise is the lead, by position (lesson 23), and never
 * pairs. From the second down, an exercise pairs with the next one when they can; else it stays straight.
 */
export function sessionPairs(entries: PairEntry[], pairing: PairSource | null | undefined, minutes: number | undefined): [number, number][] {
  if (pairing && 'kept' in pairing) return keptPairsIn(entries, pairing);
  if (!pairingOn(pairing, minutes)) return [];
  const known = (index: number) => exerciseById(entries[index].exerciseId) !== undefined;
  const pairs: [number, number][] = [];
  for (let a = 1; a + 1 < entries.length; a += 1) {
    const b = a + 1;
    if (entries[a].skipped || entries[b].skipped) continue;
    if (!known(a) || !known(b) || !canPair(exerciseById(entries[a].exerciseId)!, exerciseById(entries[b].exerciseId)!)) continue;
    pairs.push([a, b]);
    a += 1;
  }
  return pairs;
}

/**
 * A started session's pairs, from the numbers written at the start: two entries holding the same number,
 * neither skipped. Any other count reads straight, so a record can never pair three exercises.
 */
export function storedPairs(entries: PairEntry[]): [number, number][] {
  const holders = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    if (entry.pair === undefined) return;
    holders.set(entry.pair, [...(holders.get(entry.pair) ?? []), index]);
  });
  return [...holders.values()]
    .filter((indices) => indices.length === 2 && indices.every((index) => !entries[index].skipped))
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}

/** A running session's stored pairs as exercise ids: what a rebuild keeps (`keepPairs`). */
export function keptPairsOf(entries: PairEntry[]): KeptPairs {
  return { kept: storedPairs(entries).map(([a, b]) => [entries[a].exerciseId, entries[b].exerciseId]) };
}

/** `kept` pairs found in a list: both exercises there once each, neither skipped (as `keepPairs` keeps them). */
function keptPairsIn(entries: PairEntry[], { kept }: KeptPairs): [number, number][] {
  const at = (id: string) => entries.flatMap((entry, index) => (entry.exerciseId === id ? [index] : []));
  return kept.flatMap(([x, y]) => {
    const [here, there] = [at(x), at(y)];
    if (here.length !== 1 || there.length !== 1 || entries[here[0]].skipped || entries[there[0]].skipped) return [];
    return [[Math.min(here[0], there[0]), Math.max(here[0], there[0])] as [number, number]];
  }).sort((p, q) => p[0] - q[0]);
}

/** The entries with `pairs` written as numbers 1, 2, ...: what a session stores when it starts. */
export function withPairs<T extends PairEntry>(entries: T[], pairs: [number, number][]): T[] {
  const number = new Map<number, number>();
  pairs.forEach(([a, b], k) => { number.set(a, k + 1); number.set(b, k + 1); });
  return entries.map((entry, index) => {
    const { pair: _old, ...rest } = entry;
    const value = number.get(index);
    return (value === undefined ? rest : { ...rest, pair: value }) as T;
  });
}

/** A new session's exercises with the day's pairs stored (#88): the pairs the preview showed. */
export function startPairs<T extends PairEntry>(entries: T[], pairing: Pairing | null | undefined, minutes: number | undefined): T[] {
  return withPairs(entries, sessionPairs(entries, pairing, minutes));
}

/**
 * The entries with `index`'s pair cleared on both halves: a swap or skip of one half sends its partner
 * straight. Every other entry keeps its number.
 */
export function unpair<T extends PairEntry>(entries: T[], index: number): T[] {
  const value = entries[index]?.pair;
  if (value === undefined) return entries;
  return entries.map((entry) => {
    if (entry.pair !== value) return entry;
    const { pair: _old, ...rest } = entry;
    return rest as T;
  });
}

/**
 * A rebuilt running session (a shorter or longer length, another setup, back to the plan) keeps a stored
 * pair only when both of its exercises are still there, each as one entry and not skipped; a cut or split
 * half sends its partner straight. Nothing new is paired, and kept pairs keep their numbers.
 */
export function keepPairs<T extends PairEntry>(before: PairEntry[], after: T[]): T[] {
  const kept = new Map<number, number>();
  for (const [a, b] of storedPairs(before)) {
    const at = (id: string) => after.flatMap((entry, index) => (entry.exerciseId === id ? [index] : []));
    const [here, there] = [at(before[a].exerciseId), at(before[b].exerciseId)];
    if (here.length !== 1 || there.length !== 1 || after[here[0]].skipped || after[there[0]].skipped) continue;
    kept.set(here[0], before[a].pair!);
    kept.set(there[0], before[b].pair!);
  }
  return after.map((entry, index) => {
    const { pair: _old, ...rest } = entry;
    const value = kept.get(index);
    return (value === undefined ? rest : { ...rest, pair: value }) as T;
  });
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

/** (#369) Later is offered while `index` has work left and another exercise does too. */
export function canMoveLater(session: { exercises: LoggerEntry[] }, index: number): boolean {
  return live(session.exercises[index]) && session.exercises.some((entry, other) => other !== index && live(entry));
}

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
