import type {
  AppState,
  Equipment,
  Experience,
  Goal,
  MuscleGroup,
  PerformedSet,
  PlanDay,
  PlannedSet,
  Profile,
  SupportEquipment,
  WorkoutExercise,
  TodayOverride,
  WorkoutRecord,
} from '../types.ts';

const GOALS: Goal[] = ['Build Muscle', 'Lose Fat', 'Get Stronger', 'General Fitness'];
const EXPERIENCES: Experience[] = ['Beginner', 'Intermediate', 'Advanced'];
const EQUIPMENT: Equipment[] = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell', 'Bodyweight'];
const SUPPORT: SupportEquipment[] = ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'];
const MUSCLES: MuscleGroup[] = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
];

const MAX_HISTORY = 2000;
const MAX_EXERCISES = 40;
const MAX_SETS = 30;
const MAX_EXCLUSIONS = 200;
const MAX_LOAD_ENTRIES = 200;
const MAX_WEIGHT = 2000;
const MAX_REPS = 1000;

class Invalid extends Error {}

function fail(path: string, message: string): never {
  throw new Invalid(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  return value;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length > max) fail(path, `has more than ${max} entries`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected text');
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const text = string(value, path);
  if (text.trim().length === 0) fail(path, 'must not be empty');
  return text;
}

function finiteNumber(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
  if (value < 0 || value > max) fail(path, `must be between 0 and ${max}`);
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'expected a whole number');
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected true or false');
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  const text = string(value, path);
  if (!options.includes(text as T)) fail(path, `must be one of ${options.join(', ')}`);
  return text as T;
}

function isoDate(value: unknown, path: string): string {
  const text = string(value, path);
  if (Number.isNaN(Date.parse(text))) fail(path, 'expected an ISO-8601 date');
  return text;
}

function isoDateOrNull(value: unknown, path: string): string | null {
  return value === null ? null : isoDate(value, path);
}

function uniqueStrings(value: unknown, path: string, max: number): string[] {
  const items = array(value, path, max);
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = nonEmptyString(items[i], `${path}[${i}]`);
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function validateProfile(value: unknown, path: string): Profile {
  const raw = record(value, path);
  const daysPerWeek = integer(raw.daysPerWeek, `${path}.daysPerWeek`, 2, 6);
  const equipmentRaw = array(raw.equipment, `${path}.equipment`, EQUIPMENT.length);
  const equipment: Equipment[] = [];
  for (let i = 0; i < equipmentRaw.length; i += 1) {
    const item = oneOf(equipmentRaw[i], `${path}.equipment[${i}]`, EQUIPMENT);
    if (item !== 'Bodyweight' && !equipment.includes(item)) equipment.push(item);
  }
  const supportRaw = raw.support === undefined ? [] : array(raw.support, `${path}.support`, SUPPORT.length);
  const support: SupportEquipment[] = [];
  for (let i = 0; i < supportRaw.length; i += 1) {
    const item = oneOf(supportRaw[i], `${path}.support[${i}]`, SUPPORT);
    if (!support.includes(item)) support.push(item);
  }

  const loads: Partial<Record<Equipment, number[]>> = {};
  if (raw.loads !== undefined) {
    const loadsRaw = record(raw.loads, `${path}.loads`);
    for (const key of Object.keys(loadsRaw)) {
      if (!EQUIPMENT.includes(key as Equipment)) fail(`${path}.loads.${key}`, 'unknown equipment');
      const values = array(loadsRaw[key], `${path}.loads.${key}`, MAX_LOAD_ENTRIES);
      const numbers = values.map((item, i) =>
        finiteNumber(item, `${path}.loads.${key}[${i}]`, MAX_WEIGHT),
      );
      loads[key as Equipment] = [...new Set(numbers)].sort((a, b) => a - b);
    }
  }

  const exclusions = raw.exclusions === undefined ? [] : uniqueStrings(raw.exclusions, `${path}.exclusions`, MAX_EXCLUSIONS);

  return {
    goal: oneOf(raw.goal, `${path}.goal`, GOALS),
    experience: oneOf(raw.experience, `${path}.experience`, EXPERIENCES),
    daysPerWeek,
    equipment,
    support,
    exclusions,
    loads,
    name: raw.name === undefined ? undefined : string(raw.name, `${path}.name`).slice(0, 40),
    unit: raw.unit === undefined ? undefined : oneOf(raw.unit, `${path}.unit`, ['kg', 'lb'] as const),
    sessionMinutes:
      raw.sessionMinutes === undefined
        ? undefined
        : integer(raw.sessionMinutes, `${path}.sessionMinutes`, 10, 120),
  };
}

function validatePlannedSet(value: unknown, path: string): PlannedSet {
  const raw = record(value, path);
  return {
    weight: finiteNumber(raw.weight, `${path}.weight`, MAX_WEIGHT),
    reps: finiteNumber(raw.reps, `${path}.reps`, MAX_REPS),
  };
}

function validatePerformedSet(value: unknown, path: string): PerformedSet {
  const raw = record(value, path);
  return {
    weight: finiteNumber(raw.weight, `${path}.weight`, MAX_WEIGHT),
    reps: finiteNumber(raw.reps, `${path}.reps`, MAX_REPS),
    done: boolean(raw.done, `${path}.done`),
    completedAt: isoDateOrNull(raw.completedAt ?? null, `${path}.completedAt`),
  };
}

function validateExercise(value: unknown, path: string): WorkoutExercise {
  const raw = record(value, path);
  const plannedRaw = array(raw.planned, `${path}.planned`, MAX_SETS);
  const performedRaw = array(raw.performed, `${path}.performed`, MAX_SETS);
  if (plannedRaw.length !== performedRaw.length) {
    fail(path, 'planned and performed sets must have the same length');
  }
  return {
    exerciseId: nonEmptyString(raw.exerciseId, `${path}.exerciseId`),
    name: nonEmptyString(raw.name, `${path}.name`),
    planned: plannedRaw.map((item, i) => validatePlannedSet(item, `${path}.planned[${i}]`)),
    performed: performedRaw.map((item, i) => validatePerformedSet(item, `${path}.performed[${i}]`)),
  };
}

function validateWorkout(value: unknown, path: string): WorkoutRecord {
  const raw = record(value, path);
  const status = oneOf(raw.status, `${path}.status`, ['active', 'completed'] as const);
  return {
    id: nonEmptyString(raw.id, `${path}.id`),
    date: isoDate(raw.date, `${path}.date`),
    name: nonEmptyString(raw.name, `${path}.name`),
    dayIndex: integer(raw.dayIndex ?? 0, `${path}.dayIndex`, 0, 20),
    status,
    completedEarly: boolean(raw.completedEarly ?? false, `${path}.completedEarly`),
    endedAt: isoDateOrNull(raw.endedAt ?? null, `${path}.endedAt`),
    durationMin:
      raw.durationMin === undefined
        ? undefined
        : integer(raw.durationMin, `${path}.durationMin`, 0, 600),
    pausedMs:
      raw.pausedMs === undefined ? undefined : finiteNumber(raw.pausedMs, `${path}.pausedMs`, 86_400_000),
    pausedAt: raw.pausedAt === undefined ? undefined : isoDateOrNull(raw.pausedAt, `${path}.pausedAt`),
    restStartedAt:
      raw.restStartedAt === undefined
        ? undefined
        : isoDateOrNull(raw.restStartedAt, `${path}.restStartedAt`),
    restSeconds:
      raw.restSeconds === undefined
        ? undefined
        : integer(raw.restSeconds, `${path}.restSeconds`, 0, 900),
    restPausedAt:
      raw.restPausedAt === undefined
        ? undefined
        : isoDateOrNull(raw.restPausedAt, `${path}.restPausedAt`),
    restPausedMs:
      raw.restPausedMs === undefined
        ? undefined
        : finiteNumber(raw.restPausedMs, `${path}.restPausedMs`, 86_400_000),
    exercises: array(raw.exercises, `${path}.exercises`, MAX_EXERCISES).map((item, i) =>
      validateExercise(item, `${path}.exercises[${i}]`),
    ),
  };
}

function validateOverride(value: unknown, path: string): TodayOverride {
  const raw = record(value, path);
  const equipmentRaw = array(raw.equipment, `${path}.equipment`, EQUIPMENT.length);
  const equipment: Equipment[] = [];
  for (let i = 0; i < equipmentRaw.length; i += 1) {
    const item = oneOf(equipmentRaw[i], `${path}.equipment[${i}]`, EQUIPMENT);
    if (item !== 'Bodyweight' && !equipment.includes(item)) equipment.push(item);
  }
  const supportRaw = raw.support === undefined ? [] : array(raw.support, `${path}.support`, SUPPORT.length);
  const support: SupportEquipment[] = [];
  for (let i = 0; i < supportRaw.length; i += 1) {
    const item = oneOf(supportRaw[i], `${path}.support[${i}]`, SUPPORT);
    if (!support.includes(item)) support.push(item);
  }
  return {
    date: string(raw.date, `${path}.date`),
    minutes: integer(raw.minutes, `${path}.minutes`, 10, 120),
    equipment,
    support,
    appliedAt: isoDate(raw.appliedAt, `${path}.appliedAt`),
    choice:
      raw.choice === undefined
        ? undefined
        : oneOf(raw.choice, `${path}.choice`, ['home', 'hotel', 'bodyweight', 'bands'] as const),
  };
}

function validatePlan(value: unknown, path: string): PlanDay[] {
  return array(value, path, 7).map((item, i) => {
    const raw = record(item, `${path}[${i}]`);
    const focusRaw = array(raw.focus, `${path}[${i}].focus`, MUSCLES.length);
    const focus: MuscleGroup[] = [];
    for (let j = 0; j < focusRaw.length; j += 1) {
      const muscle = oneOf(focusRaw[j], `${path}[${i}].focus[${j}]`, MUSCLES);
      if (!focus.includes(muscle)) focus.push(muscle);
    }
    if (focus.length === 0) fail(`${path}[${i}].focus`, 'must include at least one muscle group');
    return { name: nonEmptyString(raw.name, `${path}[${i}].name`), focus };
  });
}

function looksLegacy(value: unknown): boolean {
  const raw = record(value, 'state');
  const profile = raw.profile;
  if (isRecord(profile) && !('support' in profile)) return true;
  if (isRecord(raw.current) && 'workout' in raw.current) return true;
  const first = Array.isArray(raw.history) ? raw.history[0] : null;
  if (isRecord(first) && Array.isArray(first.exercises)) {
    const exercise = first.exercises[0];
    if (isRecord(exercise) && 'sets' in exercise) return true;
  }
  return false;
}

function legacySets(value: unknown, date: string, path: string): { planned: PlannedSet[]; performed: PerformedSet[] } {
  const raw = record(value, path);
  const sets = array(raw.sets ?? [], `${path}.sets`, MAX_SETS);
  const planned: PlannedSet[] = [];
  const performed: PerformedSet[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    const set = record(sets[i], `${path}.sets[${i}]`);
    const weight = finiteNumber(set.weight ?? 0, `${path}.sets[${i}].weight`, MAX_WEIGHT);
    const reps = finiteNumber(set.reps ?? 0, `${path}.sets[${i}].reps`, MAX_REPS);
    const done = set.done === true;
    planned.push({ weight, reps });
    performed.push({ weight, reps, done, completedAt: done ? date : null });
  }
  return { planned, performed };
}

function migrateLegacyWorkout(
  value: unknown,
  options: { status: 'active' | 'completed'; dayIndex: number },
  path: string,
): WorkoutRecord {
  const raw = record(value, path);
  const date = isoDate(raw.date, `${path}.date`);
  const exercises = array(raw.exercises, `${path}.exercises`, MAX_EXERCISES).map((item, i) => {
    const exercise = record(item, `${path}.exercises[${i}]`);
    const sets = legacySets(exercise, date, `${path}.exercises[${i}]`);
    return {
      exerciseId: nonEmptyString(exercise.exerciseId, `${path}.exercises[${i}].exerciseId`),
      name: nonEmptyString(exercise.name, `${path}.exercises[${i}].name`),
      planned: sets.planned,
      performed: sets.performed,
    };
  });
  const allDone = exercises.every((exercise) => exercise.performed.every((set) => set.done));
  return {
    id: nonEmptyString(raw.id, `${path}.id`),
    date,
    name: nonEmptyString(raw.name, `${path}.name`),
    dayIndex: options.dayIndex,
    status: options.status,
    completedEarly: options.status === 'completed' ? !allDone : false,
    endedAt: options.status === 'completed' ? date : null,
    exercises,
  };
}

/** Convert the pre-v2 blob into the current model without touching history ids/dates. */
export function migrateLegacyState(value: unknown): AppState {
  const raw = record(value, 'state');
  const profile = raw.profile === null ? null : validateProfile({ support: [], exclusions: [], loads: {}, ...record(raw.profile, 'state.profile') }, 'state.profile');
  const plan = validatePlan(raw.plan ?? [], 'state.plan');
  const history = array(raw.history ?? [], 'state.history', MAX_HISTORY).map((item, i) =>
    migrateLegacyWorkout(item, { status: 'completed', dayIndex: 0 }, `state.history[${i}]`),
  );

  let current: WorkoutRecord | null = null;
  if (raw.current !== null && raw.current !== undefined) {
    const currentRaw = record(raw.current, 'state.current');
    const workout = 'workout' in currentRaw ? currentRaw.workout : currentRaw;
    const dayIndex = integer(currentRaw.dayIndex ?? 0, 'state.current.dayIndex', 0, 20);
    current = migrateLegacyWorkout(workout, { status: 'active', dayIndex }, 'state.current');
  }

  return { profile, plan, history, current };
}

/**
 * Validate untrusted state (stored data or an imported file). Legacy v1 data
 * is migrated, anything incompatible is rejected with a path-specific error.
 */
export function validateState(value: unknown): { ok: true; state: AppState; migrated: boolean } | { ok: false; error: string } {
  try {
    const migrated = looksLegacy(value);
    const state = normaliseState(migrated ? migrateLegacyState(value) : value);
    return { ok: true, state, migrated };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Invalid ? error.message : 'The saved data could not be validated.',
    };
  }
}

function normaliseState(value: unknown): AppState {
  const raw = record(value, 'state');
  const profile = raw.profile === null ? null : validateProfile(raw.profile, 'state.profile');
  const plan = validatePlan(raw.plan, 'state.plan');
  const history = array(raw.history, 'state.history', MAX_HISTORY).map((item, i) => {
    const workout = validateWorkout(item, `state.history[${i}]`);
    if (workout.status !== 'completed') fail(`state.history[${i}].status`, 'history can only contain completed workouts');
    return workout;
  });
  const current = raw.current === null || raw.current === undefined ? null : validateWorkout(raw.current, 'state.current');
  if (current && current.status !== 'active') fail('state.current.status', 'an active session must be active');
  const todayOverride =
    raw.todayOverride === null || raw.todayOverride === undefined
      ? null
      : validateOverride(raw.todayOverride, 'state.todayOverride');

  const ids = new Set<string>();
  for (const workout of [...history, ...(current ? [current] : [])]) {
    if (ids.has(workout.id)) fail('state', `duplicate workout id "${workout.id}"`);
    ids.add(workout.id);
  }

  return { profile, plan, history, current, todayOverride };
}

/** Parse a JSON string into validated state. Used by restore. */
export function parseState(text: string): { ok: true; state: AppState; migrated: boolean } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON. Nothing was changed.' };
  }
  if (isRecord(parsed) && 'state' in parsed) {
    return validateState(parsed.state);
  }
  return validateState(parsed);
}
