import type { MuscleGroup, WorkoutRecord } from '../types.ts';
import { AREAS, areasOf } from './areas.ts';
import type { Area } from './areas.ts';
import { dayLabel, recentlyTrained } from './recovery.ts';

/**
 * (#302) The body map: a front and a back line drawing above the body-part chips. It shows the
 * muscles of the current pick and how recently each was trained; the chips stay the accessible
 * control, and only the six large areas are tap targets on the picture.
 *
 * The figure is drawn for this app (CREDITS.md): one left half per shape, mirrored, on a
 * 100 x 170 grid. Each region is one of the program's muscle groups.
 */
export type View = 'front' | 'back';
export const VIEWS: View[] = ['front', 'back'];
export const VIEW_W = 100;
export const VIEW_H = 170;
/** A figure is never drawn narrower than this, so every area target stays at least 44px. */
export const MIN_FIGURE_PX = 140;

/** An ellipse as a path, so every shape is one `d`. */
const oval = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

/** The plain body, the same front and back: head, neck and trunk whole; limbs as left halves. */
export const OUTLINE: { d: string; mirror: boolean }[] = [
  { d: oval(50, 11, 7.5, 9.5), mirror: false },
  { d: 'M46 19L46 26L54 26L54 19Z', mirror: false },
  { d: 'M40 24Q26 25 21 32L23 48Q30 50 33 60L35 82L32 95L68 95L65 82L67 60Q70 50 77 48L79 32Q74 25 60 24Z', mirror: false },
  { d: 'M22 31C15 33 13 40 14 50L15 66L25 66L27 48Z', mirror: true },
  { d: 'M15 67L13 88L21 88L25 67Z', mirror: true },
  { d: oval(17, 92.5, 4, 5), mirror: true },
  { d: 'M32 95L33 133L47 133L49.5 96Z', mirror: true },
  { d: 'M34 135L35 161L45 161L47 135Z', mirror: true },
  { d: 'M35 162L44 162L45 167L32 167Z', mirror: true },
];

export interface Region {
  muscle: MuscleGroup;
  d: string;
  /** Drawn on both sides. */
  mirror: boolean;
}

/** Each view's muscles. The front shows a strip of triceps on the outer arm; the back shows it whole. */
export const REGIONS: Record<View, Region[]> = {
  front: [
    { muscle: 'Shoulders', d: oval(20, 38, 6, 8), mirror: true },
    { muscle: 'Chest', d: 'M49 30L36 30Q29 32 28 40Q30 46 38 47Q46 47 49 44Z', mirror: true },
    { muscle: 'Biceps', d: oval(21, 56, 4, 9), mirror: true },
    { muscle: 'Triceps', d: oval(15.9, 55, 1.8, 8), mirror: true },
    { muscle: 'Core', d: 'M40 50L60 50Q62 50 62 53L60 82Q50 86 40 82L38 53Q38 50 40 50Z', mirror: false },
    { muscle: 'Quads', d: 'M33 98Q31 112 34 128Q40 132 46 129Q49 112 48 99Q40 96 33 98Z', mirror: true },
    { muscle: 'Calves', d: oval(38.5, 146, 3.4, 10), mirror: true },
  ],
  back: [
    { muscle: 'Shoulders', d: oval(20, 38, 6, 8), mirror: true },
    { muscle: 'Back', d: 'M49 27L40 27Q30 29 27 35Q30 50 35 62Q38 78 43 84L49 85Z', mirror: true },
    { muscle: 'Triceps', d: oval(20, 55, 4.5, 9.5), mirror: true },
    { muscle: 'Glutes', d: 'M49 92Q40 89 34 93Q32 101 37 106Q44 108 49 104Z', mirror: true },
    { muscle: 'Hamstrings', d: 'M34 109Q32 120 35 130Q41 133 46 130Q49 120 48 109Q41 107 34 109Z', mirror: true },
    { muscle: 'Calves', d: oval(40, 146, 5, 11), mirror: true },
  ],
};

/** Thin lines over the regions (the six-pack, the spine): drawing only, never a target. */
export const DETAIL: Record<View, string[]> = {
  front: ['M50 51L50 83', 'M39.5 61L60.5 61', 'M39.5 71L60.5 71'],
  back: ['M50 27L50 85'],
};

export interface Zone {
  area: Area;
  x: number;
  y: number;
  w: number;
  h: number;
}

const both = (area: Area, y: number, h: number): Zone[] => [
  { area, x: 0, y, w: 32, h },
  { area, x: 68, y, w: 32, h },
];

/**
 * The tap targets: one block per large area, never a small muscle (#302). No block is under 32 grid
 * units a side, so at the 140px minimum figure width (1.4px a unit) each is at least 44.8px.
 */
export const ZONES: Record<View, Zone[]> = {
  front: [
    ...both('Shoulders', 16, 32),
    { area: 'Chest', x: 32, y: 16, w: 36, h: 32 },
    ...both('Arms', 48, 42),
    { area: 'Core', x: 32, y: 48, w: 36, h: 42 },
    { area: 'Legs', x: 28, y: 90, w: 44, h: 80 },
  ],
  back: [
    ...both('Shoulders', 16, 32),
    { area: 'Back', x: 32, y: 16, w: 36, h: 74 },
    ...both('Arms', 48, 42),
    { area: 'Legs', x: 28, y: 90, w: 44, h: 80 },
  ],
};

/** The area a tap at this point of a view toggles, or null off every target. */
export function zoneAt(view: View, x: number, y: number): Area | null {
  return ZONES[view].find((zone) => x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h)?.area ?? null;
}

/** How dark a muscle reads: trained today or yesterday, or 2 to 3 days ago. Fresh muscles are absent. */
export type Shade = Partial<Record<MuscleGroup, 'recent' | 'earlier'>>;
/** The map looks back 72 h (#302), through the same check as the chips' "trained yesterday" (#296). */
export const MAP_HOURS = 72;

export function bodyShade(history: WorkoutRecord[], now: Date): Shade {
  const shade: Shade = {};
  for (const [muscle, at] of recentlyTrained(history, now, MAP_HOURS)) {
    const label = dayLabel(at, now);
    shade[muscle] = label === 'today' || label === 'yesterday' ? 'recent' : 'earlier';
  }
  return shade;
}

/** The highlighted regions of a view: the selected muscles that view draws, in drawing order. */
export function highlighted(view: View, selected: MuscleGroup[]): MuscleGroup[] {
  return REGIONS[view].map((region) => region.muscle).filter((muscle) => selected.includes(muscle));
}

const names = (areas: Area[]) => areas.map((area) => area.toLowerCase()).join(', ');

/** What a screen reader hears for the picture: "Selected: chest, arms. Trained recently: legs." */
export function mapSummary(selected: MuscleGroup[], shade: Shade): string {
  const picked = areasOf(selected);
  const trained = AREAS.filter((area) => areasOf(Object.keys(shade) as MuscleGroup[]).includes(area));
  const first = picked.length ? `Selected: ${names(picked)}.` : 'Nothing selected.';
  return trained.length ? `${first} Trained recently: ${names(trained)}.` : first;
}
