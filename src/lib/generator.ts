import { EQUIPMENT_OPTIONS, EXERCISES, SUPPORT_OPTIONS, areIncompatible, exerciseById } from '../data/exercises.ts';
import type {
  Exercise,
  MuscleGroup,
  PlanDay,
  Profile,
  SetupChoice,
  WorkoutExercise,
  WorkoutRecord,
} from '../types.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import {
  evaluateFeasibility,
  isRelevantToDay,
  matchesRequirement,
  requirementsForDay,
} from './feasibility.ts';
import { isCompound, pickLead, prescribeExercise } from './progression.ts';
import { REST_SECONDS, SHORT_SESSION_MAX_SETS, SHORT_SESSION_MINUTES, exerciseSeconds, fitSets, leadFloorSets, restSecondsFor, sessionSeconds, warmUpSeconds } from './sessionTime.ts';
import { programExercise } from '../data/flagship.ts';
import { pairOrder, pairedSessionSeconds, pairingOn, sessionPairs } from './supersets.ts';

const SPLITS: Record<number, PlanDay[]> = {
  2: [
    { name: 'Full Body A', focus: ['Chest', 'Back', 'Quads', 'Hamstrings', 'Shoulders', 'Core'] },
    { name: 'Full Body B', focus: ['Back', 'Chest', 'Glutes', 'Hamstrings', 'Biceps', 'Triceps', 'Calves'] },
  ],
  3: [
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  ],
  4: [
    { name: 'Upper A', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { name: 'Lower A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
    { name: 'Upper B', focus: ['Back', 'Chest', 'Shoulders', 'Triceps', 'Biceps'] },
    { name: 'Lower B', focus: ['Hamstrings', 'Quads', 'Glutes', 'Calves', 'Core'] },
  ],
  5: [
    { name: 'Push', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
    { name: 'Upper', focus: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { name: 'Lower', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'] },
  ],
  6: [
    { name: 'Push A', focus: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull A', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs A', focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
    { name: 'Push B', focus: ['Shoulders', 'Chest', 'Triceps'] },
    { name: 'Pull B', focus: ['Back', 'Biceps', 'Core'] },
    { name: 'Legs B', focus: ['Hamstrings', 'Glutes', 'Quads', 'Calves', 'Core'] },
  ],
};

const CORE_PATTERNS = new Set(['core_flexion', 'core_stability']);
/**
 * A split day that lists Core after its main muscles takes one core exercise of at most 3 sets;
 * the slot and time that frees go to the day's first muscle (#190). Full Body is not a split day.
 */
const capsCore = (day: PlanDay) => !day.name.startsWith('Full Body') && day.focus.includes('Core') && day.focus[0] !== 'Core';
const CAPPED_CORE_SETS = 3;

/**
 * Main lifts, best first within each movement (#131); the equipment filter
 * skips what the user lacks. Anything unlisted is an accessory, left to the seed.
 */
const MAIN_LIFTS = [
  'back-squat', 'front-squat', 'leg-press', 'goblet-squat', 'kettlebell-goblet-squat',
  'deadlift', 'romanian-deadlift', 'hip-thrust',
  'barbell-bench-press', 'incline-dumbbell-press', 'dumbbell-bench-press', 'machine-chest-press', 'dumbbell-floor-press', 'push-up',
  'overhead-press', 'dumbbell-shoulder-press', 'arnold-press',
  'barbell-row', 'pull-up', 'seated-cable-row', 'lat-pulldown', 'dumbbell-row', 'chin-up',
];
/** A beginner learns the hinge with the Romanian deadlift before pulling from the floor. */
const BEGINNER_LIFTS = MAIN_LIFTS.map((id) =>
  id === 'deadlift' ? 'romanian-deadlift' : id === 'romanian-deadlift' ? 'deadlift' : id);

export function buildPlan(profile: Profile): PlanDay[] {
  const days = Math.min(6, Math.max(2, profile.daysPerWeek));
  return SPLITS[days];
}

export const MIN_EXERCISES = 3;

/**
 * Exercises one muscle may take in a session, counted by each exercise's first-listed muscle (#96):
 * 2, or 3 on a day that lists the muscle in its focus for an advanced lifter, and for an
 * intermediate one at 60 minutes or more. A beginner's 2 is about 6-8 hard sets, plenty. Under
 * 45 minutes no muscle takes a third: movements come before sets (#229). A third only fills spare
 * time and must be a new movement for the muscle, so in practice it is an isolation (a fly beside
 * bench and incline), not another press: close-grip bench repeats the flat press. Weekly volume,
 * about 10-20 hard sets a muscle, is the guide behind it, not enforced.
 */
export function muscleCap(experience: Profile['experience'], minutes: number, focus: boolean): number {
  const third = focus && minutes >= SHORT_SESSION_MINUTES
    && (experience === 'Advanced' || (experience === 'Intermediate' && minutes >= 60));
  return third ? 3 : 2;
}

/** Past this, extra exercises mostly add fatigue, not results. */
export const MAX_EXERCISES = { Beginner: 6, Intermediate: 8, Advanced: 8 } as const;
/** Thinned to fit a short session, an exercise keeps at least this many sets; the lead keeps 3. */
const MIN_SETS = 2;

/**
 * Seconds a day of these set counts takes, warm-up included, by the same rest the
 * timer uses (#132). `rests[i]` is exercise i's rest; see `sessionTime.ts`.
 */
export function estimatedSeconds(sets: number[], rests: number[], sessionMinutes?: number): number {
  return sessionSeconds(sets.map((count, index) => ({ sets: count, rest: rests[index] ?? REST_SECONDS.isolation })),
    warmUpSeconds(sessionMinutes));
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A day to generate. A day the lifter described (#211) gives each of its focus muscles an
 * exercise of its own before a second one for any, as long as they fit the time.
 */
export type DayRequest = PlanDay & { everyMuscle?: boolean };

export interface GeneratedSession {
  exercises: WorkoutExercise[];
  feasibility: ReturnType<typeof evaluateFeasibility>;
  targetCount: number;
  /** The day's thirds (#96): exercises a shortened day drops before it cuts a set. Absent when none. */
  thirds?: string[];
}

/**
 * Coverage-first, seeded selection, up to `target` exercises in priority order.
 *
 * The seed still does the work it always did (stable day-to-day ordering).
 * What changed is the stopping rule: an exercise is only eligible if its
 * complete equipment requirements are met, it is not excluded, it belongs to
 * the day's focus, and taking it does not pile a third exercise onto the same
 * movement pattern or muscle (a trained lifter's focus muscle may take a third,
 * see `muscleCap`). When the pool cannot fill the target, the session is
 * shorter and reports itself as limited instead of silently padding with
 * unrelated movements.
 */
function selectExercises(profile: Profile, day: DayRequest, dayIndex: number, target: number) {
  const requirements = requirementsForDay(day);
  const caps = capabilitiesFor(profile);
  const exclusions = new Set(profile.exclusions);

  const eligible = EXERCISES.filter(
    (exercise) =>
      provides(caps, exercise.needs) &&
      !exclusions.has(exercise.id) &&
      // A 'more' is the user asking for it, so it may go off the day's pattern (#120).
      (isRelevantToDay(exercise, day) ||
        (profile.preferences?.[exercise.id] === 'more' && day.focus.includes(exercise.muscles[0]))),
  );

  // Within the seeded order, "more" moves ahead and "less" behind (still
  // eligible). The sort is stable, so compound-first below keeps it as a tiebreaker.
  const rank = (exercise: Exercise) =>
    profile.preferences?.[exercise.id] === 'more' ? 0 : profile.preferences?.[exercise.id] === 'less' ? 2 : 1;
  const lifts = profile.experience === 'Beginner' ? BEGINNER_LIFTS : MAIN_LIFTS;
  const family = (exercise: Exercise) => lifts.filter((id) => exerciseById(id)?.pattern === exercise.pattern);
  const main = (exercise: Exercise) => {
    const index = lifts.indexOf(exercise.id);
    return index < 0 ? lifts.length : index;
  };
  // A day repeating an earlier day's movements this week (Lower B after Lower A) swaps each
  // movement's first choice for its second (Romanian Deadlift for Deadlift). A beginner repeats
  // the same lifts instead: practice, and the second choices include Deadlift and Front Squat.
  const movements = (item: PlanDay) => requirementsForDay(item).map((requirement) => requirement.id).join();
  const repeat = profile.experience !== 'Beginner'
    && buildPlan(profile).slice(0, dayIndex).some((item) => movements(item) === movements(day));
  const replaced = (exercise: Exercise) => repeat && rank(exercise) !== 0 && family(exercise)[0] === exercise.id
    && eligible.some((item) => item.id === family(exercise)[1]);
  const pool = eligible.filter((exercise) => !replaced(exercise));
  // Preferences first, then the main lifts in rank, then the seeded order for accessories.
  const shuffled = seededShuffle(pool, 7 + dayIndex * 13).sort((a, b) => rank(a) - rank(b) || main(a) - main(b));
  // Keep that order as the tiebreaker, but prefer compound movements
  // when filling slots so an accessory cannot consume the last slot for a
  // primary muscle and leave the session short.
  // A main movement pattern also outranks an accessory one, so a home Pull day takes a pullover
  // (its only vertical pull) before a rear-delt fly (#174).
  const MAIN_PATTERNS = new Set(['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'squat', 'lunge', 'hinge', 'hip_extension']);
  const mainPattern = (exercise: Exercise) => (MAIN_PATTERNS.has(exercise.pattern) ? 0 : 1);
  const compoundFirst = [...shuffled].sort((a, b) => b.muscles.length - a.muscles.length || mainPattern(a) - mainPattern(b));
  const picked: Exercise[] = [];
  const patternCounts = new Map<string, number>();
  const primaryMuscleCounts = new Map<MuscleGroup, number>();

  const pullDay = day.focus[0] === 'Back';
  const coreCapped = capsCore(day);
  const cap = (muscle: MuscleGroup) => muscleCap(profile.experience, profile.sessionMinutes ?? 35, day.focus.includes(muscle));
  const canTake = (exercise: Exercise, allowDuplicatePattern: boolean, perMuscle = 2): boolean => {
    if (picked.some((item) => item.id === exercise.id || areIncompatible(item.id, exercise.id))) return false;
    const patterns = patternCounts.get(exercise.pattern) ?? 0;
    const primary = exercise.muscles[0];
    if (CORE_PATTERNS.has(exercise.pattern)) {
      if (patterns >= 1) return false;
    } else if (!allowDuplicatePattern && patterns >= 1) {
      return false;
    } else if (patterns >= Math.min(perMuscle, cap(primary))) {
      return false;
    }
    // A pull day is back first: one curl at most, the rest of the slots go to back work (#155).
    if (pullDay && exercise.pattern === 'elbow_flexion' && patterns >= 1) return false;
    if ((primaryMuscleCounts.get(primary) ?? 0) >= perMuscle) return false;
    return true;
  };

  const covering = new Set<Exercise>();
  const take = (exercise: Exercise) => {
    picked.push(exercise);
    patternCounts.set(exercise.pattern, (patternCounts.get(exercise.pattern) ?? 0) + 1);
    const primary = exercise.muscles[0];
    primaryMuscleCounts.set(primary, (primaryMuscleCounts.get(primary) ?? 0) + 1);
  };

  // 1. Cover every required movement family, if the equipment allows it.
  for (const requirement of requirements) {
    const alreadyCovered = picked.some((exercise) => matchesRequirement(exercise, requirement));
    if (alreadyCovered) continue;
    const candidates = shuffled.filter(
      (exercise) => matchesRequirement(exercise, requirement) && canTake(exercise, false),
    );
    // Multi-muscle first, then the day's earliest focus muscle (Push-Up over
    // Diamond Push-Up on a Push day), so an incompatible twin cannot crowd out
    // the exercise that fills the first slot.
    const focusRank = (exercise: Exercise) => {
      const index = day.focus.indexOf(exercise.muscles[0]);
      return index < 0 ? day.focus.length : index;
    };
    // A described day covers a movement with an exercise for one of its muscles no pick trains yet
    // (#211): a Romanian deadlift (Hamstrings) over a deadlift (Back) on a legs day, or beside a row.
    const offFocus = (exercise: Exercise) => Number(Boolean(day.everyMuscle) && (!day.focus.includes(exercise.muscles[0])
      || picked.some((item) => item.muscles[0] === exercise.muscles[0])));
    const best = [...candidates].sort(
      (a, b) =>
        Number(b.muscles.length >= 2) - Number(a.muscles.length >= 2) ||
        rank(a) - rank(b) || // "more" and "less" outrank focus order
        offFocus(a) - offFocus(b) ||
        main(a) - main(b) ||
        focusRank(a) - focusRank(b),
    )[0];
    if (best) { take(best); covering.add(best); }
  }

  // 1a. "More" exercises claim a slot before the focus filler can spend it.
  for (const exercise of shuffled) {
    if (picked.length >= target) break;
    if (rank(exercise) === 0 && canTake(exercise, false)) take(exercise);
  }

  // 1b. Give every focus muscle its own exercise while slots remain, so the
  // last slot is decided by the day, not by whichever caps happen to be left.
  for (const muscle of day.focus) {
    if (picked.length >= target) break;
    if (picked.some((exercise) => exercise.muscles[0] === muscle)) continue;
    const candidate = shuffled.find(
      (exercise) => exercise.muscles[0] === muscle && canTake(exercise, false),
    );
    if (candidate) take(candidate);
  }

  // 2. Fill using movement patterns not already used.
  for (const exercise of compoundFirst) {
    if (picked.length >= target) break;
    if (canTake(exercise, false)) take(exercise);
  }

  // 3. Only add a variation of a movement already used if slots remain.
  for (const exercise of compoundFirst) {
    if (picked.length >= target) break;
    if (canTake(exercise, true)) take(exercise);
  }

  // A further exercise for the day's first muscle that can take one, else the next, in the direction
  // the day has less of; a tie goes to the lead's (a second row beside a chin-up).
  const further = (perMuscle: (muscle: MuscleGroup) => number, third = false) => {
    const leadPattern = pickLead(picked, day.focus)?.pattern;
    const used = (exercise: Exercise) => 2 * (patternCounts.get(exercise.pattern) ?? 0) + Number(exercise.pattern !== leadPattern);
    // A third (#96) is a loaded move wherever the kit loads the muscle (no push-up as a gym's third press),
    // and a new movement for it: an incline or a fly beside a flat press, never a second flat press.
    const loaded = (muscle: MuscleGroup) => eligible.some((exercise) => exercise.muscles[0] === muscle && exercise.equipment !== 'Bodyweight');
    // Against everything the day already trains the muscle with, a compound third adds a pattern (an
    // incline press also pushes up; no pulldown or pullover beside a chin-up), and an isolation is no copy.
    const patterns = (exercise: Exercise) => [exercise.pattern, ...(exercise.secondaryPatterns ?? [])];
    const newMovement = (exercise: Exercise) => {
      const trained = picked.filter((item) => item.muscles.includes(exercise.muscles[0]));
      return isCompound(exercise)
        ? patterns(exercise).some((pattern) => !trained.some((item) => patterns(item).includes(pattern)))
        : !trained.some((item) => patterns(item).join() === patterns(exercise).join());
    };
    const fits = (exercise: Exercise) => !third || ((primaryMuscleCounts.get(exercise.muscles[0]) ?? 0) === 2
      && !(exercise.equipment === 'Bodyweight' && loaded(exercise.muscles[0])) && newMovement(exercise));
    for (const muscle of day.focus.filter((item) => item !== 'Core')) {
      const best = compoundFirst.filter((exercise) => exercise.muscles[0] === muscle && canTake(exercise, true, perMuscle(muscle)) && fits(exercise))
        .sort((a, b) => used(a) - used(b))[0];
      if (best) return best;
    }
    return undefined;
  };

  // 4. A split day keeps one core exercise: a second one gives its slot to the day's first muscle,
  // else another of its muscles (#190), up to a third for it. With nothing to take it, the slot stays
  // empty and the day is shorter. The new exercise is the first to go when time runs short, as the second core was.
  const extraCore = coreCapped ? picked.filter((exercise) => CORE_PATTERNS.has(exercise.pattern))[1] : undefined;
  const freed = extraCore && further(() => 3);
  if (extraCore) {
    picked.splice(picked.indexOf(extraCore), 1);
    patternCounts.set(extraCore.pattern, (patternCounts.get(extraCore.pattern) ?? 1) - 1);
    primaryMuscleCounts.set(extraCore.muscles[0], (primaryMuscleCounts.get(extraCore.muscles[0]) ?? 1) - 1);
    if (freed) take(freed);
  }

  // 5. A trained lifter's focus muscle may take a third exercise while slots remain (#96). It stays
  // out of the day: `generateWorkout` adds it only into time the day leaves over.
  const thirds: Exercise[] = [];
  for (let next = further(cap, true); next && picked.length < target; next = further(cap, true)) {
    take(next);
    thirds.push(next);
  }

  return { picked: picked.filter((exercise) => !thirds.includes(exercise)), covering, requirements, freed, thirds };
}

/**
 * The day for the saved session length (#89). Exercises are taken in priority
 * order while their real sets fit the minutes (never fewer than 3, nor fewer than
 * the day's required movements); a day still too long at that floor thins sets,
 * and one with every possible exercise and time left adds a set to accessories.
 *
 * Prescriptions come from the progression policy: the load and rep target are
 * derived from the last completed session that trained each exercise, so a
 * session carries real numbers instead of a fixed 0 kg × 10.
 */
export function generateWorkout(
  profile: Profile,
  day: DayRequest,
  dayIndex: number,
  history: WorkoutRecord[] = [],
  targetCountOverride?: number,
  /** Where the day runs (#188): that setup's own history prescribes it. */
  setup: SetupChoice = 'home',
): GeneratedSession {
  const max = MAX_EXERCISES[profile.experience];
  const fixed = targetCountOverride && targetCountOverride > 0
    ? Math.min(max, Math.max(MIN_EXERCISES, Math.round(targetCountOverride)))
    : undefined;
  const { picked, covering, requirements, freed, thirds } = selectExercises(profile, day, dayIndex, fixed ?? max);

  const coveredRequirements = requirements.filter((requirement) =>
    picked.some((exercise) => matchesRequirement(exercise, requirement)),
  ).length;

  // Core accessories alone do not make a Push/Pull/Legs session. If none of the
  // day's required movement families can be performed, this is infeasible and
  // the caller must not start a workout. A described day (#211) only picks its asked muscles, so it
  // keeps what it found: curls and extensions are an Arms day with Chest skipped (#216).
  if (requirements.length > 0 && coveredRequirements === 0 && !(day.everyMuscle && picked.length > 0)) {
    const targetCount = fixed ?? max;
    return {
      exercises: [],
      feasibility: evaluateFeasibility(profile, day, [], targetCount),
      targetCount,
    };
  }

  const lead = pickLead(picked, day.focus);
  // The lead, then one compound per movement, then the rest (#131): cutting from the end drops
  // isolation and second presses before a movement the day has only once.
  const leadFirst = lead ? [lead, ...picked.filter((exercise) => exercise !== lead)] : picked;
  const firstOfMovement = new Set(leadFirst.filter((exercise, index) => isCompound(exercise)
    && leadFirst.findIndex((item) => isCompound(item) && item.pattern === exercise.pattern) === index));
  const tier = (exercise: Exercise) => (exercise === lead ? 0 : firstOfMovement.has(exercise) ? 1 : 2);
  // Within a tier the day's first focus outlasts the rest when time runs short: a Pull day keeps
  // its second back movement before a curl (#155 under the honest time model, #132).
  const focusRank = (exercise: Exercise) => {
    const index = day.focus.indexOf(exercise.muscles[0]);
    return index < 0 ? day.focus.length : index;
  };
  // The slot a second core exercise freed (#190) goes first, unless it holds the lead.
  const spare = (exercise: Exercise) => Number(exercise === freed && exercise !== lead);
  picked.sort((a, b) => spare(a) - spare(b) || tier(a) - tier(b) || focusRank(a) - focusRank(b));
  const prescriptions = picked.map((exercise) =>
    prescribeExercise(exercise, profile, history, exercise === lead, lead !== undefined, setup));
  const sets = prescriptions.map((prescription) => prescription.sets);
  const rests = picked.map((exercise) => restSecondsFor(exercise, exercise === lead, profile.goal, profile.sessionMinutes ?? 35));

  // Trimming uses the priority above; the session itself runs lead, compounds, isolation, core (#133).
  const showTier = (exercise: Exercise) => (exercise === lead ? 0
    : isCompound(exercise) ? 1
    : CORE_PATTERNS.has(exercise.pattern) ? 3 : 2);
  // Among compounds, heavy barbell lifts come while you are fresh and single-leg work last (#174).
  const heaviness = (exercise: Exercise) => (exercise.pattern === 'lunge' ? 3
    : exercise.equipment !== 'Barbell' ? 2
    : exercise.pattern === 'squat' || exercise.pattern === 'hinge' ? 0 : 1);
  const showOrder = (items: Exercise[]) => items.map((_, index) => index)
    .sort((a, b) => showTier(items[a]) - showTier(items[b])
      || (showTier(items[a]) === 1 ? heaviness(items[a]) - heaviness(items[b]) : 0) || a - b);
  // (#88) With pairing on, compatible accessories sit side by side and the day is timed as it will
  // run: pairs share their rest. Off, the straight-set model below is untouched.
  const pairing = pairingOn(profile, profile.sessionMinutes ?? 35);
  /** Indices into `items` in the order the session runs, pairs side by side. */
  const runOrder = (items: Exercise[]) => {
    const order = showOrder(items);
    return pairing
      ? pairOrder(order.map((index) => ({ exerciseId: items[index].id, index })), profile, profile.sessionMinutes ?? 35,
        // Only isolation work moves, next to isolation work, so the day still runs lead, compounds, isolation, core.
        (entry, later) => showTier(items[entry.index]) === 2 && showTier(items[later.index]) === 2).map((entry) => entry.index)
      : order;
  };
  /** Seconds the exercises in `items` take at `counts` sets, by the model the timer runs. */
  const secondsOf = (items: Exercise[], counts: number[]) => {
    const itemRests = items.map((exercise) => rests[picked.indexOf(exercise)] ?? REST_SECONDS.isolation);
    if (!pairing) return estimatedSeconds(counts, itemRests, profile.sessionMinutes ?? 35);
    const kept = items.map((_, index) => index).filter((index) => counts[index] > 0);
    const order = runOrder(kept.map((index) => items[index])).map((position) => kept[position]);
    const pairs = sessionPairs(order.map((index) => ({ exerciseId: items[index].id })), profile, profile.sessionMinutes ?? 35);
    return pairedSessionSeconds(order.map((index) => ({ sets: counts[index], rest: itemRests[index] })), pairs,
      warmUpSeconds(profile.sessionMinutes ?? 35));
  };
  const seconds = () => secondsOf(picked, sets);
  /** One more 3-set isolation exercise: the unit "room for another exercise" is measured in. */
  const anotherExercise = exerciseSeconds(3, REST_SECONDS.isolation);

  let targetCount = fixed ?? picked.length;
  if (fixed === undefined) {
    const minutes = profile.sessionMinutes ?? 35;
    const budget = minutes * 60;
    const short = minutes < SHORT_SESSION_MINUTES;
    const all = picked.length;
    const leadFloor = leadFloorSets(minutes);
    const held = new Set(lead ? [lead, ...covering] : covering);
    // A described day (#211) keeps one exercise per focus muscle, in focus order, while the lead,
    // the day's requirements and those exercises fit at their floor sets: the cut below then takes a
    // second exercise for a muscle before the only one for another. A muscle past that is left for time.
    if (day.everyMuscle) {
      const floorSeconds = (items: Exercise[]) => secondsOf(items,
        items.map((exercise) => Math.min(sets[picked.indexOf(exercise)], exercise === lead ? leadFloor : MIN_SETS)));
      for (const muscle of day.focus) {
        if ([...held].some((exercise) => exercise.muscles[0] === muscle)) continue;
        const cover = picked.find((exercise) => exercise.muscles[0] === muscle);
        if (cover && floorSeconds([...held, cover]) <= budget) held.add(cover);
      }
    }
    const drop = (index: number) => {
      picked.splice(index, 1);
      sets.splice(index, 1);
      rests.splice(index, 1);
      prescriptions.splice(index, 1);
    };
    if (short) {
      // Under 45 minutes (#229) the day is fitted by the same rule a today-only shorter length uses
      // (`fitSets`): every movement at its floor before any is cut, cut from the end of the priority
      // order, sets handed back evenly, none past 3. Cutting whole movements first left a
      // 30-minute day at 3 exercises and 9 sets.
      const fromEnd = picked.map((_, index) => index).reverse();
      // (#88) A paired described day times its covers on a partial day whose pairs differ from the final
      // one, so a cover can miss by seconds: its cut takes a muscle's second exercise before another
      // muscle's only one (#211), still from the end.
      const second = (index: number) => picked.slice(0, index).some((other) => other.muscles[0] === picked[index].muscles[0]);
      const dropOrder = day.everyMuscle && pairing
        ? [...fromEnd.filter(second), ...fromEnd.filter((index) => !second(index))]
        : fromEnd;
      const fitted = fitSets(
        picked.map((exercise, index) => ({
          sets: sets[index],
          rest: rests[index],
          hold: Boolean(programExercise(exercise.id)?.holdSeconds),
          lead: exercise === lead,
          keep: held.has(exercise),
          pattern: exercise.pattern,
        })),
        dropOrder,
        budget,
        warmUpSeconds(minutes),
        { cap: SHORT_SESSION_MAX_SETS, minCount: MIN_EXERCISES, leadFloor, twoPresses: true,
          ...(pairing ? { secondsOf: (counts: number[]) => secondsOf(picked, counts) } : {}) },
      );
      fitted.forEach((count, index) => { sets[index] = count; });
      for (let index = picked.length - 1; index >= 0; index -= 1) if (sets[index] === 0) drop(index);
    }
    // Cut from the end, never the lead nor a day requirement's only cover, while the day runs long.
    for (let index = picked.length - 1; index > 0 && picked.length > MIN_EXERCISES && seconds() > budget; index -= 1) {
      if (held.has(picked[index])) continue;
      drop(index);
    }
    const kept = picked.length;
    const room = budget - seconds();
    // A count gap is only reported when gear or exclusions caused it: the same
    // day with everything allowed shows how many the caps can actually hold.
    // Preferences stay: a 'more' pick reorders the fill, and that is the user's choice, not a gap.
    const open = { ...profile, equipment: [...EQUIPMENT_OPTIONS], support: [...SUPPORT_OPTIONS], exclusions: [] };
    const capacity = selectExercises(open, day, dayIndex, max).picked.length;
    const exhausted = kept === all;
    // Too long even at the floor: thin the last exercises first, down to 2 sets (the lead to 3;
    // under 30 minutes the lead may go to 2 so a four-movement day still fits, #132).
    for (let index = kept - 1; index >= 0 && seconds() > budget; ) {
      const least = index === 0 && lead ? leadFloor : MIN_SETS;
      if (sets[index] > least) sets[index] -= 1;
      else index -= 1;
    }
    // Still promising more minutes than asked at that floor (a 2-day strength day at 20 min, #197):
    // the last movements drop to one set. Dropping a required movement would read as a gear gap (#67).
    for (let index = kept - 1; index >= 0 && Math.round(seconds() / 60) * 60 > budget; index -= 1) {
      if (!(index === 0 && lead) && sets[index] > 1) sets[index] -= 1;
    }
    // No exercise left to add and at least one more exercise's worth of time:
    // 3-set work gets a fourth set in priority order while it fits, the lead first, so a
    // later compound never ends up with more sets than the lead (#133). A 5-set lead is already past 4.
    if (!short && exhausted && room >= anotherExercise) {
      for (let index = 0; index < kept; index += 1) {
        const most = capsCore(day) && CORE_PATTERNS.has(picked[index].pattern) ? CAPPED_CORE_SETS : 4;
        if (sets[index] >= most) continue;
        if (pairing) {
          sets[index] += 1;
          if (seconds() > budget) sets[index] -= 1;
        } else if (seconds() + exerciseSeconds(sets[index] + 1, rests[index]) - exerciseSeconds(sets[index], rests[index]) <= budget) sets[index] += 1;
      }
    }
    // The target is what the saved gear covers (#67): more gear could add exercises, but a day that
    // still fills the time is not short. Only when the gear cannot fill half the session is the
    // count a real gap, named against what the caps could hold with everything allowed.
    const thin = exhausted && seconds() < budget * 0.5;
    targetCount = kept < all || !thin ? kept
      : Math.min(capacity, kept + Math.max(0, Math.floor(room / anotherExercise)));
    // A muscle's third (#96) only fills time left over: it takes no set from the day above, and
    // stays out when the day kept fewer than two others for its muscle.
    for (const exercise of short ? [] : thirds) {
      if (picked.filter((item) => item.muscles[0] === exercise.muscles[0]).length < 2) continue;
      const prescription = prescribeExercise(exercise, profile, history, false, lead !== undefined, setup);
      picked.push(exercise);
      sets.push(prescription.sets);
      rests.push(restSecondsFor(exercise, false, profile.goal, minutes));
      prescriptions.push(prescription);
      if (seconds() > budget) drop(picked.length - 1);
      else targetCount = Math.max(targetCount, picked.length);
    }
  }

  const order = runOrder(picked);

  const exercises: WorkoutExercise[] = order.map((index) => {
    const exercise = picked[index];
    const prescription = prescriptions[index];
    // A rack-lowered load is planned at its target so the adaptation caps it and says so (#188).
    const planned = Array.from({ length: sets[index] }, () => ({
      weight: prescription.uncapped ?? prescription.weight,
      reps: prescription.reps,
    }));
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      planned,
      performed: planned.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        done: false,
        completedAt: null,
      })),
    };
  });

  const kept = thirds.filter((exercise) => picked.includes(exercise)).map((exercise) => exercise.id);
  return {
    exercises,
    feasibility: evaluateFeasibility(profile, day, picked, targetCount),
    targetCount,
    ...(kept.length > 0 ? { thirds: kept } : {}),
  };
}
