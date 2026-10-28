import { EXERCISES } from '../data/exercises.ts';
import type {
  Alternative,
  Capability,
  CoverageRequirement,
  CoverageResult,
  Exercise,
  Feasibility,
  MovementPattern,
  MuscleGroup,
  PlanDay,
  Profile,
} from '../types';
import {
  capabilitiesFor,
  capabilityLabel,
  equipmentForCapability,
  missingCapabilities,
  provides,
  supportForCapability,
} from './capabilities.ts';

const PRESS: CoverageRequirement = {
  id: 'press',
  label: 'Pressing',
  anyOf: ['horizontal_push', 'vertical_push'],
};

const PULL: CoverageRequirement = {
  id: 'pull',
  label: 'Pulling',
  anyOf: ['horizontal_pull', 'vertical_pull'],
};

const SQUAT: CoverageRequirement = {
  id: 'squat',
  label: 'Squat or lunge',
  anyOf: ['squat', 'lunge'],
};

const HINGE: CoverageRequirement = {
  id: 'hinge',
  label: 'Hip hinge',
  anyOf: ['hinge', 'hip_extension'],
};

const TRICEPS: CoverageRequirement = {
  id: 'triceps',
  label: 'Triceps extension',
  anyOf: ['elbow_extension'],
};

const BICEPS: CoverageRequirement = {
  id: 'biceps',
  label: 'Biceps flexion',
  anyOf: ['elbow_flexion'],
};

const CALF: CoverageRequirement = {
  id: 'calf',
  label: 'Calf work',
  anyOf: ['calf_raise'],
};

const CORE: CoverageRequirement = {
  id: 'core',
  label: 'Core work',
  anyOf: ['core_flexion', 'core_stability'],
};

const FOCUS_REQUIREMENTS: { muscles: MuscleGroup[]; requirement: CoverageRequirement }[] = [
  { muscles: ['Chest', 'Shoulders', 'Triceps'], requirement: PRESS },
  { muscles: ['Back', 'Biceps'], requirement: PULL },
  { muscles: ['Quads'], requirement: SQUAT },
  { muscles: ['Hamstrings', 'Glutes'], requirement: HINGE },
  { muscles: ['Calves'], requirement: CALF },
  { muscles: ['Core'], requirement: CORE },
];

function deriveFromFocus(focus: MuscleGroup[]): CoverageRequirement[] {
  const out: CoverageRequirement[] = [];
  for (const entry of FOCUS_REQUIREMENTS) {
    if (entry.muscles.some((m) => focus.includes(m)) && !out.some((r) => r.id === entry.requirement.id)) {
      out.push(entry.requirement);
    }
  }
  return out;
}

/**
 * What a day has to train to be a real session. These are movement families,
 * not muscle tags: a day with six exercises that are all core work does not
 * cover a leg day.
 */
export function requirementsForDay(day: PlanDay): CoverageRequirement[] {
  const name = day.name.toLowerCase();
  if (name.startsWith('push')) return [PRESS, TRICEPS];
  if (name.startsWith('pull')) return [PULL, BICEPS];
  if (name.startsWith('legs')) return [SQUAT, HINGE, CALF];
  if (name.startsWith('upper')) return [PRESS, PULL, TRICEPS];
  if (name.startsWith('lower')) return [SQUAT, HINGE, CALF];
  if (name.startsWith('full body')) {
    return name.endsWith('b') ? [PRESS, PULL, HINGE, CORE] : [PRESS, PULL, SQUAT, HINGE];
  }
  return deriveFromFocus(day.focus);
}

export function patternsOf(exercise: Exercise): MovementPattern[] {
  return [exercise.pattern, ...(exercise.secondaryPatterns ?? [])];
}

export function matchesRequirement(exercise: Exercise, requirement: CoverageRequirement): boolean {
  return patternsOf(exercise).some((pattern) => requirement.anyOf.includes(pattern));
}

export function isRelevantToDay(exercise: Exercise, day: PlanDay): boolean {
  // Primary muscle only. Matching any secondary tag is what let a Goblet Squat
  // (Quads/Glutes/Core) appear on a Pull day through its Core tag.
  return day.focus.includes(exercise.muscles[0]);
}


function coverageFor(requirements: CoverageRequirement[], selected: Exercise[]): CoverageResult[] {
  return requirements.map((requirement) => {
    const exerciseIds = selected
      .filter((exercise) => matchesRequirement(exercise, requirement))
      .map((exercise) => exercise.id);
    return {
      id: requirement.id,
      label: requirement.label,
      satisfied: exerciseIds.length > 0,
      exerciseIds,
    };
  });
}

function joinLabels(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function buildAlternatives(
  profile: Profile,
  day: PlanDay,
  requirements: CoverageRequirement[],
  coverage: CoverageResult[],
  selectedCount: number,
  targetCount: number,
): Alternative[] {
  const caps = capabilitiesFor(profile);
  const excluded = new Set(profile.exclusions);
  const alternatives: Alternative[] = [];
  const offeredCaps = new Set<Capability>();
  const offeredExercises = new Set<string>();
  const missing = requirements.filter(
    (requirement) => !coverage.find((item) => item.id === requirement.id)?.satisfied,
  );
  const countGap = selectedCount < targetCount;

  // Nothing to suggest when the day is already complete and full.
  if (missing.length === 0 && !countGap) return [];

  const relevant = EXERCISES.filter((exercise) => isRelevantToDay(exercise, day));

  // 1. Exercises the user excluded that would otherwise be usable.
  for (const exercise of relevant) {
    if (!excluded.has(exercise.id)) continue;
    if (!provides(caps, exercise.needs)) continue;
    if (offeredExercises.has(exercise.id)) continue;
    offeredExercises.add(exercise.id);
    const restores = missing.filter((requirement) => matchesRequirement(exercise, requirement));
    alternatives.push({
      kind: 'allow-exercise',
      label: `Allow ${exercise.name}`,
      detail:
        restores.length > 0
          ? `You excluded this exercise. Allowing it restores ${joinLabels(restores.map((requirement) => requirement.label.toLowerCase()))} coverage.`
          : `You excluded this exercise. Allowing it adds an available ${day.name} exercise.`,
      exerciseId: exercise.id,
    });
  }

  // 2. Missing capabilities that unlock at least one exercise on their own.
  const blocked = relevant.filter(
    (exercise) => !excluded.has(exercise.id) && !provides(caps, exercise.needs),
  );
  const candidateCaps = new Set<Capability>();
  for (const exercise of blocked) {
    for (const cap of missingCapabilities(caps, exercise.needs)) candidateCaps.add(cap);
  }

  for (const cap of candidateCaps) {
    if (offeredCaps.has(cap)) continue;
    // Only advertise a purchase that actually unlocks something on its own.
    const unlocked = blocked.filter((exercise) => {
      const absent = missingCapabilities(caps, exercise.needs);
      return absent.length === 1 && absent[0] === cap;
    });
    // When a specific movement family is missing, only advertise purchases
    // that actually restore that coverage.
    const forGap =
      missing.length > 0
        ? unlocked.filter((exercise) =>
            missing.some((requirement) => matchesRequirement(exercise, requirement)),
          )
        : unlocked;
    if (forGap.length === 0) continue;
    offeredCaps.add(cap);
    const example = forGap[0];
    const support = supportForCapability(cap);
    const equipment = equipmentForCapability(cap);
    alternatives.push({
      kind: 'capability',
      label: `Add ${capabilityLabel(cap)}`,
      detail:
        missing.length > 0
          ? `Unlocks ${forGap.length} ${forGap.length === 1 ? 'exercise' : 'exercises'} for ${joinLabels(missing.map((requirement) => requirement.label.toLowerCase()))} (e.g. ${example.name}).`
          : `Adds ${forGap.length} possible ${day.name} ${forGap.length === 1 ? 'exercise' : 'exercises'} (e.g. ${example.name}).`,
      capability: cap,
      support,
      equipment,
    });
  }

  return alternatives.slice(0, 5);
}

/**
 * Evaluate a chosen exercise list against the day's movement requirements.
 * The app uses this for both the dashboard preview and a resumed session.
 */
export function evaluateFeasibility(
  profile: Profile,
  day: PlanDay,
  selected: Exercise[],
  targetCount: number,
): Feasibility {
  const requirements = requirementsForDay(day);
  const coverage = coverageFor(requirements, selected);
  const unsatisfied = coverage.filter((item) => !item.satisfied);
  const availableCount = selected.length;
  const alternatives = buildAlternatives(
    profile,
    day,
    requirements,
    coverage,
    availableCount,
    targetCount,
  );

  if (availableCount === 0) {
    return {
      status: 'infeasible',
      reason: `No ${day.name.toLowerCase()} exercise can be performed with the selected equipment and exclusions.`,
      targetCount,
      selectedCount: 0,
      coverage,
      alternatives,
    };
  }

  if (unsatisfied.length > 0) {
    return {
      status: 'limited',
      reason: `Limited session: no ${joinLabels(unsatisfied.map((item) => item.label.toLowerCase()))} work is available with these constraints.`,
      targetCount,
      selectedCount: availableCount,
      coverage,
      alternatives,
    };
  }

  if (availableCount < targetCount) {
    return {
      status: 'limited',
      reason: `Limited session: ${availableCount} of ${targetCount} exercises are possible without repeating movement patterns.`,
      targetCount,
      selectedCount: availableCount,
      coverage,
      alternatives,
    };
  }

  return {
    status: 'ok',
    reason: `Full session: ${availableCount} exercises covering ${joinLabels(coverage.map((item) => item.label.toLowerCase()))}.`,
    targetCount,
    selectedCount: availableCount,
    coverage,
    alternatives: [],
  };
}
