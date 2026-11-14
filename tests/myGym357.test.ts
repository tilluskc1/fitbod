import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { EXERCISES, exerciseById } from '../src/data/exercises.ts';
import { GYM_ITEMS, GYM_ITEM_IDS, gymPatch, initialTicks, showsMyGym } from '../src/data/gymItems.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { Constraints } from '../src/lib/adapt.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { readGymText } from '../src/lib/gymText.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { kitProfile, planSlots, revisePlan, todayProgram, updateProfile } from '../src/lib/sequence.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { startPairs } from '../src/lib/supersets.ts';
import { PRESETS, NO_PICKS, pickConstraints, pickPreset } from '../src/lib/switchPick.ts';
import { parseState, validateState } from '../src/lib/validate.ts';
import type { AppState, GymItemId, Profile, WorkoutRecord } from '../src/types.ts';
import { KITS, LENGTHS, LEVELS, SPLITS, profileOf, sweep } from './myGym357Sweep.ts';

/* #357: "My gym": say or tick which machines the gym has, and plan only with those. */

const FIXTURE = new URL('./fixtures/myGym357-main.json.gz', import.meta.url);
const ALL_BUT = (...drop: GymItemId[]) => GYM_ITEM_IDS.filter((id) => !drop.includes(id));

const gym: Profile = profileOf(KITS.gym, 'Intermediate', 4, 45);

test('#357 the 4-item sentence ticks exactly those 4 items', () => {
  assert.deepEqual(readGymText('leg extension, leg curl, dumbbells, cable stack'), ['leg-extension', 'leg-curl', 'cable-stack', 'dumbbells']);
});

const PHRASINGS: [string, GymItemId[]][] = [
  ['leg ext', ['leg-extension']],
  ['Leg Extensions and leg curls', ['leg-extension', 'leg-curl']],
  ['hamstring curl', ['leg-curl']],
  ['lat pull down', ['lat-pulldown']],
  ['lat pulldown', ['lat-pulldown']],
  ['Lat pull-down', ['lat-pulldown']],
  ['smith', ['smith-machine']],
  ['a Smith machine', ['smith-machine']],
  ['leg press', ['leg-press']],
  ['legpress & hack squat', ['leg-press', 'hack-squat']],
  ['pec deck', ['pec-deck']],
  ['chest press machine', ['chest-press']],
  ['bench press machine', ['chest-press']],
  ['seated cable row', ['seated-row']],
  ['rowing machine', []],
  ['cable crossover', ['cable-crossover']],
  ['functional trainer', ['cable-crossover']],
  ['cables', ['cable-stack']],
  ['DBs and KBs', ['dumbbells', 'kettlebells']],
  ['kettle bells', ['kettlebells']],
  ['power rack', ['squat-rack']],
  ['barbell and squat rack', ['barbell', 'squat-rack']],
  ['pull-up bar', ['pull-up-bar']],
  ['chin up bar', ['pull-up-bar']],
  ['dip station', ['dip-bars']],
  ['power tower', ['pull-up-bar', 'dip-bars']],
  ['plyo box', ['box']],
  ['ab roller', ['ab-wheel']],
  ['assisted pull up machine', ['assisted-pull-up']],
  ['calf raise machine', ['calf-raise-machine']],
  ['glute drive', ['hip-thrust-machine']],
  ['shoulder press machine', ['shoulder-press-machine']],
  ['dumbbells to 30 kg', ['dumbbells']],
  ['adjustable bench', ['bench']],
  ['calf raises', ['calf-raise-machine']],
  ['pull-ups and chin-ups', ['pull-up-bar']],
  ['a dip', ['dip-bars']],
  ['dumbbell rack', ['dumbbells']],
  ['leg curl, no leg press', ['leg-curl']],
  ['everything except a smith machine', []],
  ['dumbbells but no barbell', ['dumbbells']],
  ["we don't have a leg press", []],
  ['everything but the smith machine', []],
  [
    'leg extension, leg curl, leg press, dumbbells to 30 kg, barbell and squat rack, cable stack, pull-up bar',
    ['leg-press', 'leg-extension', 'leg-curl', 'cable-stack', 'dumbbells', 'barbell', 'squat-rack', 'pull-up-bar'],
  ],
];

for (const [text, expected] of PHRASINGS) {
  test(`#357 reads "${text}"`, () => {
    assert.deepEqual(readGymText(text), expected);
  });
}

test('#357 text that names nothing reads as nothing, never a guess', () => {
  for (const text of ['', '   ', 'treadmills and bikes', 'a nice sauna', 'lots of stuff', 'energy']) {
    assert.deepEqual(readGymText(text), [], text);
  }
});

test('#357 every Machine and Cable exercise names a listed item; nothing else does', () => {
  for (const exercise of EXERCISES) {
    const station = exercise.equipment === 'Machine' || exercise.equipment === 'Cable';
    assert.equal(Boolean(exercise.stations?.length), station, exercise.id);
    for (const item of exercise.stations ?? []) assert.ok(GYM_ITEM_IDS.includes(item), `${exercise.id} ${item}`);
  }
  assert.equal(GYM_ITEMS.length, 24);
});

test('#357 saving the list sets the families and support it implies', () => {
  const patch = gymPatch(['cable-stack', 'leg-curl', 'dumbbells', 'leg-extension']);
  assert.deepEqual(patch, {
    gymItems: ['leg-extension', 'leg-curl', 'cable-stack', 'dumbbells'],
    equipment: ['Dumbbell', 'Machine', 'Cable'],
    support: [],
  });
  assert.deepEqual(gymPatch(['lat-pulldown', 'squat-rack', 'barbell']).equipment, ['Barbell', 'Cable']);
  assert.deepEqual(gymPatch(['lat-pulldown', 'squat-rack', 'barbell']).support, ['Rack']);
});

test('#357 the sheet opens with the saved free weights and stations, and the list machines (none without one)', () => {
  // Review 1: a first save must not drop the Barbell, Rack and Bench the lifter already had.
  assert.deepEqual(initialTicks(gym), ['dumbbells', 'barbell', 'kettlebells', 'squat-rack', 'bench', 'pull-up-bar', 'dip-bars', 'box', 'ab-wheel']);
  assert.deepEqual(initialTicks(profileOf(KITS.machines, 'Beginner', 3, 45)), ['dumbbells', 'bench']);
  const typedOnly = gymPatch([...initialTicks(gym), ...readGymText('leg extension, leg curl, dumbbells, cable stack')]);
  assert.deepEqual(typedOnly.equipment, gym.equipment, 'typing only machines keeps every saved family');
  assert.deepEqual(typedOnly.support, gym.support);
  const saved = { ...gym, ...gymPatch(['leg-curl', 'dumbbells', 'bench']) };
  assert.deepEqual(initialTicks(saved), ['leg-curl', 'dumbbells', 'bench']);
  // Settings' Dumbbell chip turned off afterwards: the sheet follows the family.
  assert.deepEqual(initialTicks({ ...saved, equipment: ['Machine'] }), ['leg-curl', 'bench']);
});

test('#357 the row shows for gym kits and saved lists, not home or bodyweight', () => {
  assert.equal(showsMyGym(gym), true);
  assert.equal(showsMyGym(profileOf(KITS.home, 'Beginner', 3, 45)), false);
  assert.equal(showsMyGym(profileOf(KITS.bodyweight, 'Beginner', 3, 45)), false);
  assert.equal(showsMyGym({ ...profileOf(KITS.home, 'Beginner', 3, 45), gymItems: [] }), true);
  // Review 2: home gear with a cable stack is still home gear; its rack keeps being read.
  assert.equal(showsMyGym(profileOf(KITS.machines, 'Beginner', 3, 45)), false);
  assert.equal(showsMyGym({ ...profileOf(KITS.home, 'Beginner', 3, 45), equipment: ['Dumbbell', 'Cable'] }), false);
});

test('#357 absent field = identical plans, Limited lines and swaps to main eed9fd9 (snapshot)', () => {
  const main = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()) as Record<string, string>;
  const now = sweep();
  assert.equal(now.length, Object.keys(main).length);
  const differ = now.filter((item) => main[item.key] !== item.text).map((item) => item.key);
  assert.deepEqual(differ, []);
});

test('#357 Leg press unticked: no plan, swap or described day ever includes Leg Press', () => {
  const cases = sweep(() => ({ gymItems: ALL_BUT('leg-press') }), ['gym', 'machines']);
  const hits = cases.filter((item) => item.ids.includes('leg-press')).map((item) => item.key);
  assert.deepEqual(hits, []);
  // The sweep can see Leg Press when it is listed, so the empty result above means something.
  const listed = sweep(() => ({ gymItems: [...GYM_ITEM_IDS] }), ['gym', 'machines']);
  assert.ok(listed.some((item) => item.ids.includes('leg-press')));
});

test('#357 Leg press unticked: Switch presets and every Replace from a full gym day skip it', () => {
  for (const level of LEVELS) for (const days of SPLITS) for (const minutes of LENGTHS) {
    const profile = profileOf(KITS.gym, level, days, minutes, { gymItems: ALL_BUT('leg-press') });
    const slot = planSlots(buildPlan(profile))[0];
    for (const preset of PRESETS) {
      const next = pickConstraints(pickPreset(NO_PICKS, preset), { minutes, equipment: 'home' }, slot.focus, minutes);
      const program = todayProgram(profile, slot, [], next);
      const ids = adaptWorkout(program, next, profile.exclusions, profile.goal, profile).exercises.map((exercise) => exercise.exerciseId);
      assert.ok(!ids.includes('leg-press'), `${level} ${days} ${minutes} ${preset}`);
    }
    // Replace from any squat in the catalog, in an otherwise empty day.
    for (const exercise of EXERCISES.filter((item) => item.muscles[0] === 'Quads')) {
      assert.ok(!rankedReplacements(exercise, profile, [exercise], EXERCISES.length).some((item) => item.id === 'leg-press'));
    }
  }
});

test('#357 a machines-only list plans only the listed machines and cables', () => {
  const listed: GymItemId[] = ['leg-extension', 'leg-curl', 'cable-stack', 'dumbbells'];
  const allowed = new Set(['leg-extension', 'leg-curl']);
  for (const level of LEVELS) for (const days of SPLITS) for (const minutes of LENGTHS) {
    const profile = { ...profileOf(KITS.gym, level, days, minutes), ...gymPatch(listed) };
    buildPlan(profile).forEach((day, index) => {
      for (const entry of generateWorkout(profile, day, index, []).exercises) {
        const exercise = exerciseById(entry.exerciseId)!;
        if (exercise.equipment === 'Machine') assert.ok(allowed.has(exercise.id), `${exercise.id} ${day.name}`);
        if (exercise.equipment === 'Cable') assert.ok(exercise.stations!.includes('cable-stack'), `${exercise.id} ${day.name}`);
        assert.ok(['Dumbbell', 'Machine', 'Cable', 'Bodyweight'].includes(exercise.equipment), exercise.id);
        assert.ok(exercise.needs.every((need) => ['dumbbell', 'machine', 'cable'].includes(need)), `${exercise.id} needs ${exercise.needs}`);
      }
    });
  }
});

test('#357 a list with no squat option: Legs is Limited with its reason and the gear fix, never padded', () => {
  // Bodyweight squats need no kit, so this lifter has also excluded them to reach "no squat at all".
  const profile: Profile = {
    ...profileOf(KITS.gym, 'Intermediate', 6, 60),
    ...gymPatch(['leg-extension', 'leg-curl', 'calf-raise-machine', 'cable-stack', 'pull-up-bar']),
    exclusions: ['bodyweight-squat', 'bodyweight-lunge'],
  };
  const plan = buildPlan(profile);
  const index = plan.findIndex((day) => day.name.toLowerCase().startsWith('legs'));
  assert.ok(index >= 0);
  const day = plan[index];
  const session = generateWorkout(profile, day, index, []);
  assert.equal(session.feasibility.status, 'limited');
  assert.match(session.feasibility.reason, /no squat/i);
  const fix = session.feasibility.alternatives.find((alt) => alt.gymItem === 'leg-press');
  assert.ok(fix, session.feasibility.alternatives.map((alt) => alt.label).join(', '));
  assert.equal(fix.label, 'Add Leg press');
  assert.equal(fix.kind, 'capability', 'opens Settings like the #219 gear chips');
  // Not padded: nothing off the day stands in for the squat, and no squat appears from nowhere.
  assert.ok(!session.exercises.some((entry) => ['squat', 'lunge'].includes(exerciseById(entry.exerciseId)!.pattern)));
  for (const entry of session.exercises) {
    assert.ok(day.focus.includes(exerciseById(entry.exerciseId)!.muscles[0]) || exerciseById(entry.exerciseId)!.pattern === 'hinge', entry.exerciseId);
  }
  // Without the list the same profile's family check would never offer a list item.
  const legacy = generateWorkout({ ...profile, gymItems: undefined }, day, index, []);
  assert.ok(!legacy.feasibility.alternatives.some((alt) => alt.gymItem));
});

test('#357 a list without Machine offers the item, never "Add Machine" (which would unlock nothing)', () => {
  const profile: Profile = { ...profileOf(KITS.gym, 'Intermediate', 6, 60), ...gymPatch(['pull-up-bar']), exclusions: ['bodyweight-squat', 'bodyweight-lunge'] };
  const plan = buildPlan(profile);
  const index = plan.findIndex((day) => day.name.toLowerCase().startsWith('legs'));
  const alts = generateWorkout(profile, plan[index], index, []).feasibility.alternatives;
  assert.ok(!alts.some((alt) => alt.capability === 'machine'), alts.map((alt) => alt.label).join(', '));
  assert.ok(alts.some((alt) => alt.gymItem === 'leg-press'), alts.map((alt) => alt.label).join(', '));
});

test('#357 validate: absent stays absent, unknown ids reject, duplicates drop; export/restore round-trips', () => {
  const state: AppState = revisePlan({ ...EMPTY_STATE }, { ...gym, ...gymPatch(['leg-press', 'dumbbells', 'leg-press' as GymItemId]) });
  const parsed = parseState(serializeExport(state, '2026-11-14T10:00:00.000Z'));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.state.profile!.gymItems, ['leg-press', 'dumbbells']);

  const legacy = parseState(serializeExport(revisePlan({ ...EMPTY_STATE }, gym), '2026-11-14T10:00:00.000Z'));
  assert.ok(legacy.ok);
  assert.equal('gymItems' in legacy.state.profile!, false, 'an older backup restores without the field');

  const bad = (gymItems: unknown) => validateState({ ...JSON.parse(JSON.stringify(state)), profile: { ...state.profile, gymItems } });
  assert.equal(bad(['leg-press', 'rocket-sled']).ok, false);
  assert.equal(bad('leg-press').ok, false);
  assert.equal(bad([3]).ok, false);
  const dup = bad(['dumbbells', 'leg-press', 'dumbbells']);
  assert.ok(dup.ok);
  assert.deepEqual(dup.state.profile!.gymItems, ['leg-press', 'dumbbells']);
  assert.deepEqual((bad([]) as { ok: true; state: AppState }).state.profile!.gymItems, []);
});

test('#357 today-only gear wins for the day; the saved list is untouched', () => {
  const profile: Profile = { ...gym, ...gymPatch(['leg-press', 'leg-extension', 'cable-stack', 'dumbbells', 'bench', 'barbell', 'squat-rack']) };
  const before = JSON.stringify(profile);
  const slot = planSlots(buildPlan(profile)).find((item) => item.name.toLowerCase().includes('lower')) ?? planSlots(buildPlan(profile))[0];
  for (const equipment of ['hotel', 'bodyweight', 'bands'] as const) {
    const next: Constraints = { minutes: 45, equipment };
    const ids = adaptWorkout(todayProgram(profile, slot, [], next), next, profile.exclusions, profile.goal, profile).exercises.map((item) => item.exerciseId);
    assert.ok(ids.length > 0, equipment);
    for (const id of ids) assert.ok(!['Machine', 'Cable', 'Barbell'].includes(exerciseById(id)!.equipment), `${equipment} ${id}`);
    assert.deepEqual(kitProfile(profile, equipment).gymItems, profile.gymItems);
  }
  // The saved setup reads the list.
  const home: Constraints = { minutes: 45, equipment: 'home' };
  const homeIds = adaptWorkout(todayProgram(profile, slot, [], home), home, profile.exclusions, profile.goal, profile).exercises.map((item) => item.exerciseId);
  assert.ok(!homeIds.includes('leg-curl'));
  assert.equal(JSON.stringify(profile), before);
});

function running(profile: Profile): AppState {
  const state = revisePlan({ ...EMPTY_STATE }, profile);
  const slot = planSlots(state.plan)[1];
  const program = todayProgram(profile, slot, [], { minutes: 30, equipment: 'home' });
  const workout = adaptWorkout(program, { minutes: 30, equipment: 'home' }, profile.exclusions, profile.goal, profile);
  const exercises = startPairs(workout.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    planned: Array.from({ length: exercise.sets }, () => ({ weight: 0, reps: 10 })),
    performed: Array.from({ length: exercise.sets }, () => ({ weight: 0, reps: 10, done: false, completedAt: null })),
  })), profile, 30);
  const current: WorkoutRecord = {
    id: 's1', date: '2026-11-14T09:00:00.000Z', name: slot.name, dayIndex: 1, status: 'active', completedEarly: false, endedAt: null, exercises,
  };
  return { ...state, current };
}

test('#357 a running session keeps its exercises and pairs when the list changes; the next start never pairs a removed exercise', () => {
  const profile: Profile = { ...profileOf(KITS.gym, 'Intermediate', 4, 30) };
  const state = running(profile);
  const ids = state.current!.exercises.map((exercise) => exercise.exerciseId);
  assert.ok(state.current!.exercises.some((exercise) => exercise.pair !== undefined), 'the fixture runs a paired day');
  const machine = ids.find((id) => exerciseById(id)!.stations);
  assert.ok(machine, `the running day holds a machine or cable move: ${ids}`);
  const stations = exerciseById(machine!)!.stations!;
  const changed = updateProfile(state, { gymItems: ALL_BUT(...stations) });
  assert.deepEqual(changed.current, state.current, 'the running session is the same object content: exercises and pairs');
  assert.ok(changed.profile!.gymItems);

  const next = running(changed.profile!);
  for (const exercise of next.current!.exercises) {
    assert.notEqual(exercise.exerciseId, machine, 'the removed exercise is not started');
  }
});

test('#357 ticks: the text adds, a tap wins over the text in both directions; nothing is guessed', async () => {
  const { gymTicks, gymSummary } = await import('../src/lib/myGym.ts');
  const read = readGymText('leg extension, leg curl, dumbbells, cable stack');
  assert.deepEqual(gymTicks([], read, {}), ['leg-extension', 'leg-curl', 'cable-stack', 'dumbbells']);
  assert.deepEqual(gymTicks([], read, { 'leg-curl': false, barbell: true }), ['leg-extension', 'cable-stack', 'dumbbells', 'barbell']);
  // A saved list keeps its ticks when the text names nothing.
  assert.deepEqual(gymTicks(['leg-press'], readGymText('a sauna'), {}), ['leg-press']);
  assert.deepEqual(gymTicks(['leg-press'], [], { 'leg-press': false }), []);
  assert.equal(gymSummary({}), 'Not set: every machine counts. List what your gym has so plans use only that.');
  assert.equal(gymSummary({ gymItems: ['leg-press'] }), '1 item: Leg press.');
  assert.equal(gymSummary({ gymItems: ['leg-extension', 'leg-curl', 'cable-stack', 'dumbbells'] }), '4 items: Leg extension, Leg curl, Cable stack (single) and 1 more.');
});

test('#357 review 1: a saved list is a gym kit: labels stay "Your gym" and a stale home rack stays unread', async () => {
  const { isGymKit, ownedLoads } = await import('../src/lib/progression.ts');
  const { gearLabel } = await import('../src/lib/todayTalk.ts');
  const { equipmentTitle } = await import('../src/lib/coachLabels.ts');
  // A gym profile still carrying a dumbbell rack saved before #180, then the story's own list (no barbell).
  const stale: Profile = { ...gym, loads: { Dumbbell: [5, 10, 12.5] } };
  assert.equal(isGymKit(stale), true);
  const saved: Profile = { ...stale, ...gymPatch(['leg-extension', 'leg-curl', 'dumbbells', 'cable-stack']) };
  assert.deepEqual(saved.equipment, ['Dumbbell', 'Machine', 'Cable']);
  assert.equal(isGymKit(saved), true);
  assert.deepEqual(ownedLoads(saved), {}, 'the stale rack never caps a gym list');
  assert.equal(gearLabel('home', saved), 'Your gym');
  assert.equal(equipmentTitle(saved), 'Gym equipment');
  // Absent field: unchanged rules (a dumbbell-and-machine kit without a list is still home gear).
  const noList: Profile = { ...saved, gymItems: undefined };
  assert.equal(isGymKit(noList), false);
  assert.deepEqual(ownedLoads(noList), { Dumbbell: [5, 10, 12.5] });
});

test('#357 review 2: a home kit with cables never sees My gym, so its dumbbell rack is still read', async () => {
  const { ownedLoads } = await import('../src/lib/progression.ts');
  const { defaultConstraints } = await import('../src/lib/constraints.ts');
  const homeCable: Profile = { ...profileOf({ equipment: ['Dumbbell', 'Cable'], support: ['Bench'] }, 'Intermediate', 3, 45), loads: { Dumbbell: [5, 10, 15] } };
  assert.equal(showsMyGym(homeCable), false, 'no row, so no list can be saved from Settings');
  assert.deepEqual(ownedLoads(homeCable), { Dumbbell: [5, 10, 15] });
  assert.deepEqual(defaultConstraints(homeCable).loads, [5, 10, 15]);
});
