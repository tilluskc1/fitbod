import { EQUIPMENT_OPTIONS, EXERCISES, MUSCLE_GROUPS, SUPPORT_OPTIONS, exerciseById } from '../data/exercises.ts';
import media from '../data/media.json' with { type: 'json' };
import type { Capability, Equipment, Exercise, MovementPattern, MuscleGroup, Profile, SupportEquipment } from '../types.ts';
import { capabilitiesFor, provides } from './capabilities.ts';
import { programExercise } from '../data/flagship.ts';
import { canLead, isCompound, roleTarget } from './progression.ts';
import { rankedReplacements } from './replacements.ts';

/**
 * The catalog studio's data (#230): every exercise, its frames and the gaps, for curation.
 * Dev-only: read by `src/studio/`, which the production build never includes.
 */

export interface StudioKit {
  id: 'gym' | 'home' | 'dumbbells' | 'bodyweight';
  label: string;
  equipment: Equipment[];
  support: SupportEquipment[];
}

/** The kits a lifter actually has, from most to least gear. Bands run bodyweight moves: the catalog has none of its own. */
export const STUDIO_KITS: StudioKit[] = [
  { id: 'gym', label: 'Gym', equipment: [...EQUIPMENT_OPTIONS], support: [...SUPPORT_OPTIONS] },
  { id: 'home', label: 'Dumbbells + bench', equipment: ['Dumbbell'], support: ['Bench'] },
  { id: 'dumbbells', label: 'Dumbbells only', equipment: ['Dumbbell'], support: [] },
  { id: 'bodyweight', label: 'Bodyweight / bands', equipment: [], support: [] },
];

const capsOf = (kit: StudioKit): Set<Capability> => capabilitiesFor({ equipment: kit.equipment, support: kit.support } as Profile);
const GYM = { equipment: STUDIO_KITS[0].equipment, support: STUDIO_KITS[0].support, exclusions: [] } as unknown as Profile;

interface MediaEntry { frames: string[]; source?: string; video?: string }
const MEDIA = media as Record<string, MediaEntry>;

/** Each muscle group with how many exercises list it first. */
export function musclesWithCounts(): { muscle: MuscleGroup; count: number }[] {
  return MUSCLE_GROUPS.map((muscle) => ({ muscle, count: EXERCISES.filter((exercise) => exercise.muscles[0] === muscle).length }));
}

export type Role = 'Lead' | 'Compound' | 'Isolation' | 'Core';

export interface CatalogCard {
  id: string;
  name: string;
  frames: string[];
  video: string | null;
  source?: string;
  muscles: MuscleGroup[];
  equipment: Equipment;
  needs: Capability[];
  pattern: MovementPattern;
  secondaryPatterns: MovementPattern[];
  role: Role;
  /** What the app prescribes outside the lead: the program's own range or hold first (as `roleTarget`). */
  repRange: string;
  /** A Lead card's ranges in the lead slot, by lifter (#230 review): heavy muscle, strength, beginner. */
  leadRanges: { muscle: string; strength: string; beginner: string } | null;
  /** Best swaps with a full gym, as the app's swap sheet lists them (up to 6). */
  swaps: string[];
  /** The studio kits that can do it. */
  kits: StudioKit['id'][];
  instructions: string;
}

function roleOf(exercise: Exercise): Role {
  if (exercise.pattern === 'core_flexion' || exercise.pattern === 'core_stability') return 'Core';
  if (canLead(exercise)) return 'Lead';
  return isCompound(exercise) ? 'Compound' : 'Isolation';
}

export function catalogCard(id: string): CatalogCard {
  const exercise = exerciseById(id);
  if (!exercise) throw new Error(`No exercise ${id}`);
  const hold = programExercise(id)?.holdSeconds;
  const span = (lifter: Pick<Profile, 'goal' | 'experience'>, lead: boolean) => {
    const range = roleTarget(exercise, lifter, lead).range;
    return `${range.min}–${range.max}`;
  };
  const lead = roleOf(exercise) === 'Lead';
  return {
    id,
    name: exercise.name,
    frames: MEDIA[id]?.frames ?? [],
    video: MEDIA[id]?.video ?? null,
    source: MEDIA[id]?.source,
    muscles: exercise.muscles,
    equipment: exercise.equipment,
    needs: exercise.needs,
    pattern: exercise.pattern,
    secondaryPatterns: exercise.secondaryPatterns ?? [],
    role: roleOf(exercise),
    repRange: hold ? `${hold} s hold` : span({ goal: 'Build Muscle', experience: 'Intermediate' }, false),
    leadRanges: lead ? {
      muscle: span({ goal: 'Build Muscle', experience: 'Intermediate' }, true),
      strength: span({ goal: 'Get Stronger', experience: 'Intermediate' }, true),
      beginner: span({ goal: 'Build Muscle', experience: 'Beginner' }, true),
    } : null,
    swaps: rankedReplacements(exercise, GYM, [], 6).map((swap) => swap.name),
    kits: STUDIO_KITS.filter((kit) => provides(capsOf(kit), exercise.needs)).map((kit) => kit.id),
    instructions: exercise.instructions,
  };
}

export interface Coverage {
  rows: string[];
  kits: StudioKit['id'][];
  /** Exercise names a kit can do for a row, in catalog order; empty is a gap. */
  cell: (row: string, kit: StudioKit['id']) => string[];
}

/** What each kit can train, by primary muscle or by primary movement pattern. */
export function coverage(by: 'muscle' | 'pattern'): Coverage {
  const key = (exercise: Exercise): string => (by === 'muscle' ? exercise.muscles[0] : exercise.pattern);
  const rows = by === 'muscle' ? [...MUSCLE_GROUPS] : [...new Set(EXERCISES.map(key))];
  const caps = new Map(STUDIO_KITS.map((kit) => [kit.id, capsOf(kit)]));
  return {
    rows,
    kits: STUDIO_KITS.map((kit) => kit.id),
    cell: (row, kit) => EXERCISES.filter((exercise) => key(exercise) === row && provides(caps.get(kit)!, exercise.needs))
      .map((exercise) => exercise.name),
  };
}

export interface CatalogFlag {
  kind: 'no-media' | 'no-exercise' | 'broken-frame' | 'no-swap';
  exerciseId: string;
  detail: string;
}

/**
 * What needs curating: an exercise without frames, a media entry without an exercise, a frame
 * file that does not exist (when `exists` can check), an exercise no full gym could swap.
 */
export function catalogFlags(
  { exists, media: entries = MEDIA }: { exists?: (path: string) => boolean; media?: Record<string, MediaEntry> } = {},
): CatalogFlag[] {
  const flags: CatalogFlag[] = [];
  for (const exercise of EXERCISES) {
    const frames = entries[exercise.id]?.frames ?? [];
    if (frames.length === 0) flags.push({ kind: 'no-media', exerciseId: exercise.id, detail: `${exercise.name} has no frames` });
    for (const frame of frames) {
      if (exists && !exists(frame)) flags.push({ kind: 'broken-frame', exerciseId: exercise.id, detail: `${frame} is missing` });
    }
    if (rankedReplacements(exercise, GYM).length === 0) {
      flags.push({ kind: 'no-swap', exerciseId: exercise.id, detail: `${exercise.name} has no swap even with a full gym` });
    }
  }
  for (const id of Object.keys(entries)) {
    if (!exerciseById(id)) flags.push({ kind: 'no-exercise', exerciseId: id, detail: `media for "${id}", which is not in the catalog` });
  }
  return flags;
}
