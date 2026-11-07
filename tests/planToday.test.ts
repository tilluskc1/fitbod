import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { adaptWorkout, swapCandidateFor, todayGlance, workMinutes, type AdaptedWorkout, type EquipmentChoice } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { addPerformedSet, createSession, logSet, removePerformedSet, skipExercise, swapPendingExercise } from '../src/lib/session.ts';
import { exerciseById } from '../src/data/exercises.ts';
import type { Program } from '../src/data/flagship.ts';
import type { Profile, WorkoutRecord } from '../src/types.ts';

// #189: Plan's header and Up next described the saved day while View session showed today's.
const gym = { name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable'],
  support: ['Bench', 'Rack', 'Pull-up bar'], exclusions: [], loads: {}, unit: 'kg', sessionMinutes: 60 } as unknown as Profile;
const bodyweight = { ...gym, equipment: [], support: [] } as unknown as Profile;
const firstDay = (who: Profile) => {
  const slot = planSlots(buildPlan(who))[0];
  return { slot, program: slotProgram(who, slot, []) };
};
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

interface Day { who: Profile; program: Program; focus: string[]; adapted: AdaptedWorkout; current: WorkoutRecord | null; overridden: boolean; equipment: EquipmentChoice }

/** Today, Plan and View session rendered from the same state, the way App wires them. */
async function surfaces({ who, program, focus, adapted, current, overridden, equipment }: Day) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Today } = await server.ssrLoadModule('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await server.ssrLoadModule('/src/screens/PlanScreen.tsx');
    const { DaySheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const { default: Coach } = await server.ssrLoadModule('/src/screens/CoachScreen.tsx');
    const live = liveAdapted(adapted, who, []);
    const exercises = current?.exercises ?? liveExercises(live, who, []);
    const today = todayGlance(adapted, current, overridden, who.goal);
    const now = new Date('2026-11-07T10:00:00Z');
    const sheet = plain(renderToStaticMarkup(createElement(DaySheet, { name: today.name, minutes: today.minutes, approx: today.approx, exercises, unit: 'kg', onClose: noop })));
    const plan = plain(renderToStaticMarkup(createElement(Plan, { profile: who, upcoming: [], focus, program, today, equipment, history: [], unit: 'kg',
      now, onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop })));
    const todayScreen = plain(renderToStaticMarkup(createElement(Today, { profile: who, program, adapted: live, equipment, adjusted: overridden, history: [], current, now,
      onPreview: noop, onAdjust: noop, onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop, onOpenLength: noop })));
    // App hands Coach the same glance as Plan and View session (#200).
    const coach = plain(renderToStaticMarkup(createElement(Coach, { profile: who, history: [], program: today, onWhy: noop, onEdit: noop })));
    const pick = (text: string, pattern: RegExp, label: string) => {
      const match = text.match(pattern);
      assert.ok(match, `${label}: ${text.slice(0, 400)}`);
      return match.slice(1);
    };
    return {
      today,
      card: pick(todayScreen, /The workout (≈?\d+) min · (\d+) sets/, 'Today card'),
      header: pick(plan, /(\d+) exercises? · (\d+) sets · (≈?\d+) minutes · (\w+(?: gym)?)/, 'Plan header'),
      upNext: pick(plan, /UP NEXT .*? (≈?\d+) min · (\d+) exercises? · (\d+) sets/, 'Up next'),
      sheet: pick(sheet, /(≈?\d+) min · (\d+) exercises? · (\d+) sets/, 'View session'),
      coach: pick(coach, /Next session .*? · (≈?\d+) min/, 'Coach'),
      plan,
    };
  } finally {
    await server.close();
  }
}

function agree(seen: Awaited<ReturnType<typeof surfaces>>, minutes: string, exercises: string, sets: string) {
  assert.deepEqual(seen.card, [minutes, sets], 'Today card');
  assert.deepEqual(seen.header.slice(0, 3), [exercises, sets, minutes], 'Plan header');
  assert.deepEqual(seen.upNext, [minutes, exercises, sets], 'Up next');
  assert.deepEqual(seen.sheet, [minutes, exercises, sets], 'View session');
  assert.deepEqual(seen.coach, [minutes], 'Coach');
}

test('a today-only 30 min day: Today, Plan header, Up next and View session show the same honest minutes', async () => {
  const { slot, program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  const seen = await surfaces({ who: gym, program, focus: slot.focus, adapted, current: null, overridden: true, equipment: 'home' });
  // #203: trimming now fits 30 min by the timer's own rests: 10 sets in 28 minutes. The 2 minutes
  // left would fit a Face Pull set but not a third lead set, and no movement passes the lead (#133).
  // The old sets-per-minute trim kept 12 sets that ran 32 (#200 showed that overrun).
  agree(seen, '28', '5', '10');
  assert.match(seen.plan, /UP NEXT .*? 28 min · 5 exercises · 10 sets · Adjusted for today/);
  assert.equal(seen.header[3], 'Full gym', 'a length-only change keeps the saved setup word');
});

test('a bodyweight day whose work cannot fill the hour reads ≈ everywhere', async () => {
  const { slot, program } = firstDay(bodyweight);
  const adapted = adaptWorkout(program, defaultConstraints(bodyweight), [], bodyweight.goal);
  const seen = await surfaces({ who: bodyweight, program, focus: slot.focus, adapted, current: null, overridden: false, equipment: 'bodyweight' });
  agree(seen, '≈15', '1', '4');
  assert.doesNotMatch(seen.plan, /Adjusted for today/);
});

test('a running session: every surface shows the session, and it is not labelled adjusted', async () => {
  const { slot, program } = firstDay(gym);
  const started = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  const current = createSession({ id: 's1', name: started.name, dayIndex: 0, exercises: liveExercises(started, gym, []), now: '2026-11-07T09:00:00Z', durationMin: started.minutes });
  // Today's override still applies, but the open session is what runs.
  const seen = await surfaces({ who: gym, program, focus: slot.focus, adapted: started, current, overridden: true, equipment: 'home' });
  // #200: the promised figure stays after Start (28 since #203 trims by the timer).
  agree(seen, '28', '5', '10');
  assert.equal(seen.today.adjusted, false);
  assert.doesNotMatch(seen.plan, /Adjusted for today/);
});

test('no override and no session: Plan numbers are the saved day, as before', async () => {
  const { slot, program } = firstDay(gym);
  const adapted = adaptWorkout(program, defaultConstraints(gym), [], gym.goal);
  const seen = await surfaces({ who: gym, program, focus: slot.focus, adapted, current: null, overridden: false, equipment: 'home' });
  // 23 sets take 58 minutes with the timer's rests; ≈ only marks work far short of the hour (#200).
  agree(seen, '58', '7', '23');
  assert.equal(seen.header[3], 'Full gym');
  assert.doesNotMatch(seen.plan, /Adjusted for today/);
});

test('a today-only setup names that setup in the Plan header', async () => {
  const { slot, program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), equipment: 'hotel' }, [], gym.goal);
  const seen = await surfaces({ who: gym, program, focus: slot.focus, adapted, current: null, overridden: true, equipment: 'hotel' });
  assert.equal(seen.header[3], 'Travel');
});

test('todayGlance: adjusted only while no session runs', () => {
  const { program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  const current = createSession({ id: 's1', name: adapted.name, dayIndex: 0, exercises: liveExercises(adapted, gym, []), now: '2026-11-07T09:00:00Z', durationMin: 30 });
  assert.equal(todayGlance(adapted, null, true).adjusted, true);
  assert.equal(todayGlance(adapted, current, true).adjusted, false);
  assert.equal(todayGlance(adapted, null, false).adjusted, false);
});

// #200: Start must not change the minutes a screen promised a moment before, and a running
// session's minutes come from the session alone: its exercises, their rests and planned sets.
const start = (who: Profile, adapted: AdaptedWorkout, durationMin = adapted.minutes) =>
  createSession({ id: 's1', name: adapted.name, dayIndex: 0, exercises: liveExercises(adapted, who, []), now: '2026-11-07T09:00:00Z', durationMin });
const glance = (adapted: AdaptedWorkout, current: WorkoutRecord | null, who: Profile = gym) => todayGlance(adapted, current, false, who.goal);
const pick = (seen: { minutes: number; approx: boolean }) => [seen.minutes, seen.approx];

test('a bodyweight day keeps ≈15 on every surface after Start, Coach included', async () => {
  const { slot, program } = firstDay(bodyweight);
  const adapted = adaptWorkout(program, defaultConstraints(bodyweight), [], bodyweight.goal);
  const day = { who: bodyweight, program, focus: slot.focus, adapted, overridden: false, equipment: 'bodyweight' as const };
  agree(await surfaces({ ...day, current: null }), '≈15', '1', '4');
  agree(await surfaces({ ...day, current: start(bodyweight, adapted) }), '≈15', '1', '4');
});

test('todayGlance: the same minutes and ≈ before and after Start', () => {
  for (const [who, minutes] of [[gym, 30], [gym, 60], [bodyweight, 60], [gym, 15], [{ ...gym, goal: 'Get Stronger' } as Profile, 30]] as const) {
    const { program } = firstDay(who);
    const adapted = adaptWorkout(program, { ...defaultConstraints(who), minutes }, [], who.goal);
    assert.deepEqual(pick(glance(adapted, start(who, adapted), who)), pick(glance(adapted, null, who)), `${who.goal} ${who.equipment.length ? 'gym' : 'bodyweight'} at ${minutes}`);
  }
});

test('todayGlance: each set added mid-session adds time; minutes never fall back to the asked length', () => {
  const { program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  let current = start(gym, adapted);
  let previous = glance(adapted, current).minutes;
  const seen = [previous];
  // Past the program's own 23 sets too: the old density rule snapped back to 30 there.
  for (let added = 1; added <= 14; added += 1) {
    current = addPerformedSet(current, added % current.exercises.length);
    const minutes = glance(adapted, current).minutes;
    assert.ok(minutes > previous, `set ${12 + added}: ${minutes} after ${previous} (${seen.join(', ')})`);
    previous = minutes;
    seen.push(minutes);
  }
  // And back down as sets are removed.
  current = removePerformedSet(current, 1, 0);
  assert.ok(glance(adapted, current).minutes < previous);
});

test('todayGlance: a skip keeps the planned minutes; a swap reprices only the work it changes', () => {
  const { program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  const current = start(gym, adapted);
  const promised = glance(adapted, current).minutes;
  assert.equal(glance(adapted, skipExercise(current, 1)).minutes, promised, 'a skip leaves the planned sets in place');

  // A real swap after one done set: the done set stays as its own entry, the rest moves to the replacement.
  const logged = logSet(current, 0, 0, '2026-11-07T09:05:00Z');
  const lead = exerciseById(logged.exercises[0].exerciseId)!;
  const replacement = exerciseById('dumbbell-bench-press')!;
  const swapped = swapPendingExercise(logged, 0, swapCandidateFor(replacement, gym, [], logged, true));
  assert.equal(swapped.exercises.reduce((sum, exercise) => sum + exercise.planned.length, 0), 10, 'no set gained or lost');
  // The honest figure is the time model of the session as it now stands: the split adds one
  // set-up (90 s) and drops one rest between the lead's sets.
  const expected = workMinutes(swapped.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, sets: exercise.planned.length })), gym.goal, 30);
  assert.equal(glance(adapted, swapped).minutes, expected, `${lead.id} -> ${replacement.id}`);
  assert.ok(Math.abs(expected - promised) <= 1, `${promised} -> ${expected}`);
});

test('todayGlance: nothing outside the running session moves its minutes', () => {
  const { program } = firstDay(gym);
  const adapted = adaptWorkout(program, { ...defaultConstraints(gym), minutes: 30 }, [], gym.goal);
  const current = start(gym, adapted);
  const before = pick(glance(adapted, current));
  // A settings or slot change mid-session rebuilds today's day; the session is unchanged.
  const other = adaptWorkout(firstDay(bodyweight).program, defaultConstraints(bodyweight), [], bodyweight.goal);
  assert.deepEqual(pick(glance(other, current)), before);
  assert.deepEqual(pick(glance(adaptWorkout(program, defaultConstraints(gym), [], gym.goal), current)), before);
});

test('todayGlance: a stored session reads sensibly with or without its asked length', () => {
  const { program } = firstDay(bodyweight);
  const adapted = adaptWorkout(program, defaultConstraints(bodyweight), [], bodyweight.goal);
  // Sessions saved before #200 hold the asked length, which is still what is written.
  assert.deepEqual(pick(glance(adapted, start(bodyweight, adapted, 60), bodyweight)), [15, true]);
  // A record without durationMin: rests as the timer runs them (full), and no ≈ since the asked length is unknown.
  assert.deepEqual(pick(glance(adapted, { ...start(bodyweight, adapted), durationMin: undefined }, bodyweight)), [15, false]);
});
