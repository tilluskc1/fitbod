import assert from 'node:assert/strict';
import test from 'node:test';
import { AREAS, AREA_MUSCLES, musclesOf } from '../src/lib/areas.ts';
import type { Area } from '../src/lib/areas.ts';
import {
  MIN_FIGURE_PX, REGIONS, VIEWS, VIEW_W, ZONES, bodyShade, highlighted, mapSummary, talkMapMuscles, zoneAt,
} from '../src/lib/bodyMap.ts';
import { recentlyTrained } from '../src/lib/recovery.ts';
import { NO_PICKS, mapMuscles, pickPreset, pickedMuscles, recoveryLabels, togglePart } from '../src/lib/switchPick.ts';
import type { MuscleGroup, WorkoutRecord } from '../src/types.ts';

const NOW = new Date(2026, 10, 14, 12, 0); // Sat noon local
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
function record(ids: string[], endedHoursAgo: number): WorkoutRecord {
  return {
    id: `r${ids.join()}${endedHoursAgo}`, date: hoursAgo(endedHoursAgo + 1), endedAt: hoursAgo(endedHoursAgo),
    name: 'Day', dayIndex: 0, status: 'completed', completedEarly: false,
    exercises: ids.map((exerciseId) => ({
      exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 50 }],
      performed: [{ weight: 50, reps: 8, done: true, completedAt: hoursAgo(endedHoursAgo) }],
    })),
  } as unknown as WorkoutRecord;
}
/** Legs only: quads, glutes, hamstrings, calves; no hinge, so the back is not touched. */
const legsDay = (h: number) => record(['back-squat', 'leg-curl', 'standing-calf-raise'], h);

test('#302: Chest + Arms highlights chest, biceps and triceps on the front, triceps on the back, nothing else', () => {
  const picks = togglePart(togglePart(NO_PICKS, 'Chest'), 'Arms');
  const selected = pickedMuscles(picks);
  assert.deepEqual(highlighted('front', selected), ['Chest', 'Biceps', 'Triceps']);
  assert.deepEqual(highlighted('back', selected), ['Triceps']);
});

test('#302: a preset lights its own muscles: Push shows triceps, not biceps', () => {
  const selected = pickedMuscles(pickPreset(NO_PICKS, 'Push'));
  assert.deepEqual(highlighted('front', selected), ['Shoulders', 'Chest', 'Triceps']);
});

test('#302: a Legs day yesterday shades the legs darker; no history shades nothing (the legend hides; e2e)', () => {
  const shade = bodyShade([legsDay(24)], NOW);
  assert.deepEqual(Object.keys(shade).sort(), ['Calves', 'Glutes', 'Hamstrings', 'Quads']);
  assert.ok(Object.values(shade).every((tone) => tone === 'recent'));
  assert.deepEqual(bodyShade([], NOW), {});
});

test('#302: the map reads the chips\' recent-work check, over 72 h; 2 to 3 days ago is lighter', () => {
  assert.deepEqual(Object.keys(bodyShade([legsDay(60)], NOW)).sort(), ['Calves', 'Glutes', 'Hamstrings', 'Quads']);
  assert.ok(Object.values(bodyShade([legsDay(60)], NOW)).every((tone) => tone === 'earlier'));
  assert.deepEqual(bodyShade([legsDay(73)], NOW), {}, 'older than 72 h is fresh');
  // One path (lesson 9): every muscle the chips label "trained ..." is shaded on the map.
  for (const hours of [1, 12, 24, 30, 40, 47]) {
    const history = [legsDay(hours), record(['barbell-bench-press'], hours + 3)];
    const shade = bodyShade(history, NOW);
    for (const muscle of recentlyTrained(history, NOW).keys()) assert.ok(shade[muscle], `${muscle} at ${hours} h`);
    for (const area of Object.keys(recoveryLabels(history, NOW)) as Area[]) {
      assert.ok(AREA_MUSCLES[area].some((muscle) => shade[muscle]), `${area} labelled but not shaded at ${hours} h`);
    }
  }
  assert.equal(recentlyTrained([legsDay(60)], NOW).size, 0, 'everything else keeps 48 h');
});

test('#302: the screen-reader summary names the picks and the recent areas', () => {
  const selected = musclesOf(['Chest', 'Arms']);
  assert.equal(mapSummary(selected, bodyShade([legsDay(24)], NOW)), 'Selected: chest, arms. Trained recently: legs.');
  assert.equal(mapSummary([], {}), 'Nothing selected.');
});

test('#302: every zone maps to its own chip and toggles it like the chip does', () => {
  const toggled: Area[] = [];
  for (const view of VIEWS) {
    for (const zone of ZONES[view]) {
      assert.equal(zoneAt(view, zone.x + zone.w / 2, zone.y + zone.h / 2), zone.area);
      toggled.push(zone.area);
    }
  }
  assert.deepEqual([...new Set(toggled)].sort(), [...AREAS].sort(), 'every chip has a target');
  assert.equal(zoneAt('back', 50, 60), 'Back');
  assert.equal(zoneAt('front', 50, 60), 'Core');
  assert.equal(zoneAt('front', 50, 5), null, 'the head is not a target');
  // A region tap and a chip tap are the same call.
  assert.deepEqual(togglePart(NO_PICKS, zoneAt('front', 50, 30)!), togglePart(NO_PICKS, 'Chest'));
});

test('#302: every target is at least 44px at the narrowest figure, and no two overlap', () => {
  const px = MIN_FIGURE_PX / VIEW_W;
  for (const view of VIEWS) {
    for (const zone of ZONES[view]) {
      assert.ok(zone.w * px >= 44 && zone.h * px >= 44, `${view} ${zone.area} ${zone.w * px}x${zone.h * px}px`);
    }
    for (const [i, a] of ZONES[view].entries()) {
      for (const b of ZONES[view].slice(i + 1)) {
        const meets = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!meets, `${view}: ${a.area} overlaps ${b.area}`);
      }
    }
  }
});

test('#302 review 1: every drawn point of a region sits in its own area\'s target or off every target', () => {
  const areaOf = (muscle: string) => AREAS.find((area) => (AREA_MUSCLES[area] as string[]).includes(muscle))!;
  for (const view of VIEWS) {
    for (const region of REGIONS[view]) {
      // Shapes and inner lines are absolute M, C and Z paths (#366): every point they name, control points
      // included, so the whole curve sits inside.
      const numbers = [...`${region.d} ${region.lines ?? ''}`.matchAll(/-?\d+(\.\d+)?/g)].map((match) => Number(match[0]));
      const points = numbers.reduce<number[][]>((pairs, n, i) => (i % 2 ? pairs : [...pairs, [n, numbers[i + 1]]]), []);
      for (const [x, y] of points) {
        for (const px of region.mirror ? [x, VIEW_W - x] : [x]) {
          const hit = zoneAt(view, px, y);
          assert.ok(hit === null || hit === areaOf(region.muscle), `${view} ${region.muscle} at (${px}, ${y}) toggles ${hit}`);
        }
      }
    }
  }
});

test('#302 review 1: Switch lights the pressed chips; all six parts light every part, arms included', () => {
  let picks = NO_PICKS;
  for (const area of AREAS) picks = togglePart(picks, area);
  assert.deepEqual(highlighted('front', mapMuscles(picks)), ['Shoulders', 'Chest', 'Biceps', 'Triceps', 'Core', 'Quads', 'Calves']);
  assert.equal(mapSummary(mapMuscles(picks), {}), 'Selected: chest, back, shoulders, arms, legs, core.');
  assert.deepEqual(mapMuscles(pickPreset(NO_PICKS, 'Push')), pickedMuscles(pickPreset(NO_PICKS, 'Push')), 'a preset lights what it builds');
  assert.deepEqual(mapMuscles(pickPreset(NO_PICKS, 'Full body')), pickedMuscles(pickPreset(NO_PICKS, 'Full body')));
});

test('#302 review 1: Plan today\'s "My planned day" lights the planned muscles, less sore areas', () => {
  const push: MuscleGroup[] = ['Chest', 'Shoulders', 'Triceps'];
  const train: Area[] = ['Chest', 'Shoulders', 'Arms'];
  assert.deepEqual(highlighted('front', talkMapMuscles(train, true, push)), ['Shoulders', 'Chest', 'Triceps'], 'same as Switch\'s Push');
  assert.deepEqual(talkMapMuscles(['Chest', 'Arms'], true, push), ['Chest', 'Triceps'], 'sore shoulders left out');
  assert.deepEqual(talkMapMuscles(train, false, push), musclesOf(train), 'own picks light their areas');
});
