import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES, areIncompatible, exerciseById } from '../src/data/exercises.ts';
import { capabilitiesFor, provides } from '../src/lib/capabilities.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
import type { EquipmentChoice } from '../src/lib/adapt.ts';
import { AREAS, AREA_MUSCLES, musclesOf, worksSkipped } from '../src/lib/areas.ts';
import type { Area } from '../src/lib/areas.ts';
import { keywordParser, resolveConstraints } from '../src/lib/constraints.ts';
import { MAX_EXERCISES, buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { activeOverride, dayKey } from '../src/lib/plan.ts';
import { cursorFor, kitProfile, planSlots, slotLinkFor, todayProgram, withSkipped } from '../src/lib/sequence.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { applyFinish, createSession } from '../src/lib/session.ts';
import { serializeExport } from '../src/lib/storage.ts';
import { parseState } from '../src/lib/validate.ts';
import {
  NO_TAPS, baseTalk, composeTalk, customDayName, customDayPreview, describesDay, talkConstraints, talkFromText, talkParse,
  tapSkip, tapTrain, tapsAfterEdit,
} from '../src/lib/todayTalk.ts';
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
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60, pairExercises: false, // #88: straight sets
};
const plan = buildPlan(gym);
const lower = planSlots(plan)[1];
const LEGS: MuscleGroup[] = ['Quads', 'Hamstrings', 'Glutes', 'Calves'];
const base: TalkState = baseTalk({ equipment: 'home', minutes: 60 }, lower.focus);
const pick = (parsed: ReturnType<typeof talkParse>) => {
  const { train, avoid, sore, pain, equipment, minutes } = parsed;
  return Object.fromEntries(Object.entries({ train, avoid, sore, pain, equipment, minutes }).filter(([, v]) => v !== undefined));
};

/* ---------- the composer's parser ---------- */

test('#193: the mockup sentences read as gear, train, skip and time', () => {
  assert.deepEqual(pick(talkParse('Full gym today. My legs are sore so skip them. I want chest and abs, 45 min.')),
    { minutes: 45, equipment: 'home', train: ['Chest', 'Core'], avoid: ['Legs'], sore: ['Legs'] });
  assert.deepEqual(pick(talkParse('Hotel gym, 30 min, upper body please.')),
    { minutes: 30, equipment: 'hotel', train: ['Chest', 'Back', 'Shoulders', 'Arms'] });
  assert.deepEqual(pick(talkParse('Home today, back and arms, an hour.')),
    { minutes: 60, equipment: 'home', train: ['Back', 'Arms'] });
  assert.deepEqual(pick(talkParse('Shoulders are tired, legs and abs, 60 min at the gym.')),
    { minutes: 60, equipment: 'home', train: ['Legs', 'Core'], avoid: ['Shoulders'], sore: ['Shoulders'] });
  assert.deepEqual(pick(talkParse('My knee hurts, gym, legs.')), { equipment: 'home', train: ['Legs'], pain: true });
});

test('#193: area words, sore and skip phrasing, never across a comma', () => {
  assert.deepEqual(talkParse('pecs and lats').train, ['Chest', 'Back']);
  assert.deepEqual(talkParse('delts, biceps, triceps').train, ['Shoulders', 'Arms']);
  assert.deepEqual(talkParse('quads hamstrings glutes calves core').train, ['Legs', 'Core']);
  assert.deepEqual(talkParse('lower body').train, ['Legs']);
  const mixed = talkParse('sore legs, tired arms, no chest, skip back');
  assert.deepEqual([mixed.avoid, mixed.sore, mixed.train], [['Chest', 'Back', 'Arms', 'Legs'], ['Arms', 'Legs'], undefined]);
  assert.deepEqual(pick(talkParse('shoulders tired, chest')), { train: ['Chest'], avoid: ['Shoulders'], sore: ['Shoulders'] });
  assert.equal(talkParse('legs are sore, legs').train, undefined, 'a skipped area never also trains');
  assert.deepEqual(pick(talkParse('back is sore, legs')), { train: ['Legs'], avoid: ['Back'], sore: ['Back'] });
});

test('#193: only a determiner may sit between "no/skip" and an area; "not sore" trains', () => {
  assert.deepEqual(pick(talkParse('30 min no dumbbells chest')), { minutes: 30, equipment: 'bodyweight', train: ['Chest'] });
  assert.deepEqual(pick(talkParse('no time chest')), { train: ['Chest'] });
  assert.deepEqual(pick(talkParse('skip my legs, chest')), { train: ['Chest'], avoid: ['Legs'] });
  assert.deepEqual(pick(talkParse('legs not sore, legs and core')), { train: ['Legs', 'Core'] });
  assert.deepEqual(pick(talkParse("shoulders aren't sore")), { train: ['Shoulders'] });
  assert.deepEqual(pick(talkParse('not sore legs')), { train: ['Legs'] });
  assert.deepEqual(pick(talkParse('legs are no longer sore')), { train: ['Legs'] });
});

test('#193: pain stops the build, and a denied pain does not', () => {
  for (const text of ['my knee hurts', 'lower back pain', 'injured my wrist', 'tweaked my shoulder', 'pulled a hamstring', 'my elbow hurt']) {
    assert.equal(talkParse(text).pain, true, text);
  }
  // The hurting area is skipped, so "It's only soreness" never trains it.
  assert.deepEqual(talkParse('my shoulder hurts').avoid, ['Shoulders']);
  assert.deepEqual(talkParse('lower back pain').avoid, ['Back']);
  assert.deepEqual(talkParse('pulled a hamstring').avoid, ['Legs']);
  for (const text of ['no pain today, chest', 'nothing hurts', 'injury free, legs', 'pain-free', "my back doesn't hurt", 'legs are sore']) {
    assert.equal(talkParse(text).pain, undefined, text);
  }
  assert.deepEqual(pick(talkParse('no pain today, chest')), { train: ['Chest'] });
  assert.deepEqual(pick(talkParse('nothing hurts')), {}, '"nothing" here is not bodyweight');
  assert.deepEqual(pick(talkParse('injury free, legs')), { train: ['Legs'] });
  assert.deepEqual(talkParse('no back pain, legs').avoid, undefined);
});

test('#193: gear and time in the composer; a negated place selects nothing', () => {
  assert.deepEqual(pick(talkParse('Travel gym')), { equipment: 'hotel' });
  assert.deepEqual(pick(talkParse('at the gym')), { equipment: 'home' });
  assert.deepEqual(pick(talkParse('no gym today')), {});
  assert.deepEqual(pick(talkParse('not at the gym, bodyweight')), { equipment: 'bodyweight' });
  assert.deepEqual(pick(talkParse('1 hour')), { minutes: 60 });
  assert.deepEqual(pick(talkParse('1.5 hours')), { minutes: 90 });
  assert.deepEqual(pick(talkParse('half an hour')), { minutes: 30 });
  assert.deepEqual(pick(talkParse('an hour, 45 min')), { minutes: 45 });
  assert.equal(talkFromText('no gym today, chest', { ...base, equipment: 'hotel' }).equipment, 'hotel');
});

test('#193: the shared parser behind the Adjust sheet is unchanged', () => {
  assert.deepEqual(keywordParser.parse('travel day bands'), { equipment: 'bands' });
  assert.deepEqual(keywordParser.parse('Travel gym'), {});
  assert.deepEqual(keywordParser.parse('at the gym'), {});
  assert.deepEqual(keywordParser.parse('legs sore, chest'), {});
  assert.deepEqual(keywordParser.parse('1 hour'), { minutes: 1 });
  assert.deepEqual(keywordParser.parse('20 min at a hotel gym'), { minutes: 20, equipment: 'hotel' });
  assert.deepEqual(keywordParser.parse('no equipment, 30 minutes'), { minutes: 30, equipment: 'bodyweight' });
  assert.deepEqual(keywordParser.parse(''), {});
});

test('#193: resolveConstraints carries a custom day through other edits', () => {
  const current = { minutes: 45, equipment: 'home' as const, focus: ['Chest', 'Core'] as MuscleGroup[], skip: LEGS };
  const resolved = resolveConstraints(current, { minutes: 30 });
  assert.deepEqual(resolved.constraints, { minutes: 30, equipment: 'home', focus: ['Chest', 'Core'], skip: LEGS });
  assert.deepEqual(resolveConstraints({ minutes: 45, equipment: 'home' }, { minutes: 30 }).constraints, { minutes: 30, equipment: 'home' });
});

test('#193: a sore or skip word covers a whole list of areas, before or after it', () => {
  assert.deepEqual(pick(talkParse('legs and arms are sore')), { avoid: ['Arms', 'Legs'], sore: ['Arms', 'Legs'] });
  assert.deepEqual(pick(talkParse('sore legs and arms')), { avoid: ['Arms', 'Legs'], sore: ['Arms', 'Legs'] });
  assert.deepEqual(pick(talkParse('skip legs and arms')), { avoid: ['Arms', 'Legs'] });
  assert.deepEqual(pick(talkParse('no shoulders or arms, chest')), { train: ['Chest'], avoid: ['Shoulders', 'Arms'] });
  assert.deepEqual(pick(talkParse('skip legs, arms and chest')), { avoid: ['Chest', 'Arms', 'Legs'] });
  assert.deepEqual(pick(talkParse('my chest, back and shoulders are tired')), { avoid: ['Chest', 'Back', 'Shoulders'], sore: ['Chest', 'Back', 'Shoulders'] });
  // A comma alone is not a list: the sore word stays with its own area.
  assert.deepEqual(pick(talkParse('I want chest, legs are sore')), { train: ['Chest'], avoid: ['Legs'], sore: ['Legs'] });
  assert.deepEqual(pick(talkParse('Shoulders are tired, legs and abs')), { train: ['Legs', 'Core'], avoid: ['Shoulders'], sore: ['Shoulders'] });
});

test('#193: "everything but legs" trains the other five; "but" elsewhere still splits', () => {
  assert.deepEqual(pick(talkParse('everything but legs')), { train: ['Chest', 'Back', 'Shoulders', 'Arms', 'Core'] });
  assert.deepEqual(pick(talkParse('anything except chest')), { train: ['Back', 'Shoulders', 'Arms', 'Legs', 'Core'] });
  assert.deepEqual(pick(talkParse('all but legs and core, 45 min')), { minutes: 45, train: ['Chest', 'Back', 'Shoulders', 'Arms'] });
  assert.deepEqual(pick(talkParse('everything other than arms')), { train: ['Chest', 'Back', 'Shoulders', 'Legs', 'Core'] });
  assert.deepEqual(pick(talkParse('chest but my back is sore')), { train: ['Chest'], avoid: ['Back'], sore: ['Back'] });
});

test('#193: "fine/ok" covers only the areas it follows, never a skip said earlier in the list', () => {
  assert.deepEqual(pick(talkParse('no legs, arms and chest ok')), { avoid: ['Legs'] });
  assert.deepEqual(pick(talkParse('skip legs, chest and arms are fine')), { avoid: ['Legs'] });
  assert.deepEqual(pick(talkParse('sore legs, back and core are fine, chest')), { train: ['Chest'], avoid: ['Legs'], sore: ['Legs'] });
  assert.deepEqual(pick(talkParse('legs and arms are fine')), {});
});

test('#193: "everything is sore" skips every area, so there is nothing to build', () => {
  for (const text of ['everything is sore', 'all sore', 'whole body is sore', "everything's tired", 'my whole body feels wrecked']) {
    assert.deepEqual(talkParse(text).avoid, AREAS, text);
  }
  assert.deepEqual(pick(talkParse('my legs are all sore, chest')), { train: ['Chest'], avoid: ['Legs'], sore: ['Legs'] });
  const talk = talkFromText('everything is sore', base);
  assert.deepEqual(talk.train, []);
  assert.equal(talkConstraints(talk, undefined, lower.focus).focus, undefined, 'no focus: Build stays disabled');
});

test('#193: "everything but legs is sore" trains legs and skips the rest; a denied all-sore skips nothing', () => {
  const five = (out: Area) => AREAS.filter((area) => area !== out);
  assert.deepEqual(pick(talkParse('everything but legs is sore')), { train: ['Legs'], avoid: five('Legs'), sore: five('Legs') });
  assert.deepEqual(pick(talkParse('everything except chest is tired')), { train: ['Chest'], avoid: five('Chest'), sore: five('Chest') });
  assert.deepEqual(pick(talkParse('not everything is sore, legs')), { train: ['Legs'] });
  assert.deepEqual(pick(talkParse('everything but legs')), { train: five('Legs') }, 'without a sore word it still trains the rest');
});

test('#193: "back after a break" and "<area> is fine" train nothing', () => {
  assert.deepEqual(pick(talkParse('back after a break, chest')), { train: ['Chest'] });
  assert.deepEqual(pick(talkParse('legs are fine, chest')), { train: ['Chest'] });
  assert.deepEqual(pick(talkParse('shoulders feel ok')), {});
  assert.deepEqual(pick(talkParse('legs fine, back good, arms')), { train: ['Arms'] });
});

test('#193: in-session swaps on a described day respect the same skip rule', () => {
  const skipped: MuscleGroup[] = ['Back'];
  const profile = withSkipped(gym, skipped);
  for (const id of ['leg-curl', 'hip-thrust', 'glute-bridge', 'back-squat']) {
    const offered = rankedReplacements(exerciseById(id)!, profile, [], 10).map((e) => e.id);
    for (const other of offered) assert.ok(!worksSkipped(exerciseById(other)!, skipped), `${id} offers ${other}`);
  }
  const plain = rankedReplacements(exerciseById('leg-curl')!, gym, [], 10).map((e) => e.id);
  assert.ok(plain.some((other) => worksSkipped(exerciseById(other)!, skipped)), 'without the skip a hinge is offered');
  assert.deepEqual(withSkipped(gym, []), gym);
});

test('#193: a longer time on the planned day builds the longer day, as the length sheet does', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /next\.equipment === 'home' && !next\.focus && next\.minutes === constraints\.minutes \? homeProgram : programFor\(next\)/);
  const home: Profile = { ...gym, daysPerWeek: 3, equipment: ['Dumbbell'], support: ['Bench'], sessionMinutes: 35 };
  const slot = planSlots(buildPlan(home))[0];
  const talk = { ...baseTalk({ minutes: 35, equipment: 'home' }, slot.focus), minutes: 60 };
  const next = talkConstraints(talk, undefined, slot.focus);
  assert.equal(next.focus, undefined);
  const longer = adaptWorkout(todayProgram(home, slot, [], next), next, [], home.goal);
  const saved = adaptWorkout(todayProgram(home, slot, [], { minutes: 35 }), next, [], home.goal);
  assert.ok(longer.totalSets > saved.totalSets, `${longer.totalSets} vs ${saved.totalSets}`);
});

/* ---------- chips ---------- */

test('#193: text fills the chips and the chips stay editable', () => {
  const said = 'Full gym, legs sore, chest and abs, 45 min';
  const talk = composeTalk(base, said, NO_TAPS);
  assert.deepEqual([talk.equipment, talk.minutes, talk.train, talk.skip, talk.pain], ['home', 45, ['Chest', 'Core'], ['Legs'], false]);
  // Tapping a Train chip takes it out of Skip, and the other way round.
  const legsBack = composeTalk(base, said, tapTrain(talk, NO_TAPS, 'Legs'));
  assert.deepEqual([legsBack.train, legsBack.skip, legsBack.sore], [['Chest', 'Legs', 'Core'], [], []]);
  const chestSkipped = composeTalk(base, said, tapSkip(talk, NO_TAPS, 'Chest'));
  assert.deepEqual([chestSkipped.train, chestSkipped.skip], [['Core'], ['Chest', 'Legs']]);
  // Only skips named: the planned areas stay, minus the skipped one.
  assert.deepEqual(talkFromText('legs are sore', base).train, ['Core']);
  assert.deepEqual(talkFromText('', base), base);
  assert.equal(talkFromText('my knee hurts', base).pain, true);
});

test('#193: chip taps made before typing survive typing; text sets only what it changes', () => {
  let taps = NO_TAPS;
  let text = '';
  const type = (next: string) => { taps = tapsAfterEdit(taps, text, next); text = next; return composeTalk(base, text, taps); };
  taps = { ...taps, equipment: 'hotel', minutes: 30 };
  taps = tapSkip(composeTalk(base, text, taps), taps, 'Shoulders');
  let talk = type('chest and abs');
  assert.deepEqual([talk.equipment, talk.minutes, talk.train, talk.skip], ['hotel', 30, ['Chest', 'Core'], ['Shoulders']]);
  talk = type('chest and abs please');
  assert.deepEqual([talk.equipment, talk.minutes], ['hotel', 30], 'typing on keeps the taps');
  talk = type('chest and abs please, 45 min');
  assert.equal(talk.minutes, 45, 'a new time in the text wins over the earlier tap');
  assert.equal(talk.equipment, 'hotel');
  assert.deepEqual(talk.skip, ['Shoulders'], 'an unchanged reading keeps the Skip tap');
  talk = type('chest and abs please, 45 min, shoulders are fine');
  assert.deepEqual(talk.skip, ['Shoulders'], '"shoulders are fine" names them for neither, so the tap stays');
  talk = type('chest and abs please, 45 min, shoulders too');
  assert.deepEqual([talk.train, talk.skip], [['Chest', 'Shoulders', 'Core'], []], 'naming shoulders to train wins over the tap');
  // A new base (gear or time changed in another sheet) shows through where nothing overrides it.
  const moved = composeTalk({ ...base, equipment: 'bodyweight', minutes: 20 }, 'chest', NO_TAPS);
  assert.deepEqual([moved.equipment, moved.minutes], ['bodyweight', 20]);
});

test('#193: the stored focus is Train minus Skip, as muscle groups', () => {
  const said = 'arms, legs sore';
  const first = composeTalk(base, said, NO_TAPS);
  const talk = composeTalk(base, said, tapTrain(first, NO_TAPS, 'Chest'));
  assert.deepEqual([talk.train, talk.skip], [['Chest', 'Arms'], ['Legs']]);
  const constraints = talkConstraints(talk, undefined, lower.focus);
  assert.deepEqual(constraints.focus, ['Chest', 'Biceps', 'Triceps']);
  assert.deepEqual(constraints.skip, LEGS);
  assert.deepEqual([constraints.minutes, constraints.equipment], [60, 'home']);
  assert.equal(customDayName(['Chest', 'Core']), 'Chest + Core');
  assert.equal(customDayName(['Biceps', 'Triceps', 'Quads']), 'Arms + Legs');
});

test('#193: chips equal to the planned day change only gear and time, so the plan moves as usual', () => {
  const talk = talkFromText('hotel gym, 30 min', base);
  assert.deepEqual(talk.train, ['Legs', 'Core']);
  assert.equal(describesDay(talk, lower.focus), false);
  const constraints = talkConstraints(talk, undefined, lower.focus);
  assert.deepEqual(constraints, { minutes: 30, equipment: 'hotel' });
  const state = { profile: gym, plan, history: [], current: null, planRevision: 1, programCursor: { revision: 1, seq: 1 } } as AppState;
  assert.equal(slotLinkFor(state, Boolean(constraints.focus)).slotSeq, 1, 'the session is linked to its slot');
  const { preview } = build('hotel gym, 30 min');
  assert.equal(preview.described, false);
  assert.equal(preview.title, lower.name);
  // Any area change is a described day.
  assert.equal(describesDay(talkFromText('legs', base), lower.focus), true);
  assert.equal(describesDay(talkFromText('core sore', base), lower.focus), true);
});

/* ---------- build ---------- */

function build(text: string, profile = gym, slot = lower) {
  const talk = talkFromText(text, baseTalk({ equipment: 'home', minutes: 60 }, slot.focus));
  const constraints = talkConstraints(talk, undefined, slot.focus);
  const program = todayProgram(profile, slot, [], constraints);
  const adapted = adaptWorkout(program, constraints, [], profile.goal);
  const live = liveAdapted(adapted, profile, []);
  return { talk, constraints, program, adapted, live, preview: customDayPreview(talk, program, live, profile, slot.focus) };
}
const primaryOf = (id: string) => exerciseById(id)!.muscles[0];

test('#193: "Full gym, legs sore, chest and abs, 45 min" builds Chest + Core with no leg work', () => {
  const { program, adapted, preview } = build('Full gym, legs sore, chest and abs, 45 min');
  assert.equal(adapted.name, 'Chest + Core');
  assert.equal(preview.title, 'Chest + Core');
  assert.ok(adapted.exercises.length >= 3, adapted.exercises.map((e) => e.exerciseId).join());
  for (const exercise of adapted.exercises) {
    const meta = exerciseById(exercise.exerciseId)!;
    assert.ok(!worksSkipped(meta, LEGS), `${exercise.exerciseId} works legs`);
    assert.ok(['Chest', 'Core'].includes(meta.muscles[0]), `${exercise.exerciseId} is on focus`);
  }
  assert.ok(adapted.exercises.some((e) => primaryOf(e.exerciseId) === 'Chest'));
  assert.ok(adapted.exercises.some((e) => primaryOf(e.exerciseId) === 'Core'));
  // #203 removed promisedMinutes: todayGlance is the one minutes figure, the preview's included.
  const promised = todayGlance(adapted, null, false, gym.goal).minutes;
  assert.ok(promised <= 45, `promised ${promised}`);
  assert.equal(preview.minutes, promised);
  assert.equal(preview.status, program.feasibility?.status === 'limited' ? 'limited' : 'ready');
  assert.deepEqual(preview.why[0], { label: 'Skipped:', text: 'Legs, because you said sore.' });
  assert.deepEqual(preview.gaps, []);
  assert.equal(preview.gear, 'Your gym');
  assert.equal(preview.described, true);
  assert.ok(preview.why.some((line) => line.text === 'includes a 5-minute warm-up and rest by exercise.'));
});

test('#193: "back is sore, legs" leaves out every exercise that works the back', () => {
  const { adapted, preview } = build('back is sore, legs');
  const ids = adapted.exercises.map((e) => e.exerciseId);
  for (const id of ['deadlift', 'good-morning', 'romanian-deadlift', 'dumbbell-romanian-deadlift', 'kettlebell-swing']) {
    assert.ok(!ids.includes(id), `${id} works a sore back: ${ids.join()}`);
  }
  for (const id of ids) assert.ok(!worksSkipped(exerciseById(id)!, ['Back']), id);
  assert.ok(ids.some((id) => exerciseById(id)!.pattern === 'squat'), ids.join());
  assert.deepEqual(preview.why[0], { label: 'Skipped:', text: 'Back, because you said sore.' });
  assert.ok(preview.why.every((line) => !/deadlift/i.test(line.text)));
});

test('#193: the skip rule — first or second listed muscle, every listed muscle on a hinge, never a trailing Core, arms only first', () => {
  const ex = (id: string) => exerciseById(id)!;
  assert.equal(worksSkipped(ex('romanian-deadlift'), ['Back']), true, 'hinge, Back listed third');
  assert.equal(worksSkipped(ex('chin-up'), ['Back']), true, 'Back listed second');
  assert.equal(worksSkipped(ex('barbell-bench-press'), ['Shoulders']), false, 'Shoulders listed third on a press');
  assert.equal(worksSkipped(ex('incline-dumbbell-press'), ['Shoulders']), true);
  assert.equal(worksSkipped(ex('back-squat'), ['Core']), false, 'a trailing Core is the brace');
  assert.equal(worksSkipped(ex('deadlift'), ['Core']), false);
  assert.equal(worksSkipped(ex('plank'), ['Core']), true);
  assert.equal(worksSkipped(ex('deadlift'), ['Hamstrings']), true);
  // Arms count only when listed first: sore arms skip arm work, not every press and row.
  const arms: MuscleGroup[] = ['Biceps', 'Triceps'];
  for (const id of ['barbell-bench-press', 'dumbbell-bench-press', 'push-up', 'dip', 'barbell-row', 'lat-pulldown', 'overhead-press']) {
    assert.equal(worksSkipped(ex(id), arms), false, id);
  }
  for (const id of ['barbell-curl', 'hammer-curl', 'triceps-pushdown', 'skull-crusher', 'chin-up', 'close-grip-bench', 'diamond-push-up']) {
    assert.equal(worksSkipped(ex(id), arms), true, id);
  }
});

test('#193: "back" as an adverb trains nothing', () => {
  for (const text of ['back at the gym, chest', 'back home today, chest', 'back to it, chest', 'back in the gym, chest', 'get back into it, chest', 'came back from a trip, chest']) {
    assert.deepEqual(talkParse(text).train, ['Chest'], text);
    assert.equal(talkParse(text).avoid, undefined, text);
  }
  assert.deepEqual(talkParse('back and chest').train, ['Chest', 'Back']);
  assert.deepEqual(talkParse('back is sore, legs').avoid, ['Back']);
  assert.deepEqual(talkParse('my back, at the gym').train, ['Back']);
});

test('#193: "arms are sore, chest and back" keeps presses and rows, and drops arm work', () => {
  const upper = planSlots(plan)[0];
  // "sore arms, chest and back" is one list, all sore; this says only the arms are.
  assert.deepEqual(talkParse('sore arms, chest and back').avoid, ['Chest', 'Back', 'Arms']);
  const { adapted, preview } = build('arms are sore, chest and back', gym, upper);
  const ids = adapted.exercises.map((e) => e.exerciseId);
  assert.ok(ids.some((id) => exerciseById(id)!.pattern === 'horizontal_push'), ids.join());
  assert.ok(ids.some((id) => ['horizontal_pull', 'vertical_pull'].includes(exerciseById(id)!.pattern)), ids.join());
  for (const id of ids) assert.ok(!['Biceps', 'Triceps'].includes(primaryOf(id)), id);
  assert.deepEqual(preview.gaps, []);
  assert.equal(preview.status, 'ready');
});

const SETUPS: EquipmentChoice[] = ['home', 'hotel', 'bodyweight'];
const subsets = (items: Area[]) => items.reduce<Area[][]>((all, item) => all.concat(all.map((set) => [...set, item])), [[]]);

/** "No hamstring work": a muscle as the why lines name it (#211). */
const MUSCLE_WORD: Record<MuscleGroup, string> = {
  Chest: 'chest', Back: 'back', Shoulders: 'shoulder', Biceps: 'biceps', Triceps: 'triceps',
  Quads: 'quad', Hamstrings: 'hamstring', Glutes: 'glute', Calves: 'calf', Core: 'core',
};

test('#211: sweep — every muscle of an asked area is trained or named, no skipped area trained, no day over its length', () => {
  const trainSets = subsets(AREAS).filter((set) => set.length > 0);
  let checked = 0;
  for (const setup of SETUPS) {
    const kit = kitProfile(gym, setup);
    const caps = capabilitiesFor(kit);
    for (const minutes of [30, 45, 60]) {
      for (const train of trainSets) {
        for (const skip of [[], ...AREAS.filter((area) => !train.includes(area)).map((area) => [area])] as Area[][]) {
          const talk: TalkState = { equipment: setup, minutes, train, skip, sore: skip, pain: false, notices: [] };
          const constraints = talkConstraints(talk, undefined, lower.focus);
          if (!constraints.focus) continue;
          const program = todayProgram(gym, lower, [], constraints);
          const live = liveAdapted(adaptWorkout(program, constraints, [], gym.goal), gym, []);
          const preview = customDayPreview(talk, program, live, gym, lower.focus);
          const at = `${setup} ${minutes} ${train}/${skip}: ${live.exercises.map((e) => e.exerciseId)}`;
          const skipped = musclesOf(skip);
          for (const exercise of live.exercises) {
            assert.ok(!worksSkipped(exerciseById(exercise.exerciseId)!, skipped), `${at} works a skipped area`);
          }
          const why = preview.why.map((line) => `${line.label} ${line.text}`).join(' ');
          // #216: a described day is never empty while the kit has an allowed exercise for an asked muscle,
          // and an empty one never blames time.
          if (live.exercises.length === 0) {
            const doable = musclesOf(train).filter((muscle) => EXERCISES.some((exercise) => exercise.muscles[0] === muscle
              && provides(caps, exercise.needs) && !worksSkipped(exercise, skipped)));
            assert.deepEqual(doable, [], `${at}: empty beside allowed ${doable} work`);
            assert.ok(preview.why.every((line) => line.label !== 'Not enough time:'), `${at}: empty day blames time: ${why}`);
          }
          for (const area of train) {
            for (const muscle of AREA_MUSCLES[area]) {
              const trained = live.exercises.some((e) => primaryOf(e.exerciseId) === muscle);
              const gap = preview.gaps.find((item) => item.muscle === muscle);
              assert.ok(trained !== Boolean(gap), `${at}: ${muscle} trained=${trained} named=${Boolean(gap)}`);
              if (!gap) continue;
              assert.equal(gap.area, area);
              assert.notEqual(preview.status, 'ready', `${at}: ${muscle} uncovered reads Ready`);
              if (live.exercises.length > 0) assert.equal(preview.status, 'limited', at);
              assert.ok(new RegExp(`\\b${MUSCLE_WORD[muscle]}\\b`).test(why), `${at}: why never names ${muscle}: ${why}`);
              // The cause is the real one: the kit has no such exercise, the skip rules out every one, its only
              // moves repeat one in the day, the day holds its most exercises, or time.
              const possible = EXERCISES.filter((exercise) => exercise.muscles[0] === muscle && provides(caps, exercise.needs));
              const allowed = possible.filter((exercise) => !worksSkipped(exercise, skipped));
              const cause = possible.length === 0 ? 'gear' : allowed.length === 0 ? 'skip'
                : allowed.every((exercise) => live.exercises.some((e) => areIncompatible(e.exerciseId, exercise.id))) ? 'twin'
                : live.exercises.length >= MAX_EXERCISES[gym.experience] ? 'cap' : 'time';
              assert.equal(gap.cause, cause, `${at}: ${muscle}`);
              // Covering comes before a second exercise for an asked muscle: time leaves a muscle out
              // only when no asked muscle has two exercises.
              if (cause === 'time') {
                const asked = musclesOf(train);
                const doubled = asked.filter((item) => live.exercises.filter((e) => primaryOf(e.exerciseId) === item).length > 1);
                assert.deepEqual(doubled, [], `${at}: ${muscle} left out for time beside a second ${doubled}`);
              }
            }
          }
          assert.ok(preview.minutes <= minutes, `${at}: ${preview.minutes} min`);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 2232);
});

test('#216: an Arms day with Chest skipped at the travel gym builds curls and extensions that spare the chest', () => {
  for (const minutes of [30, 45, 60]) {
    const talk: TalkState = { equipment: 'hotel', minutes, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] };
    const constraints = talkConstraints(talk, undefined, lower.focus);
    const program = todayProgram(gym, lower, [], constraints);
    const live = liveAdapted(adaptWorkout(program, constraints, [], gym.goal), gym, []);
    const preview = customDayPreview(talk, program, live, gym, lower.focus);
    const ids = live.exercises.map((e) => e.exerciseId);
    const at = `${minutes} min: ${ids.join()}`;
    assert.ok(ids.some((id) => primaryOf(id) === 'Biceps'), at);
    assert.ok(ids.some((id) => primaryOf(id) === 'Triceps'), at);
    for (const id of ids) assert.ok(!worksSkipped(exerciseById(id)!, ['Chest']), `${at}: ${id} works the chest`);
    assert.ok(preview.minutes > 0 && preview.minutes <= minutes, `${at}: ${preview.minutes} min`);
    assert.deepEqual(preview.gaps, [], at);
    // Every asked muscle is trained, so the day is Ready (#219): the generator's planned-day
    // requirements (no press or pull) are not what the lifter asked for, and never show.
    assert.equal(preview.status, 'ready', at);
    assert.equal(program.feasibility?.reason, 'Limited session: no pressing and pulling work is available with these constraints.', at);
    assert.ok(preview.why.every((line) => line.label !== 'Not enough time:'), JSON.stringify(preview.why));
  }
});

test('#216: an empty described day never blames time or the cap', () => {
  const talk: TalkState = { equipment: 'hotel', minutes: 60, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] };
  const constraints = talkConstraints(talk, undefined, lower.focus);
  const program = todayProgram(gym, lower, [], constraints);
  const adapted = adaptWorkout(program, constraints, [], gym.goal);
  const empty = { ...adapted, exercises: [], totalSets: 0 };
  const preview = customDayPreview(talk, { ...program, exercises: [] }, empty, gym, lower.focus);
  assert.equal(preview.status, 'none');
  assert.ok(preview.gaps.length > 0 && preview.gaps.every((gap) => gap.cause !== 'time' && gap.cause !== 'cap'), JSON.stringify(preview.gaps));
  assert.ok(preview.why.every((line) => line.label !== 'Not enough time:'), JSON.stringify(preview.why));
});

test('#211: "back is sore, legs, 45 min" at a full gym trains hamstrings, not a second quad move', () => {
  const { live, preview } = build('back is sore, legs, 45 min');
  const ids = live.exercises.map((e) => e.exerciseId);
  for (const muscle of LEGS) assert.ok(ids.some((id) => primaryOf(id) === muscle), `${muscle}: ${ids.join()}`);
  for (const id of ids) assert.ok(!worksSkipped(exerciseById(id)!, ['Back']), id);
  assert.equal(preview.status, 'ready');
  assert.deepEqual(preview.gaps, []);
  assert.ok(preview.minutes <= 45, `${preview.minutes} min`);
});

test('#211: a muscle left out by the exercise cap names the cap, not time', () => {
  const run = (profile: Profile) => {
    const talk: TalkState = { equipment: 'home', minutes: 90, train: ['Chest', 'Shoulders', 'Arms', 'Legs', 'Core'], skip: [], sore: [], pain: false, notices: [] };
    const constraints = talkConstraints(talk, undefined, lower.focus);
    const program = todayProgram(profile, lower, [], constraints);
    return customDayPreview(talk, program, adaptWorkout(program, constraints, [], profile.goal), profile, lower.focus);
  };
  for (const [experience, cap] of [['Intermediate', 8], ['Beginner', 6]] as const) {
    const preview = run({ ...gym, experience });
    assert.equal(preview.exercises.length, cap, experience);
    assert.equal(preview.status, 'limited');
    assert.ok(preview.gaps.length > 0 && preview.gaps.every((gap) => gap.cause === 'cap'), JSON.stringify(preview.gaps));
    const line = preview.why.find((item) => item.label === `Room for ${cap} exercises:`);
    assert.ok(line && /^no .+ work today\.$/.test(line.text), JSON.stringify(preview.why));
    assert.ok(preview.why.every((item) => item.label !== 'Not enough time:'), JSON.stringify(preview.why));
  }
});

test('#211: a muscle whose only move repeats one in the day says so', () => {
  const talk: TalkState = { equipment: 'bodyweight', minutes: 45, train: ['Chest', 'Arms'], skip: [], sore: [], pain: false, notices: [] };
  const constraints = talkConstraints(talk, undefined, lower.focus);
  const program = todayProgram(gym, lower, [], constraints);
  const preview = customDayPreview(talk, program, adaptWorkout(program, constraints, [], gym.goal), gym, lower.focus);
  assert.deepEqual(preview.exercises.map((e) => e.exerciseId), ['push-up']);
  assert.deepEqual(preview.gaps.find((gap) => gap.muscle === 'Triceps'),
    { area: 'Arms', muscle: 'Triceps', cause: 'twin', repeats: { exercise: 'Diamond Push-Up', of: 'Push-Up' } });
  assert.ok(preview.why.some((line) => line.label === 'No separate triceps move:' && line.text === 'Diamond Push-Up repeats Push-Up.'), JSON.stringify(preview.why));
  assert.ok(preview.why.every((line) => !/triceps exercise with this gear/.test(line.text)), JSON.stringify(preview.why));
});

test('#193: an asked area with no exercise reads Limited and names the cause', () => {
  const upper = planSlots(plan)[0];
  // Time: three areas at 45 minutes.
  const timed = (() => {
    for (const minutes of [30, 45]) {
      const talk: TalkState = { equipment: 'home', minutes, train: ['Chest', 'Shoulders', 'Legs'], skip: [], sore: [], pain: false, notices: [] };
      const constraints = talkConstraints(talk, undefined, upper.focus);
      const program = todayProgram(gym, upper, [], constraints);
      const preview = customDayPreview(talk, program, adaptWorkout(program, constraints, [], gym.goal), gym, upper.focus);
      if (preview.gaps.length) return { preview, minutes };
    }
    return null;
  })();
  assert.ok(timed, 'some asked area is cut for time');
  assert.equal(timed.preview.status, 'limited');
  assert.ok(timed.preview.gaps.every((gap) => gap.cause === 'time'));
  assert.ok(timed.preview.why.some((line) => line.label === 'Not enough time:' && new RegExp(`fit in ${timed.minutes} min\\.$`).test(line.text)), JSON.stringify(timed.preview.why));
  // Gear: bodyweight has no back exercise without a bar.
  const { preview: gear, adapted } = build('bodyweight, back and core, 30 min');
  assert.ok(adapted.exercises.every((e) => primaryOf(e.exerciseId) === 'Core'), 'nothing pads the gap');
  assert.deepEqual(gear.gaps, [{ area: 'Back', muscle: 'Back', cause: 'gear' }]);
  assert.deepEqual(gear.why.find((line) => line.label === 'Not possible here:'), { label: 'Not possible here:', text: 'no back exercise with this gear.' });
  assert.equal(gear.status, 'limited');
  // Skip: sore arms leave a home chest with nothing that spares them.
  const home: Profile = { ...gym, equipment: ['Dumbbell'], support: [] };
  const arms = build('arms sore, chest', home);
  if (arms.preview.gaps.some((gap) => gap.area === 'Chest')) {
    assert.deepEqual(arms.preview.gaps, [{ area: 'Chest', muscle: 'Chest', cause: 'skip' }]);
    assert.ok(arms.preview.why.some((line) => line.label === 'Not possible today:'));
  }
});

test('#193: "Skipped" names soreness only when soreness was the reason', () => {
  assert.deepEqual(build('skip legs, chest').preview.why[0], { label: 'Skipped:', text: 'Legs.' });
  assert.deepEqual(build('legs sore, skip back, chest').preview.why[0], { label: 'Skipped:', text: 'Back, Legs (sore).' });
  const talk = talkFromText('chest', base);
  const tapped = composeTalk(base, 'chest', tapSkip(talk, NO_TAPS, 'Legs'));
  assert.deepEqual(tapped.sore, []);
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

test('a sore word anywhere in the few words after "everything but" makes the rest the sore part (#193)', async () => {
  const { talkParse } = await import('../src/lib/todayTalk.ts');
  for (const text of ['everything but legs is really sore', 'everything but legs is pretty tired', 'everything but legs, sore']) {
    const read = talkParse(text);
    assert.deepEqual(read.train, ['Legs'], text);
    assert.deepEqual([...(read.avoid ?? [])].sort(), ['Arms', 'Back', 'Chest', 'Core', 'Shoulders'], text);
  }
  assert.deepEqual(talkParse('everything but legs, 45 min').train, ['Chest', 'Back', 'Shoulders', 'Arms', 'Core']);
  assert.equal(talkParse('everything but legs, 45 min').minutes, 45, 'the words after the list still count');
});

test('the "everything but" list ends at a comma, so an area after it gets its own sore reading (#193)', async () => {
  const { talkParse } = await import('../src/lib/todayTalk.ts');
  assert.deepEqual(talkParse('everything but legs, chest sore').train, ['Legs']);
  assert.ok(talkParse('everything but legs, chest sore').avoid?.includes('Chest'));
  assert.deepEqual(talkParse('anything except chest, arms tired').train, ['Chest']);
  assert.ok(talkParse('anything except chest, arms tired').avoid?.includes('Arms'));
});

/* ---------- merge with #188 / #203 ---------- */

test('#193 with #188: a described day on a no-gear profile\'s saved bodyweight setup is no gear rebuild', async () => {
  const { defaultConstraints } = await import('../src/lib/constraints.ts');
  const { withoutCustomDay } = await import('../src/lib/plan.ts');
  const noGear: Profile = { ...gym, equipment: [], support: [], sessionMinutes: 35 };
  const slot = planSlots(buildPlan(noGear))[0];
  const saved = defaultConstraints(noGear);
  assert.equal(saved.equipment, 'bodyweight');
  const talk = talkFromText('chest and abs', baseTalk(saved, slot.focus));
  const constraints = talkConstraints(talk, undefined, slot.focus);
  assert.ok(constraints.focus?.length, 'a described day');
  const program = todayProgram(noGear, slot, [], constraints);
  assert.equal(program.setup, undefined, 'the saved setup is never a gear rebuild');
  const adapted = adaptWorkout(program, constraints, [], noGear.goal);
  assert.equal(adapted.setup, undefined);
  assert.doesNotMatch(adapted.note, /rebuilt/);
  assert.ok(liveExercises(adapted, noGear, []).every((exercise) => exercise.setup === undefined), 'its sets read as the saved setup');
  // The preview names the minutes Today will (#203).
  const preview = customDayPreview(talk, program, liveAdapted(adapted, noGear, []), noGear, slot.focus);
  const glance = todayGlance(adapted, null, false, noGear.goal);
  assert.deepEqual([preview.minutes, preview.approx], [glance.minutes, glance.approx]);
  // Finishing it leaves no override behind: bodyweight at the saved length is the saved day.
  const override: TodayOverride = { date: '2026-11-07', minutes: 35, equipment: [], support: [], appliedAt: '2026-11-07T10:00:00.000Z',
    choice: 'bodyweight', focus: constraints.focus!, ...(constraints.skip ? { skip: constraints.skip } : {}) };
  assert.equal(withoutCustomDay({ profile: noGear, todayOverride: override } as AppState).todayOverride, null);
});
