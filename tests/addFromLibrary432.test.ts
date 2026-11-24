import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import { loadModeOf, needsLoad, setText, setUnit } from '../src/data/flagship.ts';
import {
  applyLibraryIndex, libraryExerciseById, libraryFamily, libraryLoadEquipment, resetLibrary,
} from '../src/data/library.ts';
import { LIBRARY_FILES } from '../src/data/libraryFiles.ts';
import { ADDED_SETS, addLibraryExercise, addedPrescription, noWeightLine } from '../src/lib/addFromLibrary.ts';
import { swapCandidateFor } from '../src/lib/adapt.ts';
import { exerciseActions } from '../src/lib/exerciseActions.ts';
import { buildPlan, generateWorkout } from '../src/lib/generator.ts';
import { progressionLines } from '../src/lib/liveProgression.ts';
import { setExerciseNote } from '../src/lib/notes.ts';
import { rankedReplacements } from '../src/lib/replacements.ts';
import { applyFinish, createSession, sessionProgress, skipExercise, unskipExercise } from '../src/lib/session.ts';
import { sessionRests } from '../src/lib/sessionTime.ts';
import { EMPTY_STATE, serializeExport } from '../src/lib/storage.ts';
import { parseState } from '../src/lib/validate.ts';
import type { AppState, Profile, WorkoutRecord } from '../src/types.ts';

/* #432: Add from library. A catalog row joins the open workout only, and logs as its family. */

const root = new URL('..', import.meta.url).pathname;
const indexFile = JSON.parse(readFileSync(join(root, 'public', LIBRARY_FILES.index), 'utf8'));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const BANDS = 'lib-f-Band_Pull_Apart';
const STRETCH = 'lib-f-Seated_Hamstring';
const NOW = '2026-11-24T09:00:00.000Z';

const profileOf = (extra: Partial<Profile>): Profile => ({
  goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4, unit: 'kg', sessionMinutes: 45,
  equipment: [], support: [], exclusions: [], loads: {}, ...extra,
} as Profile);
const PROFILES: Profile[] = [
  profileOf({ equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar', 'Dip bars', 'Box', 'Ab wheel'] }),
  profileOf({ equipment: ['Dumbbell'], support: ['Bench'], daysPerWeek: 3, goal: 'Get Stronger' }),
  profileOf({ equipment: [], support: [], daysPerWeek: 5, experience: 'Beginner' }),
];

/** A Push workout in progress: set 1 of the first exercise logged, resting. */
function openWorkout(): WorkoutRecord {
  const session = createSession({
    id: 'w-open', name: 'Push', dayIndex: 0, now: NOW, durationMin: 45,
    exercises: [
      { exerciseId: 'push-up', name: 'Push-Up', planned: [{ weight: 0, reps: 10 }, { weight: 0, reps: 10 }],
        performed: [{ weight: 0, reps: 10, done: true, completedAt: NOW }, { weight: 0, reps: 10, done: false, completedAt: null }] },
      { exerciseId: 'plank', name: 'Plank', planned: [{ weight: 0, reps: 30 }],
        performed: [{ weight: 0, reps: 30, done: false, completedAt: null }] },
    ],
  });
  return { ...session, restStartedAt: NOW };
}

const builtInRules = () => EXERCISES.map((exercise) => [exercise.id, loadModeOf(exercise.id), setUnit(exercise.id), needsLoad(exercise.id), setText(exercise.id, 8)]);

test('#432 families: Bands reps only, Stretching seconds held, cardio optional weight; built-in units unchanged', () => {
  resetLibrary();
  const before = builtInRules();
  // Before the index loads an added row logs reps, with no weight asked for.
  assert.equal(libraryFamily(BANDS), undefined);
  assert.equal(loadModeOf(BANDS), 'none');
  assert.equal(needsLoad(BANDS), false);
  applyLibraryIndex(indexFile);
  assert.deepEqual(builtInRules(), before, 'no built-in moves');

  assert.equal(libraryFamily(BANDS), 'none');
  assert.equal(loadModeOf(BANDS), 'none');
  assert.equal(setUnit(BANDS), 'reps');
  assert.equal(needsLoad(BANDS), false);

  assert.equal(libraryExerciseById(STRETCH)?.group, 'Stretching');
  assert.equal(libraryFamily(STRETCH), 'timed');
  assert.equal(setUnit(STRETCH), 'seconds');
  assert.equal(loadModeOf(STRETCH), 'none');
  assert.equal(setText(STRETCH, 30), '30s');

  const cardio = [...indexFile.rows].find((row: { group: string; logType: string }) => row.group === 'Cardio' && row.logType === 'free');
  assert.ok(cardio);
  assert.equal(libraryFamily(cardio.id), 'free');
  assert.equal(loadModeOf(cardio.id), 'total');
  assert.equal(needsLoad(cardio.id), false, 'cardio weight is optional');

  const each = [...indexFile.rows].find((row: { equipment: string; logType: string }) => row.equipment === 'Dumbbell' && row.logType === 'each');
  assert.ok(each);
  assert.equal(loadModeOf(each.id), 'each');
  assert.equal(needsLoad(each.id), true);
  assert.equal(libraryLoadEquipment(each.id), 'Dumbbell');
  assert.equal(libraryLoadEquipment(BANDS), undefined);
  assert.equal(libraryFamily('push-up'), undefined, 'a built-in id is never a library family');
  resetLibrary();
  assert.deepEqual(builtInRules(), before);
});

test('#432 add: a library row goes after the last exercise; the current set, rest and every other entry stay', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const open = openWorkout();
  const snapshot = plain(open);
  const row = libraryExerciseById(BANDS)!;
  const next = addLibraryExercise(open, row);
  assert.deepEqual(plain(open), snapshot, 'the input is not mutated');
  assert.equal(next.exercises.length, 3);
  assert.deepEqual(plain(next.exercises.slice(0, 2)), snapshot.exercises);
  const { exercises: _a, ...restNext } = plain(next);
  const { exercises: _b, ...restOpen } = snapshot;
  assert.deepEqual(restNext, restOpen, 'timer, status, ids and links unchanged');
  const added = next.exercises[2];
  assert.equal(added.exerciseId, BANDS);
  assert.equal(added.name, row.name);
  assert.equal(added.performed.length, ADDED_SETS);
  assert.ok(added.performed.every((set) => set.weight === 0 && set.reps === 15 && !set.done && set.completedAt === null));
  assert.deepEqual(Object.keys(added).sort(), ['exerciseId', 'name', 'performed', 'planned']);
  // The pending set is still the one it was: push-up set 2.
  assert.equal(sessionProgress(next).done, 1);
  assert.equal(next.exercises[0].performed[1].done, false);

  const stretch = addLibraryExercise(next, libraryExerciseById(STRETCH)!);
  assert.ok(stretch.exercises[3].planned.every((set) => set.reps === 30 && set.weight === 0));

  const finished = { ...open, status: 'completed' as const };
  assert.equal(addLibraryExercise(finished, row), finished, 'a finished workout is never changed');
  assert.deepEqual(addedPrescription(undefined), { weight: 0, reps: 10 });
  assert.equal(noWeightLine('Bands'), 'Bands have no weight to log.');
  assert.equal(noWeightLine('Exercise ball'), 'No weight to log for this one.');
  resetLibrary();
});

test('#432 save, restore and export: an added row and its note round-trip unchanged, library loaded or not', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  let current = addLibraryExercise(openWorkout(), libraryExerciseById(STRETCH)!);
  current = setExerciseNote(current, 2, STRETCH, '30 sec hold, left leg');
  current = { ...current, exercises: current.exercises.map((entry, i) => i !== 2 ? entry : {
    ...entry, performed: entry.performed.map((set, s) => (s === 0 ? { ...set, reps: 45, done: true, completedAt: NOW } : set)),
  }) };
  const state = { ...EMPTY_STATE, profile: PROFILES[0], current } as AppState;
  resetLibrary();
  const parsed = parseState(serializeExport(state));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.deepEqual(plain(parsed.ok && parsed.state.current), plain(current));
  const entry = parsed.ok ? parsed.state.current!.exercises[2] : null;
  assert.equal(entry?.note, '30 sec hold, left leg');
  assert.equal(entry?.performed[0].reps, 45, 'seconds held are stored in reps');

  // Finished, it is history like any other exercise; the record keeps it after another export.
  const after = applyFinish(parsed.ok ? parsed.state : state, current.id, { early: true, now: NOW });
  assert.equal(after.current, null);
  assert.equal(after.history[0].exercises[2].exerciseId, STRETCH);
  const again = parseState(serializeExport(after));
  assert.ok(again.ok);
  assert.deepEqual(plain(again.ok && again.state.history[0].exercises[2]), plain(after.history[0].exercises[2]));
});

test('#432 remove and undo: an added row skips and returns like any other exercise', () => {
  resetLibrary();
  applyLibraryIndex(indexFile);
  const open = addLibraryExercise(openWorkout(), libraryExerciseById(BANDS)!);
  const skipped = skipExercise(open, 2);
  assert.equal(skipped.exercises[2].skipped, true);
  assert.equal(skipped.exercises[2].exerciseId, BANDS);
  assert.deepEqual(plain(skipped.exercises.slice(0, 2)), plain(open.exercises.slice(0, 2)));
  assert.equal(sessionProgress(skipped).done, sessionProgress(open).done);
  const back = unskipExercise(skipped, 2);
  assert.deepEqual(plain(back.exercises), plain(open.exercises));
  resetLibrary();
});

test('#432 actions: an added row offers no Replace and no planner preference; a built-in keeps every row', () => {
  const ids = (library: boolean) => exerciseActions(3, 0, true, false, false, library).map((action) => action.id);
  assert.deepEqual(ids(false), ['instructions', 'history', 'note', 'set-all', 'replace', 'more', 'less', 'dont-recommend', 'remove-today']);
  assert.deepEqual(ids(true), ['instructions', 'history', 'note', 'set-all', 'remove-today']);
  assert.equal(exerciseActions(3, 0, true, false, false, true)[0].label, 'Instructions');
  assert.deepEqual(exerciseActions(0, 3, true, true, false, true).map((action) => action.id), ['instructions', 'history', 'note', 'return']);
});

test('#432 the open workout and finish read an added row safely, library loaded or not', () => {
  for (const loaded of [false, true]) {
    resetLibrary();
    if (loaded) applyLibraryIndex(indexFile);
    const row = { id: BANDS, name: 'Band Pull Apart' };
    const open = addLibraryExercise(openWorkout(), row);
    assert.equal(sessionProgress(open).total, 6);
    const rests = sessionRests(open.exercises.map((entry) => entry.exerciseId), 'Build Muscle', 45);
    assert.equal(rests.length, 3);
    assert.ok(rests.every((value) => Number.isFinite(value) && value > 0));
    const done = { ...open, status: 'completed' as const };
    const lines = progressionLines(done, PROFILES[0], [done], 'kg');
    assert.ok(Array.isArray(lines));
  }
  resetLibrary();
});

function plannerOutput(): string {
  return JSON.stringify(PROFILES.map((profile) => {
    const plan = buildPlan(profile);
    return {
      plan,
      days: plan.map((day, i) => generateWorkout(profile, day, i)),
      replace: EXERCISES.map((exercise) => rankedReplacements(exercise, profile, [], 6).map((item) => item.id)),
    };
  }));
}

test('#432 planner unchanged: an added row in the open workout and history never reaches plans, Swap or Replace', () => {
  resetLibrary();
  const before = plannerOutput();
  const swapsBefore = JSON.stringify(EXERCISES.map((exercise) => swapCandidateFor(exercise, PROFILES[0], [], openWorkout())));
  applyLibraryIndex(indexFile);
  const open = addLibraryExercise(addLibraryExercise(openWorkout(), libraryExerciseById(BANDS)!), libraryExerciseById(STRETCH)!);
  const finished = { ...open, id: 'w-old', status: 'completed' as const,
    exercises: open.exercises.map((entry) => ({ ...entry, performed: entry.performed.map((set) => ({ ...set, done: true, completedAt: NOW })) })) };
  const history = [finished];
  const after = JSON.stringify(PROFILES.map((profile) => {
    const plan = buildPlan(profile);
    return {
      plan,
      days: plan.map((day, i) => generateWorkout(profile, day, i)),
      replace: EXERCISES.map((exercise) => rankedReplacements(exercise, profile, [], 6).map((item) => item.id)),
    };
  }));
  assert.equal(after, before);
  assert.doesNotMatch(after, /lib-/);
  const withHistory = JSON.stringify(PROFILES.map((profile) => EXERCISES.map((exercise) => rankedReplacements(exercise, profile, history, 6).map((item) => item.id))));
  assert.doesNotMatch(withHistory, /lib-/);
  const swapsAfter = JSON.stringify(EXERCISES.map((exercise) => swapCandidateFor(exercise, PROFILES[0], [], open)));
  assert.equal(swapsAfter, swapsBefore);
  assert.doesNotMatch(JSON.stringify(EXERCISES.map((exercise) => swapCandidateFor(exercise, PROFILES[0], history, open))), /lib-/);
  resetLibrary();
});
