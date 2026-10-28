export type MuscleGroup =
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Quads'
  | 'Hamstrings'
  | 'Glutes'
  | 'Calves'
  | 'Core';

/** Primary equipment. Bodyweight work has no primary-equipment requirement. */
export type Equipment =
  | 'Barbell'
  | 'Dumbbell'
  | 'Machine'
  | 'Cable'
  | 'Kettlebell'
  | 'Bodyweight';

/**
 * Support equipment that changes which exercises are actually possible.
 * These are deliberately separate from `Equipment`: owning dumbbells does not
 * imply owning a bench, and assuming it did is what made the old planner offer
 * bench presses to people without one.
 */
export type SupportEquipment =
  | 'Bench'
  | 'Rack'
  | 'Pull-up bar'
  | 'Dip bars'
  | 'Box'
  | 'Ab wheel';

/**
 * Normalised capability tags. An exercise declares every capability it needs;
 * a profile resolves to the capabilities it can actually provide.
 */
export type Capability =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'kettlebell'
  | 'bench'
  | 'rack'
  | 'pull-up-bar'
  | 'dip-bars'
  | 'box'
  | 'ab-wheel';

/**
 * Primary movement pattern. Used for session coverage: a workout is not
 * "complete" just because it has enough exercises, it has to cover the
 * movement families the day is supposed to train.
 */
export type MovementPattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'lunge'
  | 'hinge'
  | 'hip_extension'
  | 'knee_extension'
  | 'knee_flexion'
  | 'calf_raise'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'shoulder_abduction'
  | 'shoulder_horizontal_abduction'
  | 'core_flexion'
  | 'core_stability';

export interface CoverageRequirement {
  id: string;
  label: string;
  anyOf: MovementPattern[];
}

export interface Exercise {
  id: string;
  name: string;
  muscles: MuscleGroup[];
  equipment: Equipment;
  /** Primary movement pattern. */
  pattern: MovementPattern;
  /** Additional patterns the movement meaningfully trains. */
  secondaryPatterns?: MovementPattern[];
  /** Every capability required to perform the exercise. */
  needs: Capability[];
  instructions: string;
}

export type Goal = 'Build Muscle' | 'Lose Fat' | 'Get Stronger' | 'General Fitness';
export type Experience = 'Beginner' | 'Intermediate' | 'Advanced';

export type Unit = 'kg' | 'lb';

export interface Profile {
  goal: Goal;
  experience: Experience;
  daysPerWeek: number;
  /** Primary equipment the user has. Bodyweight is always available. */
  equipment: Equipment[];
  /** Support equipment the user has. Never inferred from `equipment`. */
  support: SupportEquipment[];
  /** Exercise ids the user explicitly does not want to be programmed. */
  exclusions: string[];
  /**
   * Optional per-equipment load inventory. Stored and validated now so a
   * future progression policy has real data; Phase 1 prescribes no load, so
   * it does not gate exercise selection.
   */
  loads: Partial<Record<Equipment, number[]>>;
  /** Display name used in the greeting. Optional so older data still loads. */
  name?: string;
  /** Display unit. Records are always stored in kilograms. */
  unit?: Unit;
  /** Usual session length in minutes, used by the plan preview. */
  sessionMinutes?: number;
}

/** The prescription. Never mutated by logging. */
export interface PlannedSet {
  weight: number;
  reps: number;
}

/** What the user actually did. */
export interface PerformedSet {
  weight: number;
  reps: number;
  done: boolean;
  completedAt: string | null;
}

export interface WorkoutExercise {
  exerciseId: string;
  name: string;
  planned: PlannedSet[];
  performed: PerformedSet[];
}

export type WorkoutStatus = 'active' | 'completed';

export interface WorkoutRecord {
  id: string;
  /** Start time, ISO-8601. */
  date: string;
  /** Estimated length shown in the preview and recap. */
  durationMin?: number;
  /** Total paused time in milliseconds, accumulated across pauses. */
  pausedMs?: number;
  /** When the current pause began, or null while running. */
  pausedAt?: string | null;
  /** Timestamp the rest countdown started from, or null when idle. */
  restStartedAt?: string | null;
  /** Rest length in seconds for the running countdown. */
  restSeconds?: number;
  /** When the current rest pause began, or null while the rest clock runs. */
  restPausedAt?: string | null;
  /** Total paused rest time in milliseconds. */
  restPausedMs?: number;
  name: string;
  dayIndex: number;
  status: WorkoutStatus;
  /** True when the user finished before completing every planned set. */
  completedEarly: boolean;
  endedAt: string | null;
  exercises: WorkoutExercise[];
}

export interface PlanDay {
  name: string;
  focus: MuscleGroup[];
}

/**
 * A one-day change to time or equipment. Scoped by date so it can never drift
 * into the following session, and never mutates the saved profile or plan.
 */
export interface TodayOverride {
  date: string;
  minutes: number;
  equipment: Equipment[];
  support: SupportEquipment[];
  appliedAt: string;
  /**
   * The named setup behind the override. Stored beside the legacy equipment
   * array so hotel/bodyweight/bands survive a reload, not just "has dumbbells".
   */
  choice?: 'home' | 'hotel' | 'bodyweight' | 'bands';
}

export interface AppState {
  profile: Profile | null;
  plan: PlanDay[];
  history: WorkoutRecord[];
  current: WorkoutRecord | null;
  todayOverride?: TodayOverride | null;
}

export type FeasibilityStatus = 'ok' | 'limited' | 'infeasible';

export interface CoverageResult {
  id: string;
  label: string;
  satisfied: boolean;
  exerciseIds: string[];
}

/**
 * An explicit constraint change the user can choose. The app never applies
 * these automatically: unavailable equipment and exclusions are not relaxed
 * to make a session look complete.
 */
export interface Alternative {
  kind: 'capability' | 'allow-exercise';
  label: string;
  detail: string;
  capability?: Capability;
  equipment?: Equipment;
  support?: SupportEquipment;
  exerciseId?: string;
}

export interface Feasibility {
  status: FeasibilityStatus;
  reason: string;
  targetCount: number;
  selectedCount: number;
  coverage: CoverageResult[];
  alternatives: Alternative[];
}
