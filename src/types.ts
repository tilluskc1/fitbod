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

/**
 * (#357) One station or piece of kit on the "My gym" list (`src/data/gymItems.ts`). Machine and cable
 * exercises name the items that can host them; free weights and stations map to a family above.
 */
export type GymItemId =
  | 'leg-press'
  | 'leg-extension'
  | 'leg-curl'
  | 'hip-thrust-machine'
  | 'calf-raise-machine'
  | 'hack-squat'
  | 'smith-machine'
  | 'chest-press'
  | 'pec-deck'
  | 'shoulder-press-machine'
  | 'lat-pulldown'
  | 'seated-row'
  | 'assisted-pull-up'
  | 'cable-stack'
  | 'cable-crossover'
  | 'dumbbells'
  | 'barbell'
  | 'kettlebells'
  | 'squat-rack'
  | 'bench'
  | 'pull-up-bar'
  | 'dip-bars'
  | 'box'
  | 'ab-wheel';

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
  /**
   * (#357) Machine and cable work: the gym items that can host it, any one of them. Read only when the
   * profile saved a "My gym" list; without one, `needs` alone decides (Machine means every machine).
   */
  stations?: GymItemId[];
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
  /** Per-variant "more often" / "less often". Absent key = neutral. Optional so older data still loads. */
  preferences?: Record<string, ExercisePreference>;
  /**
   * "Pair exercises to save time" (#88). Absent means On: supersets for Intermediate and Advanced on
   * days of 45 min or less. False keeps every day in straight sets. Read when a session starts: a
   * running session keeps the pairs it stored. Optional so older data still loads.
   */
  pairExercises?: boolean;
  /**
   * (#357) "My gym": the stations and kit the lifter's gym has. Absent means today's behaviour (Machine
   * means every machine). When present, a machine or cable exercise is planned only if one of its
   * `stations` is listed. Optional so older data still loads.
   */
  gymItems?: GymItemId[];
}

export type ExercisePreference = 'more' | 'less';

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

/** Where a session ran: the saved setup ('home') or a today-only one (#188). */
export type SetupChoice = 'home' | 'hotel' | 'bodyweight' | 'bands';

export interface WorkoutExercise {
  exerciseId: string;
  name: string;
  planned: PlannedSet[];
  performed: PerformedSet[];
  /**
   * Set count this session slot originally prescribed, kept when a swap split
   * the work. Unset on untouched entries. Individual sets still hold no
   * identity — `shortcut: segments stay anonymous, one field per segment`.
   */
  originalPlannedSets?: number;
  /**
   * Pending work the user set aside for this session only. The prescription and
   * every completed set stay untouched; unskipping restores exactly the sets
   * that were pending, never a fresh default count.
   */
  skipped?: boolean;
  /**
   * The setup these sets ran on, written only for a today-only setup (#188). Absent means the
   * saved setup, so older records read as home. Per segment, because a mid-session gear switch
   * leaves done sets on one setup and pending sets on another within one exercise.
   */
  setup?: SetupChoice;
  /**
   * Superset (#88): the two entries holding the same number run back to back, set by set. Written once,
   * when the session starts; absent means straight sets, so older records read straight. A swap or skip
   * of one half clears it on both halves; nothing re-derives it after the start.
   */
  pair?: number;
}

/**
 * The user's own assessment of how a finished session fit. Deliberately three
 * fixed choices with no preselection: it is recorded context, never a training
 * signal, and it changes no prescription.
 */
export type WorkoutFeedback = 'too-much' | 'about-right' | 'too-little';

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
  /** Slot this session belongs to, and its place in the plan sequence. */
  slotId?: string;
  slotSeq?: number;
  planRevision?: number;
  status: WorkoutStatus;
  /** True when the user finished before completing every planned set. */
  completedEarly: boolean;
  endedAt: string | null;
  /**
   * Optional answer to "how did today fit?". Absent means no answer, which is a
   * valid state; nothing infers it, and older records stay valid without it.
   */
  feedback?: WorkoutFeedback;
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
  choice?: SetupChoice;
  /**
   * A day the lifter described for today (#193): the muscle groups it trains. Absent means
   * the planned day. Today-only like the rest of the override; it never moves the plan.
   */
  focus?: MuscleGroup[];
  /** Muscle groups the lifter said to leave alone today (sore). Never overlaps `focus`. */
  skip?: MuscleGroup[];
}

export interface AppState {
  profile: Profile | null;
  plan: PlanDay[];
  history: WorkoutRecord[];
  current: WorkoutRecord | null;
  todayOverride?: TodayOverride | null;
  /**
   * Which version of the plan the sequence belongs to. A plan change bumps it,
   * so a cursor written for the old plan can never point at the new one.
   */
  planRevision?: number;
  /** The slot the user is up to. Moves only on an explicit finish or skip. */
  programCursor?: { revision: number; seq: number } | null;
  /** Explicit skips, kept apart from history: a skip is not a workout. */
  slotSkips?: SlotSkip[];
  /**
   * (#225) When this browser last handed a backup file to the Share sheet or a
   * download. Absent until the first one; a restore never sets it.
   */
  lastBackupAt?: string;
  /**
   * (#307) When the Today install note was dismissed, at most two dates. Absent until the first ×;
   * a restore never sets it.
   */
  installNoteDismissals?: string[];
}

export interface SlotSkip {
  /** `skip:<revision>:<seq>`; the same skip can never be recorded twice. */
  id: string;
  revision: number;
  seq: number;
  slotId: string;
  at: string;
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
  /** (#357) A "My gym" item that would unlock the gap; added in Settings > Equipment. */
  gymItem?: GymItemId;
}

export interface Feasibility {
  status: FeasibilityStatus;
  reason: string;
  targetCount: number;
  selectedCount: number;
  coverage: CoverageResult[];
  alternatives: Alternative[];
}
