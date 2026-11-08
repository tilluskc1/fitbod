import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { EquipmentChoice } from '../src/lib/adapt.ts';
import { AREAS, areasOf } from '../src/lib/areas.ts';
import type { Area } from '../src/lib/areas.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted } from '../src/lib/liveProgression.ts';
import {
  gearChoices, isPlannedPick, nothingSore, pickPlanned, planLine, timeChoices, toggleSore, toggleTrain,
} from '../src/lib/planToday.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import {
  NO_TAPS, baseTalk, composeTalk, customDayPreview, talkConstraints, tapSkip, tapTrain,
} from '../src/lib/todayTalk.ts';
import type { TalkState, Taps } from '../src/lib/todayTalk.ts';
import type { Profile } from '../src/types.ts';

/* #236: "Plan today with me". The questions write the same taps as the chips, over the same text. */

const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60,
};
const noGear: Profile = { ...gym, equipment: [], support: [], sessionMinutes: 35 };
const UPPER: Area[] = ['Chest', 'Back', 'Shoulders', 'Arms'];

type Slot = ReturnType<typeof planSlots>[number];
const start = (profile: Profile, saved: number) => {
  const withLength = { ...profile, sessionMinutes: saved };
  return { profile: withLength, slots: planSlots(buildPlan(withLength)), constraints: defaultConstraints(withLength) };
};
/** The day Start runs for these answers, as the app builds it (App.tsx `talkPreview`). */
function day(profile: Profile, slot: Slot, talk: TalkState) {
  const constraints = talkConstraints(talk, undefined, slot.focus);
  const program = todayProgram(profile, slot, [], constraints);
  const live = liveAdapted(adaptWorkout(program, constraints, [], profile.goal), profile, []);
  const preview = customDayPreview(talk, program, live, profile, slot.focus);
  return {
    constraints,
    shape: { exercises: preview.exercises.map((e) => `${e.exerciseId} ${e.sets}x${e.reps}`), sets: preview.sets, minutes: preview.minutes, status: preview.status },
  };
}

/** The owner's example by taps: Q1 30, Q2 sore Legs, Q3 upper areas one by one, Q4 kept. */
function byQuestions(base: TalkState, plannedAreas: Area[], gear?: EquipmentChoice) {
  let taps: Taps = { ...NO_TAPS, minutes: 30 };
  taps = toggleSore(base, '', taps, 'Legs');
  for (const area of UPPER) taps = toggleTrain(base, '', taps, area, plannedAreas);
  if (gear) taps = { ...taps, equipment: gear };
  return composeTalk(base, '', taps);
}
/** The same by the #193 chip rows: Time 30, Skip Legs, Train exactly the upper areas. */
function byChips(base: TalkState, gear?: EquipmentChoice) {
  let taps: Taps = { ...NO_TAPS, minutes: 30, ...(gear ? { equipment: gear } : {}) };
  taps = tapSkip(composeTalk(base, '', taps), taps, 'Legs');
  for (const area of AREAS) {
    const talk = composeTalk(base, '', taps);
    if (area !== 'Legs' && UPPER.includes(area) !== talk.train.includes(area)) taps = tapTrain(talk, taps, area);
  }
  return composeTalk(base, '', taps);
}
const GEAR_WORD: Partial<Record<EquipmentChoice, string>> = { hotel: ', hotel gym', bodyweight: ', bodyweight' };

test('#236: taps, text and chips give the same day, from every starting point (lessons #9)', () => {
  for (const profile of [gym, noGear]) {
    for (const saved of [45, 60, 90]) {
      const { profile: p, slots, constraints } = start(profile, saved);
      for (const slot of slots) {
        for (const gear of [undefined, 'hotel', 'bodyweight'] as const) {
          const base = baseTalk(constraints, slot.focus);
          const planned = areasOf(slot.focus);
          const taps = byQuestions(base, planned, gear);
          const text = composeTalk(base, `30 min, legs sore, upper body${gear ? GEAR_WORD[gear] : ''}`, NO_TAPS);
          const chips = byChips(base, gear);
          const at = `${profile === gym ? 'gym' : 'no gear'} saved ${saved} ${slot.name} ${gear ?? 'saved gear'}`;
          assert.deepEqual([taps.train, taps.skip, taps.sore, taps.minutes], [UPPER, ['Legs'], ['Legs'], 30], at);
          assert.deepEqual(day(p, slot, taps), day(p, slot, text), `taps = text, ${at}`);
          assert.deepEqual(day(p, slot, taps).shape, day(p, slot, chips).shape, `taps = chips, ${at}`);
        }
      }
    }
  }
});

test('#236: Q3 "My planned day" is the planned day minus what is sore; untouched answers keep the plan', () => {
  const { profile, slots, constraints } = start(gym, 60);
  const lower = slots[1];
  const planned = areasOf(lower.focus);
  const base = baseTalk(constraints, lower.focus);
  // Nothing answered: the planned day, untouched; no focus is written.
  assert.equal(isPlannedPick(base, planned), true);
  assert.deepEqual(talkConstraints(base, undefined, lower.focus), { minutes: 60, equipment: 'home' });
  // Sore Legs, planned day: the same as saying "legs sore".
  let taps = toggleSore(base, '', NO_TAPS, 'Legs');
  taps = pickPlanned(base, '', taps, planned);
  const talk = composeTalk(base, '', taps);
  assert.ok(!talk.train.includes('Legs'));
  assert.deepEqual(talk.train, planned.filter((area) => area !== 'Legs'));
  assert.deepEqual(day(profile, lower, talk), day(profile, lower, composeTalk(base, 'legs sore', NO_TAPS)));
  // Leaving the planned day starts from none: one tap trains just that area; a second turns it off.
  taps = toggleTrain(base, '', taps, 'Chest', planned);
  assert.deepEqual(composeTalk(base, '', taps).train, ['Chest']);
  taps = toggleTrain(base, '', taps, 'Chest', planned);
  assert.deepEqual(composeTalk(base, '', taps).train, []);
  // Back to the planned day.
  taps = pickPlanned(base, '', taps, planned);
  assert.equal(isPlannedPick(composeTalk(base, '', taps), planned), true);
});

test('#236: Q2 toggles sore on and off; "Nothing" undoes even what the text said', () => {
  const { slots, constraints } = start(gym, 60);
  const lower = slots[1];
  const base = baseTalk(constraints, lower.focus);
  let taps = toggleSore(base, '', NO_TAPS, 'Legs');
  assert.deepEqual(composeTalk(base, '', taps).sore, ['Legs']);
  taps = toggleSore(base, '', taps, 'Legs');
  assert.deepEqual(composeTalk(base, '', taps), base, 'off again is the untouched base');
  const said = 'legs and back are sore';
  assert.deepEqual(composeTalk(base, said, NO_TAPS).skip, ['Back', 'Legs']);
  const cleared = composeTalk(base, said, nothingSore(base, said, NO_TAPS));
  assert.deepEqual([cleared.skip, cleared.sore], [[], []]);
  // One the text made sore, toggled off, is neither trained nor skipped (Q3 decides).
  const one = composeTalk(base, said, toggleSore(base, said, NO_TAPS, 'Legs'));
  assert.deepEqual([one.skip, one.train.includes('Legs')], [['Back'], false]);
});

test('#236: everything sore leaves nothing to train, and says so instead of building', () => {
  const { slots, constraints } = start(gym, 60);
  const lower = slots[1];
  const base = baseTalk(constraints, lower.focus);
  let taps = NO_TAPS;
  for (const area of areasOf(lower.focus)) taps = toggleSore(base, '', taps, area);
  const talk = composeTalk(base, '', pickPlanned(base, '', taps, areasOf(lower.focus)));
  assert.deepEqual(talk.train, []);
  // No focus is written for an empty day, so nothing silent: the screen blocks the build (TodayTalk `build`).
  assert.equal(talkConstraints(talk, undefined, lower.focus).focus, undefined);
});

test('#236: pain in the text is pain; the floors and gear choices', () => {
  const { slots, constraints } = start(gym, 60);
  const base = baseTalk(constraints, slots[0].focus);
  assert.equal(composeTalk(base, 'my knee hurts, 30 min', NO_TAPS).pain, true);
  assert.deepEqual(timeChoices(35, 35), [15, 20, 30, 35, 45, 60, 90]);
  for (const minutes of [15, 20]) {
    const talk = composeTalk(base, '', { ...NO_TAPS, minutes });
    assert.equal(talk.minutes, minutes);
    assert.ok(day(gym, slots[0], talk).shape.exercises.length > 0, `${minutes} min still builds a day`);
  }
  assert.deepEqual(gearChoices('home', 'home'), ['home', 'hotel', 'bodyweight', 'bands']);
  assert.deepEqual(gearChoices('bodyweight', 'bodyweight'), ['bodyweight', 'hotel', 'bands'], 'a no-gear profile is not offered "home"');
});

test('#236: the summary line', () => {
  const { slots, constraints } = start(gym, 60);
  const lower = slots[1];
  const planned = areasOf(lower.focus);
  const base = baseTalk(constraints, lower.focus);
  const talk = composeTalk(base, '30 min, legs sore, upper body', NO_TAPS);
  assert.equal(planLine(talk, lower.name, planned, 'Home gym'), '30 min · Upper body · skipping Legs · Home gym');
  assert.equal(planLine(base, lower.name, planned, 'Your gym'), `60 min · ${lower.name} · Your gym`);
  assert.equal(planLine(composeTalk(base, 'full body', NO_TAPS), lower.name, planned, 'Your gym'), '60 min · Full body · Your gym');
});
