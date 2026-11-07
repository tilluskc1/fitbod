import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseById } from '../src/data/exercises.ts';
import { adaptWorkout, promisedMinutes } from '../src/lib/adapt.ts';
import { keywordParser, resolveConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { activeOverride, dayKey } from '../src/lib/plan.ts';
import { cursorFor, planSlots, slotLinkFor, todayProgram } from '../src/lib/sequence.ts';
import { applyFinish, createSession } from '../src/lib/session.ts';
import { serializeExport } from '../src/lib/storage.ts';
import { parseState } from '../src/lib/validate.ts';
import { customDayName, customDayPreview, talkConstraints, talkFromText, toggleSkip, toggleTrain } from '../src/lib/todayTalk.ts';
import type { TalkState } from '../src/lib/todayTalk.ts';
import type { AppState, MuscleGroup, Profile, TodayOverride, WorkoutRecord } from '../src/types.ts';

/** One completed set on the first exercise, as the logger records it. */
const logSet = (session: WorkoutRecord, _e: number, _s: number, at: string): WorkoutRecord => ({
  ...session,
  exercises: session.exercises.map((exercise, index) => index === 0
    ? { ...exercise, performed: exercise.performed.map((set, k) => (k === 0 ? { ...set, weight: 20, done: true, completedAt: at } : set)) }
    : exercise),
});

const gym: Profile = {
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60,
};
const plan = buildPlan(gym);
const lower = planSlots(plan)[1];
const LEGS: MuscleGroup[] = ['Quads', 'Hamstrings', 'Glutes', 'Calves'];
const base: TalkState = { equipment: 'home', minutes: 60, train: ['Legs', 'Core'], skip: [], pain: false, notices: [] };

/* ---------- parser ---------- */

test('#193: the mockup sentences read as gear, train, skip and time', () => {
  assert.deepEqual(keywordParser.parse('Full gym today. My legs are sore so skip them. I want chest and abs, 45 min.'),
    { minutes: 45, equipment: 'home', train: ['Chest', 'Core'], avoid: ['Legs'] });
  assert.deepEqual(keywordParser.parse('Hotel gym, 30 min, upper body please.'),
    { minutes: 30, equipment: 'hotel', train: ['Chest', 'Back', 'Shoulders', 'Arms'] });
  assert.deepEqual(keywordParser.parse('Home today, back and arms, an hour.'),
    { minutes: 60, equipment: 'home', train: ['Back', 'Arms'] });
  assert.deepEqual(keywordParser.parse('Shoulders are tired, legs and abs, 60 min at the gym.'),
    { minutes: 60, equipment: 'home', train: ['Legs', 'Core'], avoid: ['Shoulders'] });
  assert.deepEqual(keywordParser.parse('My knee hurts, gym, legs.'),
    { equipment: 'home', train: ['Legs'], pain: true });
});

test('#193: muscle words, sore and skip phrasing, never across a comma', () => {
  assert.deepEqual(keywordParser.parse('pecs and lats').train, ['Chest', 'Back']);
  assert.deepEqual(keywordParser.parse('delts, biceps, triceps').train, ['Shoulders', 'Arms']);
  assert.deepEqual(keywordParser.parse('quads hamstrings glutes calves core').train, ['Legs', 'Core']);
  assert.deepEqual(keywordParser.parse('lower body').train, ['Legs']);
  assert.deepEqual(keywordParser.parse('sore legs, tired arms, no chest, skip back').avoid, ['Chest', 'Back', 'Arms', 'Legs']);
  assert.equal(keywordParser.parse('sore legs, tired arms, no chest, skip back').train, undefined);
  // "tired" ends its clause: the next clause trains.
  const parsed = keywordParser.parse('shoulders tired, chest');
  assert.deepEqual(parsed.avoid, ['Shoulders']);
  assert.deepEqual(parsed.train, ['Chest']);
  // A skipped area never also trains.
  assert.deepEqual(keywordParser.parse('legs are sore, legs').train, undefined);
  assert.deepEqual(keywordParser.parse('Full gym, legs sore, chest and abs, 45 min'),
    { minutes: 45, equipment: 'home', train: ['Chest', 'Core'], avoid: ['Legs'] });
});

test('#193: pain words stop the build', () => {
  for (const text of ['my knee hurts', 'lower back pain', 'injured my wrist', 'tweaked my shoulder', 'pulled a hamstring', 'my elbow hurt']) {
    assert.equal(keywordParser.parse(text).pain, true, text);
  }
  assert.equal(keywordParser.parse('legs are sore').pain, undefined);
});

test('#193: existing time and gear parsing keeps working', () => {
  assert.deepEqual(keywordParser.parse('20 min at a hotel gym'), { minutes: 20, equipment: 'hotel' });
  assert.deepEqual(keywordParser.parse('Travel gym'), { equipment: 'hotel' });
  assert.deepEqual(keywordParser.parse('no equipment, 30 minutes'), { minutes: 30, equipment: 'bodyweight' });
  assert.deepEqual(keywordParser.parse('1 hour'), { minutes: 60 });
  assert.deepEqual(keywordParser.parse('half an hour'), { minutes: 30 });
  assert.deepEqual(keywordParser.parse(''), {});
});

test('#193: resolveConstraints carries a custom day through other edits', () => {
  const current = { minutes: 45, equipment: 'home' as const, focus: ['Chest', 'Core'] as MuscleGroup[], skip: LEGS };
  const resolved = resolveConstraints(current, { minutes: 30 });
  assert.deepEqual(resolved.constraints, { minutes: 30, equipment: 'home', focus: ['Chest', 'Core'], skip: LEGS });
  assert.deepEqual(resolveConstraints({ minutes: 45, equipment: 'home' }, { minutes: 30 }).constraints, { minutes: 30, equipment: 'home' });
});

/* ---------- chips ---------- */

test('#193: text fills the chips and the chips stay editable', () => {
  const talk = talkFromText('Full gym, legs sore, chest and abs, 45 min', base);
  assert.deepEqual([talk.equipment, talk.minutes, talk.train, talk.skip, talk.pain], ['home', 45, ['Chest', 'Core'], ['Legs'], false]);
  // Tapping a Train chip takes it out of Skip, and the other way round.
  const legsBack = toggleTrain(talk, 'Legs');
  assert.deepEqual([legsBack.train, legsBack.skip], [['Chest', 'Legs', 'Core'], []]);
  const chestSkipped = toggleSkip(talk, 'Chest');
  assert.deepEqual([chestSkipped.train, chestSkipped.skip], [['Core'], ['Chest', 'Legs']]);
  // Only skips named: the planned areas stay, minus the skipped one.
  assert.deepEqual(talkFromText('legs are sore', base).train, ['Core']);
  assert.deepEqual(talkFromText('', base), base);
  assert.equal(talkFromText('my knee hurts', base).pain, true);
});

test('#193: the stored focus is Train minus Skip, as muscle groups', () => {
  const talk = toggleTrain(talkFromText('arms, legs sore', base), 'Chest');
  assert.deepEqual([talk.train, talk.skip], [['Chest', 'Arms'], ['Legs']]);
  const constraints = talkConstraints(talk);
  assert.deepEqual(constraints.focus, ['Chest', 'Biceps', 'Triceps']);
  assert.deepEqual(constraints.skip, LEGS);
  assert.deepEqual([constraints.minutes, constraints.equipment], [60, 'home']);
  assert.equal(customDayName(['Chest', 'Core']), 'Chest + Core');
  assert.equal(customDayName(['Biceps', 'Triceps', 'Quads']), 'Arms + Legs');
});

/* ---------- build ---------- */

const build = (text: string, profile = gym) => {
  const talk = talkFromText(text, base);
  const constraints = talkConstraints(talk);
  const program = todayProgram(profile, lower, [], constraints);
  const adapted = adaptWorkout(program, constraints, []);
  const live = liveAdapted(adapted, profile, []);
  return { talk, constraints, program, adapted, live, preview: customDayPreview(talk, program, live, profile) };
};

test('#193: "Full gym, legs sore, chest and abs, 45 min" builds Chest + Core with no leg work', () => {
  const { program, adapted, preview } = build('Full gym, legs sore, chest and abs, 45 min');
  assert.equal(adapted.name, 'Chest + Core');
  assert.equal(preview.title, 'Chest + Core');
  assert.ok(adapted.exercises.length >= 3, adapted.exercises.map((e) => e.exerciseId).join());
  for (const exercise of adapted.exercises) {
    const meta = exerciseById(exercise.exerciseId)!;
    assert.ok(!LEGS.includes(meta.muscles[0]), `${exercise.exerciseId} trains ${meta.muscles[0]}`);
    assert.ok(!['squat', 'lunge', 'hinge', 'calf_raise', 'knee_flexion', 'knee_extension'].includes(meta.pattern), exercise.exerciseId);
    assert.ok(['Chest', 'Core'].includes(meta.muscles[0]), `${exercise.exerciseId} is on focus`);
  }
  assert.ok(adapted.exercises.some((e) => exerciseById(e.exerciseId)!.muscles[0] === 'Chest'));
  assert.ok(adapted.exercises.some((e) => exerciseById(e.exerciseId)!.muscles[0] === 'Core'));
  const promised = promisedMinutes(program, adapted);
  assert.ok(promised <= 45, `promised ${promised}`);
  assert.equal(preview.minutes, promised);
  assert.equal(preview.status, program.feasibility?.status === 'limited' ? 'limited' : 'ready');
  assert.deepEqual(preview.skipped, ['Legs']);
  assert.deepEqual(preview.missing, []);
  assert.equal(preview.gear, 'Your gym');
  assert.equal(preview.warmUpMinutes, 5);
});

test('#193: an area the gear cannot train reads Limited and is named, never padded', () => {
  const { preview, adapted } = build('bodyweight, back and core, 30 min');
  assert.ok(adapted.exercises.every((e) => exerciseById(e.exerciseId)!.muscles[0] !== 'Chest'));
  if (!adapted.exercises.some((e) => exerciseById(e.exerciseId)!.muscles[0] === 'Back')) {
    assert.deepEqual(preview.missing, ['Back']);
    assert.equal(preview.status, 'limited');
  }
  assert.equal(preview.gear, 'Bodyweight');
});

test('#193: preview and Start launch exactly the same exercises', () => {
  const { live, preview } = build('Shoulders are tired, legs and abs, 60 min at the gym.');
  const session = createSession({ id: 's', name: live.name, dayIndex: lower.index, exercises: liveExercises(live, gym, []), now: '2026-11-07T10:00:00.000Z', durationMin: live.minutes });
  assert.deepEqual(session.exercises.map((e) => [e.exerciseId, e.planned.length]), preview.exercises.map((e) => [e.exerciseId, e.sets]));
  assert.equal(session.name, 'Legs + Core');
});

/* ---------- storage ---------- */

const override: TodayOverride = {
  date: '2026-11-07', minutes: 45, equipment: ['Dumbbell'], support: [], appliedAt: '2026-11-07T09:00:00.000Z',
  choice: 'home', focus: ['Chest', 'Core'], skip: LEGS,
};
const stateWith = (todayOverride: unknown) => ({
  profile: gym, plan, history: [], current: null, todayOverride, planRevision: 1, programCursor: { revision: 1, seq: 1 }, slotSkips: [],
});

test('#193: an override with focus and skip validates, round-trips and expires next day', () => {
  const parsed = parseState(JSON.stringify(stateWith(override)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.state.todayOverride, override);
  const restored = parseState(serializeExport(parsed.state));
  assert.ok(restored.ok);
  assert.deepEqual(restored.state.todayOverride, override);
  assert.deepEqual(activeOverride(restored.state, new Date(2026, 10, 7, 20)), override);
  assert.equal(activeOverride(restored.state, new Date(2026, 10, 8, 6)), null);
  assert.equal(dayKey(new Date(2026, 10, 7)), override.date);
});

test('#193: older overrides load unchanged and bad focus or skip values are refused', () => {
  const { focus: _focus, skip: _skip, ...older } = override;
  const parsed = parseState(JSON.stringify(stateWith(older)));
  assert.ok(parsed.ok);
  assert.equal('focus' in parsed.state.todayOverride!, false);
  assert.equal('skip' in parsed.state.todayOverride!, false);
  for (const bad of [
    { focus: 'Chest' }, { focus: [] }, { focus: ['Pecs'] }, { skip: [42] }, { skip: 'Legs' },
    { focus: ['Chest'], skip: ['Chest'] },
  ]) {
    assert.equal(parseState(JSON.stringify(stateWith({ ...older, ...bad }))).ok, false, JSON.stringify(bad));
  }
});

/* ---------- the plan stays intact ---------- */

test('#193: finishing a custom day records it and leaves the planned day next', () => {
  const start: AppState = { ...stateWith(override), todayOverride: override } as AppState;
  const link = slotLinkFor(start, true);
  assert.equal('slotSeq' in link, false);
  assert.equal('slotId' in link, false);
  const { live } = build('Full gym, legs sore, chest and abs, 45 min');
  const session = createSession({ id: 'c1', name: live.name, dayIndex: lower.index, ...link, exercises: liveExercises(live, gym, []), now: '2026-11-07T10:00:00.000Z', durationMin: live.minutes });
  const logged = logSet(session, 0, 0, '2026-11-07T10:05:00.000Z');
  const finished = applyFinish({ ...start, current: logged }, 'c1', { early: true, now: '2026-11-07T10:30:00.000Z' });
  assert.deepEqual(cursorFor(finished), cursorFor(start), 'the cursor stays on the planned day');
  assert.equal(finished.history[0].name, 'Chest + Core');
  assert.equal(finished.current, null);
  // The custom day is done: Today goes back to the planned day, keeping today's gear and time.
  assert.equal(finished.todayOverride?.focus, undefined);
  assert.equal(finished.todayOverride?.skip, undefined);
  assert.equal(finished.todayOverride?.minutes, 45);
  // A planned session still advances exactly as before.
  const planned = createSession({ id: 'p1', name: lower.name, dayIndex: lower.index, ...slotLinkFor(start, false), exercises: liveExercises(live, gym, []), now: '2026-11-07T11:00:00.000Z' });
  const advanced = applyFinish({ ...start, current: logSet(planned, 0, 0, '2026-11-07T11:05:00.000Z') }, 'p1', { early: true, now: '2026-11-07T11:30:00.000Z' });
  assert.equal(cursorFor(advanced).seq, cursorFor(start).seq + 1);
});

test('#193: finishing a custom day at the saved gear and length clears the override', () => {
  const sameAsSaved: TodayOverride = { ...override, minutes: 60 };
  const start = { ...stateWith(sameAsSaved) } as AppState;
  const { live } = build('chest');
  const session = createSession({ id: 'c2', name: live.name, dayIndex: 0, ...slotLinkFor(start, true), exercises: liveExercises(live, gym, []), now: '2026-11-07T10:00:00.000Z' });
  const finished = applyFinish({ ...start, current: logSet(session, 0, 0, '2026-11-07T10:05:00.000Z') }, 'c2', { early: true, now: '2026-11-07T10:30:00.000Z' });
  assert.equal(finished.todayOverride, null);
});
