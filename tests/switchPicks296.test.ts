import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { Constraints } from '../src/lib/adapt.ts';
import { AREAS, customDayName } from '../src/lib/areas.ts';
import type { Area } from '../src/lib/areas.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted } from '../src/lib/liveProgression.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import {
  NO_PICKS, PRESETS, PRESET_MUSCLES, consequenceLine, pickConstraints, pickLabel, pickPreset, pickPreview, pickedMuscles, recoveryLabels, togglePart,
} from '../src/lib/switchPick.ts';
import type { Picks } from '../src/lib/switchPick.ts';
import { NO_TAPS, baseTalk, composeTalk, talkConstraints, tapTrain } from '../src/lib/todayTalk.ts';
import { todayOnly } from '../src/lib/todayOnly.ts';
import { dayKey } from '../src/lib/plan.ts';
import { EMPTY_STATE } from '../src/lib/storage.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

/* #296: Switch workout's "Or train something else". */

const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 45,
};
const home: Profile = { ...gym, equipment: ['Dumbbell'], support: ['Bench'] };
const bodyweight: Profile = { ...gym, equipment: [], support: [] };
const KITS = { gym, home, bodyweight };

const slotOf = (profile: Profile, days = profile.daysPerWeek, name?: string) => {
  const slots = planSlots(buildPlan({ ...profile, daysPerWeek: days }));
  return name ? slots.find((slot) => slot.name === name)! : slots[0];
};
/** The day the app builds for constraints: `programFor` → `adaptFor` → live loads (App.tsx). */
function build(profile: Profile, next: Constraints, days = profile.daysPerWeek, name?: string) {
  const slot = slotOf(profile, days, name);
  const program = todayProgram(profile, slot, [], next);
  const live = liveAdapted(adaptWorkout(program, next, profile.exclusions, profile.goal, profile), profile, []);
  return { program, live };
}
function picked(profile: Profile, picks: Picks, today: Constraints = defaultConstraints(profile), days = profile.daysPerWeek, name?: string) {
  const slot = slotOf(profile, days, name);
  const next = pickConstraints(picks, today, slot.focus, profile.sessionMinutes ?? 35);
  const { program, live } = build(profile, next, days, name);
  return { next, live, preview: pickPreview(picks, next, program, live, profile) };
}
const parts = (...areas: Area[]) => areas.reduce((picks, area) => togglePart(picks, area), NO_PICKS);
const ALL_PICKS: [string, Picks][] = [
  ...PRESETS.map((preset): [string, Picks] => [preset, pickPreset(NO_PICKS, preset)]),
  ...AREAS.map((area): [string, Picks] => [area, parts(area)]),
];

test('#296 a preset fills its parts, editing a part clears the preset, every part is Full body', () => {
  assert.deepEqual(pickPreset(NO_PICKS, 'Push'), { preset: 'Push', parts: ['Chest', 'Shoulders', 'Arms'] });
  assert.deepEqual(pickPreset(pickPreset(NO_PICKS, 'Push'), 'Push'), NO_PICKS, 'tapping the preset again clears it');
  const edited = togglePart(pickPreset(NO_PICKS, 'Push'), 'Arms');
  assert.deepEqual(edited, { preset: null, parts: ['Chest', 'Shoulders'] });
  assert.equal(pickLabel(parts('Shoulders', 'Arms')), 'Shoulders + Arms');
  assert.equal(pickLabel(parts('Core')), 'Abs', 'the Core area reads Abs');
  const all = parts(...AREAS);
  assert.equal(all.preset, null);
  assert.equal(pickLabel(all), 'Full body');
  assert.deepEqual(pickedMuscles(all), PRESET_MUSCLES['Full body']);
  assert.deepEqual(pickedMuscles(NO_PICKS), [], 'nothing picked builds nothing (Build is disabled)');
});

test('#296 every preset and single part trains only its own muscles, on gym, home and bodyweight', () => {
  for (const [kit, profile] of Object.entries(KITS)) {
    for (const [name, picks] of ALL_PICKS) {
      const { live, preview } = picked(profile, picks, defaultConstraints(profile), 4, 'Lower A');
      const allowed = pickedMuscles(picks);
      for (const exercise of live.exercises) {
        const primary = exerciseById(exercise.exerciseId)!.muscles[0];
        assert.ok(allowed.includes(primary), `${kit} ${name}: ${exercise.exerciseId} trains ${primary}`);
      }
      assert.ok(preview.status !== 'limited' || preview.reasons.length > 0, `${kit} ${name}: Limited names its reason`);
    }
  }
});

test('#296 a preset is judged on its own muscles: Push never reads Limited for biceps (#219)', () => {
  const reasons = (preset: 'Push' | 'Pull' | 'Full body') => picked(gym, pickPreset(NO_PICKS, preset), { ...defaultConstraints(gym), minutes: 30 }).preview.reasons.map((line) => line.text).join(' ');
  assert.doesNotMatch(reasons('Push'), /biceps/);
  assert.doesNotMatch(reasons('Pull'), /triceps/);
  assert.doesNotMatch(reasons('Full body'), /glute|calf|biceps|triceps/);
});

test('#296 one path: the same parts in Switch and in Plan today with me build the identical day', () => {
  for (const profile of Object.values(KITS)) {
    for (const days of [3, 4, 5]) {
      const slot = slotOf(profile, days);
      const today = defaultConstraints(profile);
      const base = baseTalk(today, slot.focus, profile === gym);
      for (const areas of [['Shoulders', 'Arms'], ['Chest'], ['Back', 'Legs'], ['Legs', 'Core'], ['Chest', 'Back', 'Shoulders', 'Arms']] as Area[][]) {
        // Plan today with me: clear the planned areas, then tap these on.
        let taps = NO_TAPS;
        for (const area of AREAS) {
          const want = areas.includes(area);
          const talk = composeTalk(base, '', taps);
          if (talk.train.includes(area) !== want) taps = tapTrain(talk, taps, area);
        }
        const fromTalk = talkConstraints(composeTalk(base, '', taps), undefined, slot.focus);
        const fromSwitch = pickConstraints(parts(...areas), today, slot.focus, profile.sessionMinutes ?? 35);
        assert.deepEqual(fromSwitch, fromTalk, areas.join('+'));
        const a = build(profile, fromTalk, days).live;
        const b = build(profile, fromSwitch, days).live;
        assert.deepEqual(b.exercises.map((e) => [e.exerciseId, e.sets]), a.exercises.map((e) => [e.exerciseId, e.sets]));
        assert.equal(b.totalSets, a.totalSets);
        assert.equal(b.minutes, a.minutes);
      }
    }
  }
});

test('#296 a Pull pick on a Push day is a described Pull day; the plan cursor is not part of it', () => {
  const { next, preview } = picked(gym, pickPreset(NO_PICKS, 'Pull'), defaultConstraints(gym), 3, 'Push');
  assert.deepEqual(next.focus, ['Back', 'Biceps']);
  assert.equal(customDayName(next.focus!), 'Pull', 'Today names it Pull, not "Back + Arms"');
  assert.equal(preview.status, 'ready');
  assert.match(consequenceLine(preview), /^Pull · \d+ exercises · \d+ sets · ≈?\d+ min$/);
  // Picks equal to the planned day are the planned day, as in Plan today with me.
  assert.equal(pickConstraints(pickPreset(NO_PICKS, 'Push'), defaultConstraints(gym), slotOf(gym, 3, 'Push').focus, 45).focus, undefined);
  // One day, one name: Upper and Lower read so on Today too, whichever screen built them (review 1).
  assert.equal(customDayName(PRESET_MUSCLES.Upper), 'Upper');
  assert.equal(customDayName(PRESET_MUSCLES.Lower), 'Lower');
  assert.equal(customDayName(['Shoulders', 'Biceps', 'Triceps']), 'Shoulders + Arms');
});

test('#296 bodyweight and Back: Not enough equipment with its gear reason, never padded', () => {
  const { live, preview } = picked(bodyweight, parts('Back'));
  assert.equal(live.exercises.length, 0);
  assert.equal(preview.status, 'none');
  assert.ok(preview.gearGap, 'the sheet offers the gear fix');
  assert.ok(preview.reasons.some((line) => line.label === 'Not possible here:' && /back/.test(line.text)), JSON.stringify(preview.reasons));
  const arms = picked(bodyweight, parts('Arms')).preview;
  assert.equal(arms.status, 'limited');
  assert.ok(arms.reasons.some((line) => /biceps/.test(line.text)));
});

test('#296 balance guard: Arms only or Abs only stays at most the saved length and says so', () => {
  const longer = { ...defaultConstraints(gym), minutes: 90 };
  const arms = picked(gym, parts('Arms'), longer);
  assert.equal(arms.next.minutes, 45, 'capped at the saved 45');
  assert.match(arms.preview.smallLine ?? '', /^Arms only: \d+ exercises?(, all isolation)?\.$/);
  assert.equal(arms.preview.smallLine?.includes('all isolation'), arms.live.exercises.every((e) => ['elbow_flexion', 'elbow_extension'].includes(exerciseById(e.exerciseId)!.pattern)), 'says "all isolation" only when true');
  assert.equal(picked(gym, parts('Core'), longer).next.minutes, 45);
  assert.match(picked(gym, parts('Core')).preview.smallLine ?? '', /^Abs only: /);
  assert.equal(picked(gym, parts('Chest'), longer).next.minutes, 90, 'a big part keeps today\'s length');
  assert.equal(picked(gym, parts('Arms', 'Shoulders')).preview.smallLine, undefined);
  const shorter = { ...defaultConstraints(gym), minutes: 20 };
  assert.equal(picked(gym, parts('Arms'), shorter).next.minutes, 20, 'a shorter day stays short');
});

test('#296 today-only gear: the pick builds on today\'s gear and the bar names both', () => {
  const travel = { ...defaultConstraints(gym), equipment: 'hotel' as const };
  const { next } = picked(gym, parts('Shoulders', 'Arms'), travel);
  assert.equal(next.equipment, 'hotel');
  const now = new Date(2026, 10, 13, 10);
  const state = {
    ...EMPTY_STATE, profile: gym,
    todayOverride: { date: dayKey(now), minutes: 45, equipment: ['Dumbbell'], support: [], appliedAt: now.toISOString(), choice: 'hotel', focus: next.focus },
  } as unknown as AppState;
  assert.equal(todayOnly(state, now)?.label, 'Today only: Shoulders + Arms (you chose) · Travel gym');
});

test('#296 exclusions and "less often" are respected by a pick', () => {
  const first = picked(gym, parts('Chest')).live.exercises[0].exerciseId;
  const excluded = { ...gym, exclusions: [first] };
  assert.ok(!picked(excluded, parts('Chest')).live.exercises.some((e) => e.exerciseId === first));
  const lessOften = { ...gym, preferences: { [first]: 'less' as const } };
  const ids = picked(lessOften, parts('Chest')).live.exercises.map((e) => e.exerciseId);
  assert.ok(ids[0] !== first, `"less often" ${first} still leads: ${ids.join(', ')}`);
});

/* Coach rule 1: a label, never a block. */
const NOW = new Date(2026, 10, 11, 10, 0); // Wed 10:00 local
const ended = (at: Date, ids: string[]): WorkoutRecord => ({
  id: `r${at.getTime()}`, date: new Date(at.getTime() - 3_600_000).toISOString(), endedAt: at.toISOString(),
  name: 'Day', dayIndex: 0, status: 'completed', completedEarly: false,
  exercises: ids.map((exerciseId) => ({
    exerciseId, name: exerciseId, planned: [{ reps: 8, weight: 50 }],
    performed: [{ weight: 50, reps: 8, done: true, completedAt: at.toISOString() }],
  })),
}) as unknown as WorkoutRecord;
const hoursBefore = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

test('#296 recovery labels: yesterday, 2 days ago at 47 h, nothing at 49 h, across midnight', () => {
  assert.deepEqual(recoveryLabels([ended(hoursBefore(NOW, 20), ['barbell-bench-press'])], NOW), { Chest: 'trained yesterday' });
  assert.deepEqual(recoveryLabels([ended(hoursBefore(NOW, 47), ['barbell-bench-press'])], NOW), { Chest: 'trained 2 days ago' });
  assert.deepEqual(recoveryLabels([ended(hoursBefore(NOW, 49), ['barbell-bench-press'])], NOW), {});
  const halfPastMidnight = new Date(2026, 10, 11, 0, 30);
  assert.deepEqual(recoveryLabels([ended(new Date(2026, 10, 10, 23, 30), ['barbell-bench-press'])], halfPastMidnight), { Chest: 'trained yesterday' });
  assert.deepEqual(recoveryLabels([ended(hoursBefore(NOW, 2), ['barbell-row'])], NOW), { Back: 'trained today' });
  // Arms count only when they lead the exercise: a press does not mark Arms.
  assert.equal(recoveryLabels([ended(hoursBefore(NOW, 20), ['barbell-bench-press'])], NOW).Arms, undefined);
});
