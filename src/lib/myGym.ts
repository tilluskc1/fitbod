import { gymItem, orderedItems } from '../data/gymItems.ts';
import type { GymItemId, Profile } from '../types';

/** (#357) Chips the lifter tapped: true on, false off. A tap wins over the text, whatever it says later. */
export type GymTaps = Partial<Record<GymItemId, boolean>>;

/** The ticks the sheet shows: what it opened with and what the text reads, then every tap on top. */
export function gymTicks(start: GymItemId[], read: GymItemId[], taps: GymTaps): GymItemId[] {
  const on = new Set([...start, ...read]);
  for (const [id, value] of Object.entries(taps) as [GymItemId, boolean][]) {
    if (value) on.add(id);
    else on.delete(id);
  }
  return orderedItems(on);
}

/** Settings' "My gym" line: what the planner reads now. */
export function gymSummary(profile: Pick<Profile, 'gymItems'>): string {
  const items = profile.gymItems;
  if (!items) return 'Not set: every machine counts. List what your gym has so plans use only that.';
  if (items.length === 0) return 'Nothing listed: no machines or cables are planned.';
  const names = items.map((id) => gymItem(id).label);
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${names.length} items: ${shown} and ${names.length - 3} more.` : `${names.length} ${names.length === 1 ? 'item' : 'items'}: ${shown}.`;
}
