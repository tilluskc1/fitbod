import type { MuscleGroup, WorkoutRecord } from '../types.ts';
import { AREAS, areasOf, musclesOf } from './areas.ts';
import type { Area } from './areas.ts';
import { dayLabel, recentlyTrained } from './recovery.ts';

/**
 * (#302) The body map: a front and a back figure above the body-part chips. It shows the muscles of
 * the current pick and how recently each was trained; the chips stay the accessible control, and
 * only the six large areas are tap targets on the picture.
 *
 * (#366) The art is an athletic adult male in natural proportions, drawn for this app as hand-written
 * SVG paths (CREDITS.md): one silhouette per view and the anatomical muscles grouped into the
 * program's muscle groups. Muscles are left halves (viewer's left), mirrored; the silhouette is
 * mirrored into one closed outline so no seam runs down the middle. Grid: 100 x 142.8, so a figure
 * is 200px tall at its 140px minimum width and 219px at its 153px maximum.
 */
export type View = 'front' | 'back';
export const VIEWS: View[] = ['front', 'back'];
export const VIEW_W = 100;
export const VIEW_H = 142.8;
/** A figure is never drawn narrower than this, so every area target stays at least 44px. */
export const MIN_FIGURE_PX = 140;

/**
 * One closed outline from a left contour that runs from the top centre to the bottom centre
 * (`x y` then `C` segments, absolute): the right side is the same contour mirrored and reversed.
 */
function symmetric(left: string): string {
  const n = [...left.matchAll(/-?\d*\.?\d+/g)].map((match) => Number(match[0]));
  const pts: number[][] = [];
  for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  const flip = ([x, y]: number[]) => `${+(VIEW_W - x).toFixed(2)} ${y}`;
  let back = '';
  for (let i = pts.length - 1; i >= 3; i -= 3) back += `C${flip(pts[i - 1])} ${flip(pts[i - 2])} ${flip(pts[i - 3])}`;
  return `M${pts[0][0]} ${pts[0][1]}C${pts.slice(1).map(([x, y]) => `${x} ${y}`).join(' ').replace(/((?:\S+ \S+ ){2}\S+ \S+) /g, '$1C')}${back}Z`;
}

/** The left contour: head, neck, trapezius slope, arm down and up, flank, leg down and up to the crotch. */
const CONTOUR = `50 1.5
  46.6 1.5 44.3 3.8 44.2 7.6   44.2 8.3 44.3 8.9 44.4 9.5   43.6 9.4 43.2 10.4 43.5 11.6   43.7 12.6 44.2 13.2 44.8 13.3
  45.1 14.6 45.4 15.4 45.5 15.9   45.2 17.4 44.9 18.6 44.2 19.6   41.4 20.6 37.6 21.6 34.4 22.8
  30.2 23 26.4 25.4 25.6 29.8   25.1 33.6 25.6 37.4 26.6 40.2   26 43 25.6 47 25.9 50.6   26.2 52.6 26.6 54.2 26.8 55.4
  25.6 57.4 24.4 60 24.4 63   24.6 66.6 25.6 70.4 26.4 73.2
  25.6 75.6 25.3 79 26.1 82.4   26.8 84.6 28.8 85.2 29.8 84   30.8 82 31.2 78 30.9 74.6   30.8 74 30.8 73.6 30.8 73.2
  31.8 69.6 33 64.6 33.7 60.4   33.9 58.4 33.6 56.8 33.4 55.8   34 52.6 34.05 47.6 33.9 43.6   33.8 41.4 34.4 39.4 35.4 38.6
  35.6 40.6 35.4 43 35.8 46   36.6 50 38 53.4 38.4 56.4   38.5 59.2 37.9 62.4 37 65   36.3 67.4 35.9 69.8 35.6 72.4
  35 76.4 34.8 81 35 86   35 91.4 36.2 96.6 37.4 100.4
  37.6 102.2 37.2 103.6 36.6 105.6   35.8 108.4 35.6 112 36.2 115.4   37 119.6 38.8 127 39.6 133.4
  39.4 136.5 38.4 139.6 39.2 141   40.6 142.4 44.4 142.6 46.2 141.6   46.9 140.2 46.5 137.2 45.6 134.6
  45.6 129.6 46.2 124.6 46.8 120.6   47.8 116.4 48.2 111.2 47.6 106.6   47.2 104 46.8 102.4 46.9 100.6
  47.6 97.6 48.6 94.6 48.8 90.6   49.2 85 49.3 80 49.4 77.4   49.6 75.4 49.7 74.4 50 74`;

/** The plain body, the same front and back. */
export const OUTLINE: { d: string; mirror: boolean }[] = [{ d: symmetric(CONTOUR), mirror: false }];

export interface Region {
  muscle: MuscleGroup;
  /** The muscle's shapes; several subpaths for a group (abs and obliques, traps and lats). */
  d: string;
  /** Lines inside the group (the six-pack, the quad heads): drawing only, coloured with the group. */
  lines?: string;
  /** Drawn on both sides. */
  mirror: boolean;
}

const DELT = 'M34.1 23.4C30.6 23.4 26.8 25.4 26 29.8C25.5 33.4 25.9 37 27 39.8C28 40.6 29.6 40.6 30.8 40C31.8 36.6 33 33 33.8 29.6C34.1 27.4 34.1 25.4 34.1 23.4Z';

/** Each view's muscles. The front shows a strip of triceps on the outer arm; the back shows it whole. */
export const REGIONS: Record<View, Region[]> = {
  front: [
    { muscle: 'Shoulders', d: DELT, lines: 'M30.6 25.2C30.2 29 30 33 30.2 37.6', mirror: true },
    {
      muscle: 'Chest',
      d: 'M49.6 25.4C46 24.6 41 24.3 37.6 24.6C36.2 25.4 35 27.4 34.4 29.6C34.6 31.4 35 33.6 35.8 35.6C36.8 37.8 38.4 39.6 40.6 40.4C43.4 40.9 46.4 40.6 48.4 39.6C49.1 39.1 49.5 38.4 49.6 37.6Z',
      mirror: true,
    },
    {
      muscle: 'Biceps',
      d: 'M28.6 41.2C27.8 44 27.8 47.8 28.4 50.8C29 53 30.2 54.6 31.6 55C32.8 54.2 33.7 51.8 33.9 48.8C34 45.8 33.7 43 32.9 41.2C31.4 41 30 41 28.6 41.2Z',
      mirror: true,
    },
    {
      muscle: 'Triceps',
      d: 'M26.9 41.6C26.3 44.4 26.1 48 26.5 51.2C26.7 52.6 27.1 53.6 27.7 54C28.1 51.4 28.1 48 27.9 45C27.7 43.6 27.3 42.4 26.9 41.6Z',
      mirror: true,
    },
    {
      muscle: 'Core',
      d: [
        'M49.4 41.6C47.5 41.4 45.3 41.6 44.2 42.2C43.9 44 44 45.8 44.4 47.2C46 47.5 47.9 47.4 49.4 47.1Z',
        'M49.4 47.8C47.8 48 46 48.1 44.5 47.9C44.4 49.8 44.4 51.6 44.6 53.4C46.2 53.6 47.9 53.6 49.4 53.4Z',
        'M49.4 54.1C47.9 54.3 46.2 54.3 44.7 54.1C44.6 56 44.8 57.9 45.1 59.6C46.6 59.8 48.1 59.8 49.4 59.6Z',
        'M49.4 60.3C48 60.5 46.6 60.5 45.2 60.3C45.4 63.6 46.4 67 48.2 69.4C48.8 69.9 49.2 70.1 49.4 70.2Z',
        'M43.6 42.4C41 42.8 38.6 44 36.9 45.8C37.6 50 38 54.5 38 58.6C38 61.6 38.6 64 40.4 66.6C42 66.4 43.4 65 44.4 62.4C44.3 58 44 50 43.6 42.4Z',
      ].join(''),
      lines: 'M37.2 47.2C38.6 46.8 40 47.4 41.2 48.4M37.6 51C39 50.6 40.4 51.2 41.6 52.2',
      mirror: true,
    },
    {
      muscle: 'Quads',
      // Rectus femoris and vastus lateralis down to the knee, vastus medialis as the teardrop above the
      // inner knee; the adductors and sartorius above them stay plain body.
      d: 'M36.6 73.2C39 73.4 41.6 74.2 43.4 75.4C45.4 81 46.4 87 46.4 92C46.2 95.4 45 98 43.2 99C41.4 99.6 39.8 99 38.8 97.8C37.4 94.6 36.2 89.6 35.7 84.4C35.4 80.4 35.7 76.4 36.6 73.2Z'
        + 'M47.9 86C48.4 90 48 94.4 46.8 97.6C46.2 98.6 45.4 99.2 44.6 99.4C45.8 96.4 46.6 92.6 46.8 89C47.1 87.8 47.4 86.8 47.9 86Z',
      lines: 'M40.4 74.4C40.2 81 40.4 89 41.6 98.4',
      mirror: true,
    },
    {
      muscle: 'Calves',
      // The gastrocnemius heads either side of the shin.
      d: 'M47.4 104.6C48.1 107.6 48 112 47.4 115.6C46.9 118.4 46.2 120.6 45.6 121.8C44.8 118.6 44.6 114 44.9 110C45.2 107.4 46.1 105.6 47.4 104.6Z'
        + 'M37 105.6C36.2 108.6 36.1 112.4 36.6 115.6C37 117.8 37.8 119.6 38.6 120.6C39.2 117 39.4 112.4 39 108.8C38.8 107 38 105.8 37 105.6Z',
      mirror: true,
    },
  ],
  back: [
    { muscle: 'Shoulders', d: DELT, mirror: true },
    {
      muscle: 'Back',
      d: [
        // Trapezius, from the skull to the shoulder and down to the mid back.
        'M50 13.4C48.6 13.6 47.2 14.4 46.4 16C45.6 18.4 44 20.4 41.2 21.6C38.8 22.4 36.4 23 34.6 23.8C36.2 25.2 38.6 26.6 41.4 28.6C44.6 31.8 47.6 38 49.2 44.6C49.5 45.4 49.8 45.8 50 46Z',
        // Infraspinatus and teres on the shoulder blade.
        'M35 25.8C37.6 26.8 40.4 28.4 42.6 30.6C43.6 32.6 43.6 35.6 42.4 38.4C40.2 39.2 37.4 38.8 35.4 37.6C34.8 34 34.6 29.6 35 25.8Z',
        // Latissimus dorsi.
        'M35.4 38.6C37.8 39.8 40.4 39.8 42.4 39.2C44.2 39.4 45.8 39.8 47 40.2C47.8 42 48.4 44 48.6 46.4C47 48.2 46.2 51 45.9 54C45.6 57 44.4 59.4 42.6 60.6C40.4 60.8 38.8 59.4 38.2 57.4C37.6 52.6 36.6 47.6 35.8 43.6C35.6 41.8 35.4 40.2 35.4 38.6Z',
        // Lower back: the erectors beside the spine.
        'M49.4 46.2C48.2 47.4 46.8 50 46.4 53.2C46.2 56.6 46.4 60 47 62.8C47.8 63.3 48.7 63.5 49.4 63.6Z',
      ].join(''),
      mirror: true,
    },
    {
      muscle: 'Triceps',
      d: 'M27.4 41.2C26.6 44 26.4 48.2 26.9 51.6C27.5 53.8 28.8 55 30.4 55.2C31.8 55 33.1 53.8 33.5 51.2C33.9 47.6 33.7 44 32.9 41.2C31 41 29.2 41 27.4 41.2Z',
      lines: 'M28.8 47.6C29.8 49 31 49.2 32.2 47.8',
      mirror: true,
    },
    {
      muscle: 'Glutes',
      d: 'M49.4 66C47.6 64.8 44.6 64.4 41.8 65C39 65.8 37.2 67.8 36.8 70.6C36.6 73.6 37.6 76.6 39.8 78.4C42.4 79.8 46 79.6 49.3 77.8Z',
      mirror: true,
    },
    {
      muscle: 'Hamstrings',
      d: 'M37.2 79.6C38.8 80.8 41 81.2 42.6 81.2C44.6 81.2 46.4 80.6 47.8 79.8C48.2 85 47.8 91 46.6 96C45.8 98.4 44.6 99.8 43.4 100.4C42.6 98 41.8 97 40.8 97C39.8 97.2 39 98.4 38.4 100.2C37 97 36 91 35.7 85C35.7 82.6 36.2 80.6 37.2 79.6Z',
      lines: 'M42.2 81C42 87 41.8 92 41.6 97',
      mirror: true,
    },
    {
      muscle: 'Calves',
      d: 'M37.4 103.6C36.6 106.6 36.3 110.6 36.8 114.6C37.3 117.6 38.6 119.8 40.6 120.6C41.2 117 41.6 112 41.6 107.6C41.2 105.4 39.6 104 37.4 103.6Z'
        + 'M46.8 103.6C44.6 104 42.8 105.4 42.4 107.6C42.4 112 42.8 117 43.6 121C45.6 120 46.8 117.6 47.2 114.6C47.7 110.6 47.6 106.6 46.8 103.6Z',
      mirror: true,
    },
  ],
};

/** Lines on the plain body (jaw, neck, forearms, knees, shins): drawing only, never a target. Left halves, mirrored. */
export const DETAIL: Record<View, string[]> = {
  front: [
    'M44.6 12.8C45 15.2 47 17.6 50 18',
    'M45.8 16.6C46.8 18.6 48 20.4 49.2 21.6',
    'M26.8 57C27.8 60.6 28.6 64.4 29 68.4',
    'M40.4 100.2C41.6 101.6 43.2 101.6 44.4 100.6',
    'M41.2 105C41.4 112 42 120 42.6 130',
    'M44 75.2C46.2 78.4 47.6 82 48.2 86',
    'M35.6 71.4C38 72 40.6 73 42.6 74.4',
  ],
  back: [
    'M50 64.4L50 73.8',
    'M36.8 68.2C38 66 39.8 64.8 42 64.4',
    'M28.6 57C29.4 60.6 29.8 64.4 29.8 68.4',
    'M39.2 101.6C40.6 102.4 42.6 102.4 44.2 101.6',
    'M41.4 121.4C41.6 125 41.8 129 42 133',
  ],
};

export interface Zone {
  area: Area;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The centre column: as wide as the 44px minimum allows, so the shoulders and arms keep the rest. */
const MID_X = 34.2;
const MID_W = VIEW_W - 2 * MID_X;
const both = (area: Area, y: number, h: number): Zone[] => [
  { area, x: 0, y, w: MID_X, h },
  { area, x: VIEW_W - MID_X, y, w: MID_X, h },
];

/**
 * The tap targets: one block per large area, never a small muscle (#302). No block is under 31.6 grid
 * units a side, so at the 140px minimum figure width (1.4px a unit) each is at least 44.2px. The
 * centre column ends where the shoulder meets the chest (x 34.2); the chest ends at the pecs' lower
 * edge (y 41), the core at the groin (y 73), and on the back the back ends above the glutes (y 64).
 */
export const ZONES: Record<View, Zone[]> = {
  front: [
    ...both('Shoulders', 9, 32),
    { area: 'Chest', x: MID_X, y: 9, w: MID_W, h: 32 },
    ...both('Arms', 41, 47),
    { area: 'Core', x: MID_X, y: 41, w: MID_W, h: 32 },
    { area: 'Legs', x: MID_X, y: 73, w: MID_W, h: VIEW_H - 73 },
  ],
  back: [
    ...both('Shoulders', 9, 32),
    { area: 'Back', x: MID_X, y: 9, w: MID_W, h: 55 },
    ...both('Arms', 41, 47),
    { area: 'Legs', x: MID_X, y: 64, w: MID_W, h: VIEW_H - 64 },
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

/**
 * (#302 review 1) What Plan today lights: "My planned day" lights the planned day's own muscles
 * (Push: triceps, not biceps), less any area left out as sore; other picks light their areas.
 */
export function talkMapMuscles(train: Area[], planned: boolean, plannedFocus: MuscleGroup[] | undefined): MuscleGroup[] {
  if (!planned || !plannedFocus) return musclesOf(train);
  return plannedFocus.filter((muscle) => areasOf([muscle]).every((area) => train.includes(area)));
}

const names = (areas: Area[]) => areas.map((area) => area.toLowerCase()).join(', ');

/** What a screen reader hears for the picture: "Selected: chest, arms. Trained recently: legs." */
export function mapSummary(selected: MuscleGroup[], shade: Shade): string {
  const picked = areasOf(selected);
  const trained = AREAS.filter((area) => areasOf(Object.keys(shade) as MuscleGroup[]).includes(area));
  const first = picked.length ? `Selected: ${names(picked)}.` : 'Nothing selected.';
  return trained.length ? `${first} Trained recently: ${names(trained)}.` : first;
}
