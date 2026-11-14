import { isGymKit } from '../lib/progression.ts';
import type { Equipment, GymItemId, Profile, SupportEquipment } from '../types';

/**
 * (#357) The "My gym" list: catalog data, not stored data. The order and groups are the story's.
 * A machine or cable item turns on its family (Machine / Cable) when the list is saved; a free weight
 * or station is the family or support item the app already knows. Items no catalog exercise uses yet
 * (Hack squat, Smith machine, ...) are listed and saved, and unlock nothing until the catalog has them.
 */
export type GymGroup = 'Legs machines' | 'Upper machines' | 'Cables' | 'Free weights' | 'Stations';

export interface GymItem {
  id: GymItemId;
  label: string;
  group: GymGroup;
  /** The family or support item ticking this one turns on. */
  equipment?: Exclude<Equipment, 'Bodyweight'>;
  support?: SupportEquipment;
}

export const GYM_GROUPS: GymGroup[] = ['Legs machines', 'Upper machines', 'Cables', 'Free weights', 'Stations'];

export const GYM_ITEMS: GymItem[] = [
  { id: 'leg-press', label: 'Leg press', group: 'Legs machines', equipment: 'Machine' },
  { id: 'leg-extension', label: 'Leg extension', group: 'Legs machines', equipment: 'Machine' },
  { id: 'leg-curl', label: 'Leg curl', group: 'Legs machines', equipment: 'Machine' },
  { id: 'hip-thrust-machine', label: 'Hip thrust / glute machine', group: 'Legs machines', equipment: 'Machine' },
  { id: 'calf-raise-machine', label: 'Calf raise machine', group: 'Legs machines', equipment: 'Machine' },
  { id: 'hack-squat', label: 'Hack squat', group: 'Legs machines', equipment: 'Machine' },
  { id: 'smith-machine', label: 'Smith machine', group: 'Legs machines', equipment: 'Machine' },
  { id: 'chest-press', label: 'Chest press', group: 'Upper machines', equipment: 'Machine' },
  { id: 'pec-deck', label: 'Pec deck / fly', group: 'Upper machines', equipment: 'Machine' },
  { id: 'shoulder-press-machine', label: 'Shoulder press machine', group: 'Upper machines', equipment: 'Machine' },
  { id: 'lat-pulldown', label: 'Lat pulldown', group: 'Upper machines', equipment: 'Cable' },
  { id: 'seated-row', label: 'Seated row', group: 'Upper machines', equipment: 'Cable' },
  { id: 'assisted-pull-up', label: 'Assisted pull-up', group: 'Upper machines', equipment: 'Machine' },
  { id: 'cable-stack', label: 'Cable stack (single)', group: 'Cables', equipment: 'Cable' },
  { id: 'cable-crossover', label: 'Cable crossover (dual)', group: 'Cables', equipment: 'Cable' },
  { id: 'dumbbells', label: 'Dumbbells', group: 'Free weights', equipment: 'Dumbbell' },
  { id: 'barbell', label: 'Barbell', group: 'Free weights', equipment: 'Barbell' },
  { id: 'kettlebells', label: 'Kettlebells', group: 'Free weights', equipment: 'Kettlebell' },
  { id: 'squat-rack', label: 'Squat rack', group: 'Stations', support: 'Rack' },
  { id: 'bench', label: 'Bench', group: 'Stations', support: 'Bench' },
  { id: 'pull-up-bar', label: 'Pull-up bar', group: 'Stations', support: 'Pull-up bar' },
  { id: 'dip-bars', label: 'Dip bars', group: 'Stations', support: 'Dip bars' },
  { id: 'box', label: 'Box', group: 'Stations', support: 'Box' },
  { id: 'ab-wheel', label: 'Ab wheel', group: 'Stations', support: 'Ab wheel' },
];

export const GYM_ITEM_IDS: GymItemId[] = GYM_ITEMS.map((item) => item.id);

export function gymItem(id: GymItemId): GymItem {
  return GYM_ITEMS.find((item) => item.id === id)!;
}

export function isGymItemId(value: unknown): value is GymItemId {
  return typeof value === 'string' && (GYM_ITEM_IDS as string[]).includes(value);
}

/** Ids in list order, each once. */
export function orderedItems(ids: Iterable<GymItemId>): GymItemId[] {
  const set = new Set(ids);
  return GYM_ITEM_IDS.filter((id) => set.has(id));
}

/**
 * What saving the list writes (#357): the list itself, and the families and support it implies, so the
 * chips are the truth for free weights too (no barbell ticked, no barbell work).
 */
export function gymPatch(ids: Iterable<GymItemId>): Pick<Profile, 'gymItems' | 'equipment' | 'support'> {
  const gymItems = orderedItems(ids);
  const items = gymItems.map(gymItem);
  const equipment = (['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'] as const)
    .filter((family) => items.some((item) => item.equipment === family));
  const support = (['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] as const)
    .filter((name) => items.some((item) => item.support === name));
  return { gymItems, equipment: [...equipment], support: [...support] };
}

/**
 * The ticks the sheet opens with. Machines and cables: the saved list's (none without a list). Free
 * weights and stations follow the saved families, which Settings' chips may have changed since, so a
 * first save never drops a barbell or rack the lifter already had (#357 review 1).
 */
export function initialTicks(profile: Pick<Profile, 'gymItems' | 'equipment' | 'support'>): GymItemId[] {
  return orderedItems(GYM_ITEMS.filter((item) =>
    item.equipment === 'Machine' || item.equipment === 'Cable'
      ? (profile.gymItems ?? []).includes(item.id)
      : item.equipment ? profile.equipment.includes(item.equipment) : profile.support.includes(item.support!),
  ).map((item) => item.id));
}

/**
 * (#357) The "My gym" row is for gym kits (`isGymKit`, the rule every gear label reads) or a saved list.
 * Home gear, cables included, never sees it: saving a list there would turn it into a gym and stop
 * reading its own dumbbell rack (review 2).
 */
export function showsMyGym(profile: Pick<Profile, 'gymItems' | 'equipment'>): boolean {
  return isGymKit(profile);
}
